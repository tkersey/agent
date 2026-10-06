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

async function bridge(t, options = {}) {
  const f = await hostFixture(t, { localData: true, ...options }), tls = await certificates(f.area);
  const origin = await serveBrowser(f.hosts.A, { ...tls.A, audience: 'human-A', runtimePath: process.env.AGENT_MOBILITY_RUNTIME,
    kernelBytes: await readFile(join(process.env.AGENT_MOBILITY_RUNTIME, 'world-kernel.wasm')), maximumAssignments: 1, catalogue: options.catalogue ?? null,
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

test('cancellation fences a browser successor computed from a yielded checkpoint', async t => {
  const f = await bridge(t, { imageMode: 'yielding' });
  assert.equal((await f.hosts.A.run(f.id)).kind, 'yielded');
  const csrf = (await f.api('/v1/browser/session')).json().csrf;
  const route = operation => `/v1/browser/runs/${f.id}/${operation}`;
  const assignment = (await f.api(route('attach'), { method: 'POST', csrf })).json();
  const options = { assignment, csrf };
  const outcome = (await f.api(route('outcome'), options)).bytes;
  const executor = await f.admissions.A.resume(await f.admissions.A.stored(f.image, outcome, f.deployment.programId));
  try {
    const command = (await f.api(route('command'), { ...options, method: 'POST' })).json();
    assert.equal(command.kind, 'drive'); assert.equal(command.control, 'resume_yield');
    const next = await executor.drive({ kind: command.control });
    assert.equal((await f.api(route('cancel'), { ...options, method: 'POST', body: canonical({ reason: 'stop' }) })).status, 200);
    const late = await f.api(route('report'), { ...options, method: 'POST', body: f.admissions.A.read(next).outcome });
    assert.equal(late.status, 409); assert.equal(late.json().error, 'StaleAssignment');
    assert.equal((await f.hosts.A.run(f.id)).kind, 'terminal');
    assert.equal(f.result('A').kind, 'cancelled');
    assert.equal(f.counters.A.cleanup, 1); assert.equal(f.counters.A.side, 0);
    assert.deepEqual(f.file.counts().reads, []);
  } finally { executor.retire(); }
});

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

test('deferred browser question survives restart, rejects stale tabs, and acquires one saved reply', async t => {
  const f = await bridge(t), binding = f.bindings.A.find(value => value.operation.endsWith('.task.v1'));
  binding.deferredRevision = 'question-v1';
  binding.defer = () => ({ audience: 'human-A', question: { text: 'Inspect this repository?', generation: '1' }, alternatives: ['accept', 'decline'], maximum_text_bytes: 32 });
  let encodings = 0;
  binding.answer = ({ answer }) => { encodings++; assert.equal(answer.choice, 'accept'); return encodeValue(f.schemas.task, f.taskValue); };
  assert.equal((await f.hosts.A.step(f.id)).kind, 'awaiting');
  assert.equal((await f.hosts.A.run(f.id)).kind, 'awaiting');
  assert.equal(f.counters.A.task, 0);
  const route = operation => `/v1/browser/runs/${f.id}/${operation}`;
  const csrf = (await f.api('/v1/browser/session')).json().csrf;
  const question = (await f.api(route('question'))).json();
  assert.equal(question.pending.question.generation, '1'); assert.equal(question.acquired, false);
  const answer = { ...question, answer: { choice: 'accept', text: '' } };
  assert.equal((await f.api(route('answer'), { method: 'POST', body: canonical(answer) })).json().error, 'CsrfDenied');
  // Restart the owning custodian/journal while retaining the HTTP bridge object.
  // The independent restart test below creates a fresh custodian and drives it.
  const assigned = (await f.api(route('attach'), { method: 'POST', csrf })).json();
  assert.ok(assigned.version.executor_incarnation !== question.version.executor_incarnation);
  assert.equal((await f.api(route('answer'), { method: 'POST', csrf, body: canonical(answer) })).json().error, 'StaleExecutor');
  const fresh = (await f.api(route('question'))).json(), current = { ...fresh, answer: { choice: 'accept', text: '' } };
  const acquired = await f.api(route('answer'), { method: 'POST', csrf, body: canonical(current) }); assert.equal(acquired.status, 200);
  assert.deepEqual((await f.api(route('answer'), { method: 'POST', csrf, body: canonical(current) })).json(), acquired.json());
  const conflict = await f.api(route('answer'), { method: 'POST', csrf, body: canonical({ ...current, answer: { choice: 'accept', text: 'different' } }) });
  assert.equal(conflict.json().error, 'ReplyConflict'); assert.equal(encodings, 1);
  assert.equal((await f.api(route('question'))).json().acquired, true);
  f.restart('A');
  assert.equal(f.hosts.A.pendingQuestion(f.id, { principal: 'user', tenant: 'tenant', audiences: ['human-A'] }).acquired, true);
  assert.equal((await f.hosts.A.run(f.id)).kind, 'terminal');
  assert.equal(f.counters.A.task, 0); assert.equal(f.counters.A.present, 1);
});

for (const cancel of [false, true]) test(`pending question restores without a live promise; cancel=${cancel}`, async t => {
  const f = await hostFixture(t, { localData: true }), binding = f.bindings.A.find(value => value.operation.endsWith('.task.v1'));
  binding.deferredRevision = 'question-v1';
  binding.defer = () => ({ audience: 'human-A', question: 'Continue?', alternatives: ['accept'], maximum_text_bytes: 0 });
  binding.answer = () => encodeValue(f.schemas.task, f.taskValue);
  await f.hosts.A.step(f.id);
  const identity = { principal: 'user', tenant: 'tenant', audiences: ['human-A'] }, before = f.hosts.A.pendingQuestion(f.id, identity);
  f.restart('A');
  assert.equal((await f.hosts.A.step(f.id)).kind, 'awaiting');
  const restored = f.hosts.A.pendingQuestion(f.id, identity);
  assert.equal(restored.pending_digest, before.pending_digest);
  assert.equal(restored.occurrence_id, before.occurrence_id);
  await assert.rejects(f.hosts.A.answerQuestion(f.id, identity, { ...before, answer: { choice: 'accept', text: '' } }), { code: 'StaleExecutor' });
  if (cancel) {
    await f.hosts.A.cancelRun(f.id, 'stop');
    await assert.rejects(f.hosts.A.answerQuestion(f.id, identity, { ...restored, answer: { choice: 'accept', text: '' } }), { code: 'StaleExecutor' });
    assert.equal(f.hosts.A.pendingQuestion(f.id, identity), null);
  } else await f.hosts.A.answerQuestion(f.id, identity, { ...restored, answer: { choice: 'accept', text: '' } });
  assert.equal((await f.hosts.A.run(f.id)).kind, 'terminal');
  assert.equal(f.result('A').kind, cancel ? 'cancelled' : 'completed');
  assert.equal(f.counters.A.task, 0);
});

for (const [kind, cancel] of [['model', false], ['model', true], ['check', true]]) test(`background leaf releases the run lock, preserves charge and fences late completion; ${kind}, cancel=${cancel}`, async t => {
  const f = await hostFixture(t, { localData: true }), binding = f.bindings.A.find(value => value.operation.endsWith('.task.v1'));
  let release; const held = new Promise(resolve => { release = resolve; });
  binding.background = true; binding.cancelSafe = true;
  binding.charge = () => ({ owner: 'A', kind, grant: 'c'.repeat(64), limit: { attempts: 2, request_bytes: 100, output_tokens: kind === 'model' ? 20 : 0, concurrent: 2 }, amount: { request_bytes: 40, output_tokens: kind === 'model' ? 8 : 0 } });
  binding.handle = async ({ signal }) => { signal.addEventListener('abort', release, { once: true }); await held; return encodeValue(f.schemas.task, f.taskValue); };
  assert.equal((await f.hosts.A.step(f.id)).kind, 'dispatching');
  assert.equal(f.journals.A.allowance(f.id, kind).used.attempts, 1);
  assert.equal((await f.hosts.A.step(f.id)).kind, 'dispatching');
  // A fresh executor may observe this same occurrence while I/O is pending.
  await f.hosts.A.executorAssignment(f.id);
  if (cancel) await f.hosts.A.cancelRun(f.id, 'stop'); else { release(); await f.hosts.A.stopOperations(); }
  assert.equal(f.journals.A.occurrence(f.journals.A.run(f.id).current_occurrence_id).status, cancel ? 'ABANDONED' : 'SETTLED_REPLY');
  assert.equal((await f.hosts.A.run(f.id)).kind, 'terminal');
  assert.equal(f.result('A').kind, cancel ? 'cancelled' : 'completed');
  assert.equal(f.journals.A.allowance(f.id, kind).used.attempts, 1);
});

for (const [kind, cancelSafe, stillRunning = false] of [['model', false], ['model', true], ['check', true], ['check', true, true], ['query', false]]) test(`unknown background work is not retried after restart; ${kind}, abandon permission=${cancelSafe}, running=${stillRunning}`, async t => {
  const f = await hostFixture(t, { localData: true }), binding = f.bindings.A.find(value => value.operation.endsWith('.task.v1'));
  let calls = 0, release; const running = new Promise(resolve => { release = resolve; });
  const previous = f.hosts.A;
  binding.background = kind !== 'query'; binding.cancelSafe = cancelSafe;
  if (kind !== 'query') binding.charge = () => ({ owner: 'A', kind, grant: 'e'.repeat(64), limit: { attempts: 2, request_bytes: 100, output_tokens: kind === 'model' ? 20 : 0, concurrent: 1 }, amount: { request_bytes: 40, output_tokens: kind === 'model' ? 8 : 0 } });
  binding.handle = async () => { calls++; if (stillRunning) await running; throw new Error('simulated lost response'); };
  if (kind === 'query') await assert.rejects(f.hosts.A.step(f.id), /simulated lost response/);
  else await f.hosts.A.step(f.id);
  if (!stillRunning) await f.hosts.A.stopOperations();
  f.restart('A');
  for (let i = 0; i < 3; i++) assert.equal((await f.hosts.A.run(f.id)).kind, 'effect_unknown');
  assert.equal(calls, 1); if (kind !== 'query') assert.equal(f.journals.A.allowance(f.id, kind).used.attempts, 1);
  if (kind === 'query') { binding.cancelSafe = true; binding.recoveryMatches = binding.authorize; }
  f.journals.A.requestCancel(f.id, 'stop'); // Crash after the durable request, before settlement.
  f.restart('A');
  const cancellable = kind === 'query' || cancelSafe && !stillRunning;
  assert.equal((await f.hosts.A.run(f.id)).kind, cancellable ? 'terminal' : 'effect_unknown');
  if (cancellable) assert.equal(f.result('A').kind, 'cancelled');
  assert.equal(calls, 1); if (kind !== 'query') assert.equal(f.journals.A.allowance(f.id, kind).used.attempts, 1);
  if (stillRunning) {
    assert.equal(f.hosts.A.status(f.id).cancellation_pending, true);
    release(); await previous.stopOperations();
    assert.equal((await f.hosts.A.run(f.id)).kind, 'effect_unknown', 'a dead owner cannot certify completion into a successor journal');
  }
});


test('browser task intake requires session-bound CSRF and passes only authenticated identity', async t => {
  const starts = [], catalogue = { list: identity => [{ id: 'allowed', principal: identity.principal }],
    async start(identity, request) { starts.push({ identity, request }); return { run_id: 'registered' }; } };
  const f = await bridge(t, { catalogue }), csrf = (await f.api('/v1/browser/session')).json().csrf;
  assert.deepEqual(canonical((await f.api('/v1/browser/tasks')).json()), canonical([{ id: 'allowed', principal: 'user' }]));
  const body = canonical({ entry: 'allowed', mode: 'propose', goal: 'Inspect this repository' });
  assert.equal((await f.api('/v1/browser/tasks', { method: 'POST', body })).status, 403);
  assert.equal((await f.api('/v1/browser/tasks', { method: 'POST', body, csrf, session: 'other' })).status, 403);
  assert.equal(starts.length, 0);
  assert.equal((await f.api('/v1/browser/tasks', { method: 'POST', body, csrf })).status, 200);
  assert.equal(starts[0].identity.principal, 'user'); assert.equal(starts[0].identity.tenant, 'tenant');
  assert.deepEqual(canonical(starts[0].request), canonical({ entry: 'allowed', mode: 'propose', goal: 'Inspect this repository' }));
});
