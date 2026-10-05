import { artifactRoot } from "./artifacts.mjs";
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { generateKeyPairSync } from 'node:crypto';
import { verifyRuntime } from '../../tools/agent4/dependencies.mjs';
import { encodeValue, decodeSchema, encodeSchema } from '../../runtime/values.mjs';
import { WorldAdmission, canonicalRequirements } from '../../runtime/mobility/admission.mjs';
import { CustodyJournal } from '../../runtime/mobility/journal.mjs';
import { hash, opaqueId, runId, signRecord, verifyRecord, parse, canonical } from '../../runtime/mobility/protocol.mjs';
import { schemas, observationValue } from '../../runtime/mobility/values.mjs';
import { version, attach as coreAttach, accept as coreAccept, acceptedCore } from '../../runtime/mobility/custody.mjs';
import { subject } from '../../runtime/text_inspection.mjs';
import { placement, resolution } from './mobility_fixture.mjs';

assert.ok(process.env.AGENT_MOBILITY_RUNTIME, 'Set AGENT_MOBILITY_RUNTIME to the independently authenticated runtime');
const runtime = resolve(process.env.AGENT_MOBILITY_RUNTIME);
const identity = verifyRuntime(runtime), world = await import(pathToFileURL(identity.entrypoint));
const kernelBytes = await readFile(identity.kernelPath), image = await readFile((artifactRoot + '/agent4/mobility/program.bpi3'));
const admission = new WorldAdmission(world, { kernelBytes, expectedSha256: identity.kernelSha256 });
const text = new TextEncoder().encode('alpha\nbeta gamma\ndelta epsilon zeta\nomega\n');
const declared = await subject('fixture/story', text);
const limits = { maximum_moves: 16, maximum_image_bytes: 8 << 20, maximum_outcome_bytes: 8 << 20 };
const kernel = await world.Kernel.create({ bytes: kernelBytes, expectedSha256: identity.kernelSha256 });
kernel.setLimits({ input: 8 << 20, working: 64 << 20, output: 8 << 20 });
const prepared = kernel.prepare(image), session = kernel.start(prepared, encodeValue({ root: 0, types: ['u64'] }, 123n));
const initialBytes = kernel.drive(session, { checkpoint: true });
const initialRequest = await world.decodeRequest(world.decodeOutcome(initialBytes).request);
const taskReply = encodeValue(decodeSchema(initialRequest.resumeSchema), [123n, 9001n, declared, placement('B', 2, 'inspect'), placement('A', 1, 'present')]);
const resolveBytes = kernel.drive(session, { control: 'reply', value: await world.encodeResult(world.decodeOutcome(initialBytes).request, taskReply), checkpoint: true });
const resolveRequest = await world.decodeRequest(world.decodeOutcome(resolveBytes).request);
const resolveReply = encodeValue(decodeSchema(resolveRequest.resumeSchema), resolution([[], [[], { tag: 1, value: 'B' }, { tag: 0, value: null }, 8n << 20n]], 'A', identity.kernelSha256));
const moveBytes = kernel.drive(session, { control: 'reply', value: await world.encodeResult(world.decodeOutcome(resolveBytes).request, resolveReply), checkpoint: true });
kernel.checkpoint(session, { transfer: true }); kernel.releasePrepared(prepared);
const initial = await admission.parked(image, initialBytes), resolving = await admission.parked(image, resolveBytes), moving = await admission.parked(image, moveBytes);
const nextResolve = await admission.successor(initial, { kind: 'reply', value: taskReply }, resolveBytes);

async function fixture(t, token = moving) {
  const directory = await mkdtemp(join(tmpdir(), 'mobility-journal-'));
  const pairs = Object.fromEntries(['issuer', 'A', 'B'].map(name => [name, generateKeyPairSync('ed25519')]));
  const keys = new Map(Object.entries(pairs).map(([owner, pair]) => [owner, { owner, status: 'active', publicKey: pair.publicKey }]));
  const opened = new Set(); let failure = null;
  const open = (host, create = false, generation = 'generation-1', options = {}) => {
    const journal = new CustodyJournal({ directory: join(directory, host), hostId: host, deploymentGeneration: generation, keys,
      signer: { keyId: host, privateKey: pairs[host].privateKey, policyRevision: 'p1' }, admission, create,
      fault(point) { if (point === failure) throw new Error(`injected ${point}`); }, ...options });
    opened.add(journal); return journal;
  };
  const close = journal => { journal.close(); opened.delete(journal); };
  t.after(async () => { for (const journal of opened) journal.close(); await rm(directory, { recursive: true, force: true }); });
  const metadata = admission.read(token).metadata;
  const registration = signRecord('run', { format: 'agent-mobility-run/v1', run_id: runId('issuer'), issuer_id: 'issuer', principal_ref: 'user', tenant_ref: 'tenant',
    image_digest: metadata.image_digest, program_id: metadata.program_id, trusted_runtime_profile: identity.kernelSha256, allowed_host_policy_ref: 'fixture-hosts', deployment_policy_revision: 'p1',
    initial_classification: ['shared'], initial_host_id: 'A', initial_epoch: '0', deployment_limits: limits, key_id: 'issuer' }, pairs.issuer.privateKey);
  const id = parse(registration).run_id;
  const a = open('A', true), b = open('B', true); a.register(registration, token);
  function offer(journal = a, overrides = {}) {
    const run = journal.run(id), req = admission.read(moving).relocation.requirements_digest;
    const observation = { host_id: 'B', requirements_digest: req, binding_digest: '1'.repeat(64), policy_revision: 'p1', runtime_profile: identity.kernelSha256 };
    const unsigned = { format: 'agent-mobility-offer/v1', run_id: id, transfer_id: opaqueId(), source_host_id: 'A', destination_host_id: 'B', source_epoch: run.custody_epoch, destination_epoch: (BigInt(run.custody_epoch) + 1n).toString(), execution_revision: run.execution_revision,
      run_registration_digest: hash(registration), predecessor_receipt_digest: run.predecessor_receipt_digest, image_digest: run.image_digest, program_id: run.program_id,
      outcome_digest: run.outcome_digest, state_digest: run.state_digest, request_digest: run.request_digest, relocation_occurrence_id: run.current_occurrence_id, placement_intent_id: 'inspect',
      requirements_digest: req, destination_observation_digest: hash(encodeValue(schemas.observation, observationValue(observation))), trusted_runtime_profile: identity.kernelSha256,
      classification: run.classification, export_policy_revision: 'fixture-shared', deployment_limits: limits, cleanup_requirements: [], resource_pin_summary: [],
      artifact_lengths: { image: image.length, outcome: moveBytes.length }, admission_deadline: null, key_id: 'A', ...overrides };
    return { bytes: signRecord('offer', unsigned, pairs.A.privateKey), observation };
  }
  const accept = (journal, proposal) => journal.accept(proposal.bytes, registration, moving, { policyRevision: 'p1', classification: ['shared'], deploymentLimits: limits, observation: proposal.observation });
  return { directory, pairs, keys, a, b, open, close, id, registration, offer, accept, fault: point => { failure = point; } };
}

