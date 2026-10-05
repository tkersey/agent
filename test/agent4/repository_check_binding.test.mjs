import test from 'node:test';
import assert from 'node:assert/strict';
import { encodeSchema, encodeValue, decodeValue } from '../../runtime/values.mjs';
import { canonical } from '../../runtime/mobility/canonical.mjs';
import { repositoryCheckBinding, acquiredCheck, checkResultSchema } from '../../runtime/mobility/repository_check.mjs';

const text = value => Buffer.from(canonical(value, 2 << 20)).toString('utf8');
const payload = { root: 0, types: [{ bounded_text: 2 << 20 }] };
const result = { root: 0, types: [{ product: [1, 2] }, { enumeration: [0, 1, 2, 3, 4, 5, 6] }, { bounded_text: 2 << 20 }] };
function fixture() {
  const profile = { owner: 'W', repository: 'repo', generation: '1', manifest: 'a'.repeat(64), profileId: 'finite-check',
    profileDigest: 'b'.repeat(64), runner: 'c'.repeat(64), disclosure: { audience: 'check', labels: ['source'] },
    allowance: { attempts: 2, request_bytes: 4 << 20, concurrent: 1 } };
  const metadata = { operation: 'agent.repository.check.v1', role: 'write', subject: 'repo', subjectVersion: profile.manifest,
    audience: 'check', payloadSchema: encodeSchema(payload), resultSchema: encodeSchema(result) };
  const calls = [], state = { status: 'Passed' }, runner = { runner: profile.runner,
    profiles: [{ id: profile.profileId, digest: profile.profileDigest }],
    async check(request) { calls.push(request); return { status: state.status, runner: runner.runner,
      profileDigest: runner.profiles[0].digest, occurrence: request.occurrence }; } };
  const candidate = { snapshot: { repository: 'repo', generation: '1' }, id: 'candidate' };
  const context = { payload: text(candidate), run: { classification: ['source'] }, occurrence: { id: 'occurrence' }, signal: new AbortController().signal };
  context.request = { payload: encodeValue(payload, context.payload) };
  return { profile, metadata, runner, calls, state, context,
    binding: repositoryCheckBinding(metadata, { runner, profile, hostId: 'W' }) };
}
test('check binding charges its bounded owner allowance before an exact selected invocation', async () => {
  const f = fixture();
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
  const f = fixture();
  for (const [index, status] of ['Passed', 'Failed', 'Unavailable', 'TimedOut', 'Cancelled', 'InvalidOutput', 'Incomplete'].entries()) {
    f.state.status = status;
    const bytes = await f.binding.handle(f.context), value = decodeValue(result, bytes);
    assert.equal(value[0], index); assert.equal(JSON.parse(value[1]).status, status);
  }
});
test('wrong owner, runner, subject, disclosure and schema reject before check execution', async () => {
  const f = fixture();
  for (const changes of [{ owner: 'elsewhere' }, { runner: 'd'.repeat(64) }, { profileDigest: 'd'.repeat(64) }])
    assert.throws(() => repositoryCheckBinding(f.metadata, { runner: f.runner, profile: { ...f.profile, ...changes }, hostId: 'W' }), { code: 'RepositoryCheckBinding' });
  assert.throws(() => repositoryCheckBinding({ ...f.metadata, resultSchema: encodeSchema(payload) },
    { runner: f.runner, profile: f.profile, hostId: 'W' }), { code: 'PublicationCheckSchema' });
  for (const method of ['authorize', 'charge', 'handle']) {
    const context = { ...f.context, run: { classification: ['restricted'] } };
    if (method === 'authorize') assert.throws(() => f.binding.authorize(context.payload, context.run), { code: 'LeafDisclosureDenied' });
    else if (method === 'charge') assert.throws(() => f.binding.charge(context), { code: 'LeafDisclosureDenied' });
    else await assert.rejects(f.binding.handle(context), { code: 'LeafDisclosureDenied' });
  }
  await assert.rejects(f.binding.handle({ ...f.context, payload: text({ snapshot: { repository: 'other', generation: '1' } }) }), { code: 'RepositoryCheckSubject' });
  assert.equal(f.calls.length, 0);
});
