// SQLite ordering tests use a trusted admission double. Full image/private-grant
// admission is covered by the regularly run native and custody contracts.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateKeyPairSync } from 'node:crypto';
import { CustodyJournal } from '../../runtime/mobility/journal.mjs';
import { hash, runId, signRecord, canonical } from '../../runtime/mobility/protocol.mjs';
import { version, RELOCATE } from '../../runtime/mobility/custody.mjs';
import { encodeValue } from '../../runtime/values.mjs';
import { schemas, observationValue } from '../../runtime/mobility/values.mjs';
async function fixture(t, operation = 'agent.repository.publish.v1') {
  const directory = await mkdtemp(join(tmpdir(), 'publication-journal-')), pair = generateKeyPairSync('ed25519');
  const image = Buffer.from('trusted admission fixture image'), outcome = Buffer.from('trusted admission fixture outcome');
  const metadata = { kind: 'requested', image_digest: hash(image), outcome_digest: hash(outcome), program_id: '1'.repeat(64),
    trusted_runtime_profile: '2'.repeat(64), request_digest: '3'.repeat(64), state_digest: '4'.repeat(64), operation };
  const id = runId('issuer'); let failure = null;
  const hosts = { W: generateKeyPairSync('ed25519'), U: generateKeyPairSync('ed25519') };
  const keys = new Map([['issuer', { owner: 'issuer', status: 'active', publicKey: pair.publicKey }], ...Object.entries(hosts).map(([owner, key]) => [owner, { owner, status: 'active', publicKey: key.publicKey }])]);
  const options = { directory, hostId: 'W', deploymentGeneration: 'generation-1', keys,
    signer: { keyId: 'W', privateKey: hosts.W.privateKey, policyRevision: 'p1' }, admission: { read: token => token.metadata ? token : ({ metadata, image, outcome }) },
    fault: point => { if (point === failure) throw Error(point); } };
  let journal = new CustodyJournal({ ...options, create: true });
  t.after(async () => { journal.close(); await rm(directory, { recursive: true, force: true }); });
  const registration = signRecord('run', { format: 'agent-mobility-run/v1', run_id: id, issuer_id: 'issuer', principal_ref: 'user', tenant_ref: 'tenant',
    image_digest: metadata.image_digest, program_id: metadata.program_id, trusted_runtime_profile: metadata.trusted_runtime_profile,
    allowed_host_policy_ref: 'fixture', deployment_policy_revision: 'p1', initial_classification: [], initial_host_id: 'W', initial_epoch: '0',
    deployment_limits: { maximum_moves: 2, maximum_image_bytes: 4096, maximum_outcome_bytes: 4096 }, key_id: 'issuer' }, pair.privateKey);
  journal.register(registration, {}); const run = journal.attach(id), occurrence = journal.admitLeaf(id, version(run), []);
  const body = { core: { binding: { run: id, principal: 'user', tenant: 'tenant', policyRevision: 'p1', intent: '6'.repeat(64) },
    destination: { repository: 'repo', generation: 'generation-1', managedRef: 'refs/heads/agent/main' } }, commitOid: '5'.repeat(40) };
  const proposal = { ...body, digest: hash(canonical(body, 2 << 20)) };
  return { get journal() { return journal; }, id, run, occurrence, proposal, options, registration, image, metadata, hosts,
    second({ intent, commitOid }) {
      const { signature: _, ...unsigned } = journal.registration(registration), otherId = runId('issuer');
      journal.register(signRecord('run', { ...unsigned, run_id: otherId }, pair.privateKey), {});
      const otherRun = journal.attach(otherId), otherOccurrence = journal.admitLeaf(otherId, version(otherRun), []);
      const other = structuredClone(proposal); other.core.binding.run = otherId; other.core.binding.intent = intent; other.commitOid = commitOid;
      const { digest: _digest, ...body } = other; other.digest = hash(canonical(body, 2 << 20));
      return journal.admitPublication(otherId, version(otherRun), otherOccurrence.attempt_id, other, 'p1');
    },
    restart() { journal.close(); journal = new CustodyJournal(options); }, failAt(point) { failure = point; },
    admit() { return journal.admitPublication(id, version(run), occurrence.attempt_id, proposal, 'p1'); },
    records() { return journal.publicationRecords('tenant', 'repo', 'generation-1', 'refs/heads/agent/main'); } };
}
test('winning cancellation prevents durable publication admission', async t => {
  const f = await fixture(t); f.journal.requestCancel(f.id, 'stop');
  assert.throws(() => f.admit(), { code: 'StaleExecutor' });
  const current = f.journal.attach(f.id);
  assert.throws(() => f.journal.admitPublication(f.id, version(current), f.occurrence.attempt_id, f.proposal, 'p1'), { code: 'CancellationPending' });
  assert.deepEqual(f.records(), []);
});
test('exact intent survives restart; later cancellation preserves and acquires publication receipt', async t => {
  const f = await fixture(t), admission = f.admit(); f.restart();
  f.journal.collectArtifacts('tenant');
  assert.equal(f.records()[0].intent.proposal.digest, f.proposal.digest);
  f.journal.requestCancel(f.id, 'late cancellation');
  assert.throws(() => f.journal.abandonLeaf(f.id, f.occurrence.attempt_id), { code: 'CannotAbandonOccurrence' });
  const receipt = { status: 'Published', proposal: f.proposal.digest, commit: f.proposal.commitOid, current: f.proposal.commitOid, admission };
  assert.throws(() => f.journal.recordReply(f.id, f.occurrence.attempt_id, Buffer.from('reply'), []), { code: 'PublicationReceiptMismatch' });
  f.journal.recordReply(f.id, f.occurrence.attempt_id, Buffer.from('reply'), [], null, { publicationReceipt: receipt });
  assert.equal(f.records()[0].receipt.status, 'Published');
  assert.throws(() => f.journal.recordReply(f.id, f.occurrence.attempt_id, Buffer.from('reply'), [], null,
    { publicationReceipt: { ...receipt, status: 'NotApplied', commit: null } }), { code: 'PublicationReceiptConflict' });
  f.journal.collectArtifacts('tenant'); f.restart(); assert.equal(f.records()[0].receipt.commit, f.proposal.commitOid);
});
for (const point of ['publication-intent.begin', 'artifact.after', 'publication-intent.before_commit']) test(`intent fault ${point} cannot leave an admitted write`, async t => {
  const f = await fixture(t); f.failAt(point); assert.throws(() => f.admit()); f.failAt(null); f.restart();
  assert.deepEqual(f.records(), []); assert.equal(f.journal.occurrence(f.run.current_occurrence_id).publication_intent_digest, undefined);
  f.admit(); assert.equal(f.records().length, 1);
});
test('stale executor, other operation and altered principal cannot acquire publication authority', async t => {
  const f = await fixture(t); f.journal.attach(f.id); assert.throws(() => f.admit(), { code: 'StaleExecutor' });
  const other = await fixture(t, 'fixture.read'); assert.throws(() => other.admit(), { code: 'PublicationOccurrenceMismatch' });
  const principal = await fixture(t); principal.proposal.core.binding.principal = 'someone';
  assert.throws(() => principal.admit(), { code: 'PublicationAuthorityMismatch' });
});
test('a fresh occurrence cannot reuse another intent or exact commit after admission', async t => {
  const f = await fixture(t); f.admit();
  assert.throws(() => f.second({ intent: f.proposal.core.binding.intent, commitOid: '7'.repeat(40) }), { code: 'PublicationIntentReused' });
  assert.throws(() => f.second({ intent: '8'.repeat(64), commitOid: f.proposal.commitOid }), { code: 'PublicationIntentReused' });
  assert.equal(f.records().length, 1);
});