for (const staged of [false, true]) for (const decision of ['refuse', 'accept'])
test(`${decision} uses the exact record quota with staged=${staged}`, async t => {
  const f = await fixture(t), proposal = f.offer(), transferId = parse(proposal.bytes).transfer_id;
  f.close(f.b);
  const b = f.open('B', false, 'generation-1', { maximumRecords: decision === 'refuse' ? 1 : 3 });
  if (staged) b.stage({ offer: proposal.bytes, registration: f.registration, predecessor: null, observation: proposal.observation,
    requirements: canonicalRequirements([]), constraints: encodeValue(schemas.constraints, [[], { tag: 1, value: 'B' }, { tag: 0, value: null }, 8388608n]) }, 'image', image);
  const receipt = decision === 'refuse' ? b.refuse(proposal.bytes, f.registration) : f.accept(b, proposal);
  assert.equal(parse(receipt).decision, decision === 'refuse' ? 'refused' : 'accepted');
  assert.equal(b.stagedOffer(transferId), null);
  f.close(b);
  const restarted = f.open('B', false, 'generation-1', { maximumRecords: decision === 'refuse' ? 1 : 3 });
  assert.deepEqual(restarted.savedDecision(proposal.bytes), receipt);
  assert.deepEqual(restarted.refuse(proposal.bytes, f.registration), receipt);
  assert.throws(() => restarted.refuse(f.offer().bytes, f.registration), { code: 'TenantRecordCapacity' });
});

test('record quota failure rolls back acceptance and retains staged withdrawal', async t => {
  const f = await fixture(t), proposal = f.offer(), transferId = parse(proposal.bytes).transfer_id;
  f.close(f.b); const b = f.open('B', false, 'generation-1', { maximumRecords: 2 });
  b.stage({ offer: proposal.bytes, registration: f.registration, predecessor: null, observation: proposal.observation,
    requirements: canonicalRequirements([]), constraints: encodeValue(schemas.constraints, [[], { tag: 1, value: 'B' }, { tag: 0, value: null }, 8388608n]) }, 'image', image);
  assert.throws(() => f.accept(b, proposal), { code: 'TenantRecordCapacity' });
  assert.equal(b.run(f.id), null); assert.equal(b.transfer(transferId), null);
  assert.equal(b.hasArtifact('tenant', hash(moveBytes)), false);
  assert.deepEqual(b.stagedOffer(transferId), proposal.bytes);
  f.close(b); const restarted = f.open('B', false, 'generation-1', { maximumRecords: 2 });
  assert.deepEqual(restarted.stagedOffer(transferId), proposal.bytes);
  assert.equal(parse(restarted.refuse(proposal.bytes, f.registration)).decision, 'refused');
});

for (const operation of ['register', 'freeze', 'stage', 'publish'])
test(`${operation} rolls back at the record limit and succeeds at its exact size`, async t => {
  const f = await fixture(t, operation === 'publish' || operation === 'register' ? initial : moving);
  const host = operation === 'stage' ? 'B' : 'A'; f.close(host === 'A' ? f.a : f.b);
  const maximumRecords = operation === 'stage' ? 0 : 2;
  let journal = f.open(host, false, 'generation-1', { maximumRecords });
  const before = journal.run(f.id), proposal = operation === 'stage' || operation === 'freeze' ? f.offer(operation === 'stage' ? f.a : journal) : null;
  let invoke, finalSize;
  if (operation === 'register') {
    const { signature: _, ...original } = parse(f.registration), id = runId('issuer');
    const registration = signRecord('run', { ...original, run_id: id }, f.pairs.issuer.privateKey);
    invoke = () => journal.register(registration, initial); finalSize = 4;
  } else if (operation === 'freeze') {
    invoke = () => journal.freeze(f.id, version(before), proposal.bytes, moving); finalSize = 3;
  } else if (operation === 'stage') {
    invoke = () => journal.stage({ offer: proposal.bytes, registration: f.registration, predecessor: null, observation: proposal.observation,
      requirements: canonicalRequirements([]), constraints: encodeValue(schemas.constraints, [[], { tag: 1, value: 'B' }, { tag: 0, value: null }, 8388608n]) }, 'image', image); finalSize = 1;
  } else {
    const attached = journal.attach(f.id), occurrence = journal.admitLeaf(f.id, version(attached), ['shared']);
    journal.recordReply(f.id, occurrence.attempt_id, taskReply, ['shared']);
    invoke = () => journal.publishOutcome(f.id, version(journal.run(f.id)), { kind: 'reply', reply_digest: hash(taskReply) }, nextResolve); finalSize = 3;
  }
  const runs = journal.recover(), outbox = journal.outbox();
  assert.throws(invoke, { code: 'TenantRecordCapacity' });
  assert.deepEqual(journal.recover(), runs); assert.deepEqual(journal.outbox(), outbox);
  if (proposal) { assert.equal(journal.transfer(parse(proposal.bytes).transfer_id), null); assert.equal(journal.stagedOffer(parse(proposal.bytes).transfer_id), null); }
  if (operation === 'publish') assert.equal(journal.hasArtifact('tenant', hash(resolveBytes)), false);
  f.close(journal); journal = f.open(host, false, 'generation-1', { maximumRecords: finalSize });
  assert.deepEqual(journal.recover(), runs); assert.doesNotThrow(invoke);
});

