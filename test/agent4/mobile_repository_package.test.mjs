// External test oracle. All production imports, images and native helpers come
// from the extracted archive; its optional oracles are removed before execution.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { artifactRoot } from './artifacts.mjs';

test('extracted full repository program executes in both browser Workers and qualified native checks', async t => {
  assert(process.env.AGENT_MOBILITY_BROWSER_TOOLS, 'set AGENT_MOBILITY_BROWSER_TOOLS for required Chromium/Firefox qualification');
  const area = await mkdtemp(join(tmpdir(), 'mobile repository package '));
  t.after(() => rm(area, { recursive: true, force: true }));
  const name = 'agent-v4.0.0-dev.0-resumable-interactions-v1';
  execFileSync('tar', ['-xzf', resolve(process.env.AGENT4_ARCHIVE ?? `${artifactRoot}/agent4-release/${name}.tar.gz`), '-C', area]);
  const root = join(area, name);
  await rm(join(root, 'test'), { recursive: true, force: true });
  const inventory = JSON.parse(await readFile(join(root, 'examples/inventory.json')));
  assert(inventory.examples.some(example => example.name === 'mobile-repository' && example.image === 'mobile-repository/session.bpi3'));
  for (const name of ['session', 'next-task', 'next-task-answer', 'task', 'report', 'model-request', 'model-result', 'review', 'review-answer']) assert(inventory.files.some(row => row.path === `mobile-repository/${name}.bin`));
  for (const name of ['agent-check-limit', 'agent-publication-gate']) assert((await stat(join(root, 'examples/native', name))).mode & 0o100);
  for (const id of ['boundary.wire-natural.v1', 'world.allocation-budget.v1', 'agent.model-json-bounds.v1']) {
    const path = `runtime/repository-profiles/${id}.json`, bytes = await readFile(join(root, path));
    assert.deepEqual(bytes, await readFile(new URL(`../../${path}`, import.meta.url)));
    const profile = JSON.parse(bytes);
    assert.equal(profile.id, id);
    assert.equal(createHash('sha256').update(profile.harness.source).digest('hex'), profile.harness.sha256);
  }
  await assert.rejects(stat(join(root, 'src'))); await assert.rejects(stat(join(root, 'test')));
  const env = { ...process.env, AGENT_MOBILE_PACKAGE: root,
    AGENT_PUBLICATION_GATE: join(root, 'examples/native/agent-publication-gate') };
  delete env.NODE_TEST_CONTEXT;
  const output = execFileSync(process.execPath, ['--test', '--test-name-pattern=full repository mode|full Agent source repair|authored return|browser catalogue starts|authored session advances|browser repeated|session propose then publish',
    resolve(import.meta.dirname, 'repository_publication_approval.test.mjs')], { env, encoding: 'utf8', timeout: 300000, maxBuffer: 4 << 20 });
  assert.match(output, /tests 13/); assert.match(output, /pass 13/); assert.match(output, /fail 0/);
  console.log(output);
});
