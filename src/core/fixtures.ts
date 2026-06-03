import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import type { Fixture } from '../types.js';

/**
 * Auto-scaffold fixtures from a repo's existing test suite, so users review/edit
 * instead of hand-authoring tasks and verify commands from scratch.
 */

export interface DetectedSuite {
  baseCommand: string;
  runner: 'jest' | 'vitest' | 'node:test' | 'mocha' | 'unknown';
  /** scopes the command to a single file, given a relative path */
  scopeArg: (file: string) => string;
  packageManager: 'pnpm' | 'yarn' | 'npm';
}

const TEST_FILE_RE = /\.(test|spec)\.[cm]?[jt]sx?$/;

export function detectSuite(repoDir: string): DetectedSuite {
  const pm = detectPackageManager(repoDir);
  const pkg = readPackageJson(repoDir);
  const testScript = pkg?.scripts?.['test'] ?? '';
  const deps = { ...(pkg?.dependencies ?? {}), ...(pkg?.devDependencies ?? {}) };

  const has = (name: string): boolean => name in deps || testScript.includes(name);

  let runner: DetectedSuite['runner'] = 'unknown';
  if (has('vitest')) runner = 'vitest';
  else if (has('jest')) runner = 'jest';
  else if (has('mocha')) runner = 'mocha';
  else if (testScript.includes('node --test') || testScript.includes('node:test')) runner = 'node:test';

  // Prefer the repo's own `test` script; fall back to a runner default.
  const runVia = pm === 'npm' ? 'npm test' : pm === 'yarn' ? 'yarn test' : 'pnpm test';
  const baseCommand = testScript ? runVia : runnerDefault(runner, pm);

  return {
    baseCommand,
    runner,
    packageManager: pm,
    scopeArg: (file: string) => scopeFor(runner, baseCommand, file),
  };
}

export function fixturesFromTests(repoDir: string, max = 4): Fixture[] {
  const suite = detectSuite(repoDir);
  const files = findTestFiles(repoDir).slice(0, max);
  if (files.length === 0) return [];
  return files.map((abs) => {
    const rel = relative(repoDir, abs);
    const name = rel
      .replace(TEST_FILE_RE, '')
      .replace(/[\\/]/g, '-')
      .replace(/^-+/, '')
      .slice(0, 40);
    return {
      name: name || 'test',
      prompt: `Make the test in ${rel} pass. Implement or fix the code under test so the suite is green. Do not modify the test file itself.`,
      verifyCmd: suite.scopeArg(rel),
    };
  });
}

// ---- internals ----

function detectPackageManager(repoDir: string): DetectedSuite['packageManager'] {
  if (existsSync(join(repoDir, 'pnpm-lock.yaml'))) return 'pnpm';
  if (existsSync(join(repoDir, 'yarn.lock'))) return 'yarn';
  return 'npm';
}

interface PackageJson {
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

function readPackageJson(repoDir: string): PackageJson | null {
  const p = join(repoDir, 'package.json');
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(readFileSync(p, 'utf8')) as PackageJson;
  } catch {
    return null;
  }
}

function runnerDefault(runner: DetectedSuite['runner'], pm: DetectedSuite['packageManager']): string {
  const exec = pm === 'pnpm' ? 'pnpm exec' : pm === 'yarn' ? 'yarn' : 'npx';
  switch (runner) {
    case 'vitest':
      return `${exec} vitest run`;
    case 'jest':
      return `${exec} jest`;
    case 'mocha':
      return `${exec} mocha`;
    case 'node:test':
      return 'node --test';
    default:
      return pm === 'npm' ? 'npm test' : `${pm} test`;
  }
}

function scopeFor(runner: DetectedSuite['runner'], baseCommand: string, file: string): string {
  // `npm test` needs `--` to forward args to the underlying runner.
  const sep = /^(npm|pnpm|yarn) (run )?test$/.test(baseCommand.trim()) ? ' -- ' : ' ';
  switch (runner) {
    case 'vitest':
      return `${baseCommand}${sep}run ${file}`.replace('run run', 'run');
    case 'jest':
      return `${baseCommand}${sep}${file}`;
    case 'mocha':
      return `${baseCommand}${sep}${file}`;
    case 'node:test':
      return `node --test ${file}`;
    default:
      return `${baseCommand}${sep}${file}`;
  }
}

function findTestFiles(repoDir: string, maxScan = 5000): string[] {
  const out: string[] = [];
  const skip = new Set(['node_modules', 'dist', 'build', '.git', 'coverage', '.next', 'out']);
  let scanned = 0;
  const walk = (dir: string): void => {
    if (out.length >= 50 || scanned >= maxScan) return;
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const e of entries) {
      if (skip.has(e)) continue;
      const full = join(dir, e);
      scanned++;
      let st;
      try {
        st = statSync(full);
      } catch {
        continue;
      }
      if (st.isDirectory()) walk(full);
      else if (TEST_FILE_RE.test(e)) out.push(full);
    }
  };
  walk(repoDir);
  // Prefer shallower files: likelier to be self-contained units.
  return out.sort((a, b) => a.split(/[\\/]/).length - b.split(/[\\/]/).length);
}
