import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { decodeValue, decodeSchema, encodeValue } from '../../runtime/values.mjs';
import { requirement } from '../../runtime/mobility/policy.mjs';
import { hostFixture } from './mobility_host_fixture.mjs';
import { parse, signRecord, runId, opaqueId, canonical } from '../../runtime/mobility/protocol.mjs';
import { Custodian } from '../../runtime/mobility/custodian.mjs';
import { version } from '../../runtime/mobility/custody.mjs';
import { WorldAdmission } from '../../runtime/mobility/admission.mjs';
import { pumpDeployment } from '../../runtime/mobility/deployment.mjs';

test('peer authentication cannot register a principal outside the configured issuer grant', async t => {
  const f = await hostFixture(t), { signature: _, ...registered } = parse(f.registration);
  const other = { ...registered, run_id: runId('A'), issuer_id: 'A', key_id: 'A' };
  const forgedAuthority = signRecord('run', other, f.pairs.A.privateKey);
  await assert.rejects(f.hosts.A.registerRun(forgedAuthority, f.image, encodeValue(f.schemas.integer, 123n)), { code: 'DeploymentDenied' });
  assert.equal(f.journals.A.run(other.run_id), null); assert.equal(f.counters.A.task, 0);
});

test('preflight normalization preserves wildcard domains and observes changed metadata on the next call', async t => {
  const f = await hostFixture(t, { requirementCount: 16 }), wanted = f.taskValue[3][0][0], constraints = f.taskValue[3][0][1], registration = parse(f.registration);
  assert.equal(f.policies.B.preflight(registration, wanted, constraints, ['shared']).host_id, 'B');
  const domainFree = structuredClone(wanted); for (const item of domainFree) item[7] = { tag: 0, value: null };
  assert.equal(f.policies.B.preflight(registration, domainFree, constraints, ['shared']).host_id, 'B');
  const binding = f.bindings.B.find(item => item.scope === 'read-15'); binding.scope = 'changed-scope';
  assert.throws(() => f.policies.B.preflight(registration, wanted, constraints, ['shared']), { code: 'CapabilityUnavailable' });
  binding.scope = 'read-15'; binding.enabled = false;
  assert.throws(() => f.policies.B.preflight(registration, wanted, constraints, ['shared']), { code: 'CapabilityUnavailable' });
});

test('Here executes the same typed file operation locally without a custody move', async t => {
  const f = await hostFixture(t, { localData: true });
  assert.equal((await f.hosts.A.run(f.id)).kind, 'terminal');
  assert.equal(f.hosts.A.status(f.id).epoch, '0');
  assert.deepEqual(f.counters.deliveries, { A: 0, B: 0 });
  assert.deepEqual(f.file.counts(), { reads: [0n, 16n, 32n], releases: 1 });
  assert.deepEqual(decodeValue(f.schemas.report, f.result('A').value), [123n, 9001n, { tag: 0, value: [42n, 4n] }, 91n]);
  assert.equal(f.counters.A.present, 1); assert.equal(f.counters.A.cleanup, 1);
});

test('an unavailable destination follows program fallback without any transfer or file read', async t => {
  const f = await hostFixture(t); f.peerMaps.A.clear();
  assert.equal((await f.hosts.A.run(f.id)).kind, 'terminal');
  assert.deepEqual(decodeValue(f.schemas.report, f.result('A').value), [123n, 9001n, { tag: 1, value: null }, 91n]);
  assert.deepEqual(f.file.counts(), { reads: [], releases: 0 });
  assert.equal(f.counters.A.cleanup, 1); assert.equal(f.hosts.A.status(f.id).epoch, '0');
});

test('a file changed after placement returns the actual typed conflict through the moved continuation', async t => {
  const f = await hostFixture(t, { expectedInspection: { tag: 2, value: null } });
  const out = await f.hosts.A.run(f.id); assert.equal((await f.hosts.A.retryTransfer(out.transfer_id)).kind, 'accepted');
  await writeFile(join(f.area, 'story.txt'), 'different version\n');
  const back = await f.hosts.B.run(f.id); assert.equal(back.kind, 'offered');
  assert.equal((await f.hosts.B.retryTransfer(back.transfer_id)).kind, 'accepted');
  assert.equal((await f.hosts.A.run(f.id)).kind, 'terminal');
  assert.deepEqual(decodeValue(f.schemas.report, f.result('A').value), [123n, 9001n, { tag: 2, value: null }, 91n]);
  assert.deepEqual(f.file.counts(), { reads: [], releases: 1 });
  assert.equal(f.counters.A.present, 1); assert.equal(f.counters.A.cleanup, 1);
});

test('an unsupported ordinary leaf remains parked without relocation or an invented reply', async t => {
  const f = await hostFixture(t), out = await f.hosts.A.run(f.id);
  assert.equal((await f.hosts.A.retryTransfer(out.transfer_id)).kind, 'accepted');
  await f.hosts.B.step(f.id);
  const before = f.journals.B.run(f.id);
  f.bindings.B.find(binding => binding.operation === 'agent.text.read-chunk.v1').enabled = false;
  await assert.rejects(f.hosts.B.step(f.id), { code: 'LeafBindingDenied' });
  assert.deepEqual(f.journals.B.run(f.id), before);
  assert.equal(f.hosts.B.status(f.id).occurrence, 'READY');
  assert.deepEqual(f.counters.deliveries, { A: 0, B: 1 }); assert.deepEqual(f.file.counts().reads, []);
});

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