test('freeze precedes publication; lost acceptance reply and restarts never thaw source', async t => {
  const f = await fixture(t), offer = f.offer();
  const prior = f.a.attach(f.id);
  f.a.freeze(f.id, version(prior), offer.bytes, moving);
  assert.equal(f.a.run(f.id).status, 'OFFERED'); assert.deepEqual(f.a.outbox()[0].offer, offer.bytes);
  assert.throws(() => f.a.attach(f.id), { code: 'CustodyFrozen' });
  const receipt = f.accept(f.b, offer);
  assert.equal(f.b.run(f.id).custody_epoch, '1'); assert.equal(f.a.run(f.id).status, 'OFFERED');
  assert.deepEqual(f.accept(f.b, offer), receipt);
  const destination = f.b.attach(f.id);
  assert.equal(destination.executor_incarnation, '1');
  assert.equal(f.b.occurrence(destination.current_occurrence_id).status, 'SETTLED_REPLY');
  f.close(f.a); f.close(f.b);
  const a = f.open('A'), b = f.open('B');
  assert.equal(a.run(f.id).status, 'OFFERED'); assert.deepEqual(b.savedDecision(offer.bytes), receipt);
  assert.deepEqual(b.refuse(offer.bytes, f.registration), receipt, 'withdraw cannot reverse acceptance');
  a.receiveDecision(offer.bytes, receipt);
  assert.equal(a.run(f.id).status, 'DEPARTED'); assert.equal(a.outbox().length, 0);
  assert.throws(() => a.admitLeaf(f.id, version(prior), []), { code: 'CustodyFrozen' });
  assert.deepEqual(a.receiveDecision(offer.bytes, receipt), a.run(f.id));
});

test('withdrawal creates a restart-safe tombstone before delayed artifacts arrive', async t => {
  const f = await fixture(t), offer = f.offer(); f.a.freeze(f.id, version(f.a.run(f.id)), offer.bytes, moving);
  const refusal = f.b.refuse(offer.bytes, f.registration);
  assert.equal(parse(refusal).decision, 'refused'); assert.equal(f.b.run(f.id), null);
  f.close(f.b); const b = f.open('B');
  assert.deepEqual(f.accept(b, offer), refusal); assert.equal(b.run(f.id), null);
  const before = f.a.run(f.id); f.a.receiveDecision(offer.bytes, refusal);
  const after = f.a.run(f.id); assert.equal(after.status, 'ACTIVE');
  assert.equal(BigInt(after.executor_incarnation), BigInt(before.executor_incarnation) + 1n);
  assert.equal(f.a.occurrence(after.current_occurrence_id).status, 'SETTLED_REPLY');
  assert.throws(() => f.a.freeze(f.id, version(after), f.offer().bytes, moving), { code: 'UnsettledOccurrence' });
});

for (const point of ['freeze.before_commit', 'freeze.after_commit']) test(`source storage fault at ${point}`, async t => {
  const f = await fixture(t), offer = f.offer(); f.fault(point);
  assert.throws(() => f.a.freeze(f.id, version(f.a.run(f.id)), offer.bytes, moving), /injected/); f.fault(null);
  f.close(f.a); const recovered = f.open('A');
  const committed = point.endsWith('after_commit');
  assert.equal(recovered.run(f.id).status, committed ? 'OFFERED' : 'ACTIVE'); assert.equal(recovered.outbox().length, committed ? 1 : 0);
});
for (const point of ['artifact.before', 'artifact.after', 'accept.before_commit', 'accept.after_commit']) test(`target storage fault at ${point}`, async t => {
  const f = await fixture(t), offer = f.offer(); f.a.freeze(f.id, version(f.a.run(f.id)), offer.bytes, moving); f.fault(point);
  assert.throws(() => f.accept(f.b, offer), /injected/); f.fault(null); f.close(f.b);
  const recovered = f.open('B'), committed = point === 'accept.after_commit';
  assert.equal(recovered.run(f.id)?.status ?? null, committed ? 'ACTIVE' : null);
  assert.equal(recovered.savedDecision(offer.bytes) !== null, committed);
  assert.equal(f.a.run(f.id).status, 'OFFERED');
  assert.equal(parse(f.accept(recovered, offer)).decision, 'accepted');
});

test('concurrent handles serialize one source offer and refuse conflicting identities', async t => {
  const f = await fixture(t), other = f.open('A'), proposal = f.offer(), rival = f.offer();
  const before = version(f.a.run(f.id)); f.a.freeze(f.id, before, proposal.bytes, moving);
  assert.throws(() => other.freeze(f.id, before, rival.bytes, moving), { code: 'CustodyFrozen' });
  const modified = f.offer(f.a, { transfer_id: parse(proposal.bytes).transfer_id, placement_intent_id: 'other' });
  f.b.refuse(proposal.bytes, f.registration);
  assert.throws(() => f.b.refuse(modified.bytes, f.registration), { code: 'TransferConflict' });
});

test('transfer identity collisions cannot change source, destination, checkpoint or requirements', async t => {
  const f = await fixture(t), proposal = f.offer(), id = parse(proposal.bytes).transfer_id;
  f.a.freeze(f.id, version(f.a.run(f.id)), proposal.bytes, moving); const refusal = f.b.refuse(proposal.bytes, f.registration);
  for (const changes of [{ source_host_id: 'C' }, { destination_host_id: 'C' }, { outcome_digest: '2'.repeat(64) }, { state_digest: '2'.repeat(64) }, { requirements_digest: '2'.repeat(64) }]) {
    const changed = f.offer(f.a, { transfer_id: id, ...changes });
    assert.throws(() => f.b.refuse(changed.bytes, f.registration), { code: 'TransferConflict' });
    assert.deepEqual(f.b.savedDecision(proposal.bytes), refusal); assert.equal(f.b.run(f.id), null);
  }
  assert.equal(f.a.run(f.id).status, 'OFFERED');
});

test('rival target offers cannot both acquire the same local run', async t => {
  const f = await fixture(t), first = f.offer(), rival = f.offer();
  f.a.freeze(f.id, version(f.a.run(f.id)), first.bytes, moving);
  const accepted = f.accept(f.b, first), secondHandle = f.open('B');
  assert.throws(() => f.accept(secondHandle, rival), { code: 'LocalCustodyConflict' });
  assert.deepEqual(secondHandle.savedDecision(first.bytes), accepted); assert.equal(secondHandle.savedDecision(rival.bytes), null);
  assert.equal(secondHandle.run(f.id).custody_epoch, '1'); assert.equal(f.a.run(f.id).status, 'OFFERED');
});

