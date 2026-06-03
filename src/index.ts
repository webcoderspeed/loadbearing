/**
 * loadbearing — programmatic API.
 *
 * Profile a coding-agent context file (CLAUDE.md / AGENTS.md) to see which
 * sections actually earn their tokens, with the measurement noise floor shown.
 */
export { profile } from './core/profiler.js';
export type {
  ProfileOptions,
  ProfileReport,
  SectionReport,
  ProgressInfo,
} from './core/profiler.js';

export { splitSections, buildAblated, buildFull, estimateTokens } from './core/sections.js';
export {
  classifySection,
  noiseFloorVerdict,
  bootstrapCI,
  mean,
  stddev,
  cv,
} from './core/stats.js';
export { trim } from './core/trim.js';
export type { TrimResult } from './core/trim.js';
export { loadConfig, findContextFile, SAMPLE_CONFIG } from './core/config.js';
export type { LoadbearingConfig } from './core/config.js';
export { claudeCodeAdapter } from './adapters/claude-code.js';
export { renderHtml } from './report/html.js';
export { renderTerminal } from './report/terminal.js';

export type {
  Section,
  Fixture,
  RunResult,
  Adapter,
  AdapterRunOptions,
  SectionLabel,
  SectionVerdict,
  NoiseBand,
  NoiseFloor,
} from './types.js';