test('cancellation during an unseen offer withdraws before source cleanup', async t => {
  const f = await hostFixture(t), offered = await f.hosts.A.run(f.id);
  assert.equal((await f.hosts.A.cancelRun(f.id, 'stop')).kind, 'cancel_requested');
  assert.equal(f.journals.B.run(f.id), null);
  assert.equal((await f.hosts.A.run(f.id)).kind, 'terminal');
  assert.equal(f.result('A').kind, 'cancelled'); assert.equal(f.counters.A.cleanup, 1); assert.equal(f.counters.B.cleanup, 0);
  assert.ok(f.journals.B.savedDecision(f.journals.A.transfer(offered.transfer_id).offer));
});

for (const route of ['pump', 'direct']) for (const revocation of ['none', 'export', 'principal'])
test(`${route} retries durable cancellation after restart with ${revocation} revocation`, async t => {
  const f = await hostFixture(t), offered = await f.hosts.A.run(f.id);
  const peer = f.peerMaps.A.get('B'), withdraw = peer.withdraw;
  peer.withdraw = async () => { throw Object.assign(new Error('offline'), { code: 'Offline' }); };
  assert.equal((await f.hosts.A.cancelRun(f.id, 'stop')).kind, 'unknown');
  if (revocation === 'export') f.deployment.exportPolicies['fixture-shared'] = [];
  if (revocation === 'principal') f.revoked.A.add('tenant/user');
  f.restart('A'); peer.withdraw = withdraw;
  await assert.rejects(f.hosts.A.transferEnvelope(offered.transfer_id), { code: 'CancellationPending' });
  const result = route === 'direct' ? await f.hosts.A.retryTransfer(offered.transfer_id)
    : (await pumpDeployment({ config: { execution: 'node' }, journal: f.journals.A, custodian: f.hosts.A }))[0];
  assert.equal(result.kind, 'cancel_requested');
  const receipt = f.journals.B.savedDecision(f.journals.A.transfer(offered.transfer_id).offer);
  assert.equal(parse(receipt).decision, 'refused');
  assert.equal(f.journals.B.run(f.id), null); assert.equal(f.counters.deliveries.B, 0);
  assert.equal((await f.hosts.A.run(f.id)).kind, 'terminal');
  assert.equal(f.result('A').kind, 'cancelled'); assert.equal(f.counters.A.cleanup, 1);
  assert.deepEqual(f.file.counts().reads, []);
});

test('cancellation arriving during retry preflight prevents fresh delivery', async t => {
  const f = await hostFixture(t), offered = await f.hosts.A.run(f.id);
  const peer = f.peerMaps.A.get('B'), preflight = peer.preflight, withdraw = peer.withdraw;
  peer.withdraw = async () => { throw new Error('offline'); };
  peer.preflight = async metadata => {
    const observation = await preflight(metadata);
    assert.equal((await f.hosts.A.cancelRun(f.id, 'stop')).kind, 'unknown');
    return observation;
  };
  const pending = await f.hosts.A.retryTransfer(offered.transfer_id);
  assert.equal(pending.kind, 'unknown'); assert.equal(pending.reason, 'CancellationPending');
  assert.equal(f.counters.deliveries.B, 0); assert.equal(f.journals.B.run(f.id), null);
  peer.withdraw = withdraw;
  assert.equal((await f.hosts.A.retryTransfer(offered.transfer_id)).kind, 'cancel_requested');
  assert.equal((await f.hosts.A.run(f.id)).kind, 'terminal');
  assert.equal(f.result('A').kind, 'cancelled'); assert.deepEqual(f.file.counts().reads, []);
});

test('the service forwards pending cancellation when acceptance already won', async t => {
  const f = await hostFixture(t, { lostAck: true }), offered = await f.hosts.A.run(f.id);
  assert.equal((await f.hosts.A.retryTransfer(offered.transfer_id)).kind, 'unknown');
  const peer = f.peerMaps.A.get('B'), withdraw = peer.withdraw;
  peer.withdraw = async () => { throw new Error('offline'); };
  assert.equal((await f.hosts.A.cancelRun(f.id, 'stop')).kind, 'unknown');
  f.restart('A'); peer.withdraw = withdraw;
  const results = await pumpDeployment({ config: { execution: 'node' }, journal: f.journals.A, custodian: f.hosts.A });
  assert.equal(results[0].kind, 'cancel_forwarded');
  assert.equal(f.hosts.A.status(f.id).custody, 'DEPARTED');
  assert.equal((await f.hosts.B.run(f.id)).kind, 'terminal');
  assert.equal(f.result('B').kind, 'cancelled'); assert.equal(f.counters.A.cleanup, 0); assert.equal(f.counters.B.cleanup, 1);
  assert.deepEqual(f.file.counts().reads, []);
});

