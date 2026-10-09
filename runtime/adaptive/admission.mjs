// Pure admission under the task-frozen policy. No routing or mutable selection.
import assert from 'node:assert/strict';
import {hash} from './codec.mjs';

export const identities = Object.freeze({policy: 'agent.model.policy.adaptive.v1', context: 'agent.model.context.responses.adaptive.v1', seed: 'agent.model.seed.adaptive.v1'});
export const same = (left, right) => Buffer.from(left).equals(Buffer.from(right));
export const sameRef = (left, right) => BigInt(left.bytes) === BigInt(right.bytes) && same(left.digest, right.digest);
export const digest = bytes => [...Buffer.from(hash(bytes), 'hex')];
const identifier = value => typeof value === 'string' && /^[a-zA-Z0-9_.-]+$/.test(value);

export function object(ctx, ref, limit) {
  assert(BigInt(ref.bytes) > 0n && BigInt(ref.bytes) <= BigInt(limit), 'object capacity');
  const bytes = Buffer.from(ctx.object(ref));
  assert(BigInt(bytes.length) === BigInt(ref.bytes) && same(digest(bytes), ref.digest), 'object identity');
  return bytes;
}

export function policy(codec, value) {
  // Roundtrip applies the exact versioned schema and its physical field bounds.
  const frozen = codec.decode('Policy', codec.encode('Policy', value));
  assert.equal(frozen.schema, identities.policy);
  assert(frozen.audience.length && frozen.profiles.length && frozen.model_attempts > 0 && frozen.model_attempts <= 64 && frozen.control_transitions <= 32);
  assert(frozen.catalog.bytes > 0 && frozen.catalog.bytes <= 64 * 1024);
  assert(frozen.core_tools.every((enabled, index) => !enabled || frozen.permitted_tools[index]));
  const ids = new Set();
  for (const entry of frozen.profiles) {
    assert(identifier(entry.id) && !ids.has(entry.id) && entry.model.length && identifier(entry.opaque_family));
    ids.add(entry.id);
    assert(entry.efforts.length && new Set(entry.efforts).size === entry.efforts.length);
    assert(entry.max_output_tokens > 0 && entry.max_output_tokens <= 32768);
    assert(entry.request_bytes > 0 && entry.request_bytes <= 256 * 1024 && entry.response_bytes > 0 && entry.response_bytes <= 512 * 1024);
    assert(entry.timeout_ms > 0 && entry.timeout_ms <= 120000);
    assert(!entry.effort_update || entry.reasoning_mode === 'standard');
  }
  assert(!/[\x00-\x20\x7f-\uffff\\]/.test(frozen.endpoint));
  const endpoint = new URL(frozen.endpoint);
  assert(endpoint.protocol === 'https:' && endpoint.hostname && !endpoint.username && !endpoint.password && !endpoint.hash);
  return frozen;
}

export function catalog(ctx, frozen) {
  const value = ctx.codec.decode('Catalog', object(ctx, frozen.catalog, 64 * 1024));
  const ids = new Set();
  let bytes = 0n;
  for (const entry of value.skills) {
    assert(identifier(entry.id) && identifier(entry.version) && !ids.has(entry.id));
    ids.add(entry.id);
    assert(entry.instructions.bytes > 0 && entry.instructions.bytes <= 32 * 1024);
    bytes += BigInt(entry.instructions.bytes);
    assert(bytes <= 128n * 1024n, 'skill catalog capacity');
    assert(entry.tools.every((enabled, index) => !enabled || frozen.permitted_tools[index]));
  }
  return value;
}

export function select(codec, frozen, request) {
  const entry = frozen.profiles.find(profile => profile.id === request.selection.profile_id);
  assert(entry, 'unknown inference profile');
  assert(same(request.selection.profile_digest, digest(codec.encode('Profile', entry))), 'profile identity');
  assert(entry.efforts.includes(request.selection.effective_effort), 'unsupported effort');
  const invocation = request.invocation, reasoning = invocation.parameters.reasoning;
  assert(reasoning && entry.efforts.includes(reasoning.effort));
  assert(entry.effort_update || reasoning.effort === request.selection.effective_effort);
  assert(reasoning.summary === null && invocation.parameters.temperature === null);
  assert.equal(invocation.model, entry.model);
  assert.equal(invocation.parameters.max_output_tokens, entry.max_output_tokens);
  assert.equal(invocation.protocol, 'agent.model.protocol.openai-responses-v2');
  assert(!invocation.response_policy.store && !invocation.response_policy.stream && !invocation.response_policy.background);
  assert(!invocation.selection.parallel_calls && invocation.selection.maximum_calls <= 1 && invocation.selection.minimum_calls <= invocation.selection.maximum_calls);
  assert.equal(invocation.maximum_provider_response_bytes, entry.response_bytes);
  assert.deepEqual(invocation.normalization_limits, codec.constant('normalization_limits', 'NormalizationLimits'));
  return entry;
}

export function bind(ctx, frozen, request, skills) {
  assert(same(request.policy, digest(ctx.profile)) && sameRef(request.plan.catalog, frozen.catalog));
  assert(request.selection.control_revision <= frozen.control_transitions);
  const selected = select(ctx.codec, frozen, request);
  const materialized = [...frozen.core_tools], permitted = [...frozen.core_tools];
  const ids = new Set();
  let active = 0, bytes = 0n;
  for (const loaded of request.plan.skills) {
    const entry = skills.skills.find(skill => skill.id === loaded.skill_id && skill.version === loaded.version);
    assert(entry && !ids.has(loaded.skill_id), 'unknown or duplicate skill');
    ids.add(loaded.skill_id);
    assert(sameRef(entry.instructions, loaded.resource) && loaded.introduced_at <= request.plan.watermark);
    active += Number(loaded.active); bytes += BigInt(entry.instructions.bytes);
    assert(active <= 4 && bytes <= 128n * 1024n, 'materialization capacity');
    new TextDecoder('utf-8', {fatal: true, ignoreBOM: true}).decode(object(ctx, entry.instructions, 32 * 1024));
    entry.tools.forEach((enabled, index) => {
      materialized[index] ||= enabled;
      permitted[index] ||= enabled && loaded.active;
    });
  }
  assert.deepEqual(request.materialized, materialized);
  assert(request.offered.every((enabled, index) => !enabled || permitted[index]), 'offered outside active grants');
  const expected = ctx.tools.filter((_tool, index) => materialized[index]);
  assert(same(ctx.codec.encode('Tools', expected), ctx.codec.encode('Tools', request.invocation.tools)), 'compiled declaration mismatch');
  return selected;
}