test('expired admission never thaws a source and a saved acceptance outlives its deadline', async t => {
  const f = await fixture(t), expired = f.offer(f.a, { admission_deadline: '1' });
  f.a.freeze(f.id, version(f.a.run(f.id)), expired.bytes, moving);
  assert.throws(() => f.accept(f.b, expired), { code: 'AdmissionExpired' });
  assert.equal(f.a.run(f.id).status, 'OFFERED'); assert.equal(f.b.run(f.id), null); assert.equal(f.b.savedDecision(expired.bytes), null);
  const refusal = f.b.refuse(expired.bytes, f.registration, 'expired_offer');
  assert.equal(f.a.receiveDecision(expired.bytes, refusal).status, 'ACTIVE');
  const other = await fixture(t), pending = other.offer(other.a, { admission_deadline: '1000' });
  const realNow = Date.now;
  try {
    Date.now = () => 999; other.a.freeze(other.id, version(other.a.run(other.id)), pending.bytes, moving);
    const accepted = other.accept(other.b, pending); Date.now = () => 1001;
    assert.deepEqual(other.accept(other.b, pending), accepted);
    assert.deepEqual(other.b.refuse(pending.bytes, other.registration, 'expired_offer'), accepted);
    assert.equal(other.a.receiveDecision(pending.bytes, accepted).status, 'DEPARTED');
  } finally { Date.now = realNow; }
});

test('forged predecessor lineage cannot create a later epoch', async t => {
  const f = await fixture(t), forged = f.offer(f.a, { source_epoch: '1', destination_epoch: '2', predecessor_receipt_digest: '2'.repeat(64) });
  assert.throws(() => f.accept(f.b, forged), { code: 'InvalidLineage' });
  assert.equal(f.b.run(f.id), null); assert.equal(f.b.savedDecision(forged.bytes), null);
  const wrongInitial = f.offer(f.a, { predecessor_receipt_digest: '2'.repeat(64) });
  assert.throws(() => f.accept(f.b, wrongInitial), { code: 'InvalidLineage' }); assert.equal(f.b.run(f.id), null);
});

test('dispatch uncertainty and acquired replies persist; replaced executor cannot publish', async t => {
  const f = await fixture(t, initial), assigned = f.a.attach(f.id), oldVersion = version(assigned);
  const operation = f.a.admitLeaf(f.id, oldVersion, ['server-only']);
  assert.equal(operation.status, 'DISPATCHING'); f.a.markUnknown(f.id, operation.attempt_id);
  f.close(f.a); const recovered = f.open('A');
  assert.equal(recovered.occurrence(operation.id).status, 'UNKNOWN');
  assert.throws(() => recovered.admitLeaf(f.id, oldVersion, []), { code: 'UnsettledOccurrence' });
  assert.throws(() => recovered.publishOutcome(f.id, oldVersion, { kind: 'reply', reply_digest: hash(taskReply) }, nextResolve), { code: 'ReplyNotAcquired' });
  recovered.recordReply(f.id, operation.attempt_id, taskReply, ['shared']);
  const reply = recovered.artifact('tenant', recovered.run(f.id).reply_digest); assert.deepEqual(reply, taskReply);
  assert.deepEqual(recovered.run(f.id).classification, ['server-only', 'shared']);
  const current = recovered.attach(f.id);
  assert.throws(() => recovered.publishOutcome(f.id, oldVersion, { kind: 'reply', reply_digest: hash(taskReply) }, nextResolve), { code: 'StaleExecutor' });
  assert.throws(() => recovered.publishOutcome(f.id, version(current), { kind: 'reply', reply_digest: hash(taskReply) }, resolving), { code: 'UnboundSuccessor' });
  recovered.publishOutcome(f.id, version(current), { kind: 'reply', reply_digest: hash(taskReply) }, nextResolve);
  assert.equal(recovered.occurrence(operation.id).status, 'ADMITTED');
  assert.notEqual(recovered.run(f.id).current_occurrence_id, operation.id);
  assert.equal(recovered.run(f.id).execution_revision, '1');
});

test('retired decision key remains valid only for its exact outstanding transfer', async t => {
  const f = await fixture(t), proposal = f.offer(); f.a.freeze(f.id, version(f.a.run(f.id)), proposal.bytes, moving);
  const receipt = f.accept(f.b, proposal); f.keys.set('B', { ...f.keys.get('B'), status: 'retired' });
  assert.throws(() => verifyRecord('decision', receipt, f.keys), { code: 'RetiredKey' });
  assert.equal(f.a.receiveDecision(proposal.bytes, receipt).status, 'DEPARTED');
  f.keys.set('A', { ...f.keys.get('A'), status: 'retired' });
  assert.deepEqual(f.b.savedDecision(proposal.bytes), receipt);
});

test('a newly accepted cancellation fences an earlier executor publication', async t => {
  const f = await fixture(t, initial), assigned = f.a.attach(f.id), oldVersion = version(assigned);
  const operation = f.a.admitLeaf(f.id, oldVersion, ['shared']);
  f.a.recordReply(f.id, operation.attempt_id, taskReply, ['shared']);
  const cancelled = f.a.requestCancel(f.id, 'stop');
  assert.equal(cancelled.attached, false);
  assert.notEqual(cancelled.executor_incarnation, assigned.executor_incarnation);
  assert.throws(() => f.a.publishOutcome(f.id, oldVersion, { kind: 'reply', reply_digest: hash(taskReply) }, nextResolve), { code: 'StaleExecutor' });
  assert.deepEqual(canonical(f.a.requestCancel(f.id, 'stop again')), canonical(cancelled), 'duplicate cancellation preserves the complete authoritative record');
});

test('known stale deployment generation, duplicate run and origin pins fail closed', async t => {
  const f = await fixture(t);
  assert.throws(() => f.a.register(f.registration, moving), { code: 'RunAlreadyRegistered' });
  assert.throws(() => f.open('A', false, 'generation-2'), { code: 'QuarantinedStorageGeneration' });
  const run = f.a.run(f.id); f.a.resourcePin(f.id, version(run), 'origin-file-lock', true);
  assert.throws(() => f.a.freeze(f.id, version(run), f.offer().bytes, moving), { code: 'PinnedResource' });
  assert.throws(() => f.b.accept(f.offer().bytes, f.registration, {}, {}), { code: 'UnadmittedWorldState' });
});

test('portable mobility schemas independently match compiled Zig contracts', async () => {
  for (const [key, name] of Object.entries({ resolve: 'resolve', resolution: 'resolution', relocate: 'relocate', relocationReply: 'relocation-reply' }))
    assert.deepEqual(encodeSchema(schemas[key]), new Uint8Array(await readFile(`${artifactRoot}/agent4/mobility/${name}.schema`)));
  assert.equal(hash(canonicalRequirements([])), admission.read(moving).relocation.requirements_digest);
});

