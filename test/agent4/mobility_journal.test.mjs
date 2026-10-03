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
import { version } from '../../runtime/mobility/custody.mjs';
import { subject } from '../../runtime/text_inspection.mjs';
import { placement, resolution } from './mobility_fixture.mjs';

assert.ok(process.env.AGENT_MOBILITY_RUNTIME, 'Set AGENT_MOBILITY_RUNTIME to the independently authenticated runtime');
const runtime = resolve(process.env.AGENT_MOBILITY_RUNTIME);
const identity = verifyRuntime(runtime), world = await import(pathToFileURL(identity.entrypoint));
const kernelBytes = await readFile(identity.kernelPath), image = await readFile('zig-out/agent4/mobility/program.bpi3');
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

async function fixture(t, token = moving) {
  const directory = await mkdtemp(join(tmpdir(), 'mobility-journal-'));
  const pairs = Object.fromEntries(['issuer', 'A', 'B'].map(name => [name, generateKeyPairSync('ed25519')]));
  const keys = new Map(Object.entries(pairs).map(([owner, pair]) => [owner, { owner, status: 'active', publicKey: pair.publicKey }]));
  const opened = new Set(); let failure = null;
  const open = (host, create = false, generation = 'generation-1') => {
    const journal = new CustodyJournal({ directory: join(directory, host), hostId: host, deploymentGeneration: generation, keys,
      signer: { keyId: host, privateKey: pairs[host].privateKey, policyRevision: 'p1' }, admission, create,
      fault(point) { if (point === failure) throw new Error(`injected ${point}`); } });
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

test('dispatch uncertainty and acquired replies persist; replaced executor cannot publish', async t => {
  const f = await fixture(t, initial), assigned = f.a.attach(f.id), oldVersion = version(assigned);
  const operation = f.a.admitLeaf(f.id, oldVersion, ['server-only']);
  assert.equal(operation.status, 'DISPATCHING'); f.a.markUnknown(f.id, operation.attempt_id);
  f.close(f.a); const recovered = f.open('A');
  assert.equal(recovered.occurrence(operation.id).status, 'UNKNOWN');
  assert.throws(() => recovered.admitLeaf(f.id, oldVersion, []), { code: 'UnsettledOccurrence' });
  assert.throws(() => recovered.publishParked(f.id, oldVersion, { kind: 'reply', reply_digest: hash(taskReply) }, resolving), { code: 'ReplyNotAcquired' });
  recovered.recordReply(f.id, operation.attempt_id, taskReply, ['shared']);
  const reply = recovered.artifact('tenant', recovered.run(f.id).reply_digest); assert.deepEqual(reply, taskReply);
  assert.deepEqual(recovered.run(f.id).classification, ['server-only', 'shared']);
  const current = recovered.attach(f.id);
  assert.throws(() => recovered.publishParked(f.id, oldVersion, { kind: 'reply', reply_digest: hash(taskReply) }, resolving), { code: 'StaleExecutor' });
  recovered.publishParked(f.id, version(current), { kind: 'reply', reply_digest: hash(taskReply) }, resolving);
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
    assert.deepEqual(encodeSchema(schemas[key]), new Uint8Array(await readFile(`zig-out/agent4/mobility/${name}.schema`)));
  assert.equal(hash(canonicalRequirements([])), admission.read(moving).relocation.requirements_digest);
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
