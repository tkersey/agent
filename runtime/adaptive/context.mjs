// Immutable replay projection. The authored program supplies every transition.
import assert from 'node:assert/strict';
import {identities, object, same, sameRef, digest} from './admission.mjs';
import {parse, canonical} from './json.mjs';

const text = value => { assert.equal(typeof value, 'string'); return value; };
const only = (value, names) => {
  assert(value && typeof value === 'object' && !Array.isArray(value));
  assert(Object.keys(value).every(key => names.includes(key)), 'unsupported replay field');
};
export function replayItem(item) {
  if (item?.type === 'function_call') {
    only(item, ['type', 'id', 'call_id', 'name', 'arguments', 'status']);
    assert(item.status === 'completed' && text(item.call_id).length && text(item.name).length);
    text(item.arguments);
  } else if (item?.type === 'reasoning') {
    only(item, ['type', 'id', 'summary', 'encrypted_content', 'status']);
    assert(item.status === undefined || item.status === 'completed');
    assert(text(item.encrypted_content).length && Array.isArray(item.summary));
    for (const part of item.summary) { only(part, ['type', 'text']); assert.equal(part.type, 'summary_text'); text(part.text); }
  } else if (item?.type === 'message') {
    only(item, ['type', 'id', 'status', 'role', 'content', 'phase']);
    assert(item.status === 'completed' && item.role === 'assistant');
    assert(item.phase === undefined || item.phase === null || ['commentary', 'final_answer'].includes(item.phase));
    assert(Array.isArray(item.content) && item.content.length);
    for (const part of item.content) {
      if (part?.type === 'output_text') {
        only(part, ['type', 'text', 'annotations', 'logprobs']); text(part.text);
        for (const key of ['annotations', 'logprobs']) if (Object.hasOwn(part, key)) assert(Array.isArray(part[key]) && !part[key].length);
      } else { only(part, ['type', 'refusal']); assert.equal(part.type, 'refusal'); text(part.refusal); }
    }
  } else assert.fail('unsupported replay item');
  if (Object.hasOwn(item, 'id')) assert(text(item.id).length);
  return item;
}

export function pending(items) {
  assert(Array.isArray(items) && items.length <= 8192, 'history capacity');
  const calls = new Set();
  for (const item of items) {
    if (item?.type === 'function_call') {
      replayItem(item); assert(!calls.has(item.call_id), 'duplicate unsettled call'); calls.add(item.call_id);
    } else if (item?.type === 'function_call_output') {
      text(item.output); assert(calls.delete(text(item.call_id)), 'unpaired tool result');
    } else if (['additional_tools', 'configuration_update'].includes(item?.type) || !Object.hasOwn(item, 'type')) {
      assert.equal(calls.size, 0, 'missing call result');
    } else replayItem(item);
  }
  return calls;
}

const equivalent = (a, b) => same(canonical(a), canonical(b));
const message = (role, content, marked) => ({role, content: [{type: 'input_text', text: content,
  ...(marked ? {prompt_cache_breakpoint: {mode: 'explicit'}} : {})}]});
const tool = declaration => ({type: 'function', name: declaration.name, description: declaration.description,
  parameters: parse(declaration.input_schema_json), strict: true});
const sameSkill = (left, right) => left.skill_id === right.skill_id && left.version === right.version &&
  sameRef(left.resource, right.resource) && left.residency === right.residency && BigInt(left.introduced_at) === BigInt(right.introduced_at);
const next = value => { const n = BigInt(value) + 1n; assert(n <= (1n << 64n) - 1n); return n; };

export function open(ctx, reference, audience) {
  assert(reference.schema === identities.context && same(reference.policy, digest(ctx.profile)) &&
    same(reference.task, ctx.task) && reference.tenant === ctx.tenant && reference.audience === audience);
  const value = ctx.codec.decode('AdaptiveContext', object(ctx, reference.object, 2 * 1024 * 1024));
  assert(value.schema === reference.schema && same(value.policy, reference.policy) && same(value.task, reference.task) &&
    value.tenant === reference.tenant && value.audience === reference.audience && same(value.selection.profile_digest, reference.selection) &&
    BigInt(value.plan.epoch) === BigInt(reference.epoch) && BigInt(value.watermark) === BigInt(reference.watermark) &&
    BigInt(value.plan.eviction_generation) === BigInt(reference.eviction_generation) && BigInt(value.watermark) === next(value.plan.watermark));
  object(ctx, value.source_capture, 4 * 1024 * 1024);
  object(ctx, value.source_request, 2 * 1024 * 1024);
  if (value.plan.handoff !== null) object(ctx, value.plan.handoff, 128 * 1024);
  return value;
}

function settle(history, request) {
  const calls = pending(history);
  for (const result of request.results) {
    assert(calls.delete(result.call_id), 'unpaired tool result');
    history.push({type: 'function_call_output', call_id: result.call_id, output: result.output});
  }
  assert.equal(calls.size, 0, 'missing call result');
}

