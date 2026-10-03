import test from 'node:test';
import assert from 'node:assert/strict';
import { decodeValue, decodeSchema, encodeValue } from '../../runtime/values.mjs';
import { requirement } from '../../runtime/mobility/policy.mjs';
import { hostFixture } from './mobility_host_fixture.mjs';

test('durable host executes actual A→B→A with real requirements, grants and arrival receipts', async t => {
  const f = await hostFixture(t);
  const outbound = await f.hosts.A.run(f.id); assert.equal(outbound.kind, 'offered');
  assert.equal((await f.hosts.A.retryTransfer(outbound.transfer_id)).kind, 'accepted');
  assert.equal(f.hosts.A.status(f.id).custody, 'DEPARTED');
  f.restart('B'); // Restores durable incoming checkpoint and arrival, not args.
  const inbound = await f.hosts.B.run(f.id); assert.equal(inbound.kind, 'offered');
  assert.equal((await f.hosts.B.retryTransfer(inbound.transfer_id)).kind, 'accepted');
  assert.equal(f.hosts.B.status(f.id).custody, 'DEPARTED');
  f.restart('A');
  assert.equal((await f.hosts.A.run(f.id)).kind, 'terminal');
  assert.equal(f.hosts.A.status(f.id).epoch, '2');
  const outcome = f.result('A'); assert.equal(outcome.kind, 'completed');
  assert.deepEqual(decodeValue(f.schemas.report, outcome.value), [123n, 9001n, { tag: 0, value: [42n, 4n] }, 91n]);
  assert.deepEqual(f.file.counts(), { reads: [0n, 16n, 32n], releases: 1 });
  assert.deepEqual(f.counters.deliveries, { A: 1, B: 1 });
  assert.deepEqual(f.counters.A, { task: 1, present: 1, side: 1, cleanup: 1 });
  assert.deepEqual(f.counters.B, { task: 0, present: 0, side: 0, cleanup: 0 });
});

test('private data taints retained state and denies return before any bytes or preflight go to A', async t => {
  const f = await hostFixture(t, { privateData: true });
  const outbound = await f.hosts.A.run(f.id); assert.equal((await f.hosts.A.retryTransfer(outbound.transfer_id)).kind, 'accepted');
  assert.equal((await f.hosts.B.run(f.id)).kind, 'terminal');
  assert.deepEqual(f.hosts.B.status(f.id).classification, ['server-only', 'shared']);
  assert.equal(f.counters.bytes.A, 0); assert.equal(f.counters.deliveries.A, 0); assert.equal(f.counters.preflights.A, 0);
  assert.equal(f.counters.A.present, 0); assert.equal(f.counters.B.cleanup, 1);
  assert.deepEqual(decodeValue(f.schemas.report, f.result('B').value), [123n, 9001n, { tag: 1, value: null }, 91n]);
});

test('a restricted cleanup capture blocks export even though the current placement payload is public', async t => {
  const f = await hostFixture(t, { privateCapture: true });
  assert.equal((await f.hosts.A.run(f.id)).kind, 'terminal');
  assert.deepEqual(f.hosts.A.status(f.id).classification, ['origin-only', 'shared']);
  assert.deepEqual(f.counters.deliveries, { A: 0, B: 0 }); assert.deepEqual(f.counters.preflights, { A: 0, B: 0 });
  assert.equal(f.counters.A.cleanup, 1); assert.equal(f.journals.B.run(f.id), null);
  assert.deepEqual(decodeValue(f.schemas.report, f.result('A').value), [123n, 9001n, { tag: 1, value: null }, 91n]);
});

test('return reconciles lost old acceptance before taking new custody; late receipt does not restart', async t => {
  const f = await hostFixture(t, { lostAck: true });
  const out = await f.hosts.A.run(f.id);
  assert.equal((await f.hosts.A.retryTransfer(out.transfer_id)).kind, 'unknown'); assert.equal(f.hosts.A.status(f.id).custody, 'OFFERED');
  assert.equal((await f.hosts.A.step(f.id)).kind, 'offered');
  const back = await f.hosts.B.run(f.id); assert.equal(back.kind, 'offered');
  assert.equal((await f.hosts.B.retryTransfer(back.transfer_id)).kind, 'accepted');
  assert.equal((await f.hosts.A.run(f.id)).kind, 'terminal');
  const before = f.journals.A.run(f.id);
  assert.equal((await f.hosts.A.retryTransfer(out.transfer_id)).kind, 'accepted');
  assert.deepEqual(f.journals.A.run(f.id), before); assert.equal(f.counters.A.cleanup, 1);
});

