import { writeFileSync, existsSync, readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { profile, type ProgressInfo } from './core/profiler.js';
import { MIN_TRIALS_FOR_VERDICT, MIN_TRIALS_FOR_HIGH } from './core/stats.js';
import { loadConfig, findContextFile, SAMPLE_CONFIG } from './core/config.js';
import { detectSuite, fixturesFromTests } from './core/fixtures.js';
import { claudeCodeAdapter } from './adapters/claude-code.js';
import { renderTerminal } from './report/terminal.js';
import { renderHtml } from './report/html.js';
import { trim } from './core/trim.js';
import type { ProfileReport } from './core/profiler.js';

const VERSION = '0.1.0';

function parseFlags(argv: string[]): { _: string[]; flags: Record<string, string | boolean> } {
  const _: string[] = [];
  const flags: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith('--')) {
        flags[key] = next;
        i++;
      } else {
        flags[key] = true;
      }
    } else {
      _.push(a);
    }
  }
  return { _, flags };
}

const HELP = `loadbearing v${VERSION}
Profile your CLAUDE.md / AGENTS.md by what it actually costs and what it actually
changes — see which sections earn their tokens, with the noise floor shown.

USAGE
  loadbearing profile [repoDir] [options]   run the ablation profile
  loadbearing trim    [repoDir] [options]   emit a slimmed context file from a report
  loadbearing init    [repoDir]             write a starter loadbearing.json
  loadbearing init --from-tests [repoDir]   scaffold fixtures from your test suite
  loadbearing --help

OPTIONS (profile)
  --config <path>     path to loadbearing.json (default: <repoDir>/loadbearing.json)
  --context <file>    context file to profile (default: auto-detect CLAUDE.md/AGENTS.md)
  --model <name>      agent model (default: from config or "haiku")
  --trials <n>        trials per context variant (default: from config or 5)
  --budget <usd>      per-run budget cap (default: 0.5)
  --html <path>       also write the HTML report card (default: loadbearing-report.html)
  --json <path>       write the raw report JSON

OPTIONS (trim)
  --report <path>     report JSON from a previous profile (default: loadbearing-report.json)
  --out <path>        where to write the slimmed file (default: alongside, .trimmed.md)
  --aggressive        also drop low-confidence no-effect sections

Auth: with ANTHROPIC_API_KEY set, runs in --bare mode (cleanest baseline).
Otherwise uses your existing Claude subscription login (cost shown is reference only).
`;

function main(): void {
  const argv = process.argv.slice(2);
  const { _, flags } = parseFlags(argv);
  const cmd = _[0];

  if (flags['help'] || flags['h'] || cmd === 'help' || (!cmd && argv.length === 0)) {
    process.stdout.write(HELP);
    return;
  }
  if (flags['version'] || flags['v']) {
    process.stdout.write(`${VERSION}\n`);
    return;
  }

  const repoDir = resolve(_[1] ?? '.');

  try {
    if (cmd === 'init') return cmdInit(repoDir, flags);
    if (cmd === 'profile') return cmdProfile(repoDir, flags);
    if (cmd === 'trim') return cmdTrim(repoDir, flags);
    process.stderr.write(`Unknown command: ${cmd ?? '(none)'}\n\n${HELP}`);
    process.exit(2);
  } catch (e) {
    process.stderr.write(`\n✖ ${(e as Error).message}\n`);
    process.exit(1);
  }
}

function cmdInit(repoDir: string, flags: Record<string, string | boolean>): void {
  const path = join(repoDir, 'loadbearing.json');
  if (existsSync(path)) {
    process.stderr.write(`loadbearing.json already exists at ${path}\n`);
    process.exit(1);
  }

  // --from-tests: scaffold fixtures from the repo's existing test suite, so the
  // user reaches first value without hand-authoring tasks + verify commands.
  if (flags['from-tests']) {
    const suite = detectSuite(repoDir);
    const fixtures = fixturesFromTests(repoDir);
    if (fixtures.length === 0) {
      process.stderr.write(
        `No test files (*.test.* / *.spec.*) found under ${repoDir}.\n` +
          `Run "loadbearing init" for a manual template instead.\n`,
      );
      process.exit(1);
    }
    const config = { ...SAMPLE_CONFIG, fixtures };
    writeFileSync(path, JSON.stringify(config, null, 2) + '\n');
    process.stdout.write(
      `✓ Wrote ${path} with ${fixtures.length} fixture(s) scaffolded from your ${suite.runner} suite:\n` +
        fixtures.map((f) => `    • ${f.name}  →  ${f.verifyCmd}`).join('\n') +
        `\n\n  Review/trim the fixtures, then run:  loadbearing profile\n` +
        `  Tip: keep 3-4 fast, self-contained tests for a cheaper, cleaner profile.\n`,
    );
    return;
  }

  writeFileSync(path, JSON.stringify(SAMPLE_CONFIG, null, 2) + '\n');
  process.stdout.write(
    `✓ Wrote ${path}\n  Edit the "fixtures" array with 3-5 real tasks, then run:  loadbearing profile\n` +
      `  Or auto-scaffold from your tests:  loadbearing init --from-tests\n`,
  );
}