export function render(ctx, request, frozen, selected, catalog) {
  let history = [], previous = null, sameEpoch = false;
  if (request.plan.prior !== null) {
    previous = open(ctx, request.plan.prior, frozen.audience);
    let parent = previous.plan.prior, watermark = previous.plan.watermark, depth = 1;
    while (parent !== null) {
      assert(depth++ < 64 && BigInt(parent.watermark) === BigInt(watermark), 'audit ancestry capacity or mismatch');
      const saved = open(ctx, parent, frozen.audience); parent = saved.plan.prior; watermark = saved.plan.watermark;
    }
    assert(BigInt(request.plan.watermark) === BigInt(previous.watermark) && request.selection.control_revision >= previous.selection.control_revision);
    sameEpoch = BigInt(request.plan.epoch) === BigInt(previous.plan.epoch);
    const removing = previous.plan.skills.some(old => !request.plan.skills.some(current =>
      sameSkill(old, current) && !(old.residency === 'transient' && old.active && !current.active)));
    if (sameEpoch) {
      assert(!removing && BigInt(request.plan.eviction_generation) === BigInt(previous.plan.eviction_generation) &&
        same(request.selection.profile_digest, previous.selection.profile_digest) && request.invocation.parameters.reasoning.effort === previous.top_effort &&
        equivalent(request.plan.handoff, previous.plan.handoff) && request.plan.reason === previous.plan.reason);
      history = parse(previous.items, 2 * 1024 * 1024);
    } else {
      assert(BigInt(request.plan.epoch) === next(previous.plan.epoch) &&
        BigInt(request.plan.eviction_generation) === BigInt(previous.plan.eviction_generation) + BigInt(removing));
      assert(request.plan.handoff !== null, 'missing handoff');
      const seed = ctx.codec.decode('AdaptiveSeed', object(ctx, request.plan.handoff, 128 * 1024));
      assert(seed.schema === identities.seed && same(seed.policy, request.policy) && same(seed.task, ctx.task) &&
        seed.tenant === ctx.tenant && seed.audience === frozen.audience && equivalent(seed.selection, request.selection) &&
        BigInt(seed.epoch) === BigInt(request.plan.epoch) && BigInt(seed.watermark) === BigInt(request.plan.watermark) &&
        BigInt(seed.eviction_generation) === BigInt(request.plan.eviction_generation) && equivalent(seed.source, request.plan.prior) && seed.messages.length);
      settle(parse(previous.items, 2 * 1024 * 1024), request);
      history = seed.messages.map(item => message(item.role, item.content, selected.explicit_cache));
    }
  } else assert(BigInt(request.plan.epoch) === 0n && BigInt(request.plan.watermark) === 0n && BigInt(request.plan.eviction_generation) === 0n &&
    request.plan.handoff === null && request.plan.reason === 'initial', 'covert context reset');
  if (sameEpoch || previous === null) settle(history, request);
  if (sameEpoch && request.selection.effective_effort !== previous.selection.effective_effort) {
    assert(selected.effort_update && history.at(-1)?.type !== 'configuration_update');
    history.push({type: 'configuration_update', reasoning: {effort: request.selection.effective_effort}});
  } else if (!sameEpoch) assert.equal(request.invocation.parameters.reasoning.effort, request.selection.effective_effort);
  history.push(...request.invocation.messages.map(item => message(item.role, item.content, selected.explicit_cache)));
  const defined = [...frozen.core_tools];
  const coreTools = ctx.tools.filter((_item, index) => frozen.core_tools[index]).map(tool);
  if (sameEpoch) for (const loaded of previous.plan.skills) {
    const entry = catalog.skills.find(skill => skill.id === loaded.skill_id);
    if (entry) entry.tools.forEach((enabled, index) => { defined[index] ||= enabled; });
  }
  for (const loaded of request.plan.skills) {
    if (sameEpoch && previous.plan.skills.some(old => sameSkill(old, loaded))) continue;
    const additions = [], entry = catalog.skills.find(skill => skill.id === loaded.skill_id);
    if (entry) entry.tools.forEach((enabled, index) => {
      if (enabled && !defined[index]) additions.push(tool(ctx.tools[index]));
      defined[index] ||= enabled;
    });
    if (additions.length) {
      assert(selected.additional_tools, 'profile does not support added definitions');
      history.push({type: 'additional_tools', role: 'developer', tools: additions});
    }
    if (loaded.residency === 'resident') history.push(message('developer',
      new TextDecoder('utf-8', {fatal: true, ignoreBOM: true}).decode(object(ctx, loaded.resource, 32 * 1024)), selected.explicit_cache));
  }
  const input = [...history];
  for (const loaded of request.plan.skills) if (loaded.residency === 'transient' && loaded.active) input.push(message('developer',
    new TextDecoder('utf-8', {fatal: true, ignoreBOM: true}).decode(object(ctx, loaded.resource, 32 * 1024)), false));
  assert(input.length <= 8192, 'history capacity');
  return {history, input, coreTools, priorResponseId: sameEpoch ? previous.response_id : null, priorRequest: previous?.source_request ?? null};
}
