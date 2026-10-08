import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, symlinkSync, truncateSync, statSync, rmSync, utimesSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inspectCache, snapshotCache } from './zig-cache.mjs';

test('default budget admits the observed CI cache and preserves oversized files', t => {
  const root = mkdtempSync(join(tmpdir(), 'zig-cache-budget-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, 'o'));
  const object = join(root, 'o', 'object');
  writeFileSync(object, '');
  // Sparse files exercise logical cache sizes without allocating gigabytes.
  truncateSync(object, 4736598048);
  assert.equal(inspectCache(root).save, true);
  truncateSync(object, 8 * 1024 ** 3 + 1);
  assert.equal(inspectCache(root).save, false);
  assert.equal(statSync(object).size, 8 * 1024 ** 3 + 1);
});

test('cache admission retains useful objects and never erases oversized, empty, or aliased caches', t => {
  const root = mkdtempSync(join(tmpdir(), 'zig-cache-admission-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  assert.equal(inspectCache(root, 8).save, false);
  mkdirSync(join(root, 'o')); mkdirSync(join(root, 'h'));
  writeFileSync(join(root, 'h', 'manifest'), 'h');
  assert.equal(inspectCache(root, 8).save, false);
  writeFileSync(join(root, 'o', 'object'), 'object');
  assert.equal(inspectCache(root, 7).save, true);
  assert.equal(inspectCache(root, 6).save, false);
  assert.deepEqual({ ...inspectCache(root, 7).groups }, { h: 1, o: 6 });
  assert.equal(readFileSync(join(root, 'o', 'object'), 'utf8'), 'object');
  symlinkSync(join(root, 'o', 'object'), join(root, 'alias'));
  assert.equal(inspectCache(root, 100).save, false);
  assert.equal(readFileSync(join(root, 'o', 'object'), 'utf8'), 'object');
});

test('bounded upload retains newest whole objects and metadata without changing the source', t => {
  const work = mkdtempSync(join(tmpdir(), 'zig-cache-snapshot-'));
  t.after(() => rmSync(work, { recursive: true, force: true }));
  const root = join(work, 'source'), output = join(work, 'upload');
  for (const name of ['o/old', 'o/new', 'o/large', 'h']) mkdirSync(join(root, name), { recursive: true });
  for (const [name, value, time] of [['o/old/a', 'old', 1], ['o/new/a', 'new', 2], ['o/new/b', 'two', 2], ['o/large/a', 'oversized', 3], ['h/manifest', 'h', 1]]) {
    const path = join(root, name);
    writeFileSync(path, value); utimesSync(path, time, time);
  }
  const before = inspectCache(root);
  assert.equal(snapshotCache(root, output, 7).bytes, 7);
  assert.equal(readFileSync(join(output, 'o/new/a'), 'utf8'), 'new');
  assert.equal(readFileSync(join(output, 'o/new/b'), 'utf8'), 'two');
  assert.equal(readFileSync(join(output, 'h/manifest'), 'utf8'), 'h');
  assert.equal(existsSync(join(output, 'o/old')), false);
  assert.equal(existsSync(join(output, 'o/large')), false);
  assert.deepEqual(inspectCache(root), before);
  assert.equal(readFileSync(join(root, 'o/old/a'), 'utf8'), 'old');
  assert.equal(statSync(join(root, 'o/new/a')).ino, statSync(join(output, 'o/new/a')).ino);
  assert.throws(() => snapshotCache(root, output, 7), { code: 'EEXIST' });
  assert.throws(() => snapshotCache(root, join(root, 'nested'), 7), /disjoint/);
  assert.throws(() => snapshotCache(root, join(work, 'small'), 0), /positive/);
  symlinkSync(join(root, 'o/new'), join(root, 'alias'));
  assert.throws(() => snapshotCache(root, join(work, 'aliased'), 7), /unsupported/);
  assert.equal(existsSync(join(work, 'aliased')), false);
});