for (const status of ['PublishedVerified', 'PublishedVerificationFailed', 'PublishedVerificationUnavailable'])
  test(`${status} evidence survives reply acquisition and journal restart`, async t => {
    const f = await fixture(t), admission = f.admit();
    const receipt = { status: 'Published', proposal: f.proposal.digest, commit: f.proposal.commitOid,
      current: status === 'PublishedVerificationUnavailable' ? null : f.proposal.commitOid,
      verification: { status }, admission };
    f.journal.recordReply(f.id, f.occurrence.attempt_id, Buffer.from('reply'), [], null, { publicationReceipt: receipt });
    f.journal.collectArtifacts('tenant'); f.restart();
    assert.deepEqual(canonical(f.records()[0].receipt), canonical(receipt));
  });

test('publication evidence crosses custody and survives cancellation, collection and restart', async t => {
  const f = await fixture(t), admission = f.admit(), reply = Buffer.from('published');
  const publication = { format: 'agent.repository.publication-receipt/v1', status: 'Published',
    proposal: f.proposal.digest, commit: f.proposal.commitOid, tree: '7'.repeat(40), admission };
  f.journal.recordReply(f.id, f.occurrence.attempt_id, reply, [], null, { publicationReceipt: publication });
  const requirements = hash(encodeValue(schemas.requirements, []));
  const observation = { host_id: 'U', requirements_digest: requirements, binding_digest: '8'.repeat(64),
    policy_revision: 'p1', runtime_profile: f.metadata.trusted_runtime_profile };
  const current = f.journal.run(f.id), control = { kind: 'reply', reply_digest: hash(reply) }, outcome = Buffer.from('move to origin');
  const moving = { image: f.image, outcome, metadata: { ...f.metadata, outcome_digest: hash(outcome),
    request_digest: '9'.repeat(64), operation: RELOCATE }, predecessor: { outcome_digest: current.outcome_digest, control },
    relocation: { destination_host_id: 'U', placement_intent_id: 'return', requirements_digest: requirements, remaining_move_budget: 1 } };
  f.journal.publishOutcome(f.id, version(current), control, moving);
  const offered = f.journal.beginTransfer(f.id, version(f.journal.run(f.id)), moving,
    { observationDigest: hash(encodeValue(schemas.observation, observationValue(observation))), exportPolicyRevision: 'p1' });
  const targetOptions = { ...f.options, directory: join(f.options.directory, 'origin'), hostId: 'U',
    signer: { keyId: 'U', privateKey: f.hosts.U.privateKey, policyRevision: 'p1' } };
  let target = new CustodyJournal({ ...targetOptions, create: true }); t.after(() => target.close());
  const decision = target.accept(offered.offer, f.registration, moving, { policyRevision: 'p1', classification: [],
    deploymentLimits: current.deployment_limits, observation });
  f.journal.receiveDecision(offered.offer, decision);
  target.collectArtifacts('tenant'); target.close(); target = new CustodyJournal(targetOptions);
  target.requestCancel(f.id, 'stop presentation'); const attached = target.attach(f.id);
  const cancel = { kind: 'cancel', reason: 'stop presentation' }, cancelled = Buffer.from('cancelled');
  target.publishOutcome(f.id, version(attached), cancel, { image: f.image, outcome: cancelled,
    predecessor: { outcome_digest: attached.outcome_digest, control: cancel },
    metadata: { ...f.metadata, kind: 'cancelled', outcome_digest: hash(cancelled), state_digest: null, request_digest: null, operation: null } });
  target.collectArtifacts('tenant'); target.close(); target = new CustodyJournal(targetOptions);
  assert.equal(target.run(f.id).status, 'TERMINAL'); assert.equal(target.run(f.id).outcome_kind, 'cancelled');
  assert.equal(target.latestPublication(f.id).commit, f.proposal.commitOid);
});