test('cancellation after lost acceptance is forwarded to the owner, never applied at source', async t => {
  const f = await hostFixture(t, { lostAck: true }), offered = await f.hosts.A.run(f.id);
  assert.equal((await f.hosts.A.retryTransfer(offered.transfer_id)).kind, 'unknown');
  assert.equal((await f.hosts.A.cancelRun(f.id, 'stop')).kind, 'cancel_forwarded');
  assert.equal(f.hosts.A.status(f.id).custody, 'DEPARTED');
  f.restart('B'); assert.equal((await f.hosts.B.run(f.id)).kind, 'terminal');
  assert.equal(f.result('B').kind, 'cancelled'); assert.equal(f.counters.A.cleanup, 0); assert.equal(f.counters.B.cleanup, 1);
  assert.deepEqual(f.file.counts().reads, []);
});

test('failed cancellation forwarding remains durable and is retried after restart', async t => {
  const f = await hostFixture(t), offered = await f.hosts.A.run(f.id);
  await f.hosts.A.retryTransfer(offered.transfer_id);
  const peer = f.peerMaps.A.get('B'), control = peer.control;
  peer.control = async () => { throw Object.assign(new Error('offline'), { code: 'Offline' }); };
  assert.equal((await f.hosts.A.cancelRun(f.id, 'stop')).kind, 'cancel_pending');
  assert.equal(f.hosts.A.status(f.id).custody, 'DEPARTED');
  f.restart('A'); peer.control = control;
  assert.equal((await f.hosts.A.step(f.id)).kind, 'cancel_forwarded');
  assert.equal((await f.hosts.A.step(f.id)).kind, 'departed');
  assert.equal((await f.hosts.B.run(f.id)).kind, 'terminal'); assert.equal(f.result('B').kind, 'cancelled');
});

test('a returning run retains an earlier cancellation whose forwarding was unavailable', async t => {
  const f = await hostFixture(t), offered = await f.hosts.A.run(f.id);
  await f.hosts.A.retryTransfer(offered.transfer_id);
  const peer = f.peerMaps.A.get('B'); peer.control = async () => { throw new Error('offline'); };
  assert.equal((await f.hosts.A.cancelRun(f.id, 'stop')).kind, 'cancel_pending');
  const returning = await f.hosts.B.run(f.id); await f.hosts.B.retryTransfer(returning.transfer_id);
  assert.equal(f.hosts.A.status(f.id).epoch, '2'); assert.equal(f.hosts.A.status(f.id).cancellation_pending, true);
  assert.equal((await f.hosts.A.run(f.id)).kind, 'terminal'); assert.equal(f.result('A').kind, 'cancelled');
  assert.equal(f.counters.A.present, 0); assert.equal(f.counters.A.cleanup, 1); assert.equal(f.counters.B.cleanup, 0);
});

test('concurrent duplicate offers produce one exact decision and one destination execution', async t => {
  const f = await hostFixture(t), out = await f.hosts.A.run(f.id), envelope = await f.hosts.A.transferEnvelope(out.transfer_id);
  const receipts = await Promise.all([f.hosts.B.receiveOffer('A', envelope), f.hosts.B.receiveOffer('A', envelope)]);
  assert.deepEqual(receipts[0], receipts[1]); assert.equal(f.journals.B.run(f.id).executor_incarnation, '0');
  f.journals.A.receiveDecision(envelope.offer, receipts[0]);
  const back = await f.hosts.B.run(f.id); assert.equal(back.kind, 'offered');
  assert.deepEqual(await f.hosts.B.receiveOffer('A', envelope), receipts[0]);
  assert.deepEqual(f.file.counts(), { reads: [0n, 16n, 32n], releases: 1 });
  assert.equal((await f.hosts.B.retryTransfer(back.transfer_id)).kind, 'accepted');
  assert.equal((await f.hosts.A.run(f.id)).kind, 'terminal'); assert.equal(f.counters.A.cleanup, 1);
});

