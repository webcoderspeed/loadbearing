import { spawnSync } from 'node:child_process';
import type { Adapter, AdapterRunOptions, RunResult } from '../types.js';

/**
 * Claude Code adapter. With ANTHROPIC_API_KEY set we use --bare (disables
 * CLAUDE.md auto-discovery for a reproducible baseline); otherwise we fall back
 * to the user's claude.ai login and total_cost_usd becomes a reference figure.
 */

interface ClaudeJson {
  is_error?: boolean;
  subtype?: string;
  num_turns?: number;
  total_cost_usd?: number;
  duration_ms?: number;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    cache_read_input_tokens?: number;
    cache_creation_input_tokens?: number;
  };
}

function isAvailable(): boolean {
  const r = spawnSync('claude', ['--version'], { encoding: 'utf8' });
  return r.status === 0;
}

function usingApiKey(): boolean {
  return !!process.env['ANTHROPIC_API_KEY'];
}

function run(opts: AdapterRunOptions): RunResult {
  const { cwd, prompt, contextText, model, budgetUsd, extraArgs = [] } = opts;

  const args = [
    '-p',
    prompt,
    '--model',
    model,
    '--output-format',
    'json',
    '--permission-mode',
    'bypassPermissions',
    '--add-dir',
    cwd,
    '--max-budget-usd',
    String(budgetUsd),
  ];

  if (usingApiKey()) args.push('--bare');
  if (contextText && contextText.trim()) {
    args.push('--append-system-prompt', contextText);
  }
  args.push(...extraArgs);

  const res = spawnSync('claude', args, {
    cwd,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });

  const stderr = res.stderr ?? '';
  let raw: ClaudeJson;
  try {
    raw = JSON.parse(res.stdout) as ClaudeJson;
  } catch {
    return blank({ stderr: stderr || `unparseable stdout: ${truncate(res.stdout)}` });
  }

  const u = raw.usage ?? {};
  const inputTokens = u.input_tokens ?? 0;
  const outputTokens = u.output_tokens ?? 0;
  const cacheRead = u.cache_read_input_tokens ?? 0;
  const cacheCreation = u.cache_creation_input_tokens ?? 0;

  // Exclude cacheRead: it reflects provider cache warmth, not the context we
  // injected, so including it makes identical runs look wildly different.
  const totalTokens = inputTokens + outputTokens + cacheCreation;

  // Budget-capped or errored runs return partial/zero tokens; flag so the
  // profiler can drop them rather than poison the signal.
  const aborted =
    !!raw.is_error ||
    raw.subtype === 'error_max_budget_usd' ||
    (raw.subtype != null && raw.subtype !== 'success') ||
    totalTokens === 0;

  return {
    ok: !raw.is_error,
    inputTokens,
    outputTokens,
    cacheRead,
    cacheCreation,
    totalTokens,
    numTurns: raw.num_turns ?? 0,
    costUsd: raw.total_cost_usd ?? 0,
    isError: !!raw.is_error,
    durationMs: raw.duration_ms ?? 0,
    testPass: false, // set by the runner after the verify command
    aborted,
    raw,
    stderr,
  };
}

function blank(over: Partial<RunResult> = {}): RunResult {
  return {
    ok: false,
    inputTokens: 0,
    outputTokens: 0,
    cacheRead: 0,
    cacheCreation: 0,
    totalTokens: 0,
    numTurns: 0,
    costUsd: 0,
    isError: true,
    durationMs: 0,
    testPass: false,
    aborted: true,
    raw: null,
    stderr: '',
    ...over,
  };
}

function truncate(s: string, n = 300): string {
  s = String(s ?? '');
  return s.length > n ? s.slice(0, n) + '…' : s;
}

export const claudeCodeAdapter: Adapter = {
  name: 'claude-code',
  isAvailable,
  usingApiKey,
  run,
};