test('uncertain external delivery remains blocked across restart and is not automatically repeated', async t => {
  const f = await hostFixture(t, { uncertainRead: true });
  const out = await f.hosts.A.run(f.id); await f.hosts.A.retryTransfer(out.transfer_id);
  await assert.rejects(f.hosts.B.run(f.id), { code: 'FixtureDeliveryUnknown' });
  assert.equal(f.hosts.B.status(f.id).occurrence, 'UNKNOWN'); assert.deepEqual(f.file.counts().reads, [0n]);
  f.restart('B'); assert.equal((await f.hosts.B.run(f.id)).kind, 'effect_unknown');
  f.hosts.B.requestCancel(f.id, 'stop'); assert.equal((await f.hosts.B.run(f.id)).kind, 'effect_unknown');
  assert.deepEqual(f.file.counts().reads, [0n]); assert.equal(f.counters.bytes.A, 0);
});

test('cancel accepted incoming relocation skips arrival and runs only current-owner cleanup', async t => {
  const f = await hostFixture(t);
  const out = await f.hosts.A.run(f.id); await f.hosts.A.retryTransfer(out.transfer_id);
  f.hosts.B.requestCancel(f.id, 'stop'); assert.equal((await f.hosts.B.run(f.id)).kind, 'terminal');
  assert.equal(f.result('B').kind, 'cancelled');
  assert.equal(f.counters.B.cleanup, 1); assert.equal(f.counters.A.cleanup, 0); assert.equal(f.counters.B.side, 0); assert.deepEqual(f.file.counts().reads, []);
});

test('actual dispatch rejects tenant, principal, schema, role and subject mismatches before I/O', async t => {
  const f = await hostFixture(t);
  const out = await f.hosts.A.run(f.id); await f.hosts.A.retryTransfer(out.transfer_id);
  await f.hosts.B.step(f.id); // Admit the saved arrival, leaving the real read parked.
  const run = f.journals.B.run(f.id), outcome = f.result('B'), request = await f.world.decodeRequest(outcome.request);
  assert.equal(request.semanticIdentity, 'agent.text.read-chunk.v1');
  for (const changed of [{ ...run, tenant_ref: 'other' }, { ...run, principal_ref: 'other' }])
    assert.throws(() => f.policies.B.dispatch(changed, request), { code: 'DeploymentDenied' });
  assert.throws(() => f.policies.B.dispatch(run, { ...request, payloadSchema: new Uint8Array() }), { code: 'LeafBindingDenied' });
  const payload = decodeValue(decodeSchema(request.payloadSchema), request.payload); payload[0][1][0] ^= 1;
  assert.throws(() => f.policies.B.dispatch(run, { ...request, payload: encodeValue(decodeSchema(request.payloadSchema), payload) }), { code: 'LeafBindingDenied' });
  const wanted = requirement(f.bindings.B.find(binding => binding.operation === request.semanticIdentity)); wanted[3] = 'simulation';
  assert.throws(() => f.policies.B.preflight(f.journals.B.registration(f.registration), [wanted], [[], { tag: 0, value: null }, { tag: 0, value: null }, 8388608n], ['shared']), { code: 'CapabilityUnavailable' });
  assert.deepEqual(f.file.counts().reads, []);
});

test('revocation after placement blocks new effects while preserving narrow cleanup authority', async t => {
  const f = await hostFixture(t);
  const out = await f.hosts.A.run(f.id); await f.hosts.A.retryTransfer(out.transfer_id);
  await f.hosts.B.step(f.id);
  f.revoked.B.add('tenant/user');
  await assert.rejects(f.hosts.B.step(f.id), { code: 'PrincipalRevoked' });
  assert.deepEqual(f.file.counts().reads, []); assert.equal(f.hosts.B.status(f.id).custody, 'ACTIVE');
  assert.equal(f.hosts.A.status(f.id).custody, 'DEPARTED');
  f.hosts.B.requestCancel(f.id, 'revoked'); assert.equal((await f.hosts.B.run(f.id)).kind, 'terminal');
  assert.equal(f.result('B').kind, 'cancelled'); assert.equal(f.file.counts().releases, 1); assert.equal(f.counters.B.cleanup, 1);
});

test('a structurally valid browser report cannot replace the actual successor', async t => {
  const f = await hostFixture(t), run = f.journals.A.run(f.id);
  const current = f.journals.A.artifact('tenant', run.outcome_digest);
  const token = await f.admissions.A.stored(f.image, current, run.program_id);
  const binding = f.bindings.A.find(item => item.operation === 'agent.mobility.fixture.task.v1');
  const reply = await binding.handle({});
  await assert.rejects(f.admissions.A.successor(token, { kind: 'reply', value: reply }, current), { code: 'SuccessorMismatch' });
  assert.deepEqual(f.journals.A.run(f.id), run); assert.deepEqual(f.counters.deliveries, { A: 0, B: 0 });
});