test('a real infinite loop with byte-identical ERQ content receives distinct durable occurrences', async t => {
  const loopImage = await readFile((artifactRoot + '/agent4/mobility/loop-image.bin')), loopId = (await readFile((artifactRoot + '/agent4/mobility/loop-identity.bin'))).toString('hex');
  const executor = await admission.start(loopImage, new Uint8Array(), loopId); t.after(() => executor.retire());
  const f = await fixture(t, executor.current()), requests = [], occurrences = [];
  let run = f.a.attach(f.id);
  for (let i = 0; i < 4; i++) {
    requests.push(world.decodeOutcome(admission.read(executor.current()).outcome).request);
    occurrences.push(run.current_occurrence_id);
    const attempt = f.a.admitLeaf(f.id, version(run), ['shared']);
    const acquired = f.a.recordReply(f.id, attempt.attempt_id, new Uint8Array(), ['shared']);
    f.a.recordReply(f.id, attempt.attempt_id, new Uint8Array(), ['shared']);
    const next = await executor.drive({ kind: 'reply', value: new Uint8Array() });
    const before = version(f.a.run(f.id));
    run = f.a.publishOutcome(f.id, before, { kind: 'reply', reply_digest: hash(new Uint8Array()) }, next);
    assert.equal(f.a.occurrence(attempt.id).status, 'ADMITTED');
    assert.throws(() => f.a.recordReply(f.id, attempt.attempt_id, new Uint8Array(), ['shared']), { code: 'AttemptMismatch' });
    assert.throws(() => f.a.publishOutcome(f.id, before, { kind: 'reply', reply_digest: hash(new Uint8Array()) }, next), { code: 'StaleExecutor' });
  }
  for (const request of requests.slice(1)) assert.deepEqual(request, requests[0]);
  assert.equal(new Set(occurrences).size, 4); assert.equal(run.execution_revision, '4');
});

test('pure custody bounds reject overflowing incarnations and stale or retired target epochs', async t => {
  const f = await fixture(t), run = f.a.run(f.id), proposal = f.offer(), offer = parse(proposal.bytes);
  assert.throws(() => coreAttach({ ...run, executor_incarnation: '18446744073709551615' }), { code: 'CounterOverflow' });
  const core = acceptedCore(offer, 'p1', ['shared'], limits);
  assert.throws(() => coreAccept({ ...run, host_id: 'B', status: 'DEPARTED', custody_epoch: '1' }, parse(f.registration), offer, core, '3'.repeat(64), '4'.repeat(64)), { code: 'StaleEpoch' });
  assert.throws(() => coreAccept({ ...run, host_id: 'B', status: 'TERMINAL' }, parse(f.registration), offer, core, '3'.repeat(64), '4'.repeat(64)), { code: 'RetiredRun' });
  assert.deepEqual(f.a.run(f.id), run); assert.equal(f.b.run(f.id), null);
});

test('scoped metrics retain ambiguity and refusal counts without changing execution authority', async t => {
  const f = await fixture(t), proposal = f.offer(), originalNow = Date.now;
  let a = f.a;
  try {
    Date.now = () => 1000;
    a.resourcePin(f.id, version(a.run(f.id)), 'origin-lock', true);
    assert.deepEqual(a.metrics(f.id).active_pins, ['origin-lock']);
    a.resourcePin(f.id, version(a.run(f.id)), 'origin-lock', false);
    a.freeze(f.id, version(a.run(f.id)), proposal.bytes, moving); Date.now = () => 1250;
    const frozen = a.run(f.id);
    assert.equal(a.metrics(f.id).known_custodian, null); assert.equal(a.metrics(f.id).transfer_decision, 'unknown');
    assert.equal(a.metrics(f.id).ambiguity_duration_ms, '250'); assert.equal(a.metrics(f.id).local_move_attempts, '1');
    assert.throws(() => a.admitLeaf(f.id, version(frozen), []), { code: 'CustodyFrozen' });
    assert.equal(a.metrics(f.id).stale_dispatch_rejections_since_open, 1); assert.deepEqual(a.run(f.id), frozen);
    f.close(a); a = f.open('A'); assert.equal(a.metrics(f.id).ambiguity_duration_ms, '250'); assert.equal(a.metrics(f.id).stale_dispatch_rejections_since_open, 0);
    const refusal = f.b.refuse(proposal.bytes, f.registration, 'withdrawn'); a.receiveDecision(proposal.bytes, refusal);
    assert.equal(a.metrics(f.id).known_custodian, 'A'); assert.equal(a.metrics(f.id).transfer_decision, 'refused');
    assert.equal(a.metrics(f.id).refusals_by_reason.withdrawn, 1); assert.equal(a.metrics(f.id).ambiguity_duration_ms, '0');
    const run = a.attach(f.id), reply = a.artifact('tenant', run.reply_digest);
    const next = await admission.successor(moving, { kind: 'reply', value: reply });
    a.publishOutcome(f.id, version(run), { kind: 'reply', reply_digest: hash(reply) }, next); a.collectArtifacts('tenant');
    assert.equal(a.hasArtifact('tenant', hash(reply)), false); assert.equal(a.metrics(f.id).refusals_by_reason.withdrawn, 1);
  } finally { Date.now = originalNow; }
});