function cmdProfile(repoDir: string, flags: Record<string, string | boolean>): void {
  if (!claudeCodeAdapter.isAvailable()) {
    throw new Error('`claude` CLI not found on PATH. Install Claude Code first.');
  }
  const cfg = loadConfig(repoDir, asStr(flags['config']));
  const contextFile = findContextFile(repoDir, asStr(flags['context']) ?? cfg.contextFile);
  const model = asStr(flags['model']) ?? cfg.model;
  const trials = flags['trials'] ? Number(flags['trials']) : cfg.trials;
  const budgetUsd = flags['budget'] ? Number(flags['budget']) : cfg.budgetUsd;

  const totalVariants = 2 + countSections(contextFile); // baseline + noise + sections
  const totalRuns = totalVariants * cfg.fixtures.length * trials;

  if (trials < MIN_TRIALS_FOR_VERDICT) {
    process.stderr.write(
      `\n\x1b[33m⚠ trials=${trials} is below the minimum (${MIN_TRIALS_FOR_VERDICT}) needed to estimate the\n` +
        `  noise floor. Sections will likely be reported INSUFFICIENT-DATA.\n` +
        `  Re-run with --trials ${MIN_TRIALS_FOR_HIGH} for trustworthy verdicts.\x1b[0m\n\n`,
    );
  }

  process.stderr.write(
    `Profiling ${rel(repoDir, contextFile)} · ${cfg.fixtures.length} fixture(s) × ${trials} trials ` +
      `× ${totalVariants} variants = ~${totalRuns} agent runs (${model})\n`,
  );
  if (!claudeCodeAdapter.usingApiKey()) {
    process.stderr.write(`Using your Claude subscription login — cost figures are reference only.\n`);
  }
  process.stderr.write('\n');

  let done = 0;
  let aborted = 0;
  const onRun = (info: ProgressInfo): void => {
    done++;
    const where = info.phase === 'ablate' ? `ablate#${info.sectionId}` : info.phase;
    const r = info.result;
    const mark = r.aborted ? '✗' : r.testPass ? '✓' : '·';
    const note = r.aborted ? ' aborted (budget/error — excluded)' : `${r.totalTokens.toLocaleString()}t`;
    if (r.aborted) aborted++;
    process.stderr.write(`  [${String(done).padStart(3)}/${totalRuns}] ${mark} ${where} ${info.fixture} ${note}\n`);
    if (aborted === 3) {
      process.stderr.write(
        `  \x1b[33m⚠ several runs are being aborted — raise --budget (each Sonnet run can cost >$1) so runs complete.\x1b[0m\n`,
      );
    }
  };

  const report = profile({
    repoDir,
    contextFile,
    fixtures: cfg.fixtures,
    adapter: claudeCodeAdapter,
    model,
    trials,
    budgetUsd,
    onRun,
  });

  process.stdout.write(renderTerminal(report));

  const jsonPath = asStr(flags['json']) ?? join(repoDir, 'loadbearing-report.json');
  writeFileSync(jsonPath, JSON.stringify(report, null, 2) + '\n');

  const htmlPath = flags['html'] === false ? null : asStr(flags['html']) ?? join(repoDir, 'loadbearing-report.html');
  if (htmlPath) {
    writeFileSync(htmlPath, renderHtml(report));
    process.stdout.write(`\n${bold('report card')} → ${rel(repoDir, htmlPath)}\n`);
  }
  process.stdout.write(`${bold('json')}        → ${rel(repoDir, jsonPath)}\n`);
}

function cmdTrim(repoDir: string, flags: Record<string, string | boolean>): void {
  const reportPath = asStr(flags['report']) ?? join(repoDir, 'loadbearing-report.json');
  if (!existsSync(reportPath)) {
    throw new Error(`No report at ${reportPath}. Run "loadbearing profile" first.`);
  }
  const report = JSON.parse(readFileSync(reportPath, 'utf8')) as ProfileReport;
  const result = trim(report, { aggressive: !!flags['aggressive'] });
  const outPath = asStr(flags['out']) ?? report.contextFile.replace(/\.md$/, '') + '.trimmed.md';
  writeFileSync(outPath, result.trimmed);
  process.stdout.write(
    `✓ Trimmed ${result.removedIds.length} section(s) (~${result.removedTokens.toLocaleString()} tokens) → ${outPath}\n` +
      (result.removedIds.length
        ? `  removed: ${result.removedIds.join(', ')}\n  Review the diff and re-run your tasks before replacing the original.\n`
        : `  Nothing safe to trim — every section earns its tokens or is low-confidence.\n`),
  );
}

function countSections(contextFile: string): number {
  // light read to estimate run count for progress; profiler does the real split.
  const txt = readFileSync(contextFile, 'utf8');
  const m = txt.match(/^#{1,6}\s+/gm);
  return Math.max(1, m ? m.length : 1);
}

function asStr(v: string | boolean | undefined): string | undefined {
  return typeof v === 'string' ? v : undefined;
}
function rel(base: string, p: string): string {
  return p.startsWith(base) ? '.' + p.slice(base.length) : p;
}
function bold(s: string): string {
  return `\x1b[1m${s}\x1b[0m`;
}

main();
