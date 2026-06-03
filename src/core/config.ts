import { existsSync, readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import type { Fixture } from '../types.js';

/**
 * loadbearing config. A repo opts in with a `loadbearing.json` (or it can be
 * passed via flags). The fixture suite is the heart of it: a few real tasks,
 * each with an objective verify command.
 */
export interface LoadbearingConfig {
  /** path to the context file, relative to repo root (default CLAUDE.md) */
  contextFile: string;
  /** the task suite */
  fixtures: Fixture[];
  model: string;
  trials: number;
  budgetUsd: number;
}

const DEFAULTS: Omit<LoadbearingConfig, 'fixtures' | 'contextFile'> = {
  // Sonnet (capable model) gives far more consistent runs than Haiku, which
  // shrinks the noise floor and the failure-mode bimodality — better signal.
  model: 'sonnet',
  trials: 8,
  budgetUsd: 1.0,
};

export function findContextFile(repoDir: string, explicit?: string): string {
  if (explicit) return resolve(repoDir, explicit);
  for (const name of ['CLAUDE.md', 'AGENTS.md', '.cursor/rules', '.github/copilot-instructions.md']) {
    const p = join(repoDir, name);
    if (existsSync(p)) return p;
  }
  throw new Error(`No context file found in ${repoDir} (looked for CLAUDE.md, AGENTS.md, .cursor/rules).`);
}

export function loadConfig(repoDir: string, configPath?: string): LoadbearingConfig {
  const path = configPath ? resolve(configPath) : join(repoDir, 'loadbearing.json');
  if (!existsSync(path)) {
    throw new Error(
      `No config found at ${path}.\n` +
        `Create a loadbearing.json with a "fixtures" array — see "loadbearing init" or the README.`,
    );
  }
  let parsed: Partial<LoadbearingConfig>;
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8')) as Partial<LoadbearingConfig>;
  } catch (e) {
    throw new Error(`Invalid JSON in ${path}: ${(e as Error).message}`);
  }
  if (!Array.isArray(parsed.fixtures) || parsed.fixtures.length === 0) {
    throw new Error(`Config ${path} must define a non-empty "fixtures" array.`);
  }
  for (const fx of parsed.fixtures) {
    if (!fx.name || !fx.prompt || !fx.verifyCmd) {
      throw new Error(`Each fixture needs "name", "prompt", and "verifyCmd". Offending: ${JSON.stringify(fx)}`);
    }
  }
  return {
    contextFile: parsed.contextFile ?? 'CLAUDE.md',
    fixtures: parsed.fixtures,
    model: parsed.model ?? DEFAULTS.model,
    trials: parsed.trials ?? DEFAULTS.trials,
    budgetUsd: parsed.budgetUsd ?? DEFAULTS.budgetUsd,
  };
}

export const SAMPLE_CONFIG = {
  contextFile: 'CLAUDE.md',
  model: 'sonnet',
  trials: 8,
  budgetUsd: 1.0,
  fixtures: [
    {
      name: 'example-task',
      prompt: 'Describe the task you want the agent to perform, e.g. "fix the failing test in src/foo.test.js".',
      verifyCmd: 'node src/foo.test.js',
    },
  ],
};