for (const operation of ['register', 'attach', 'cleanup-policy', 'policy', 'stage', 'refuse', 'decision', 'dispatch', 'unknown', 'acquire', 'unsent-refusal', 'publish', 'cancel', 'cancel-forwarded', 'retirement-diagnostic', 'pin', 'collect']) {
  for (const when of ['before_commit', 'after_commit']) test(`transaction fault ${operation}.${when} recovers the exact committed boundary`, async t => {
    const ordinary = ['register', 'dispatch', 'unknown', 'acquire', 'publish', 'collect'].includes(operation);
    const f = await fixture(t, ordinary ? initial : moving); let journal = f.a, host = 'A', invoke, observe, expected;
    if (operation === 'register') {
      const { signature: _, ...original } = parse(f.registration), id = runId('issuer');
      const registration = signRecord('run', { ...original, run_id: id }, f.pairs.issuer.privateKey);
      invoke = () => journal.register(registration, initial); observe = db => db.run(id)?.status ?? null; expected = 'ACTIVE';
    } else if (operation === 'attach') {
      invoke = () => journal.attach(f.id); observe = db => db.run(f.id).executor_incarnation; expected = '1';
    } else if (operation === 'cleanup-policy') {
      invoke = () => journal.setCleanupRequirements(f.id, version(journal.run(f.id)), ['1'.repeat(64)]);
      observe = db => db.run(f.id).cleanup_requirements; expected = ['1'.repeat(64)];
    } else if (operation === 'policy') {
      invoke = () => journal.applyPolicy(f.id, version(journal.run(f.id)), { cleanupRequirements: [], classification: ['server-only', 'shared'], deploymentLimits: { ...limits, maximum_moves: 8 }, policyRevision: 'p2' });
      observe = db => { const run = db.run(f.id); return [run.classification, run.deployment_limits.maximum_moves, run.policy_revision]; }; expected = [['server-only', 'shared'], 8, 'p2'];
    } else if (['stage', 'refuse', 'decision', 'cancel-forwarded', 'retirement-diagnostic'].includes(operation)) {
      const proposal = f.offer(); f.a.freeze(f.id, version(f.a.run(f.id)), proposal.bytes, moving);
      if (operation === 'stage' || operation === 'refuse') { journal = f.b; host = 'B'; }
      if (operation === 'stage') {
        const envelope = { offer: proposal.bytes, registration: f.registration, predecessor: null, observation: proposal.observation,
          requirements: canonicalRequirements([]), constraints: encodeValue(schemas.constraints, [[], { tag: 1, value: 'B' }, { tag: 0, value: null }, 8388608n]) };
        invoke = () => journal.stage(envelope, 'image', image);
        observe = db => [db.stagedOffer(parse(proposal.bytes).transfer_id) !== null, db.hasArtifact('tenant', hash(image)), db.run(f.id)]; expected = [true, true, null];
      } else if (operation === 'refuse') {
        invoke = () => journal.refuse(proposal.bytes, f.registration);
        observe = db => { const saved = db.savedDecision(proposal.bytes); return [saved === null ? null : parse(saved).decision, db.run(f.id)]; }; expected = ['refused', null];
      } else if (operation === 'retirement-diagnostic') {
        invoke = () => journal.retirementIssue(f.id, version(journal.run(f.id)), 'FixtureRetirementFailure');
        observe = db => [db.run(f.id).status, db.run(f.id).retirement_issues?.length ?? 0]; expected = ['OFFERED', 1];
      } else {
        const accepted = f.accept(f.b, proposal);
        if (operation === 'cancel-forwarded') { journal.receiveDecision(proposal.bytes, accepted); journal.requestCancel(f.id, 'stop'); }
        invoke = () => operation === 'decision' ? journal.receiveDecision(proposal.bytes, accepted) : journal.cancellationForwarded(f.id, '0');
        observe = db => operation === 'decision' ? [db.run(f.id).status, db.outbox().length] : [db.run(f.id).status, db.run(f.id).cancel_forwarded];
        expected = operation === 'decision' ? ['DEPARTED', 0] : ['DEPARTED', true];
      }
    } else if (['dispatch', 'unknown', 'acquire', 'publish', 'collect'].includes(operation)) {
      journal.attach(f.id); let attempt;
      if (operation !== 'dispatch') attempt = journal.admitLeaf(f.id, version(journal.run(f.id)), ['shared']).attempt_id;
      if (operation === 'publish' || operation === 'collect') journal.recordReply(f.id, attempt, taskReply, ['shared']);
      if (operation === 'collect') journal.publishOutcome(f.id, version(journal.run(f.id)), { kind: 'reply', reply_digest: hash(taskReply) }, nextResolve);
      if (operation === 'dispatch') { invoke = () => journal.admitLeaf(f.id, version(journal.run(f.id)), ['shared']); expected = 'DISPATCHING'; }
      if (operation === 'unknown') { invoke = () => journal.markUnknown(f.id, attempt); expected = 'UNKNOWN'; }
      if (operation === 'acquire') { invoke = () => journal.recordReply(f.id, attempt, taskReply, ['shared']); expected = 'SETTLED_REPLY'; }
      observe = db => db.occurrence(db.run(f.id).current_occurrence_id).status;
      if (operation === 'publish') {
        invoke = () => journal.publishOutcome(f.id, version(journal.run(f.id)), { kind: 'reply', reply_digest: hash(taskReply) }, nextResolve);
        observe = db => [db.run(f.id).execution_revision, db.run(f.id).outcome_digest, db.hasArtifact('tenant', hash(resolveBytes))]; expected = ['1', hash(resolveBytes), true];
      }
      if (operation === 'collect') {
        invoke = () => journal.collectArtifacts('tenant');
        observe = db => [db.hasArtifact('tenant', hash(initialBytes)), db.hasArtifact('tenant', hash(resolveBytes)), db.run(f.id).status]; expected = [false, true, 'ACTIVE'];
      }
    } else if (operation === 'unsent-refusal') {
      invoke = () => journal.settleUnsentRelocation(f.id, version(journal.run(f.id)), moving, 'unavailable');
      observe = db => [db.run(f.id).status, db.occurrence(db.run(f.id).current_occurrence_id).status, db.outbox().length]; expected = ['ACTIVE', 'SETTLED_REPLY', 0];
    } else if (operation === 'cancel') {
      invoke = () => journal.requestCancel(f.id, 'stop'); observe = db => [db.run(f.id).cancel_requested, db.run(f.id).attached]; expected = ['stop', false];
    } else if (operation === 'pin') {
      invoke = () => journal.resourcePin(f.id, version(journal.run(f.id)), 'origin-lock', true); observe = db => db.run(f.id).resource_pins; expected = ['origin-lock'];
    }
    const before = observe(journal), record = journal.run(f.id);
    f.fault(`${operation}.${when}`); assert.throws(invoke, /injected/); f.fault(null); f.close(journal);
    const recovered = f.open(host); assert.deepEqual(observe(recovered), when === 'after_commit' ? expected : before);
    if (when === 'before_commit') assert.deepEqual(recovered.run(f.id), record);
    if (recovered.run(f.id)) {
      const run = recovered.run(f.id); assert.ok(recovered.hasArtifact('tenant', run.image_digest)); assert.ok(recovered.hasArtifact('tenant', run.outcome_digest));
      if (run.reply_digest) assert.ok(recovered.hasArtifact('tenant', run.reply_digest));
    }
  });
}

for (const when of ['before_commit', 'after_commit']) test(`initialization fault ${when} is empty durable custody or fail-closed storage`, async t => {
  const f = await fixture(t), directory = join(f.directory, 'initialization');
  const configuration = { directory, hostId: 'A', deploymentGeneration: 'generation-1', keys: f.keys, signer: { keyId: 'A', privateKey: f.pairs.A.privateKey, policyRevision: 'p1' }, admission };
  assert.throws(() => new CustodyJournal({ ...configuration, create: true, fault(point) { if (point === `initialize.${when}`) throw new Error('injected initialization'); } }), /injected initialization/);
  if (when === 'before_commit') assert.throws(() => new CustodyJournal(configuration));
  else { const reopened = new CustodyJournal(configuration); try { assert.deepEqual(reopened.recover(), []); assert.deepEqual(reopened.outbox(), []); } finally { reopened.close(); } }
});

