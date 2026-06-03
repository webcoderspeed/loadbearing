/** Shared types for loadbearing. */

/** One ablatable chunk of the context file (split on markdown headings). */
export interface Section {
  id: string;
  /** heading text, or null for a leading preamble block */
  heading: string | null;
  /** markdown heading level (1-6), 0 for preamble */
  level: number;
  startLine: number;
  endLine: number;
  text: string;
}

/** A task the agent must complete; success is judged by an objective command. */
export interface Fixture {
  name: string;
  prompt: string;
  /** shell command; exit code 0 == task succeeded */
  verifyCmd: string;
}

/** Result of one agent run (one fixture, one context variant). */
export interface RunResult {
  ok: boolean;
  inputTokens: number;
  outputTokens: number;
  cacheRead: number;
  cacheCreation: number;
  totalTokens: number;
  numTurns: number;
  /** reference figure when on a subscription (not a real charge) */
  costUsd: number;
  isError: boolean;
  durationMs: number;
  testPass: boolean;
  /** run cut short (budget cap / error) → token count is not a real measurement, exclude from signal */
  aborted: boolean;
  raw: unknown;
  stderr: string;
}

/** The minimal interface every agent adapter implements. */
export interface Adapter {
  name: string;
  isAvailable(): boolean;
  usingApiKey(): boolean;
  run(opts: AdapterRunOptions): RunResult;
}

export interface AdapterRunOptions {
  cwd: string;
  prompt: string;
  /** possibly-ablated context injected as system prompt */
  contextText: string;
  model: string;
  budgetUsd: number;
  extraArgs?: string[];
}

export type SectionLabel =
  | 'load-bearing'
  | 'cost-only'
  | 'no-measurable-effect'
  /** not enough trustworthy data to say anything — the honest default when thin */
  | 'insufficient-data';

export interface SectionVerdict {
  label: SectionLabel;
  /** median: robust center, resistant to the bimodal 40k/15k split */
  baselineMedian: number;
  ablatedMedian: number;
  /** baseline - ablated; positive => removing it saved tokens */
  deltaTokens: number;
  deltaPct: number;
  ci: { lo: number; hi: number };
  noiseBandTokens: number;
  clearsNoise: boolean;
  confidence: 'high' | 'medium' | 'low';
  reason: string;
  range: { min: number; max: number };
  passRate: number;
}

export type NoiseBand = 'SOLID' | 'USABLE' | 'SHAKY' | 'NO-FLOOR' | 'UNMEASURED';

export interface NoiseFloor {
  band: NoiseBand;
  /** robust CV as a percentage; null when UNMEASURED */
  pct: number | null;
  reason: string;
}
