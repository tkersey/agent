import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { request } from 'node:https';
import { pumpDeployment } from '../../runtime/mobility/deployment.mjs';
import { readFile, writeFile } from 'node:fs/promises';
import { packageFixture } from './mobility_package_fixture.mjs';

test('a repeatedly failing run does not starve execution, transfer retry or cancellation', async () => {
  const runs = [{ run_id: 'bad', status: 'ACTIVE' }, { run_id: 'good', status: 'ACTIVE' },
    { run_id: 'offered', status: 'OFFERED', transfer_id: 'transfer' }, { run_id: 'departed', status: 'DEPARTED', cancel_requested: 'stop', cancel_forwarded: false }];
  const calls = [], deployment = { config: { execution: 'node' }, journal: { recover: () => runs.map(run => ({ run })), run: id => runs.find(run => run.run_id === id) },
    custodian: { async run(id) { calls.push(id); if (id === 'bad') throw Object.assign(new Error('denied'), { code: 'LeafBindingDenied' }); return { kind: 'terminal' }; },
      async retryTransfer(id) { calls.push(id); return { kind: 'unknown' }; }, async cancelRun(id) { calls.push(id); return { kind: 'cancel_forwarded' }; } } };
  for (let i = 0; i < 3; i++) {
    const results = await pumpDeployment(deployment);
    assert.deepEqual(results.map(result => result.kind), ['failed', 'terminal', 'unknown', 'cancel_forwarded']);
    assert.deepEqual(results[0], { kind: 'failed', run_id: 'bad', reason: 'LeafBindingDenied' });
  }
  assert.deepEqual(calls, Array(3).fill(['bad', 'good', 'transfer', 'departed']).flat());
});

test('the extracted serve CLI reports a failed run and its bounded reason', async t => {
  const f = await packageFixture(t, { dataExecution: 'browser' });
  const offered = await f.hosts.A.run(f.id);
  assert.equal((await f.hosts.A.retryTransfer(offered.transfer_id)).kind, 'accepted');
  await f.stopB();
  const config = JSON.parse(await readFile(f.configB, 'utf8'));
  config.execution = 'node'; config.revoked = ['tenant/user'];
  await writeFile(f.configB, JSON.stringify(config));
  await f.startB();
  let failure;
  for (let i = 0; i < 100 && !failure; i++) {
    for (const line of f.processLogs().stderr.split('\n')) {
      try { const row = JSON.parse(line); if (row.kind === 'failed') failure = row; } catch {}
    }
    if (!failure) await new Promise(resolve => setTimeout(resolve, 20));
  }
  assert.deepEqual(failure, { kind: 'failed', run_id: f.id, reason: 'PrincipalRevoked' });
  assert.equal(f.statusB().custody, 'ACTIVE');
  await f.stopB();
});


test('installed operator CLI issues a login for the configured reference browser only', async t => {
  const f = await packageFixture(t, { browserAuth: true });
  const issue = principal => execFileSync(process.execPath, [f.cli, 'login-issue', f.configA, principal, 'tenant'], { cwd: f.root, encoding: 'utf8', env: { ...process.env, PATH: '/nonexistent' }, stdio: ['ignore', 'pipe', 'pipe'] });
  assert.throws(() => issue('not-granted'));
  const issued = JSON.parse(issue('user'));
  const bytes = Buffer.from(JSON.stringify({ credential: issued.credential }));
  const response = await new Promise((resolve, reject) => {
    const req = request(f.browserUrl + '/v1/browser/login', { method: 'POST', ca: f.tls.ca,
      headers: { origin: f.browserUrl, 'content-type': 'application/json', 'content-length': bytes.length } }, res => {
      res.resume(); res.on('end', () => resolve({ status: res.statusCode, cookies: res.headers['set-cookie'] }));
    }); req.on('error', reject); req.end(bytes);
  });
  assert.equal(response.status, 200); assert.match(response.cookies[0], /Secure; HttpOnly; SameSite=Strict/);
  assert.equal(f.archiveContents.includes(Buffer.from(issued.credential)), false);
});