for (const operation of ['freeze', 'accept', 'acquire']) for (const when of ['before_commit', 'after_commit']) test(`SIGKILL during ${operation}.${when} recovers the committed ownership state`, async t => {
  const f = await fixture(t, operation === 'acquire' ? initial : moving), proposal = f.offer();
  const host = operation === 'accept' ? 'B' : 'A';
  let attempt = null;
  if (operation === 'accept') f.a.freeze(f.id, version(f.a.run(f.id)), proposal.bytes, moving);
  if (operation === 'acquire') {
    const attached = f.a.attach(f.id);
    attempt = f.a.admitLeaf(f.id, version(attached), ['shared']).attempt_id;
  }
  f.close(host === 'A' ? f.a : f.b);
  const inputPath = join(f.directory, 'crash-input.json');
  await writeFile(inputPath, JSON.stringify({ directory: join(f.directory, host), host, runId: f.id,
    image: Array.from(image), outcome: Array.from(operation === 'acquire' ? initialBytes : moveBytes),
    offer: Array.from(proposal.bytes), registration: Array.from(f.registration),
    keys: Object.fromEntries(Object.entries(f.pairs).map(([name, pair]) => [name, pair.publicKey.export({ type: 'spki', format: 'pem' })])),
    privateKey: f.pairs[host].privateKey.export({ type: 'pkcs8', format: 'pem' }),
    policy: { policyRevision: 'p1', classification: ['shared'], deploymentLimits: limits, observation: proposal.observation },
    attempt, reply: Array.from(taskReply),
  }), { mode: 0o600 });
  const killed = spawnSync(process.execPath, [join(import.meta.dirname, 'mobility_crash_peer.mjs'), runtime, inputPath, operation, `${operation}.${when}`], { timeout: 10000, encoding: 'utf8' });
  assert.equal(killed.signal, 'SIGKILL', killed.stderr);
  const recovered = f.open(host), committed = when === 'after_commit';
  if (operation === 'freeze') {
    assert.equal(recovered.run(f.id).status, committed ? 'OFFERED' : 'ACTIVE'); assert.equal(recovered.outbox().length, committed ? 1 : 0);
  } else if (operation === 'accept') {
    assert.equal(recovered.run(f.id)?.status ?? null, committed ? 'ACTIVE' : null);
    assert.equal(recovered.savedDecision(proposal.bytes) !== null, committed); assert.equal(f.a.run(f.id).status, 'OFFERED');
  } else {
    const run = recovered.run(f.id), occurrence = recovered.occurrence(run.current_occurrence_id);
    assert.equal(occurrence.status, committed ? 'SETTLED_REPLY' : 'DISPATCHING');
    if (committed) assert.deepEqual(recovered.artifact('tenant', occurrence.reply_digest), taskReply);
    assert.throws(() => recovered.admitLeaf(f.id, version(run), []), { code: 'UnsettledOccurrence' });
  }
});

for (const first of ['answer', 'cancel']) test(`durable deferred reply: restart, authentication, duplicates and ${first}-first race`, async t => {
  const f = await fixture(t, initial), id = f.id;
  const run = f.a.attach(id), pending = { format: 'agent-deferred-leaf/v1', audience: 'review', principal: 'user', tenant: 'tenant',
    request_digest: run.request_digest, alternatives: ['accept', 'decline'], maximum_text_bytes: 20,
    question: { text: 'Inspect this exact proposal?', generation: '1' }, result_schema: Buffer.from(initialRequest.resumeSchema).toString('base64url'), binding_revision: 'v1' };
  const occurrence = f.a.deferLeaf(id, version(run), pending, ['shared']);
  assert.equal(occurrence.status, 'AWAITING');
  assert.throws(() => f.a.admitLeaf(id, version(run), []), { code: 'UnsettledOccurrence' });
  assert.throws(() => f.a.recordReply(id, occurrence.attempt_id, taskReply, []), { code: 'DeferredReplyRequired' });
  f.close(f.a); const restored = f.open('A');
  assert.deepEqual(canonical(restored.occurrence(occurrence.id)), canonical(occurrence));
  restored.collectArtifacts('tenant');
  assert.deepEqual(canonical(parse(restored.artifact('tenant', occurrence.pending_digest))), canonical(pending));
  const identity = { principal: 'user', tenant: 'tenant', audiences: ['review'] };
  const binding = { occurrence_id: occurrence.id, request_digest: occurrence.request_digest, pending_digest: occurrence.pending_digest };
  const answer = { choice: 'accept', text: '' }, wanted = version(restored.run(id));
  const acquire = (overrides = {}) => restored.answerDeferred(id, overrides.wanted ?? wanted, overrides.binding ?? binding, overrides.identity ?? identity, overrides.answer ?? answer, overrides.reply ?? taskReply, ['shared']);
  for (const changed of [{ principal: 'other' }, { tenant: 'other' }, { audiences: ['other'] }])
    assert.throws(() => acquire({ identity: { ...identity, ...changed } }), { code: 'UserDenied' });
  for (const key of Object.keys(binding)) assert.throws(() => acquire({ binding: { ...binding, [key]: 'f'.repeat(64) } }), { code: 'QuestionMismatch' });
  for (const invalid of [{ choice: 'invent', text: '' }, { choice: 'accept', text: 'x'.repeat(21) }, { choice: 'accept', text: '', approved: true }])
    assert.throws(() => acquire({ answer: invalid }), { code: 'InvalidAnswer' });
  if (first === 'cancel') {
    const cancelled = restored.requestCancel(id, 'stop');
    assert.throws(() => acquire(), { code: 'StaleExecutor' });
    assert.throws(() => acquire({ wanted: version(cancelled) }), { code: 'CancellationPending' });
    assert.equal(restored.occurrence(occurrence.id).status, 'AWAITING');
  } else {
    const saved = acquire(); assert.equal(saved.status, 'SETTLED_REPLY');
    assert.deepEqual(canonical(acquire()), canonical(saved));
    assert.throws(() => acquire({ answer: { choice: 'decline', text: '' } }), { code: 'ReplyConflict' });
    f.close(restored); const afterAnswer = f.open('A');
    assert.deepEqual(afterAnswer.artifact('tenant', afterAnswer.run(id).reply_digest), taskReply);
    const current = afterAnswer.attach(id);
    assert.throws(() => afterAnswer.answerDeferred(id, wanted, binding, identity, answer, taskReply, []), { code: 'StaleExecutor' });
    afterAnswer.publishOutcome(id, version(current), { kind: 'reply', reply_digest: hash(taskReply) }, nextResolve);
    assert.throws(() => afterAnswer.answerDeferred(id, version(afterAnswer.run(id)), binding, identity, answer, taskReply, []), { code: 'QuestionNotPending' });
  }
});

