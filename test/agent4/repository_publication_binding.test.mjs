// Adapter contract tests. Trusted service doubles deliberately do not claim
// image/private-grant or Git qualification; those have separate witnesses.
import test from 'node:test';
import assert from 'node:assert/strict';
import { encodeSchema, encodeValue, decodeValue } from '../../runtime/values.mjs';
import { canonical } from '../../runtime/mobility/canonical.mjs';
import { repositoryPublicationBinding, PUBLICATION } from '../../runtime/mobility/repository_publication.mjs';

const schema = { root: 0, types: [{ bounded_text: 2 << 20 }] }, schemaBytes = encodeSchema(schema);
const checkSchema = { root: 0, types: [{ product: [1, 2] }, { enumeration: [0, 1, 2, 3, 4, 5, 6] }, { bounded_text: 2 << 20 }] };
const deliverySchema = { root: 0, types: [{ sum: [1, 1, 1, 2] }, { bounded_text: 16384 }, { bounded_text: 128 }] };
const text = value => Buffer.from(canonical(value, 2 << 20)).toString('utf8');
function fixture() {
  const run = { run_id: 'run', image_digest: 'a'.repeat(64), program_id: 'b'.repeat(64), principal_ref: 'user', tenant_ref: 'tenant',
    request_digest: 'c'.repeat(64), custody_epoch: '1', execution_revision: '2', executor_incarnation: '3', outcome_digest: 'd'.repeat(64) };
  const validation = { profile: 'zig-check', profileDigest: '3'.repeat(64), runner: '4'.repeat(64), id: 'check', status: 'Passed' };
  const proposal = { digest: 'proposal', commitOid: 'e'.repeat(40), core: {
    candidate: { tree: 'f'.repeat(40) },
    binding: { run: 'run', principal: 'user', tenant: 'tenant', authorizationDigest: '1'.repeat(64), validationPolicyDigest: '2'.repeat(64), policyRevision: 'policy' },
    destination: { repository: 'repo', generation: 'generation', managedRef: 'refs/heads/agent/result' }, validation: [validation] } };
  const occurrence = { id: 'occurrence', attempt_id: 'attempt' }, admission = { run_id: 'run', occurrence_id: 'occurrence', attempt_id: 'attempt', request_digest: run.request_digest };
  const state = { writes: 0, admissions: 0, reconciliations: 0, checks: [validation], records: [], revoked: false, gateRevokes: false, reconcileStatus: 'NotApplied' };
  let binding;
  const journal = { run: () => run, publicationRecords: () => state.records,
    acquiredReplies: () => state.checks.map(row => encodeValue(checkSchema, [0, text(row)])),
    admitPublication() { state.admissions++; return { ...admission, intent_digest: 'intent' }; } };
  const policy = { revision: 'policy', dispatch(_run, request) {
    if (state.revoked) throw Object.assign(Error('revoked'), { code: 'PrincipalRevoked' });
    return { binding, payload: decodeValue(schema, request.payload) };
  } };
  const store = {
    async publishManaged(exact, _helper, admit, history) {
      assert.deepEqual(await history(), { proposals: [], publishedCommits: [] });
      if (state.gateRevokes) state.revoked = true;
      const admitted = admit(exact); state.writes++;
      return { status: 'Published', proposal: exact.digest, commit: exact.commitOid, admission: admitted };
    },
    async reconcilePublication(exact) { state.reconciliations++; return { status: state.reconcileStatus,
      proposal: exact.digest, commit: state.reconcileStatus === 'Published' ? exact.commitOid : null }; },
  };
  binding = repositoryPublicationBinding({ operation: PUBLICATION, payloadSchema: schemaBytes, resultSchema: encodeSchema(deliverySchema) },
    { store, helper: {}, protectedImages: [{ image: run.image_digest, program: run.program_id }],
      authorizationDigest: '1'.repeat(64), validationPolicyDigest: '2'.repeat(64), requiredProfiles: [{ id: 'zig-check', profileDigest: '3'.repeat(64), runner: '4'.repeat(64) }],
      checkResultSchema: encodeSchema(checkSchema), services: () => ({ journal, policy }) });
  const context = () => ({ payload: text(proposal), request: { payload: encodeValue(schema, text(proposal)) }, run, occurrence });
  return { binding, run, proposal, occurrence, admission, state, context };
}
test('publication leaf requires its exact admitted image, principal and authorization context', () => {
  const f = fixture(); assert.equal(f.binding.authorize(text(f.proposal), f.run), true);
  assert.equal(f.binding.authorize(text(f.proposal), { ...f.run, image_digest: 'f'.repeat(64) }), false);
  for (const name of ['principal', 'tenant', 'run', 'authorizationDigest', 'validationPolicyDigest']) {
    const changed = structuredClone(f.proposal); changed.core.binding[name] = 'other';
    assert.equal(f.binding.authorize(text(changed), f.run), false);
  }
});
test('self-asserted validation and revocation under the gate cannot reach publication admission', async () => {
  const f = fixture(); f.state.checks = [];
  await assert.rejects(f.binding.handle(f.context()), { code: 'PublicationValidationMissing' });
  assert.equal(f.state.writes, 0); assert.equal(f.state.admissions, 0);
  const revoked = fixture(); revoked.state.gateRevokes = true;
  await assert.rejects(revoked.binding.handle(revoked.context()), { code: 'PrincipalRevoked' });
  assert.equal(revoked.state.writes, 0); assert.equal(revoked.state.admissions, 0);
});
test('acquired exact validation admits one publication and returns the durable receipt envelope', async () => {
  const f = fixture(), result = await f.binding.handle(f.context());
  assert.equal(f.state.writes, 1); assert.equal(f.state.admissions, 1);
  assert.equal(decodeValue(deliverySchema, result.reply).value, text(result.publicationReceipt));
  assert.equal(result.publicationReceipt.admission.intent_digest, 'intent');
});
test('reconciliation reads the saved exact intent after revocation and never dispatches a write', async () => {
  const f = fixture(); f.state.revoked = true; f.state.reconcileStatus = 'Published'; f.occurrence.publication_intent_digest = 'intent';
  f.state.records = [{ intent_digest: 'intent', intent: { proposal: f.proposal, admission: f.admission }, receipt: null }];
  const result = await f.binding.reconcile(f.context());
  assert.equal(result.publicationReceipt.status, 'Published'); assert.equal(f.state.reconciliations, 1);
  assert.equal(f.state.writes, 0); assert.equal(f.state.admissions, 0);
  f.occurrence.attempt_id = 'other';
  await assert.rejects(f.binding.reconcile(f.context()), { code: 'PublicationIntentMismatch' });
});
test('no-intent recovery returns definitive nonapplication only after the read-only gate observation', async () => {
  const f = fixture(), result = await f.binding.reconcile(f.context());
  assert.equal(JSON.parse(decodeValue(deliverySchema, result.reply).value).status, 'NotApplied');
  assert.equal(result.publicationReceipt, null); assert.equal(f.state.reconciliations, 1); assert.equal(f.state.writes, 0);
  f.state.reconcileStatus = 'Published';
  await assert.rejects(f.binding.reconcile(f.context()), { code: 'PublicationIntentMissing' });
});

test('acquired status and record disagreement cannot admit publication', async () => {
  const f = fixture(); f.state.checks[0].status = 'Failed';
  await assert.rejects(f.binding.handle(f.context()), { code: 'PublicationCheckStatus' });
  assert.equal(f.state.writes, 0); assert.equal(f.state.admissions, 0);
});
