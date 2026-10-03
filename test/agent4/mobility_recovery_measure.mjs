import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { writeFile } from 'node:fs/promises';
if (process.argv[2] === '--child') {
  const begin = performance.now(), [root, config, id] = process.argv.slice(3);
  const { openDeployment } = await import(pathToFileURL(join(root, 'runtime/mobility/deployment.mjs')));
  const host = await openDeployment(config);
  try {
    host.custodian.recover(); const before = host.custodian.status(id);
    assert.equal(before.custody, 'ACTIVE'); assert.equal(before.epoch, '1');
    assert.equal((await host.custodian.step(id)).kind, 'published');
    const ready = host.custodian.status(id);
    assert.equal(ready.operation, 'agent.text.read-chunk.v1'); assert.equal(ready.occurrence, 'READY');
    assert.equal(BigInt(ready.revision), BigInt(before.revision) + 1n);
    assert.equal(host.statistics()['agent.text.read-chunk.v1'].calls, 0);
    console.log(JSON.stringify({ import_verify_open_restore_publish_ms: performance.now() - begin }));
  } finally { await host.close(); }
} else {
  const { packageFixture } = await import('./mobility_package_fixture.mjs');
  const output = process.argv[2]; assert.ok(output, 'usage: mobility_recovery_measure.mjs OUTPUT.json [SAMPLES]');
  const count = Number(process.argv[3] ?? 5); assert.ok(Number.isInteger(count) && count >= 1 && count <= 20);
  const rows = [];
  for (let i = 0; i < count; i++) {
    const cleanup = [], f = await packageFixture({ after: fn => cleanup.push(fn) }, { dataExecution: 'browser' });
    try {
      const out = await f.hosts.A.run(f.id); assert.equal((await f.hosts.A.retryTransfer(out.transfer_id)).kind, 'accepted');
      await f.stopB(); const before = f.statusB(); assert.equal(before.occurrence, 'SETTLED_REPLY');
      const begin = performance.now();
      const child = spawnSync(process.execPath, [import.meta.filename, '--child', f.root, f.configB, f.id], { cwd: f.root, env: { ...process.env, PATH: '/nonexistent' }, encoding: 'utf8', timeout: 30000 });
      const total = performance.now() - begin; assert.equal(child.status, 0, child.stderr);
      rows.push({ process_start_to_exit_ms: total, ...JSON.parse(child.stdout) });
      assert.equal(f.statusB().occurrence, 'READY'); assert.equal(f.hosts.A.status(f.id).custody, 'DEPARTED');
    } finally { for (const fn of cleanup) await fn(); }
  }
  await writeFile(output, JSON.stringify({ format: 'agent-mobility-recovery-measurements/v1', node: process.version,
    method: 'Fresh process recovers accepted custody from SQLite after original process exit. Includes extracted-module import, full runtime verification, journal open/recovery, new World restore, saved arrival admission and next READY publication. No prior leaf repeated; process total also includes teardown. Browser-mode initial service intentionally holds accepted custody without driving it.', rows }, null, 2) + '\n');
}