for (const point of ['defer.before_commit', 'defer.after_commit', 'answer.before_commit', 'answer.after_commit'])
test(`deferred transaction crash at ${point}`, async t => {
  const f = await fixture(t, initial), run = f.a.attach(f.id);
  const pending = { format: 'agent-deferred-leaf/v1', audience: 'review', principal: 'user', tenant: 'tenant', request_digest: run.request_digest,
    alternatives: ['accept'], maximum_text_bytes: 0, question: 'Exact question', binding_revision: 'v1', result_schema: Buffer.from(initialRequest.resumeSchema).toString('base64url') };
  const defer = () => f.a.deferLeaf(f.id, version(run), pending, ['shared']);
  if (point.startsWith('answer')) defer();
  const occurrence = f.a.occurrence(run.current_occurrence_id);
  f.fault(point);
  assert.throws(() => point.startsWith('defer') ? defer() : f.a.answerDeferred(f.id, version(f.a.run(f.id)), {
    occurrence_id: occurrence.id, request_digest: occurrence.request_digest, pending_digest: occurrence.pending_digest,
  }, { principal: 'user', tenant: 'tenant', audiences: ['review'] }, { choice: 'accept', text: '' }, taskReply, ['shared']), /injected/);
  f.fault(null); f.close(f.a); const reopened = f.open('A'), saved = reopened.occurrence(run.current_occurrence_id);
  assert.equal(saved.status, point.startsWith('defer') ? (point.endsWith('before_commit') ? 'READY' : 'AWAITING') : (point.endsWith('before_commit') ? 'AWAITING' : 'SETTLED_REPLY'));
});

for (const crash of ['dispatch.before_commit', 'dispatch.after_commit']) test(`work allowance and dispatch are atomic across ${crash}`, async t => {
  const f = await fixture(t, initial), run = f.a.attach(f.id);
  const charge = { owner: 'A', kind: 'model', grant: 'a'.repeat(64), limit: { attempts: 2, request_bytes: 100, output_tokens: 20, concurrent: 2 }, amount: { request_bytes: 40, output_tokens: 8 } };
  f.fault(crash); assert.throws(() => f.a.admitLeaf(f.id, version(run), [], { charge }), /injected/);
  f.fault(null); f.close(f.a); const restored = f.open('A');
  const allowance = restored.allowance(f.id, 'model');
  if (crash.endsWith('before_commit')) {
    assert.equal(allowance, null); assert.equal(restored.occurrence(run.current_occurrence_id).status, 'READY');
  } else {
    assert.deepEqual({ ...allowance.used }, { attempts: 1, request_bytes: 40, output_tokens: 8 });
    const pending = restored.occurrence(run.current_occurrence_id);
    assert.throws(() => restored.admitLeaf(f.id, version(restored.run(f.id)), [], { charge }), { code: 'UnsettledOccurrence' });
    restored.markUnknown(f.id, pending.attempt_id);
    assert.equal(restored.allowance(f.id, 'model').used.attempts, 1);
  }
});

test('durable allowance cannot reset, switch owner, widen grant or overspend on a successor occurrence', async t => {
  const f = await fixture(t, initial), run = f.a.attach(f.id);
  const charge = { owner: 'A', kind: 'model', grant: 'b'.repeat(64), limit: { attempts: 1, request_bytes: 100, output_tokens: 20, concurrent: 2 }, amount: { request_bytes: 40, output_tokens: 8 } };
  assert.throws(() => f.a.admitLeaf(f.id, version(run), [], { charge: { ...charge, owner: 'B' } }), { code: 'SpendOwnerMismatch' });
  assert.equal(f.a.allowance(f.id, 'model'), null);
  const pending = f.a.admitLeaf(f.id, version(run), [], { charge });
  f.a.recordReply(f.id, pending.attempt_id, taskReply, []);
  f.a.publishOutcome(f.id, version(run), { kind: 'reply', reply_digest: hash(taskReply) }, nextResolve);
  f.close(f.a); const restored = f.open('A'), current = restored.attach(f.id);
  assert.throws(() => restored.admitLeaf(f.id, version(current), [], { charge: { ...charge, limit: { ...charge.limit, attempts: 2 } } }), { code: 'WorkAllowanceChanged' });
  assert.throws(() => restored.admitLeaf(f.id, version(current), [], { charge }), { code: 'WorkAllowanceExhausted' });
  assert.equal(restored.occurrence(current.current_occurrence_id).status, 'READY');
  assert.equal(restored.allowance(f.id, 'model').used.attempts, 1);
});

test('unknown work retains its concurrency slot until an explicitly cancellable occurrence is abandoned', async t => {
  const f = await fixture(t, initial), first = f.a.attach(f.id);
  const charge = { owner: 'A', kind: 'model', grant: 'd'.repeat(64), limit: { attempts: 2, request_bytes: 100, output_tokens: 20, concurrent: 1 }, amount: { request_bytes: 40, output_tokens: 8 } };
  const pending = f.a.admitLeaf(f.id, version(first), [], { charge, cancelSafe: true });
  f.a.markUnknown(f.id, pending.attempt_id);
  const { signature: _, ...base } = parse(f.registration), secondId = runId('issuer');
  f.a.register(signRecord('run', { ...base, run_id: secondId }, f.pairs.issuer.privateKey), initial);
  const second = f.a.attach(secondId);
  assert.throws(() => f.a.admitLeaf(secondId, version(second), [], { charge }), { code: 'WorkConcurrency' });
  assert.equal(f.a.allowance(secondId, 'model'), null);
  assert.throws(() => f.a.abandonLeaf(f.id, pending.attempt_id), { code: 'CannotAbandonOccurrence' });
  f.a.requestCancel(f.id, 'abandon remote answer'); f.a.abandonLeaf(f.id, pending.attempt_id);
  assert.equal(f.a.allowance(f.id, 'model').used.attempts, 1);
  assert.equal(f.a.admitLeaf(secondId, version(second), [], { charge }).status, 'DISPATCHING');
});
