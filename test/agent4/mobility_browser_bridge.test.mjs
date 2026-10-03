import test from 'node:test';
import assert from 'node:assert/strict';
import { request } from 'node:https';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { serveBrowser } from '../../runtime/mobility/browser.mjs';
import { canonical, parse, runId, signRecord } from '../../runtime/mobility/protocol.mjs';
import { encodeValue } from '../../runtime/values.mjs';
import { hostFixture } from './mobility_host_fixture.mjs';
import { certificates } from './mobility_tls_fixture.mjs';

async function bridge(t) {
  const f = await hostFixture(t, { localData: true }), tls = await certificates(f.area);
  const origin = await serveBrowser(f.hosts.A, { ...tls.A, audience: 'human-A', runtimePath: process.env.AGENT_MOBILITY_RUNTIME,
    kernelBytes: await readFile(join(process.env.AGENT_MOBILITY_RUNTIME, 'world-kernel.wasm')), maximumAssignments: 1,
    authenticate: req => ({ sessionId: req.headers.cookie ?? 'first', principal: 'user', tenant: 'tenant', audiences: ['human-A'] }) });
  t.after(() => origin.close());
  async function api(path, { method = 'GET', session = 'first', csrf, assignment, body = new Uint8Array() } = {}) {
    const headers = { cookie: session, origin: origin.url };
    if (method === 'POST') headers['content-length'] = String(body.length);
    if (csrf) headers['x-agent-csrf'] = csrf;
    if (assignment) { headers['x-agent-assignment'] = assignment.nonce; headers['x-agent-version'] = Buffer.from(canonical(assignment.version)).toString('base64url'); }
    return new Promise((resolve, reject) => {
      const req = request(origin.url + path, { method, ca: tls.ca, headers }, res => {
        const chunks = []; res.on('data', data => chunks.push(data)); res.on('end', () => {
          const bytes = Buffer.concat(chunks); resolve({ status: res.statusCode, bytes, json: () => parse(bytes) });
        });
      }); req.on('error', reject); req.end(body);
    });
  }
  return { ...f, api };
}

test('browser sessions do not consume historical capacity and CSRF remains session-bound', async t => {
  const f = await bridge(t), first = (await f.api('/v1/browser/session')).json().csrf;
  const second = await f.api('/v1/browser/session', { session: 'second' });
  assert.equal(second.status, 200); assert.notEqual(second.json().csrf, first);
  const denied = await f.api(`/v1/browser/runs/${f.id}/cancel`, { method: 'POST', session: 'second', csrf: first, body: canonical({ reason: 'stop' }) });
  assert.equal(denied.status, 403); assert.equal(denied.json().error, 'CsrfDenied');
});

test('revoked browser users can complete pending cancellation and terminal assignments release capacity', async t => {
  const f = await bridge(t), csrf = (await f.api('/v1/browser/session')).json().csrf;
  for (let iteration = 0; iteration < 2; iteration++) {
    let id = f.id;
    f.revoked.A.clear();
    if (iteration) {
      const { signature: _, ...record } = parse(f.registration); id = runId('issuer');
      await f.hosts.A.registerRun(signRecord('run', { ...record, run_id: id }, f.pairs.issuer.privateKey), f.image, encodeValue(f.schemas.integer, 123n));
    }
    await f.hosts.A.step(id); await f.hosts.A.step(id);
    f.revoked.A.add('tenant/user');
    const route = operation => `/v1/browser/runs/${id}/${operation}`;
    assert.equal((await f.api(route('attach'), { method: 'POST', csrf })).json().error, 'PrincipalRevoked');
    assert.equal((await f.api(route('cancel'), { method: 'POST', csrf, body: canonical({ reason: 'revoked' }) })).status, 200);
    const attached = await f.api(route('attach'), { method: 'POST', csrf }); assert.equal(attached.status, 200);
    const assignment = attached.json(), options = { assignment, csrf };
    const image = (await f.api(route('image'), options)).bytes, outcome = (await f.api(route('outcome'), options)).bytes;
    const executor = await f.admissions.A.resume(await f.admissions.A.stored(image, outcome, f.deployment.programId));
    try {
      for (let steps = 0; steps < 16; steps++) {
        const response = await f.api(route('command'), { ...options, method: 'POST' }); assert.equal(response.status, 200);
        const command = response.json(); assert.equal(command.kind, 'drive');
        const control = command.control === 'reply' ? { kind: 'reply', value: (await f.api(route('reply'), options)).bytes } : { kind: command.control, ...(command.reason === null ? {} : { reason: command.reason }) };
        const next = await executor.drive(control);
        const reported = await f.api(route('report'), { ...options, method: 'POST', body: f.admissions.A.read(next).outcome }); assert.equal(reported.status, 200);
        const result = reported.json(); assignment.version = result.version;
        if (result.status.custody === 'TERMINAL') break;
      }
      assert.equal(f.hosts.A.status(id).custody, 'TERMINAL');
      assert.equal((await f.api(route('command'), { ...options, method: 'POST' })).json().error, 'StaleAssignment');
    } finally { executor.retire(); }
  }
  assert.equal(f.counters.A.cleanup, 2); assert.equal(f.counters.A.present, 0); assert.deepEqual(f.file.counts().reads, []);
});

test('browser assignment capacity includes in-flight attachment and failed reservations are released', async t => {
  const f = await bridge(t), csrf = (await f.api('/v1/browser/session')).json().csrf;
  const { signature: _, ...record } = parse(f.registration), second = runId('issuer');
  await f.hosts.A.registerRun(signRecord('run', { ...record, run_id: second }, f.pairs.issuer.privateKey), f.image, encodeValue(f.schemas.integer, 123n));
  let entered, release;
  const started = new Promise(resolve => { entered = resolve; }), held = new Promise(resolve => { release = resolve; });
  const attach = f.hosts.A.executorAssignment.bind(f.hosts.A);
  f.hosts.A.executorAssignment = async id => { entered(); await held; throw Object.assign(new Error('test failure'), { code: 'FixtureAttachFailure' }); };
  const pending = f.api(`/v1/browser/runs/${f.id}/attach`, { method: 'POST', csrf }); await started;
  const rival = await f.api(`/v1/browser/runs/${second}/attach`, { method: 'POST', csrf });
  assert.equal(rival.json().error, 'AssignmentCapacity');
  release(); assert.equal((await pending).json().error, 'FixtureAttachFailure');
  f.hosts.A.executorAssignment = attach;
  assert.equal((await f.api(`/v1/browser/runs/${second}/attach`, { method: 'POST', csrf })).status, 200);
});
