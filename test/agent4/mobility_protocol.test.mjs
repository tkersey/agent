import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { canonical, parse, hash, runId, signRecord, verifyRecord } from '../../runtime/mobility/protocol.mjs';
import { increment } from '../../runtime/mobility/canonical.mjs';
import { encodeRefusal, schemas } from '../../runtime/mobility/values.mjs';
import { decodeValue } from '../../runtime/values.mjs';
const bytes = text => new TextEncoder().encode(text), text = value => new TextDecoder().decode(value);
function registration(overrides = {}) {
  return { format: 'agent-mobility-run/v1', run_id: runId('issuer'), issuer_id: 'issuer', principal_ref: 'user', tenant_ref: 'tenant', image_digest: '1'.repeat(64), program_id: '2'.repeat(64), trusted_runtime_profile: '3'.repeat(64),
    allowed_host_policy_ref: 'hosts', deployment_policy_revision: 'p1', initial_classification: ['shared'], initial_host_id: 'A', initial_epoch: '0',
    deployment_limits: { maximum_moves: 16, maximum_image_bytes: 8388608, maximum_outcome_bytes: 8388608 }, key_id: 'issuer-key', ...overrides };
}

test('restricted JCS preserves RFC 8785 Unicode sorting and ECMAScript escaping', () => {
  // RFC 8785 section 3.2.3 property-order test (values shortened, keys exact).
  const value = { '\u20ac': 'Euro', '\r': 'CR', '\ufb33': 'Hebrew', '1': 'One', '\ud83d\ude00': 'Emoji', '\u0080': 'Control', '\u00f6': 'Latin' };
  assert.equal(text(canonical(value)), '{"\\r":"CR","1":"One","\u0080":"Control","ö":"Latin","€":"Euro","😀":"Emoji","דּ":"Hebrew"}');
  assert.equal(text(canonical({ text: '\u000f\n"\\/é', integer: 9007199254740991, negative: -1 })), '{"integer":9007199254740991,"negative":-1,"text":"\\u000f\\n\\"\\\\/é"}');
  assert.equal(text(canonical({ b: [true, null, 'x'], a: 1 })), '{"a":1,"b":[true,null,"x"]}');
  for (const invalid of [NaN, Infinity, 1.5, -0, 9007199254740992, '\ud800', '\udfff']) assert.throws(() => canonical(invalid));
});

test('duplicate decoded keys, unknown numbers, malformed encodings and excess structure reject', () => {
  for (const input of ['{"a":1,"a":2}', '{"a":1,"\\u0061":2}', '{"nested":{"a":0,"a":1}}']) assert.throws(() => parse(bytes(input)), { code: 'DuplicateKey' });
  for (const input of ['1.0', '1e0', '-0', '01', '9007199254740992', 'null null', '[1,]', '{"a":1,}', '"\\ud800"', '['.repeat(40) + ']'.repeat(40)]) assert.throws(() => parse(bytes(input)));
  assert.throws(() => parse(bytes('{ "a":1}')), { code: 'NonCanonical' });
  assert.equal(parse(bytes('{ "a":1}'), { canonicalOnly: false }).a, 1);
  assert.throws(() => parse(new Uint8Array([0xff])));
  assert.throws(() => parse(new Uint8Array(65537)), { code: 'ControlCapacity' });
  assert.throws(() => canonical({ get x() { throw new Error('getter executed'); } }), { code: 'InvalidRecord' });
  assert.equal(Object.getPrototypeOf(parse(bytes('{"__proto__":null}'))), null);
});

test('Ed25519 binds exact closed versioned record, key owner and message kind', () => {
  const pair = generateKeyPairSync('ed25519'), keys = new Map([['issuer-key', { owner: 'issuer', status: 'active', publicKey: pair.publicKey }]]);
  const record = registration(), signed = signRecord('run', record, pair.privateKey);
  assert.equal(verifyRecord('run', signed, keys).run_id, record.run_id);
  assert.deepEqual(signRecord('run', record, pair.privateKey), signed, 'deterministic signature bytes');
  const changed = { ...parse(signed), tenant_ref: 'other-tenant' };
  assert.throws(() => verifyRecord('run', canonical(changed), keys), { code: 'InvalidSignature' });
  assert.throws(() => verifyRecord('run', canonical({ ...parse(signed), unexpected: true }), keys), { code: 'RecordFields' });
  assert.throws(() => verifyRecord('run', canonical({ ...parse(signed), format: 'agent-mobility-run/v2' }), keys), { code: 'UnknownVersion' });
  assert.throws(() => verifyRecord('offer', signed, keys));
  assert.throws(() => verifyRecord('run', signed, new Map([['issuer-key', { ...keys.get('issuer-key'), owner: 'other' }]])), { code: 'KeyOwnerMismatch' });
  assert.throws(() => verifyRecord('run', signed, new Map()), { code: 'UntrustedKey' });
});

test('ordinary retirement is exact-record-only and compromise cannot use historical exemption', () => {
  const pair = generateKeyPairSync('ed25519'), record = registration(), signed = signRecord('run', record, pair.privateKey);
  const keys = new Map([['issuer-key', { owner: 'issuer', status: 'retired', publicKey: pair.publicKey }]]);
  assert.throws(() => verifyRecord('run', signed, keys), { code: 'RetiredKey' });
  assert.equal(verifyRecord('run', signed, keys, { historicalDigest: hash(signed) }).run_id, record.run_id);
  const another = signRecord('run', registration(), pair.privateKey);
  assert.throws(() => verifyRecord('run', another, keys, { historicalDigest: hash(signed) }), { code: 'RetiredKey' });
  keys.set('issuer-key', { ...keys.get('issuer-key'), status: 'compromised' });
  assert.throws(() => verifyRecord('run', signed, keys, { historicalDigest: hash(signed) }), { code: 'RetiredKey' });
});

test('decimal counters never wrap or accept alternate spellings', () => {
  assert.equal(increment('9007199254740992'), '9007199254740993');
  assert.equal(increment('18446744073709551614'), '18446744073709551615');
  assert.throws(() => increment('18446744073709551615'), { code: 'CounterOverflow' });
  for (const invalid of ['00', '+1', '-1', '1e1', '18446744073709551616', 1]) assert.throws(() => increment(invalid), { code: 'InvalidCounter' });
});

test('v1 refusal meanings keep the specified numeric variant order', () => {
  const names = ['unavailable', 'policy_denied', 'export_denied', 'binding_mismatch', 'runtime_mismatch', 'capacity', 'unsettled_occurrence', 'pinned_resource', 'cleanup_unsupported', 'budget_exhausted', 'withdrawn', 'expired_offer', 'already_here', 'invalid_state', 'busy', 'unsupported'];
  for (const [tag, name] of names.entries()) assert.deepEqual(decodeValue(schemas.relocationReply, encodeRefusal('A', name)), {
    tag: 1, value: [{ tag, value: null }, 'A', { tag: 0, value: { tag, value: null } }],
  });
});
