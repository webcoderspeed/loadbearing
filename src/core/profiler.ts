import { readFileSync } from 'node:fs';
import type { Adapter, Fixture, RunResult, Section, SectionVerdict, NoiseFloor } from '../types.js';
import { splitSections, buildFull, buildAblated, estimateTokens } from './sections.js';
import { classifySection, noiseFloorVerdict, median, robustCv } from './stats.js';
import { isGitRepo, resetClean, verify, headHash, listUntracked } from './hermetic.js';

export interface ProfileOptions {
  repoDir: string;
  contextFile: string;
  fixtures: Fixture[];
  adapter: Adapter;
  model: string;
  /** trials per context variant (baseline, noise, each section) */
  trials: number;
  budgetUsd: number;
  onRun?: (info: ProgressInfo) => void;
}

export interface ProgressInfo {
  phase: 'baseline' | 'noise' | 'ablate';
  sectionId?: string;
  fixture: string;
  trial: number;
  totalTrials: number;
  result: RunResult;
}

export interface SectionReport extends SectionVerdict {
  id: string;
  heading: string | null;
  inherentTokens: number;
  ablatedRuns: number;
}

export interface ProfileReport {
  repoDir: string;
  contextFile: string;
  headHash: string;
  model: string;
  adapter: string;
  usingApiKey: boolean;
  trials: number;
  fixtures: string[];
  sections: SectionReport[];
  baseline: { meanTokens: number; runs: number; passRate: number };
  noiseFloor: NoiseFloor;
  totalContextTokens: number;
  inertTokens: number;
  generatedAt: string;
}

/**
 * Profile: baseline + noise run the identical full context (to measure the
 * noise floor), then each section is ablated and classified against that floor.
 */
export function profile(opts: ProfileOptions): ProfileReport {
  const { repoDir, contextFile, fixtures, adapter, model, trials, budgetUsd, onRun } = opts;

  if (!isGitRepo(repoDir)) {
    throw new Error(
      `loadbearing needs a git repo to guarantee identical state between runs.\n` +
        `Run "git init && git add -A && git commit -m baseline" in: ${repoDir}`,
    );
  }

  const content = readFileSync(contextFile, 'utf8');
  const { sections } = splitSections(content);
  if (sections.length === 0) {
    throw new Error(`No ablatable sections found in ${contextFile} (need markdown headings).`);
  }

  const fullContext = buildFull(sections);

  // Snapshot pre-existing untracked files so per-run cleans only remove what the agent creates.
  const preserve = listUntracked(repoDir);

  const runVariant = (
    phase: ProgressInfo['phase'],
    contextText: string,
    sectionId: string | undefined,
  ): { tokens: number[]; passes: boolean[]; runs: RunResult[] } => {
    const tokens: number[] = [];
    const passes: boolean[] = [];
    const runs: RunResult[] = [];
    for (const fx of fixtures) {
      for (let t = 1; t <= trials; t++) {
        resetClean(repoDir, preserve);
        const r = adapter.run({ cwd: repoDir, prompt: fx.prompt, contextText, model, budgetUsd });
        r.testPass = verify(repoDir, fx.verifyCmd);
        runs.push(r);
        onRun?.({ phase, sectionId, fixture: fx.name, trial: t, totalTrials: trials, result: r });
        // Aborted runs (budget cap / error) aren't measurements; excluding them avoids poisoning the mean.
        if (r.aborted) continue;
        tokens.push(r.totalTokens);
        passes.push(r.testPass);
      }
    }
    resetClean(repoDir, preserve);
    return { tokens, passes, runs };
  };

  // baseline + noise share the identical full context: one same-context population for the noise floor.
  const baseline = runVariant('baseline', fullContext, undefined);
  const noise = runVariant('noise', fullContext, undefined);
  const nullRuns = [...baseline.tokens, ...noise.tokens];

  // Ablate first so the floor can be cross-checked against actual ablation swings — a lucky-tight null can't masquerade as the floor.
  interface Ablation {
    sec: Section;
    tokens: number[];
    passes: boolean[];
  }
  const ablations: Ablation[] = [];
  for (const sec of sections) {
    const ablatedContext = buildAblated(sections, sec.id);
    const ab = runVariant('ablate', ablatedContext, sec.id);
    ablations.push({ sec, tokens: ab.tokens, passes: ab.passes });
  }

  const ablatedSwings = ablations.map((a) => robustCv(a.tokens));
  const nf = noiseFloorVerdict(nullRuns, { ablatedSwings });
  const floorCv = nf.band === 'UNMEASURED' ? null : (nf.pct ?? 0) / 100;

  const sectionReports: SectionReport[] = ablations.map(({ sec, tokens, passes }) => {
    const verdict = classifySection(nullRuns, tokens, floorCv, {
      inherentCostTokens: estimateTokens(sec.text),
      ablatedPasses: passes,
    });
    return {
      ...verdict,
      id: sec.id,
      heading: sec.heading,
      inherentTokens: estimateTokens(sec.text),
      ablatedRuns: tokens.length,
    };
  });

  const totalRuns = nullRuns.length;
  const totalPasses = [...baseline.passes, ...noise.passes].filter(Boolean).length;
  // Only count tokens confidently shown to add no value (exclude insufficient-data).
  const inertTokens = sectionReports
    .filter((s) => s.label === 'cost-only' || s.label === 'no-measurable-effect')
    .reduce((a, s) => a + s.inherentTokens, 0);

  return {
    repoDir,
    contextFile,
    headHash: headHash(repoDir),
    model,
    adapter: adapter.name,
    usingApiKey: adapter.usingApiKey(),
    trials,
    fixtures: fixtures.map((f) => f.name),
    sections: sectionReports,
    baseline: {
      meanTokens: median(nullRuns),
      runs: totalRuns,
      passRate: totalRuns ? totalPasses / totalRuns : 0,
    },
    noiseFloor: nf,
    totalContextTokens: estimateTokens(content),
    inertTokens,
    generatedAt: nowIso(),
  };
}

// Centralized so deterministic call sites never reach for argless new Date() directly.
function nowIso(): string {
  return new Date().toISOString();
}
