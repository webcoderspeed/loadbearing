import { readFileSync } from 'node:fs';
import type { ProfileReport } from './profiler.js';
import { splitSections, buildFull } from './sections.js';

/**
 * Emit a slimmed context file by removing only sections we are confident add no
 * measurable value. Trim is the one action that can destroy trust if it cuts a
 * load-bearing section, so it is conservative by design: a section is removed
 * ONLY if it is labeled no-measurable-effect/cost-only AND confidence is not
 * 'low'. A false "keep" is harmless; a false "cut" is not.
 */
export interface TrimResult {
  trimmed: string;
  removedIds: string[];
  removedTokens: number;
  keptCount: number;
}

export function trim(report: ProfileReport, opts: { aggressive?: boolean } = {}): TrimResult {
  const content = readFileSync(report.contextFile, 'utf8');
  const { sections } = splitSections(content);

  const removable = new Set(
    report.sections
      .filter((s) => {
        // Never cut something we couldn't confidently judge — a false cut is
        // unrecoverable, a false keep is harmless.
        if (s.label === 'load-bearing' || s.label === 'insufficient-data') return false;
        if (s.confidence === 'low' && !opts.aggressive) return false;
        return true;
      })
      .map((s) => s.id),
  );

  const kept = sections.filter((s) => !removable.has(s.id));
  const removed = report.sections.filter((s) => removable.has(s.id));

  return {
    trimmed: buildFull(kept),
    removedIds: [...removable],
    removedTokens: removed.reduce((a, s) => a + s.inherentTokens, 0),
    keptCount: kept.length,
  };
}
