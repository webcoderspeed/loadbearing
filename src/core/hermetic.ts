import { spawnSync } from 'node:child_process';

/**
 * Hermetic execution helpers. Every agent run must start from a byte-identical
 * repo state, or token/outcome deltas would be polluted by leftover edits from
 * the previous run. We use git to snapshot and hard-reset.
 */

export function isGitRepo(cwd: string): boolean {
  return spawnSync('git', ['rev-parse', '--is-inside-work-tree'], { cwd, encoding: 'utf8' }).status === 0;
}

/** List untracked files currently in the tree (porcelain '??' entries). */
export function listUntracked(cwd: string): string[] {
  const r = spawnSync('git', ['status', '--porcelain', '--untracked-files=all'], { cwd, encoding: 'utf8' });
  return (r.stdout || '')
    .split('\n')
    .filter((l) => l.startsWith('??'))
    .map((l) => l.slice(3).trim())
    .filter(Boolean);
}

/**
 * Reset the working tree to a clean, identical state between runs.
 *
 * Hard-reset restores tracked files. For untracked files we must remove only
 * what the AGENT created this run — never the user's pre-existing untracked
 * files (config, logs, notes). Caller passes the set of untracked paths that
 * existed BEFORE the profile started; we exclude those from the clean.
 * (Dogfooding caught the silent-nuke footgun the hard way.)
 */
export function resetClean(cwd: string, preserve: readonly string[] = []): void {
  spawnSync('git', ['reset', '--hard', 'HEAD'], { cwd, encoding: 'utf8' });
  const excludes: string[] = [];
  for (const p of preserve) {
    excludes.push('-e', p);
  }
  spawnSync('git', ['clean', '-fd', ...excludes], { cwd, encoding: 'utf8' });
}

/** Run an objective verify command; exit 0 == pass. */
export function verify(cwd: string, cmd: string): boolean {
  const r = spawnSync(cmd, { cwd, shell: true, encoding: 'utf8' });
  return r.status === 0;
}

/** Capture current HEAD short hash for provenance in the report. */
export function headHash(cwd: string): string {
  const r = spawnSync('git', ['rev-parse', '--short', 'HEAD'], { cwd, encoding: 'utf8' });
  return (r.stdout || '').trim();
}
