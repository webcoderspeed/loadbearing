import type { NoiseFloor, SectionVerdict } from '../types.js';

// Robust statistics for grading sections against agent run-to-run noise.
// Token spend is frequently bimodal (a low mode usually means the task failed),
// so we lean on median/MAD over mean/stddev and refuse to grade when the floor
// can't be trusted. Zero deps; the bootstrap RNG is seeded for reproducibility.

export const MIN_TRIALS_FOR_VERDICT = 3;
export const MIN_TRIALS_FOR_MEDIUM = 4;
export const MIN_TRIALS_FOR_HIGH = 8;
export const MIN_N_FOR_BIMODALITY = 4;

export function mean(xs: number[]): number {
  if (!xs.length) return 0;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

export function stddev(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  const v = xs.reduce((a, b) => a + (b - m) ** 2, 0) / (xs.length - 1);
  return Math.sqrt(v);
}

export function cv(xs: number[]): number {
  const m = mean(xs);
  return m ? stddev(xs) / m : 0;
}

export function median(xs: number[]): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

/** Median absolute deviation, scaled to match stddev for normal data. */
export function mad(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = median(xs);
  const devs = xs.map((x) => Math.abs(x - m));
  return 1.4826 * median(devs);
}

export function robustCv(xs: number[]): number {
  const c = median(xs);
  return c ? mad(xs) / c : 0;
}

/** True when the sample splits into two distinct modes rather than jittering around one. */
export function isBimodal(xs: number[], opts: { absTokenFloor?: number } = {}): boolean {
  if (xs.length < MIN_N_FOR_BIMODALITY) return false;
  const s = [...xs].sort((a, b) => a - b);
  const range = s[s.length - 1]! - s[0]!;
  if (range < (opts.absTokenFloor ?? 2000)) return false;
  // One dominant gap eating most of the range = two modes. (gap/range, not MAD —
  // MAD is itself inflated by the split.)
  let maxGap = 0;
  for (let i = 1; i < s.length; i++) {
    maxGap = Math.max(maxGap, s[i]! - s[i - 1]!);
  }
  return maxGap / range > 0.5;
}

/** Mulberry32 — seeded PRNG so bootstrap CIs are reproducible. */
export function makeRng(seed: number): () => number {
  let a = seed >>> 0;
  return function (): number {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Percentile bootstrap CI for the mean of `xs`. */
export function bootstrapCI(
  xs: number[],
  opts: { iters?: number; ci?: number; seed?: number } = {},
): { lo: number; hi: number; mean: number } {
  const { iters = 2000, ci = 0.95, seed = 1234 } = opts;
  const m = mean(xs);
  if (xs.length < 2) return { lo: m, hi: m, mean: m };
  const rng = makeRng(seed);
  const means = new Array<number>(iters);
  for (let i = 0; i < iters; i++) {
    let s = 0;
    for (let j = 0; j < xs.length; j++) {
      s += xs[(rng() * xs.length) | 0]!;
    }
    means[i] = s / xs.length;
  }
  means.sort((a, b) => a - b);
  const lo = means[Math.floor(((1 - ci) / 2) * iters)]!;
  const hi = means[Math.floor((1 - (1 - ci) / 2) * iters) - 1]!;
  return { lo, hi, mean: m };
}

export interface ClassifyOptions {
  iters?: number;
  seed?: number;
  /** the section's own token weight, used to distinguish cost-only from no-effect */
  inherentCostTokens?: number;
  /** per-run pass/fail of the ablated variant — failures aren't noise */
  ablatedPasses?: boolean[];
  noiseFloorCvOrNull?: number | null;
}

/**
 * Grade a removed section. Gates to `insufficient-data` when the data is thin,
 * bimodal, failure-contaminated, or the floor is unmeasured; otherwise calls
 * load-bearing / cost-only / no-measurable-effect on robust medians.
 */
export function classifySection(
  baseline: number[],
  ablated: number[],
  noiseFloorCv: number | null,
  opts: ClassifyOptions = {},
): SectionVerdict {
  const bMed = median(baseline);
  const aMed = median(ablated);
  const deltaTokens = bMed - aMed; // positive => removing the section saved tokens
  const deltaPct = bMed ? deltaTokens / bMed : 0;
  const range = { min: Math.min(...ablated), max: Math.max(...ablated) };
  const passes = opts.ablatedPasses ?? [];
  const passRate = passes.length ? passes.filter(Boolean).length / passes.length : 1;

  const base = (
    label: SectionVerdict['label'],
    confidence: SectionVerdict['confidence'],
    reason: string,
    extra: Partial<SectionVerdict> = {},
  ): SectionVerdict => ({
    label,
    baselineMedian: bMed,
    ablatedMedian: aMed,
    deltaTokens,
    deltaPct,
    ci: { lo: 0, hi: 0 },
    noiseBandTokens: noiseFloorCv != null ? 2 * noiseFloorCv * bMed : 0,
    clearsNoise: false,
    confidence,
    reason,
    range,
    passRate,
    ...extra,
  });

  // ---- GATES (honest "I can't tell") ----
  if (noiseFloorCv == null) {
    return base('insufficient-data', 'low', 'noise floor is UNMEASURED — can’t judge any section against it');
  }
  if (ablated.length < MIN_TRIALS_FOR_VERDICT) {
    return base(
      'insufficient-data',
      'low',
      `ran N=${ablated.length}, need >=${MIN_TRIALS_FOR_VERDICT} trials to estimate noise`,
    );
  }
  if (passes.length && passRate < 0.6) {
    return base(
      'insufficient-data',
      'low',
      `only ${(passRate * 100).toFixed(0)}% of ablated runs passed — low token runs look like task failures, not noise`,
    );
  }
  if (isBimodal(ablated)) {
    return base(
      'insufficient-data',
      'low',
      `ablated runs are bimodal (${Math.round(range.min / 1000)}k–${Math.round(range.max / 1000)}k) — two behavior modes, not jitter`,
    );
  }

  const { iters = 2000, seed = 99 } = opts;
  const rng = makeRng(seed);
  const diffs: number[] = [];
  for (let i = 0; i < iters; i++) {
    const bs: number[] = [];
    for (let j = 0; j < baseline.length; j++) bs.push(baseline[(rng() * baseline.length) | 0]!);
    const as: number[] = [];
    for (let j = 0; j < ablated.length; j++) as.push(ablated[(rng() * ablated.length) | 0]!);
    diffs.push(median(bs) - median(as));
  }
  diffs.sort((x, y) => x - y);
  const lo = diffs[Math.floor(0.025 * iters)]!;
  const hi = diffs[Math.floor(0.975 * iters) - 1]!;

  const noiseBandTokens = 2 * noiseFloorCv * bMed;
  const ciExcludesZero = lo * hi > 0;
  const halfWidth = (hi - lo) / 2;
  const clearsNoise =
    Math.abs(deltaTokens) > noiseBandTokens && ciExcludesZero && halfWidth < Math.abs(deltaTokens);

  const inherent = opts.inherentCostTokens ?? 0;

  if (clearsNoise) {
    const strong = Math.abs(deltaTokens) > 3 * noiseFloorCv * bMed && ablated.length >= MIN_TRIALS_FOR_HIGH;
    return base('load-bearing', strong ? 'high' : 'medium', 'removing it changed token spend beyond the noise floor', {
      ci: { lo, hi },
      clearsNoise: true,
    });
  }
  if (inherent > 0) {
    return base('cost-only', 'medium', 'no measurable behavior change, but it costs input tokens every turn', {
      ci: { lo, hi },
    });
  }
  return base(
    'no-measurable-effect',
    ablated.length >= MIN_TRIALS_FOR_HIGH ? 'medium' : 'low',
    'effect is within the noise floor at this power',
    { ci: { lo, hi } },
  );
}

/**
 * Estimate the noise floor from the same-context runs (baseline + noise), or
 * return UNMEASURED when it can't be trusted. `ablatedSwings` feeds the
 * cross-variant tripwire: if sections swing far more than the floor claims, the
 * null runs got a lucky-tight draw and the floor is a lie.
 */
export function noiseFloorVerdict(
  nullRuns: number[],
  opts: { ablatedSwings?: number[]; minTrials?: number } = {},
): NoiseFloor {
  const minTrials = opts.minTrials ?? MIN_TRIALS_FOR_VERDICT;

  if (nullRuns.length < minTrials) {
    return { band: 'UNMEASURED', pct: null, reason: `ran N=${nullRuns.length}, need >=${minTrials} same-context runs` };
  }
  if (isBimodal(nullRuns)) {
    return { band: 'UNMEASURED', pct: null, reason: 'same-context runs are bimodal — variance not estimable by one number' };
  }

  // max of robust and classic CV so a tight sample can't understate noise either way
  const floor = Math.max(robustCv(nullRuns), cv(nullRuns));

  const swings = opts.ablatedSwings ?? [];
  const maxSwing = swings.length ? Math.max(...swings) : 0;
  if (maxSwing > 2 * floor && maxSwing > 0.1) {
    return {
      band: 'UNMEASURED',
      pct: floor * 100,
      reason: `ablated variants swing up to ${(maxSwing * 100).toFixed(0)}% but same-context floor reads ${(floor * 100).toFixed(1)}% — the floor under-sampled the real variance`,
    };
  }

  const pct = floor * 100;
  let band: NoiseFloor['band'];
  if (pct < 10) band = 'SOLID';
  else if (pct < 25) band = 'USABLE';
  else if (pct < 50) band = 'SHAKY';
  else band = 'NO-FLOOR';
  return { band, pct, reason: `pooled from ${nullRuns.length} same-context runs` };
}
