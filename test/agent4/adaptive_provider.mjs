import assert from 'node:assert/strict';
import {prepare, interpret, usage, acquire} from '../../runtime/adaptive/responses.mjs';
import {digest, identities} from '../../runtime/adaptive/admission.mjs';
import {parse, canonical} from '../../runtime/adaptive/json.mjs';

export async function verifyAdaptiveProvider(codec) {
  const objects = new Map();
  const retain = bytes => {
    const ref = {digest: digest(bytes), bytes: bytes.length};
    objects.set(Buffer.from(ref.digest).toString('hex'), Buffer.from(bytes)); return ref;
  };
  const tools = codec.constant('tools', 'Tools');
  const core = tools.map(tool => tool.name !== 'inspect');
  const body = retain(Buffer.from('UNIQUE-RESIDENT-BODY: inspect acquired evidence.'));
  const catalog = retain(codec.encode('Catalog', {skills: [{id: 'invariant-review', version: '1', description: 'Inspect guards.',
    instructions: body, tools: tools.map(tool => tool.name === 'inspect')}]}));
  const inference = {id: 'analysis', model: 'fixture-model-a', reasoning_mode: 'standard', reasoning_context: 'auto',
    efforts: ['medium', 'high'], effort_update: false, explicit_cache: true, additional_tools: true, cache_diagnostics: true,
    opaque_family: 'fixture', max_output_tokens: 4096, request_bytes: 256 * 1024, response_bytes: 512 * 1024, timeout_ms: 1000};
  const policy = {schema: identities.policy, endpoint: 'https://example.test/v1/responses', audience: 'fixture', profiles: [inference],
    catalog, core_tools: core, permitted_tools: tools.map(() => true), model_attempts: 16, control_transitions: 16};
  const profile = canonical({adaptive: codec.toClient('Policy', policy)});
  const ctx = {codec, tools, profile, task: Array(16).fill(7), tenant: 'fixture', object: ref => {
    const bytes = objects.get(Buffer.from(ref.digest).toString('hex')); assert(bytes, 'missing artifact'); return bytes;
  }};
  const request = {policy: digest(profile), selection: {profile_id: inference.id, profile_digest: digest(codec.encode('Profile', inference)),
    effective_effort: 'medium', control_revision: 0}, plan: {epoch: 0, reason: 'initial', watermark: 0, eviction_generation: 0,
    prior: null, handoff: null, catalog, skills: []}, materialized: [...core], offered: [...core], results: [],
    invocation: {protocol: 'agent.model.protocol.openai-responses-v2', model: inference.model,
      parameters: {max_output_tokens: inference.max_output_tokens, temperature: null, reasoning: {effort: 'medium', summary: null}},
      messages: [{role: 'developer', content: 'Use approved tools and acquired evidence.'}, {role: 'user', content: 'Inspect the fixture.'}],
      tools: tools.filter((_tool, index) => core[index]), selection: {minimum_calls: 1, maximum_calls: 1, parallel_calls: false},
      response_policy: {store: false, stream: false, background: false, truncation: 'disabled'},
      normalization_limits: codec.constant('normalization_limits', 'NormalizationLimits'), maximum_provider_response_bytes: inference.response_bytes}};
  const bytes = () => codec.encode('AdaptiveRequest', request);
  const http = () => parse(codec.decode('AdaptivePrepared', prepare(ctx, bytes())).body);
  const capture = output => {
    const payload = bytes(), prepared = prepare(ctx, payload); retain(prepared);
    const raw = codec.encode('CapturedResponse', {status: 200, identity_encoding: true, request_id: null,
      body: canonical({id: 'response', status: 'completed', error: null, output})}); retain(raw);
    const result = interpret(ctx, payload, prepared, raw); result.objects.forEach(retain);
    return codec.decode('AdaptiveResult', result.reply);
  };
  const call = (name, args) => ({type: 'function_call', status: 'completed', call_id: 'reused-after-settlement', name, arguments: JSON.stringify(args)});
  assert.equal(http().tool_choice.tools.length, 7);
  const first = capture([call('list', {prefix: '', after: ''})]);
  assert.equal(first.replay_status, 'complete');
  request.plan.prior = first.replay; request.plan.watermark = first.replay.watermark;
  request.invocation.messages = []; request.results = [{call_id: 'reused-after-settlement', output: 'Source file found.'}];
  request.selection.control_revision = 1;
  request.plan.skills = [{resource: body, skill_id: 'invariant-review', version: '1', residency: 'resident', active: true, introduced_at: 1}];
  request.materialized = tools.map(() => true); request.offered = [...request.materialized]; request.invocation.tools = tools;
  assert(http().input.some(item => item.type === 'additional_tools' && item.tools[0].name === 'inspect'));
  const second = capture([{type: 'reasoning', summary: [], encrypted_content: 'OPAQUE-SKILL'}, call('inspect', {evidence_index: 0})]);
  assert.equal(second.replay_status, 'complete');
  request.plan.prior = second.replay; request.plan.watermark = second.replay.watermark;
  request.results = [{call_id: 'reused-after-settlement', output: 'Guard observation retained.'}];
  request.plan.skills[0].active = false; request.offered = [...core]; request.selection.control_revision = 2;
  assert(canonical(http()).includes('UNIQUE-RESIDENT-BODY'));
  assert.equal(http().tool_choice.tools.length, 7);
  request.plan.skills = []; request.materialized = [...core]; request.invocation.tools = tools.filter((_tool, index) => core[index]);
  assert.throws(() => prepare(ctx, bytes()), /assert|context|false/i);
  request.plan.epoch = 1; request.plan.reason = 'eviction'; request.plan.eviction_generation = 1;
  request.plan.handoff = retain(codec.encode('AdaptiveSeed', {schema: identities.seed, policy: request.policy, task: ctx.task,
    tenant: ctx.tenant, audience: policy.audience, selection: request.selection, epoch: 1, watermark: request.plan.watermark,
    eviction_generation: 1, source: second.replay, messages: [{role: 'user', content: 'Verified guard observation; continue the task.'}]}));
  const evicted = canonical(http());
  assert(!evicted.includes('UNIQUE-RESIDENT-BODY') && !evicted.includes('OPAQUE-SKILL') && !evicted.includes('"name":"inspect"'));
  assert(evicted.includes('Verified guard observation'));
  const valid = prepare(ctx, bytes());
  const graft = structuredClone(request); graft.plan.prior.task[0] ^= 1;
  assert.throws(() => prepare(ctx, codec.encode('AdaptiveRequest', graft)));
  const missing = objects.get(Buffer.from(second.replay.object.digest).toString('hex'));
  objects.delete(Buffer.from(second.replay.object.digest).toString('hex'));
  assert.throws(() => prepare(ctx, bytes()), /missing artifact/);
  retain(missing);
  assert.deepEqual(prepare(ctx, bytes()), valid);
  assert.equal((await acquire(ctx, valid, {enabled: false})).kind, 'definitely_not_sent');
  const counted = usage(parse(Buffer.from('{"usage":{"input_tokens":9007199254740993,"output_tokens":0,"input_tokens_details":{"cached_tokens":0}}}')));
  assert(counted.valid); assert.equal(counted.value.input_tokens, 9007199254740993n); assert.equal(counted.value.cache_write_tokens, null);
  assert(!usage(parse(Buffer.from('{"usage":{"input_tokens":1,"input_tokens_details":{"cached_tokens":2}}}'))).valid);
}
