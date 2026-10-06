// Adapter contract tests. Trusted service doubles deliberately do not claim
// image/private-grant or Git qualification; those have separate witnesses.
import test from 'node:test';
import assert from 'node:assert/strict';
import { encodeSchema, encodeValue, decodeValue } from '../../runtime/values.mjs';
import { canonical } from '../../runtime/mobility/canonical.mjs';
import { repositoryCheckBinding, acquiredCheck, checkResultSchema } from '../../runtime/mobility/repository_check.mjs';
import { repositoryPublicationBinding, repositoryProposalBinding, PUBLICATION } from '../../runtime/mobility/repository_publication.mjs';
import { HostPolicy } from '../../runtime/mobility/policy.mjs';

const schema = { root: 0, types: [{ bounded_text: 2 << 20 }] }, schemaBytes = encodeSchema(schema);
const checkSchema = { root: 0, types: [{ product: [1, 2] }, { enumeration: [0, 1, 2, 3, 4, 5, 6] }, { bounded_text: 2 << 20 }] };
const deliverySchema = { root: 0, types: [{ sum: [1, 1, 1, 2] }, { bounded_text: 16384 }, { bounded_text: 128 }] };
const text = value => Buffer.from(canonical(value, 2 << 20)).toString('utf8');
function fixture(repository = 'repo') {
  const run = { run_id: 'issuer:' + 'a'.repeat(64), image_digest: 'a'.repeat(64), program_id: 'b'.repeat(64), principal_ref: 'user', tenant_ref: 'tenant',
    trusted_runtime_profile: '9'.repeat(64), classification: ['shared'],
    request_digest: 'c'.repeat(64), custody_epoch: '1', execution_revision: '2', executor_incarnation: '3', outcome_digest: 'd'.repeat(64) };
  const validation = { profile: 'zig-check', profileDigest: '3'.repeat(64), runner: '4'.repeat(64), id: 'check', status: 'Passed' };
  const proposal = { digest: 'proposal', commitOid: 'e'.repeat(40), core: {
    candidate: { tree: 'f'.repeat(40) },
    binding: { run: run.run_id, principal: 'user', tenant: 'tenant', authorizationDigest: '1'.repeat(64), validationPolicyDigest: '2'.repeat(64), policyRevision: 'policy' },
    destination: { repository, generation: 'generation', managedRef: 'refs/heads/agent/result' }, validation: [validation] } };
  const occurrence = { id: 'occurrence', attempt_id: 'attempt' }, admission = { run_id: run.run_id, occurrence_id: 'occurrence', attempt_id: 'attempt', request_digest: run.request_digest };
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
    describe: () => ({ repository, generation: 'generation', managedRef: 'refs/heads/agent/result' }),
    async publishManaged(exact, _helper, admit, history) {
      assert.deepEqual(await history(), { proposals: [], publishedCommits: [] });
      if (state.gateRevokes) state.revoked = true;
      const admitted = admit(exact); state.writes++;
      return { status: 'Published', proposal: exact.digest, commit: exact.commitOid, admission: admitted };
    },
    async reconcilePublication(exact) { state.reconciliations++; return { status: state.reconcileStatus,
      proposal: exact.digest, commit: state.reconcileStatus === 'Published' ? exact.commitOid : null }; },
  };
  binding = repositoryPublicationBinding({ operation: PUBLICATION, payloadSchema: schemaBytes, resultSchema: encodeSchema(deliverySchema),
    role: 'commit', subject: repository, subjectVersion: null, scope: 'publish', audience: null, trustDomain: 'domain',
    tenants: ['tenant'], principals: ['user'], classification: ['shared'], allowedStateLabels: ['shared'] },
    { store, helper: {}, protectedImages: [{ image: run.image_digest, program: run.program_id }],
      authorizationDigest: '1'.repeat(64), validationPolicyDigest: '2'.repeat(64), requiredProfiles: [{ id: 'zig-check', profileDigest: '3'.repeat(64), runner: '4'.repeat(64) }],
      checkResultSchema: encodeSchema(checkSchema), services: () => ({ journal, policy }) });
  const context = () => ({ payload: text(proposal), request: { payload: encodeValue(schema, text(proposal)) }, run, occurrence });
  return { binding, run, proposal, occurrence, admission, state, context, store, journal, policy };
}
test('publication leaf requires its exact admitted image, principal and authorization context', () => {
  const f = fixture(); assert.equal(f.binding.authorize(text(f.proposal), f.run), true);
  assert.equal(f.binding.authorize(text(f.proposal), { ...f.run, image_digest: 'f'.repeat(64) }), false);
  for (const name of ['principal', 'tenant', 'run', 'authorizationDigest', 'validationPolicyDigest']) {
    const changed = structuredClone(f.proposal); changed.core.binding[name] = 'other';
    assert.equal(f.binding.authorize(text(changed), f.run), false);
  }
  const other = fixture('other'), retired = fixture(), revoked = new Set();
  retired.binding.scope = 'retired'; retired.binding.enabled = false;
  const policy = new HostPolicy({ hostId: 'W', trustDomain: 'domain', revision: 'policy',
    runtimeProfile: f.run.trusted_runtime_profile, labelDestinations: { shared: ['W'] }, bindings: [other.binding, retired.binding, f.binding], revoked,
    deployments: [{ imageDigest: f.run.image_digest, programId: f.run.program_id, tenant: 'tenant', principals: ['user'], issuers: ['issuer'], hosts: ['W'], classification: ['shared'], cleanup: [] }] });
  const request = { semanticIdentity: PUBLICATION, payloadSchema: schemaBytes, resumeSchema: encodeSchema(deliverySchema), payload: encodeValue(schema, text(f.proposal)) };
  const selected = policy.dispatch(f.run, request);
  assert.equal(selected.binding, f.binding);
  revoked.add('tenant/user');
  f.proposal.core.binding.authorizationDigest = '8'.repeat(64);
  request.payload = encodeValue(schema, text(f.proposal));
  assert.throws(() => policy.dispatch(f.run, request), { code: 'PrincipalRevoked' });
  assert.equal(policy.recovery(f.run, request, selected.bindingId).binding, f.binding, 'retain the actual selected binding across revocation');
  assert.equal(policy.recovery(f.run, request), null, 'legacy ambiguous ownership must not guess the first match');
  retired.binding.recoveryMatches = () => false;
  assert.equal(policy.recovery(f.run, request).binding, f.binding, 'unambiguous legacy ownership remains recoverable');
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

function checkFixture(repository = 'repo') {
  const profile = { owner: 'W', repository, generation: '1', manifest: 'a'.repeat(64), profileId: 'finite-check',
    profileDigest: 'b'.repeat(64), runner: 'c'.repeat(64), disclosure: { audience: 'check', labels: ['source'] },
    allowance: { attempts: 2, request_bytes: 4 << 20, concurrent: 1 } };
  const metadata = { operation: 'agent.repository.check.v1', role: 'write', subject: repository, subjectVersion: profile.manifest,
    audience: 'check', payloadSchema: schemaBytes, resultSchema: encodeSchema(checkSchema) };
  const calls = [], state = { status: 'Passed' }, runner = { runner: profile.runner,
    profiles: [{ id: profile.profileId, digest: profile.profileDigest }],
    async check(request) { calls.push(request); return { status: state.status, runner: runner.runner,
      profileDigest: runner.profiles[0].digest, occurrence: request.occurrence }; } };
  const candidate = { snapshot: { repository, generation: '1' }, id: 'candidate' };
  const context = { payload: text(candidate), run: { classification: ['source'] }, occurrence: { id: 'occurrence' }, signal: new AbortController().signal };
  context.request = { payload: encodeValue(schema, context.payload) };
  return { profile, metadata, runner, calls, state, context,
    binding: repositoryCheckBinding(metadata, { runner, profile, hostId: 'W' }) };
}
test('check binding charges its bounded owner allowance before an exact selected invocation', async () => {
  const f = checkFixture();
  const charge = f.binding.charge(f.context);
  assert.equal(charge.owner, 'W'); assert.equal(charge.kind, 'check'); assert.equal(charge.limit.attempts, 2);
  assert.equal(charge.amount.request_bytes, f.context.request.payload.length); assert.equal(charge.amount.output_tokens, 0);
  f.profile.allowance.attempts = 16;
  assert.deepEqual(f.binding.charge(f.context), charge);
  const bytes = await f.binding.handle(f.context);
  assert.equal(f.calls.length, 1); assert.equal(f.calls[0].profileId, 'finite-check'); assert.equal(f.calls[0].occurrence, 'occurrence');
  assert.equal(f.calls[0].signal, f.context.signal);
  assert.equal(acquiredCheck(checkResultSchema(f.metadata.resultSchema), bytes).status, 'Passed');
});
test('all seven runner outcomes survive the typed check boundary', async () => {
  const f = checkFixture();
  for (const [index, status] of ['Passed', 'Failed', 'Unavailable', 'TimedOut', 'Cancelled', 'InvalidOutput', 'Incomplete'].entries()) {
    f.state.status = status;
    const bytes = await f.binding.handle(f.context), value = decodeValue(checkSchema, bytes);
    assert.equal(value[0], index); assert.equal(JSON.parse(value[1]).status, status);
  }
});
test('wrong owner, runner, subject, disclosure and schema reject before check execution', async () => {
  const f = checkFixture();
  for (const changes of [{ owner: 'elsewhere' }, { runner: 'd'.repeat(64) }, { profileDigest: 'd'.repeat(64) }])
    assert.throws(() => repositoryCheckBinding(f.metadata, { runner: f.runner, profile: { ...f.profile, ...changes }, hostId: 'W' }), { code: 'RepositoryCheckBinding' });
  assert.throws(() => repositoryCheckBinding({ ...f.metadata, resultSchema: schemaBytes },
    { runner: f.runner, profile: f.profile, hostId: 'W' }), { code: 'PublicationCheckSchema' });
  for (const method of ['authorize', 'charge', 'handle']) {
    const context = { ...f.context, run: { classification: ['restricted'] } };
    if (method === 'authorize') assert.equal(f.binding.authorize(context.payload, context.run), false);
    else if (method === 'charge') assert.throws(() => f.binding.charge(context), { code: 'LeafDisclosureDenied' });
    else await assert.rejects(f.binding.handle(context), { code: 'LeafDisclosureDenied' });
  }
  await assert.rejects(f.binding.handle({ ...f.context, payload: text({ snapshot: { repository: 'other', generation: '1' } }) }), { code: 'RepositoryCheckSubject' });
  assert.equal(f.calls.length, 0);
});

test('repository binding selection skips foreign owners and preserves recovery of earlier admitted preparation', () => {
  const a = fixture('A'), b = fixture('B');
  const policy = (bindings, classification = ['shared']) => new HostPolicy({ hostId: 'W', trustDomain: 'domain', revision: 'policy', runtimeProfile: b.run.trusted_runtime_profile,
    labelDestinations: { shared: ['W'], source: ['W'] }, bindings, deployments: [{ imageDigest: b.run.image_digest, programId: b.run.program_id,
      tenant: 'tenant', principals: ['user'], issuers: ['issuer'], hosts: ['W'], classification, cleanup: [] }] });
  const checks = ['A', 'B'].map(repository => {
    const f = checkFixture(repository);
    return { ...f.binding, trustDomain: 'domain', scope: 'check', tenants: ['tenant'], principals: ['user'], classification: ['shared'], allowedStateLabels: ['source'] };
  });
  const checkRequest = { semanticIdentity: checks[0].operation, payloadSchema: schemaBytes, resumeSchema: encodeSchema(checkSchema),
    payload: encodeValue(schema, text({ snapshot: { repository: 'B', generation: '1' } })) };
  const checkRun = { ...b.run, classification: ['source'] };
  assert.equal(policy(checks, ['source']).dispatch(checkRun, checkRequest).binding, checks[1]);
  assert.equal(policy([...checks].reverse(), ['source']).dispatch(checkRun, checkRequest).binding, checks[1]);
  checkRequest.payload = encodeValue(schema, text({ snapshot: { repository: 'B', generation: 'other' } }));
  assert.throws(() => policy(checks, ['source']).dispatch(checkRun, checkRequest), { code: 'LeafBindingDenied' });

  const preparation = { root: 0, types: [{ product: [1, 1, 2, 2] }, { bounded_text: 2 << 20 }, 'u64'] };
  const proposals = [a, b].map(f => repositoryProposalBinding({ ...f.binding, operation: 'agent.repository.proposal.v1', role: 'write',
    payloadSchema: encodeSchema(preparation), resultSchema: schemaBytes }, { store: f.store,
    protectedImages: [{ image: f.run.image_digest, program: f.run.program_id }], authorizationDigest: '1'.repeat(64), validationPolicyDigest: '2'.repeat(64),
    requiredProfiles: [{ id: 'zig-check', profileDigest: '3'.repeat(64), runner: '4'.repeat(64) }], checkResultSchema: encodeSchema(checkSchema),
    commit: {}, services: () => ({ journal: f.journal, policy: f.policy }) }));
  const request = { semanticIdentity: proposals[0].operation, payloadSchema: encodeSchema(preparation), resumeSchema: schemaBytes,
    payload: encodeValue(preparation, [text({ snapshot: { repository: 'B', generation: 'generation' } }), '{}', 1n, 1n]) };
  const both = policy(proposals);
  assert.equal(both.dispatch(b.run, request).binding, proposals[1]);
  assert.equal(policy([...proposals].reverse()).dispatch(b.run, request).binding, proposals[1]);
  // Old journals can name A even though new admission now routes this to B.
  const old = policy([proposals[0]]), legacyRequest = { ...request, payload: encodeValue(preparation,
    [text({ snapshot: { repository: 'A', generation: 'generation' } }), '{}', 1n, 1n]) };
  const admittedId = old.dispatch(a.run, legacyRequest).bindingId;
  assert.equal(both.recovery(b.run, request, admittedId).binding, proposals[0]);
  assert.equal(proposals[0].cancelSafe, true);
});