test('concurrent executor attachment through two custodians fences the losing assignment', async t => {
  const f = await hostFixture(t);
  const other = new Custodian({ journal: f.journals.A, admission: f.admissions.A, world: f.world, policy: f.policies.A, peers: f.peerMaps.A });
  t.after(() => other.retireAll());
  const assigned = await Promise.allSettled([f.hosts.A.executorAssignment(f.id), other.executorAssignment(f.id)]);
  assert.equal(assigned.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(assigned.find(result => result.status === 'rejected').reason.code, 'StaleExecutor');
  const winner = assigned.find(result => result.status === 'fulfilled').value;
  assert.deepEqual(winner.version, version(f.journals.A.run(f.id))); assert.equal(f.counters.A.task, 0);
});

test('a returning offer with a nonmatching predecessor cannot overwrite unresolved outbound custody', async t => {
  const f = await hostFixture(t, { lostAck: true }), out = await f.hosts.A.run(f.id);
  assert.equal((await f.hosts.A.retryTransfer(out.transfer_id)).kind, 'unknown');
  const back = await f.hosts.B.run(f.id), envelope = await f.hosts.B.transferEnvelope(back.transfer_id), before = f.journals.A.run(f.id);
  envelope.predecessor = canonical({ not_a_receipt: true });
  assert.equal(parse(await f.hosts.A.receiveOffer('B', envelope)).decision, 'refused');
  assert.deepEqual(f.journals.A.run(f.id), before); assert.equal(f.hosts.A.status(f.id).custody, 'OFFERED');
  assert.equal(f.counters.A.present, 0); assert.equal(f.counters.A.cleanup, 0);
});

test('a fresh transfer cannot reactivate a terminal run using an earlier valid checkpoint', async t => {
  const f = await hostFixture(t), out = await f.hosts.A.run(f.id); await f.hosts.A.retryTransfer(out.transfer_id);
  const back = await f.hosts.B.run(f.id), envelope = await f.hosts.B.transferEnvelope(back.transfer_id);
  await f.hosts.B.retryTransfer(back.transfer_id); await f.hosts.A.run(f.id);
  const before = f.journals.A.run(f.id), { signature: _, ...offer } = parse(envelope.offer);
  envelope.offer = signRecord('offer', { ...offer, transfer_id: opaqueId() }, f.pairs.B.privateKey);
  assert.equal(parse(await f.hosts.A.receiveOffer('B', envelope)).decision, 'refused');
  assert.deepEqual(f.journals.A.run(f.id), before); assert.equal(f.counters.A.cleanup, 1);
});

test('suspending cleanup survives custodian restart and uses its exact current occurrence once', async t => {
  const f = await hostFixture(t), out = await f.hosts.A.run(f.id); await f.hosts.A.retryTransfer(out.transfer_id);
  await f.hosts.B.cancelRun(f.id, 'stop'); await f.hosts.B.step(f.id);
  const parked = f.journals.B.run(f.id); assert.equal(f.hosts.B.status(f.id).operation, 'agent.mobility.fixture.child-cleanup.v1');
  assert.equal(f.counters.B.cleanup, 0); f.restart('B');
  assert.equal(f.journals.B.run(f.id).current_occurrence_id, parked.current_occurrence_id);
  assert.equal((await f.hosts.B.run(f.id)).kind, 'terminal'); assert.equal(f.result('B').kind, 'cancelled');
  assert.equal(f.counters.B.cleanup, 1); assert.equal(f.counters.A.cleanup, 0); assert.deepEqual(f.file.counts().reads, []);
});

test('missing destination cleanup support and an origin resource pin reject movement before upload', async t => {
  const missing = await hostFixture(t);
  missing.bindings.B.find(binding => binding.operation.endsWith('.child-cleanup.v1')).enabled = false;
  assert.equal((await missing.hosts.A.run(missing.id)).kind, 'terminal');
  assert.equal(missing.counters.bytes.B, 0); assert.equal(missing.journals.B.run(missing.id), null); assert.equal(missing.counters.A.cleanup, 1);
  const pinned = await hostFixture(t);
  for (let i = 0; i < 8 && pinned.hosts.A.status(pinned.id).operation !== 'agent.mobility.relocate.v1'; i++) await pinned.hosts.A.step(pinned.id);
  const run = pinned.journals.A.run(pinned.id); pinned.journals.A.resourcePin(pinned.id, version(run), 'origin-lock', true);
  assert.equal((await pinned.hosts.A.step(pinned.id)).kind, 'refused');
  assert.equal(pinned.counters.bytes.B, 0); assert.equal(pinned.hosts.A.status(pinned.id).custody, 'ACTIVE');
  pinned.journals.A.resourcePin(pinned.id, version(pinned.journals.A.run(pinned.id)), 'origin-lock', false);
  assert.equal((await pinned.hosts.A.run(pinned.id)).kind, 'terminal'); assert.deepEqual(pinned.file.counts().reads, []);
});

test('a forged binding observation and an unconfigured program destination never expand grants', async t => {
  const f = await hostFixture(t), peer = f.peerMaps.A.get('B'), preflight = peer.preflight;
  peer.preflight = async metadata => { const value = await preflight(metadata); return { ...value, observation: { ...value.observation, binding_digest: '0'.repeat(64) } }; };
  const out = await f.hosts.A.run(f.id); assert.equal((await f.hosts.A.retryTransfer(out.transfer_id)).kind, 'refused');
  assert.equal(f.journals.B.run(f.id), null); assert.deepEqual(f.file.counts().reads, []);
  assert.equal((await f.hosts.A.run(f.id)).kind, 'terminal');
  const other = await hostFixture(t), task = structuredClone(other.taskValue); task[3][0][1][1] = { tag: 1, value: 'https://unconfigured.invalid' };
  other.bindings.A.find(binding => binding.operation.endsWith('.task.v1')).handle = () => encodeValue(other.schemas.task, task);
  assert.equal((await other.hosts.A.run(other.id)).kind, 'terminal'); assert.deepEqual(other.counters.deliveries, { A: 0, B: 0 });
  assert.deepEqual(other.file.counts().reads, []);
});

test('saved acceptance remains available when policy suspends new admissions', async t => {
  const f = await hostFixture(t), out = await f.hosts.A.run(f.id); await f.hosts.A.retryTransfer(out.transfer_id);
  const offer = f.journals.A.transfer(out.transfer_id).offer, receipt = f.journals.B.savedDecision(offer);
  f.revoked.B.add('tenant/user');
  assert.deepEqual(f.hosts.B.queryTransfer('A', offer), receipt);
  assert.deepEqual(await f.hosts.B.receiveOffer('A', { offer }), receipt);
  assert.equal(f.hosts.A.status(f.id).custody, 'DEPARTED'); assert.equal(f.hosts.B.status(f.id).custody, 'ACTIVE');
});

for (const [arena, limits] of [['input', { maximumInputBytes: 1 }], ['working', { maximumWorkingBytes: 1 }], ['output', { maximumOutputBytes: 1 }]]) test(`${arena} capacity failure preserves the authoritative checkpoint and acquired reply`, async t => {
  const f = await hostFixture(t); assert.equal((await f.hosts.A.step(f.id)).kind, 'reply_saved');
  const saved = f.journals.A.run(f.id), occurrence = f.journals.A.occurrence(saved.current_occurrence_id), generous = f.admissions.A;
  f.admissions.A = new WorldAdmission(f.world, { kernelBytes: await readFile(f.identity.kernelPath), expectedSha256: f.identity.kernelSha256, ...limits });
  f.restart('A');
  await assert.rejects(f.hosts.A.step(f.id), error => error.code === 'WORLD_CAPACITY' && error.details.arena === arena);
  assert.deepEqual(f.journals.A.run(f.id), saved); assert.deepEqual(f.journals.A.occurrence(saved.current_occurrence_id), occurrence);
  assert.equal(f.counters.A.task, 1); assert.equal(f.hosts.A.status(f.id).custody, 'ACTIVE');
  f.admissions.A = generous; f.restart('A');
  const out = await f.hosts.A.run(f.id); assert.equal(out.kind, 'offered'); assert.equal(f.counters.A.task, 1);
});

test('dispatch admission precedes queued I/O and an unsettled ordinary occurrence cannot become a transfer', async t => {
  const f = await hostFixture(t), before = version(f.journals.A.run(f.id)), out = await f.hosts.A.run(f.id);
  assert.throws(() => f.journals.A.admitLeaf(f.id, before, []));
  await f.hosts.A.retryTransfer(out.transfer_id); await f.hosts.B.step(f.id);
  const binding = f.bindings.B.find(item => item.operation === 'agent.text.read-chunk.v1'), handle = binding.handle;
  let release, entered;
  const started = new Promise(resolve => { entered = resolve; }), waiting = new Promise(resolve => { release = resolve; });
  binding.handle = async args => { entered(); await waiting; return handle(args); };
  const pending = f.hosts.B.step(f.id); await started;
  try {
    const run = f.journals.B.run(f.id), token = await f.admissions.B.stored(f.image, f.journals.B.artifact('tenant', run.outcome_digest), run.program_id);
    assert.equal(f.hosts.B.status(f.id).occurrence, 'DISPATCHING'); assert.deepEqual(f.file.counts().reads, []);
    assert.throws(() => f.journals.B.admitLeaf(f.id, version(run), []), { code: 'UnsettledOccurrence' });
    assert.throws(() => f.journals.B.beginTransfer(f.id, version(run), token, { observationDigest: '0'.repeat(64), exportPolicyRevision: 'p1' }), { code: 'RelocationMismatch' });
    assert.equal(f.journals.B.outbox().length, 0); assert.equal(f.hosts.B.status(f.id).custody, 'ACTIVE');
  } finally { release(); }
  assert.equal((await pending).kind, 'reply_saved'); assert.deepEqual(f.file.counts().reads, [0n]);
  const acquired = f.journals.B.run(f.id);
  assert.throws(() => f.journals.B.admitLeaf(f.id, version(acquired), []), { code: 'UnsettledOccurrence' });
});

for (const corrupt of ['image', 'outcome', 'oversized', 'ordinary-boundary']) test(`${corrupt} input is refused by actual target admission before any effect`, async t => {
  const f = await hostFixture(t), initial = f.journals.A.run(f.id);
  const initialBytes = f.journals.A.artifact('tenant', initial.outcome_digest);
  const out = await f.hosts.A.run(f.id), envelope = await f.hosts.A.transferEnvelope(out.transfer_id);
  if (corrupt === 'image') envelope.image = Uint8Array.of(0);
  else if (corrupt === 'outcome') envelope.outcome = Uint8Array.of(0);
  else if (corrupt === 'oversized') envelope.outcome = new Uint8Array((8 << 20) + 1);
  else envelope.outcome = initialBytes;
  assert.equal(parse(await f.hosts.B.receiveOffer('A', envelope)).decision, 'refused');
  assert.equal(f.journals.B.run(f.id), null); assert.equal(f.hosts.A.status(f.id).custody, 'OFFERED'); assert.deepEqual(f.file.counts().reads, []);
  assert.equal((await f.hosts.A.retryTransfer(out.transfer_id)).kind, 'refused');
});

test('a valid but unapproved image and a wrong trusted kernel are denied before execution', async t => {
  const f = await hostFixture(t), { signature: _, ...registration } = parse(f.registration);
  f.deployment.imageDigest = '0'.repeat(64);
  const id = runId('issuer'), unapproved = signRecord('run', { ...registration, run_id: id }, f.pairs.issuer.privateKey);
  await assert.rejects(f.hosts.A.registerRun(unapproved, f.image, encodeValue(f.schemas.integer, 123n)), { code: 'DeploymentDenied' });
  assert.equal(f.journals.A.run(id), null); assert.equal(f.counters.A.task, 0);
  assert.throws(() => new WorldAdmission(f.world, { kernelBytes: Buffer.from('not the trusted kernel'), expectedSha256: f.identity.kernelSha256 }), { code: 'RuntimeMismatch' });
});

test('an invalid offer signature is a protocol rejection, never a fabricated custody refusal', async t => {
  const f = await hostFixture(t), offered = await f.hosts.A.run(f.id), envelope = await f.hosts.A.transferEnvelope(offered.transfer_id), original = envelope.offer;
  const signed = parse(original); signed.signature = (signed.signature[0] === 'A' ? 'B' : 'A') + signed.signature.slice(1);
  envelope.offer = canonical(signed);
  await assert.rejects(f.hosts.B.receiveOffer('A', envelope), { code: 'InvalidSignature' });
  assert.equal(f.journals.B.savedDecision(original), null); assert.equal(f.journals.B.run(f.id), null);
  assert.equal(f.hosts.A.status(f.id).custody, 'OFFERED'); assert.deepEqual(f.file.counts().reads, []);
});

for (const operation of ['status', 'preflight', 'deliver', 'withdraw']) for (const when of ['before', 'after']) test(`network fault ${operation}.${when} preserves durable custody and exact retry`, async t => {
  const f = await hostFixture(t), offered = await f.hosts.A.run(f.id), peer = f.peerMaps.A.get('B'), original = peer[operation];
  let armed = true;
  peer[operation] = async (...args) => {
    if (armed && when === 'before') { armed = false; throw Object.assign(new Error('injected network timeout'), { code: 'ETIMEDOUT' }); }
    const result = await original(...args);
    if (armed) { armed = false; throw Object.assign(new Error('injected response loss'), { code: 'ECONNRESET' }); }
    return result;
  };
  const run = operation === 'withdraw' ? () => f.hosts.A.withdrawTransfer(offered.transfer_id) : () => f.hosts.A.retryTransfer(offered.transfer_id);
  assert.equal((await run()).kind, 'unknown'); assert.equal(f.hosts.A.status(f.id).custody, 'OFFERED');
  const committed = when === 'after' && ['deliver', 'withdraw'].includes(operation);
  assert.equal(f.journals.B.savedDecision(f.journals.A.transfer(offered.transfer_id).offer) !== null, committed);
  assert.equal(f.journals.B.run(f.id)?.status ?? null, committed && operation === 'deliver' ? 'ACTIVE' : null);
  assert.deepEqual(f.file.counts().reads, []); assert.equal(f.counters.A.cleanup, 0);
  f.restart('A'); f.restart('B');
  assert.equal((await run()).kind, operation === 'withdraw' ? 'refused' : 'accepted');
  assert.equal(f.hosts.A.status(f.id).custody, operation === 'withdraw' ? 'ACTIVE' : 'DEPARTED');
});

test('a delayed acceptance response may arrive after onward execution and return without restarting the old epoch', async t => {
  const f = await hostFixture(t), offered = await f.hosts.A.run(f.id), peer = f.peerMaps.A.get('B'), original = peer.deliver;
  let release, entered;
  const delayed = new Promise(resolve => { release = resolve; }), accepted = new Promise(resolve => { entered = resolve; });
  peer.deliver = async envelope => { const receipt = await original(envelope); entered(); await delayed; return receipt; };
  const oldDelivery = f.hosts.A.retryTransfer(offered.transfer_id); await accepted;
  try {
    assert.equal(f.hosts.A.status(f.id).custody, 'OFFERED'); assert.equal(f.hosts.B.status(f.id).custody, 'ACTIVE');
    const back = await f.hosts.B.run(f.id); assert.equal((await f.hosts.B.retryTransfer(back.transfer_id)).kind, 'accepted');
    assert.equal((await f.hosts.A.run(f.id)).kind, 'terminal');
    const final = f.journals.A.run(f.id); release(); assert.equal((await oldDelivery).kind, 'accepted');
    assert.deepEqual(f.journals.A.run(f.id), final); assert.equal(f.counters.A.cleanup, 1);
  } finally { release(); }
});

for (const when of ['before', 'after']) test(`World successor fault ${when} pure execution preserves the saved reply without redispatch`, async t => {
  const f = await hostFixture(t); await f.hosts.A.step(f.id);
  const saved = f.journals.A.run(f.id), resume = f.admissions.A.resume.bind(f.admissions.A); let armed = true;
  f.admissions.A.resume = async token => {
    const executor = await resume(token);
    return { ...executor, async drive(command) {
      if (armed && when === 'before') { armed = false; throw new Error('injected World boundary'); }
      const next = await executor.drive(command);
      if (armed) { armed = false; throw new Error('injected World boundary'); }
      return next;
    } };
  };
  f.restart('A'); await assert.rejects(f.hosts.A.step(f.id), /injected World boundary/);
  const failed = f.journals.A.run(f.id);
  for (const key of ['custody_epoch', 'execution_revision', 'outcome_digest', 'current_occurrence_id', 'reply_digest']) assert.equal(failed[key], saved[key]);
  assert.equal(f.counters.A.task, 1); f.restart('A');
  assert.equal((await f.hosts.A.run(f.id)).kind, 'offered'); assert.equal(f.counters.A.task, 1);
});

for (const when of ['before', 'after']) test(`target World admission fault ${when} validates no active destination or external action`, async t => {
  const f = await hostFixture(t), offered = await f.hosts.A.run(f.id), parked = f.admissions.B.parked.bind(f.admissions.B);
  f.admissions.B.parked = async (...args) => { if (when === 'after') await parked(...args); throw new Error('injected World admission'); };
  assert.equal((await f.hosts.A.retryTransfer(offered.transfer_id)).kind, 'refused');
  assert.equal(f.journals.B.run(f.id), null); assert.equal(f.hosts.A.status(f.id).custody, 'ACTIVE'); assert.deepEqual(f.file.counts().reads, []);
  f.restart('A'); assert.equal((await f.hosts.A.run(f.id)).kind, 'terminal'); assert.equal(f.counters.A.cleanup, 1);
});

for (const when of ['before', 'after']) test(`leaf response fault ${when} I/O remains uncertain rather than repeating the occurrence`, async t => {
  const f = await hostFixture(t), offered = await f.hosts.A.run(f.id); await f.hosts.A.retryTransfer(offered.transfer_id);
  const binding = f.bindings.B.find(item => item.operation === 'agent.text.read-chunk.v1'), original = binding.handle;
  binding.handle = async args => { if (when === 'after') await original(args); throw new Error('injected leaf response'); };
  await assert.rejects(f.hosts.B.run(f.id), /injected leaf response/);
  assert.equal(f.hosts.B.status(f.id).occurrence, 'UNKNOWN'); assert.deepEqual(f.file.counts().reads, when === 'after' ? [0n] : []);
  f.restart('B'); assert.equal((await f.hosts.B.run(f.id)).kind, 'effect_unknown');
  assert.deepEqual(f.file.counts().reads, when === 'after' ? [0n] : []); assert.equal(f.hosts.A.status(f.id).custody, 'DEPARTED');
});

test('distinct wildcard and exact requirements may select the same binding', async t => {
  const f = await hostFixture(t), wanted = f.taskValue[3][0][0][0], wildcard = structuredClone(wanted);
  wildcard[7] = { tag: 0, value: null };
  const inspect = requirements => f.policies.B.preflight(parse(f.registration), requirements, f.taskValue[3][0][1], ['shared']);
  assert.equal(inspect([wanted, wildcard]).binding_digest, inspect([wanted]).binding_digest);
  assert.throws(() => inspect([wanted, wanted]), { code: 'DuplicateRequirement' });
});

for (const restriction of ['state', 'result']) test(`preflight and cleanup admission reject known ${restriction} disclosure denial`, async t => {
  const f = await hostFixture(t), run = f.journals.A.run(f.id), reader = f.bindings.B.find(binding => binding.scope === 'read');
  const restrict = binding => { if (restriction === 'state') binding.allowedStateLabels = []; else binding.classification = ['origin-only']; };
  restrict(reader);
  assert.throws(() => f.policies.B.preflight(parse(f.registration), f.taskValue[3][0][0], f.taskValue[3][0][1], ['shared']), { code: 'CapabilityUnavailable' });
  restrict(f.bindings.B.find(binding => binding.cleanup));
  assert.throws(() => f.policies.B.checkCleanup(run), { code: 'CleanupUnsupported' });
});

test('dispatch skips a disclosure-ineligible binding without exposing payload to its authorizer', async t => {
  const f = await hostFixture(t, { requirementCount: 2 }), readers = f.bindings.B.filter(binding => binding.scope.startsWith('read'));
  let deniedCalls = 0; readers[0].allowedStateLabels = []; readers[0].authorize = () => { deniedCalls++; return true; };
  const request = { semanticIdentity: readers[0].operation, payloadSchema: readers[0].payloadSchema, resumeSchema: readers[0].resultSchema,
    payload: encodeValue(f.schemas.read, [f.declared, 0n, 16n]) };
  assert.equal(f.policies.B.dispatch(f.journals.A.run(f.id), request).binding, readers[1]);
  assert.equal(deniedCalls, 0);
  f.revoked.B.add('tenant/user');
  assert.throws(() => f.policies.B.dispatch(f.journals.A.run(f.id), request), { code: 'PrincipalRevoked' });
});

for (const when of ['before-retry', 'during-preflight', 'after-restart']) test(`named export revocation ${when} prevents transfer disclosure`, async t => {
  const f = await hostFixture(t), offered = await f.hosts.A.run(f.id), peer = f.peerMaps.A.get('B'), preflight = peer.preflight;
  if (when === 'during-preflight') peer.preflight = async metadata => { const ready = await preflight(metadata); f.deployment.exportPolicies['fixture-shared'] = []; return ready; };
  else f.deployment.exportPolicies['fixture-shared'] = [];
  if (when === 'after-restart') f.restart('A');
  const before = f.counters.preflights.B;
  const result = await f.hosts.A.retryTransfer(offered.transfer_id);
  assert.equal(result.kind, 'unknown'); assert.equal(result.reason, 'ExportPolicyDenied');
  assert.equal(f.counters.bytes.B, 0); assert.equal(f.journals.B.run(f.id), null);
  assert.equal(f.counters.preflights.B - before, when === 'during-preflight' ? 1 : 0);
  peer.preflight = preflight; f.deployment.exportPolicies['fixture-shared'] = ['A', 'B'];
  assert.equal((await f.hosts.A.retryTransfer(offered.transfer_id)).kind, 'accepted');
});

for (const source of ['registration', 'local']) for (const kind of ['image', 'outcome']) test(`${source} ${kind} limit rejects local registration without custody`, async t => {
  const f = await hostFixture(t, { register: false });
  let registration = f.registration;
  if (source === 'local') f.deployment.limits = { ...f.deployment.limits, [`maximum_${kind}_bytes`]: 1 };
  else {
    const { signature: _, ...record } = parse(registration);
    registration = signRecord('run', { ...record, deployment_limits: { ...record.deployment_limits, [`maximum_${kind}_bytes`]: 1 } }, f.pairs.issuer.privateKey);
  }
  await assert.rejects(f.hosts.A.registerRun(registration, f.image, encodeValue(f.schemas.integer, 123n)), { code: 'ArtifactCapacity' });
  assert.equal(f.journals.A.run(f.id), null); assert.equal(f.counters.A.task, 0);
});

test('oversized successor preserves the parked outcome and acquired reply across restart', async t => {
  const f = await hostFixture(t), initial = f.journals.A.run(f.id);
  const maximum = f.journals.A.artifact('tenant', initial.outcome_digest).length;
  f.journals.A.applyPolicy(f.id, version(initial), { cleanupRequirements: initial.cleanup_requirements, classification: initial.classification,
    deploymentLimits: { ...initial.deployment_limits, maximum_outcome_bytes: maximum }, policyRevision: 'p2' });
  assert.equal((await f.hosts.A.step(f.id)).kind, 'reply_saved');
  const parked = f.journals.A.run(f.id);
  await assert.rejects(f.hosts.A.step(f.id), { code: 'ArtifactCapacity' });
  assert.equal(f.journals.A.run(f.id).outcome_digest, parked.outcome_digest);
  assert.equal(f.journals.A.run(f.id).reply_digest, parked.reply_digest);
  f.restart('A'); await assert.rejects(f.hosts.A.step(f.id), { code: 'ArtifactCapacity' });
  assert.equal(f.counters.A.task, 1);
});

test('policy tightening cannot install limits below already retained artifacts', async t => {
  const f = await hostFixture(t), before = f.journals.A.run(f.id);
  assert.throws(() => f.journals.A.applyPolicy(f.id, version(before), { cleanupRequirements: before.cleanup_requirements, classification: before.classification,
    deploymentLimits: { ...before.deployment_limits, maximum_outcome_bytes: 1 }, policyRevision: 'p2' }), { code: 'ArtifactCapacity' });
  assert.deepEqual(f.journals.A.run(f.id), before);
});

test('export revocation does not prevent reconciliation of an already accepted transfer', async t => {
  const f = await hostFixture(t, { lostAck: true }), offered = await f.hosts.A.run(f.id);
  assert.equal((await f.hosts.A.retryTransfer(offered.transfer_id)).kind, 'unknown');
  f.deployment.exportPolicies['fixture-shared'] = [];
  const bytes = f.counters.bytes.B;
  assert.equal((await f.hosts.A.retryTransfer(offered.transfer_id)).kind, 'accepted');
  assert.equal(f.counters.bytes.B, bytes);
});

test('cleanup dispatch uses the same wildcard requirement match as cleanup admission', async t => {
  const f = await hostFixture(t), binding = f.bindings.A.find(binding => binding.operation.endsWith('.child-cleanup.v1'));
  const wanted = f.deployment.cleanup.find(value => value[0] === binding.operation); wanted[7] = { tag: 0, value: null };
  const run = f.journals.A.run(f.id); f.revoked.A.add('tenant/user');
  f.policies.A.checkCleanup(run);
  let deniedCalls = 0;
  f.bindings.A.unshift({ ...binding, cleanup: false, role: 'read', scope: 'ordinary', authorize: () => { deniedCalls++; return true; } });
  const selected = f.policies.A.dispatch(run, { semanticIdentity: binding.operation, payloadSchema: binding.payloadSchema, resumeSchema: binding.resultSchema, payload: encodeValue(f.schemas.integer, 9001n) });
  assert.equal(selected.binding, binding); assert.equal(selected.cleanup, true); assert.equal(deniedCalls, 0);
  binding.scope = 'changed-scope';
  assert.throws(() => f.policies.A.dispatch(run, { semanticIdentity: binding.operation, payloadSchema: binding.payloadSchema, resumeSchema: binding.resultSchema, payload: encodeValue(f.schemas.integer, 9001n) }), { code: 'PrincipalRevoked' });
});
