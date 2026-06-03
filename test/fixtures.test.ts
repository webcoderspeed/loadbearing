import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { detectSuite, fixturesFromTests } from '../src/core/fixtures.js';

function scaffold(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'lb-fix-'));
  for (const [rel, content] of Object.entries(files)) {
    const full = join(dir, rel);
    mkdirSync(join(full, '..'), { recursive: true });
    writeFileSync(full, content);
  }
  return dir;
}

test('detectSuite: jest + pnpm', () => {
  const dir = scaffold({
    'package.json': JSON.stringify({ scripts: { test: 'jest' }, devDependencies: { jest: '^29' } }),
    'pnpm-lock.yaml': '',
  });
  const s = detectSuite(dir);
  assert.equal(s.runner, 'jest');
  assert.equal(s.packageManager, 'pnpm');
  assert.equal(s.baseCommand, 'pnpm test');
  rmSync(dir, { recursive: true, force: true });
});

test('detectSuite: vitest + npm', () => {
  const dir = scaffold({
    'package.json': JSON.stringify({ scripts: { test: 'vitest run' }, devDependencies: { vitest: '^2' } }),
  });
  const s = detectSuite(dir);
  assert.equal(s.runner, 'vitest');
  assert.equal(s.packageManager, 'npm');
  rmSync(dir, { recursive: true, force: true });
});

test('fixturesFromTests: scaffolds one fixture per test file, skips node_modules', () => {
  const dir = scaffold({
    'package.json': JSON.stringify({ scripts: { test: 'jest' }, devDependencies: { jest: '^29' } }),
    'pnpm-lock.yaml': '',
    'src/auth.spec.ts': 'test("x", () => {})',
    'src/user.test.ts': 'test("y", () => {})',
    'node_modules/pkg/ignore.test.ts': 'should be skipped',
  });
  const fx = fixturesFromTests(dir);
  assert.equal(fx.length, 2, 'two test files, node_modules skipped');
  const names = fx.map((f) => f.name).sort();
  assert.ok(names.includes('src-auth') && names.includes('src-user'));
  for (const f of fx) {
    assert.ok(f.prompt.includes('Make the test'));
    assert.ok(f.verifyCmd.includes('pnpm test'));
    assert.ok(f.verifyCmd.includes('.ts'));
  }
  rmSync(dir, { recursive: true, force: true });
});

test('fixturesFromTests: returns empty when no tests', () => {
  const dir = scaffold({ 'package.json': '{}', 'src/index.ts': 'export const x = 1;' });
  assert.equal(fixturesFromTests(dir).length, 0);
  rmSync(dir, { recursive: true, force: true });
});
