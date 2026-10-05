import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readdir, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { reserveRepositoryScratch } from '../../runtime/repository_zig_sandbox.mjs';

test('scratch admission bounds concurrent and abandoned allocations across renewed callers', async t => {
  const root = await mkdtemp(join(tmpdir(), 'repository-scratch-quota-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const results = await Promise.allSettled(Array.from({ length: 12 }, () => reserveRepositoryScratch(root)));
  const acquired = results.filter(row => row.status === 'fulfilled').map(row => row.value);
  assert.equal(acquired.length, 4); assert.equal(new Set(acquired).size, 4);
  for (const row of results.filter(row => row.status === 'rejected')) assert.equal(row.reason.message, 'scratch_slots_exhausted');
  // A fresh module/caller has no in-memory reservations; the directories still
  // refuse growth, as they would after a process died without cleanup.
  const fresh = await import('../../runtime/repository_zig_sandbox.mjs?reopened');
  for (let attempt = 0; attempt < 8; attempt++) await assert.rejects(fresh.reserveRepositoryScratch(root), /scratch_slots_exhausted/);
  assert.equal((await readdir(root)).length, 4);
  // Only the owning operation's post-reap cleanup makes capacity reusable.
  await rm(acquired[0], { recursive: true });
  assert.equal(await fresh.reserveRepositoryScratch(root), acquired[0]);
  assert.equal((await readdir(root)).length, 4);
});

test('a preexisting slot symlink consumes capacity without being followed or removed', async t => {
  const root = await mkdtemp(join(tmpdir(), 'repository-scratch-alias-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  for (let i = 0; i < 4; i++) await symlink('/does-not-exist', join(root, `agent-zig-slot-${i}`));
  await assert.rejects(reserveRepositoryScratch(root), /scratch_slots_exhausted/);
  assert.equal((await readdir(root)).length, 4);
});


test('legacy scratch is preserved and blocks new allocation until explicitly reconciled', async t => {
  const root = await mkdtemp(join(tmpdir(), 'repository-scratch-legacy-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, 'agent-zig-old-generation'));
  await assert.rejects(reserveRepositoryScratch(root), /scratch_legacy_storage/);
  assert.deepEqual(await readdir(root), ['agent-zig-old-generation']);
});
