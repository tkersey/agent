// Read-only measurements from immutable captures. These values never select a
// model, change a projection, authorize a retry, or infer a provider cache hit.
import {hash} from './codec.mjs';
import {parse, canonical, integer} from './json.mjs';
import {usage} from './responses.mjs';

const presence = (value, key) => !value || !Object.hasOwn(value, key) ? 'absent' : value[key] === null ? 'null' : 'reported';
const boundedText = (value, maximum) => typeof value === 'string' && value.isWellFormed() && Buffer.byteLength(value) <= maximum ? value : null;
function count(value) { if (value === undefined || value === null) return null; try { return String(integer(value)); } catch { return null; } }
export function diagnostics(body) {
  const disposition = presence(body, 'prompt_cache_diagnostics');
  if (disposition !== 'reported') return {presence: disposition, type: null, reason: null, comparison_reusable_tokens: null, cache_missed_tokens: null};
  const value = body.prompt_cache_diagnostics;
  const type = ['cache_hit', 'cache_miss', 'comparison_response_not_found', 'unavailable'].includes(value?.type) ? value.type : 'unrecognized';
  const reasons = ['model_changed', 'prompt_cache_key_changed', 'service_tier_changed', 'tools_changed', 'text_format_changed',
    'reasoning_effort_changed', 'verbosity_changed', 'context_compacted', 'input_changed'];
  return {presence: disposition, type, reason: reasons.includes(value?.reason) ? value.reason : value?.reason === undefined ? null : 'unrecognized',
    comparison_reusable_tokens: count(value?.comparison_reusable_tokens), cache_missed_tokens: count(value?.cache_missed_tokens)};
}
export function markers(body) {
  const result = [];
  for (const [index, item] of (body.input ?? []).entries()) {
    const name = item.type === 'function_call_output' ? 'output' : 'content';
    const parts = item[name]; if (!Array.isArray(parts)) continue;
    for (const [part, value] of parts.entries()) if (value?.prompt_cache_breakpoint?.mode === 'explicit') result.push(`input[${index}].${name}[${part}]`);
  }
  return result;
}

// A reversible local diagnostic ordering, not OpenAI's hidden rendered prompt:
// cache-affecting visible settings, core definitions, then chronological items.
export function visibleProjection(body) {
  const settings = {model: body.model, reasoning: body.reasoning ?? null, parallel_tool_calls: body.parallel_tool_calls ?? null,
    text: body.text ?? null, service_tier: body.service_tier ?? null, context_management: body.context_management ?? null};
  return Buffer.concat([settings, body.tools ?? [], ...(body.input ?? [])].flatMap(value => [canonical(value), Buffer.from('\n')]));
}
export function commonPrefix(left, right) {
  if (!left || !right) return 0;
  let index = 0; while (index < left.length && index < right.length && left[index] === right[index]) index++;
  return index;
}

export function observe(codec, preparedBytes, capturedBytes, {previous = null, requestMilliseconds = null} = {}) {
  const prepared = codec.decode('AdaptivePrepared', preparedBytes), request = prepared.request, body = parse(prepared.body, 256 * 1024);
  const raw = codec.decode('CapturedResponse', capturedBytes);
  let response = null;
  try { response = parse(raw.body, 512 * 1024); } catch {}
  const observed = response === null ? {value: null, valid: false} : usage(response);
  const tools = codec.constant('tools', 'Tools');
  const defined = tools.filter((_tool, index) => request.materialized[index]), offered = tools.filter((_tool, index) => request.offered[index]);
  const skillBytes = (kind, active) => String(request.plan.skills.filter(skill => (kind === null || skill.residency === kind) && (!active || skill.active))
    .reduce((total, skill) => total + BigInt(skill.resource.bytes), 0n));
  const selectedMarkers = markers(body), previousPrepared = previous ? codec.decode('AdaptivePrepared', previous) : null;
  const previousBody = previousPrepared ? parse(previousPrepared.body, 256 * 1024) : null;
  const previousMarkers = previousBody ? markers(previousBody) : [];
  const sameEpoch = previousPrepared !== null && BigInt(previousPrepared.request.plan.epoch) === BigInt(request.plan.epoch);
  return {
    watermark: String(request.plan.watermark), context_epoch: String(request.plan.epoch), eviction_generation: String(request.plan.eviction_generation),
    lineage_break: previousPrepared === null || !sameEpoch ? request.plan.reason : null,
    policy_sha256: Buffer.from(request.policy).toString('hex'), inference_profile_id: request.selection.profile_id,
    inference_profile_sha256: Buffer.from(request.selection.profile_digest).toString('hex'), control_revision: String(request.selection.control_revision),
    requested_model: body.model, returned_model: boundedText(response?.model, 128), returned_reasoning_context: boundedText(response?.reasoning?.context, 64),
    top_level_effort: body.reasoning.effort, effective_effort: request.selection.effective_effort,
    request_bytes: prepared.body.length, response_bytes: raw.body.length, prepared_bytes: preparedBytes.length, captured_bytes: capturedBytes.length,
    request_ms: requestMilliseconds, http_status: raw.status,
    active_skill_bytes: skillBytes(null, true), resident_skill_bytes: skillBytes('resident', false), transient_skill_bytes: skillBytes('transient', true),
    materialized_definitions_sha256: hash(codec.encode('Tools', defined)), offered_set_sha256: hash(codec.encode('Tools', offered)),
    materialized_names: defined.map(tool => tool.name), offered_names: offered.map(tool => tool.name),
    marker_positions: selectedMarkers, lookup_positions: [...new Set([...selectedMarkers.slice(0, 2), ...selectedMarkers.slice(-50)])],
    newly_marked_positions: sameEpoch ? selectedMarkers.filter(position => !previousMarkers.includes(position)) : selectedMarkers,
    local_visible_prefix_bytes: previousBody ? commonPrefix(visibleProjection(previousBody), visibleProjection(body)) : 0,
    local_prefix_scope: 'visible settings, core definitions and chronological input; not token counts, hidden prompt identity or provider cache evidence',
    usage_presence: response === null ? 'unavailable' : presence(response, 'usage'), usage_valid: observed.valid,
    usage: observed.value === null ? null : Object.fromEntries(Object.entries(observed.value).map(([key, value]) => [key, value === null ? null : String(value)])),
    cache_diagnostics: diagnostics(response), billed_cost: null,
  };
}
