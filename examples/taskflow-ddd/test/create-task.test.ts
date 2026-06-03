import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTask } from '../src/application/create-task.js';
import { InMemoryTaskRepository } from '../src/infrastructure/in-memory-repo.js';

function deps() {
  return { repo: new InMemoryTaskRepository(), now: () => '2026-01-01T00:00:00.000Z' };
}

test('createTask returns success envelope with a camelCase DTO', async () => {
  const res = await createTask({ title: 'Write docs' }, deps());
  assert.equal(res.ok, true);
  if (res.ok) {
    assert.equal(res.data.title, 'Write docs');
    assert.equal(res.data.status, 'todo');
    assert.equal(res.data.assigneeId, null);
    assert.equal(res.data.createdAt, '2026-01-01T00:00:00.000Z');
    assert.ok(res.data.id.startsWith('task-'), 'id comes from the repository port');
  }
});

test('createTask persists via the repository port', async () => {
  const d = deps();
  const res = await createTask({ title: 'Persist me' }, d);
  assert.equal(res.ok, true);
  if (res.ok) {
    const saved = await d.repo.findById(res.data.id);
    assert.ok(saved, 'task was saved through repo.save');
  }
});

test('createTask wraps a domain error in the failure envelope with SCREAMING_SNAKE code', async () => {
  const res = await createTask({ title: '   ' }, deps());
  assert.equal(res.ok, false);
  if (!res.ok) {
    assert.equal(res.error.code, 'TASK_TITLE_REQUIRED');
    assert.ok(res.error.message.length > 0);
  }
});

test('createTask keeps assigneeId when provided', async () => {
  const res = await createTask({ title: 'Assigned', assigneeId: 'user-7' }, deps());
  assert.equal(res.ok, true);
  if (res.ok) assert.equal(res.data.assigneeId, 'user-7');
});
