// Independent, read-only observations of native captures and controlled HTTPS.
// No execution, admission, prompt rendering, provider interpretation or recovery.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdirSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {decodeSchema, encodeValue} from '../../runtime/values.mjs';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
export function contract(application, name) {
  const entry = application.support[name], bytes = Buffer.from(entry.wire_base64url, 'base64url');
  assert.equal(bytes.toString('base64url'), entry.wire_base64url);
  assert.equal(hash(bytes), entry.wire_sha256);
  return decodeSchema(bytes);
}
const ordered = value => Array.isArray(value) ? value.map(ordered) : value && typeof value === 'object' ?
  Object.fromEntries(Object.keys(value).sort().map(key => [key, ordered(value[key])])) : value;
const canonical = value => Buffer.from(JSON.stringify(ordered(value)));
const presence = (value, key) => !Object.hasOwn(value, key) ? 'absent' : value[key] === null ? 'null' : 'reported';
const optional = value => value.tag === 0 ? null : value.value;
const count = value => Number.isSafeInteger(value) && value >= 0 ? String(value) : null;
const text = (value, maximum) => typeof value === 'string' && value.isWellFormed() && Buffer.byteLength(value) <= maximum ? value : null;
const efforts = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'];
const reasons = ['initial', 'model_change', 'effort_change', 'eviction', 'capacity_handoff'];
const names = ['list', 'read', 'ask', 'report', 'stop', 'inference_set', 'skill_set', 'inspect'];
const usageNames = ['input_tokens', 'output_tokens', 'cached_input_tokens', 'cache_write_tokens', 'reasoning_tokens'];
function markers(body) {
  return body.input.flatMap((item, index) => {
    const field = item.type === 'function_call_output' ? 'output' : 'content';
    return Array.isArray(item[field]) ? item[field].flatMap((part, n) => part.prompt_cache_breakpoint?.mode === 'explicit' ? [`input[${index}].${field}[${n}]`] : []) : [];
  });
}
function visible(body) {
  // Explicit local ordering, not the provider's hidden prompt or token prefix.
  const settings = {model: body.model, reasoning: body.reasoning, parallel_tool_calls: body.parallel_tool_calls,
    text: body.text ?? null, service_tier: body.service_tier ?? null, context_management: body.context_management ?? null};
  return Buffer.concat([settings, body.tools, ...body.input].flatMap(value => [canonical(value), Buffer.from('\n')]));
}
function prefix(left, right) {
  if (!left) return 0;
  let n = 0; while (n < left.length && n < right.length && left[n] === right[n]) n++;
  return n;
}

export function measureAdaptive(application, rows, skillBodies, resources = {}) {
  // Positional fields are independently specified by the ordinary v6 contracts.
  rows.sort((a, b) => Number(a.request[3][2] - b.request[3][2]));
  const toolsSchema = contract(application, 'Tools');
  const calls = rows.map((row, index) => {
    const [invocation, policy, selection, plan, materialized, offered] = row.request;
    const [epoch, reason, watermark, eviction, , , , skills] = plan;
    const prior = rows[index - 1], sameEpoch = prior && prior.request[3][0] === epoch;
    const selectedMarkers = markers(row.http), priorMarkers = prior ? markers(prior.http) : [];
    // A logical epoch no longer replaces history. Existing breakpoints in an
    // unchanged prefix remain old writes even across model/eviction revisions.
    const newlyMarked = selectedMarkers.filter(path => {
      if (!prior || !priorMarkers.includes(path)) return true;
      const position = Number(path.match(/^input\[(\d+)\]/)[1]);
      return !canonical(row.http.input.slice(0, position + 1)).equals(canonical(prior.http.input.slice(0, position + 1)));
    });
    assert(newlyMarked.length <= 2);
    const definitions = invocation[4], offeredDefinitions = definitions.filter(tool => offered[names.indexOf(tool[2])]);
    assert.deepEqual(definitions.map(tool => tool[2]), names.filter((_, n) => materialized[n]));
    const usage = optional(row.reply[3]);
    const skillBytes = (residency, active) => String(skills.filter(skill => (residency === null || skill[3] === residency) && (!active || skill[4]))
      .reduce((total, skill) => total + skill[0][1], 0n));
    const diagnostics = row.response.prompt_cache_diagnostics;
    return {
      watermark: String(watermark), context_epoch: String(epoch), eviction_generation: String(eviction),
      lineage_break: !sameEpoch ? reasons[reason] : null,
      policy_sha256: Buffer.from(policy).toString('hex'), inference_profile_id: selection[0],
      inference_profile_sha256: Buffer.from(selection[1]).toString('hex'), control_revision: String(selection[3]),
      requested_model: row.http.model, returned_model: text(row.response.model, 128),
      returned_reasoning_context: text(row.response.reasoning?.context, 64),
      top_level_effort: row.http.reasoning.effort, effective_effort: efforts[selection[2]],
      request_bytes: row.requestBytes.length, response_bytes: row.responseBytes.length,
      prepared_bytes: row.preparedBytes.length, captured_bytes: row.capturedBytes.length,
      request_ms: row.request_ms, http_status: row.http_status,
      active_skill_bytes: skillBytes(null, true), resident_skill_bytes: skillBytes(0, false), transient_skill_bytes: skillBytes(1, true),
      materialized_definitions_sha256: hash(encodeValue(toolsSchema, definitions)), offered_set_sha256: hash(encodeValue(toolsSchema, offeredDefinitions)),
      materialized_names: names.filter((_, n) => materialized[n]), offered_names: names.filter((_, n) => offered[n]),
      marker_positions: selectedMarkers, lookup_positions: [...new Set([...selectedMarkers.slice(0, 2), ...selectedMarkers.slice(-50)])],
      newly_marked_positions: newlyMarked, local_visible_prefix_bytes: prefix(prior && visible(prior.http), visible(row.http)),
      local_prefix_scope: 'canonical visible settings, core definitions and chronological input; not tokens or provider cache evidence',
      usage_presence: presence(row.response, 'usage'),
      usage: usage === null ? null : Object.fromEntries(usageNames.map((name, n) => [name, optional(usage[n]) === null ? null : String(usage[n].value)])),
      usage_source: 'committed native AdaptiveResult; scalar admission independently tested in Zig',
      cache_diagnostics: {presence: presence(row.response, 'prompt_cache_diagnostics'), type: text(diagnostics?.type, 64), reason: text(diagnostics?.reason, 64),
        comparison_reusable_tokens: count(diagnostics?.comparison_reusable_tokens), cache_missed_tokens: count(diagnostics?.cache_missed_tokens),
        count_scope: 'exact safe JSON integers only; unrepresentable diagnostic counters are unavailable'},
      billed_cost: null,
    };
  });
  const textMessage = text => ({role: 'developer', content: [{type: 'input_text', text}]});
  const layouts = {projected: [], eager: [], naive: []};
  for (const row of rows) {
    const retained = row.http.input.filter(item => !(item.role === 'developer' && item.content?.length === 1 &&
      skillBodies.some(skill => item.content[0]?.text === skill.body)));
    const current = row.request[3][7].filter(skill => skill[3] === 0 || skill[4]).map(skill => skillBodies.find(body => body.id === skill[1]).body);
    layouts.projected.push(row.http);
    layouts.eager.push({...row.http, input: [retained[0], ...skillBodies.map(skill => textMessage(skill.body)), ...retained.slice(1)]});
    layouts.naive.push({...row.http, input: [retained[0], ...(current.length ? [textMessage(`Current skill instructions:\n${current.join('\n')}`)] : []), ...retained.slice(1)]});
  }
  const comparison = Object.entries(layouts).map(([policy, inputs]) => {
    let prior = null, common = 0;
    const sizes = inputs.map((body, index) => {
      assert.deepEqual(body.tool_choice, rows[index].http.tool_choice);
      const value = visible(body); common += prefix(prior, value); prior = value;
      return policy === 'projected' ? rows[index].requestBytes.length : canonical(body).length;
    });
    return {policy, recorded_requests: inputs.length, additional_inferences: 0, request_bytes: sizes,
      total_request_bytes: sizes.reduce((sum, size) => sum + size, 0), summed_local_visible_prefix_bytes: common,
      actual_execution: policy === 'projected' ? 'controlled native fixture' : 'not executed',
      hard_eviction: policy === 'projected' ? 'qualified by native task trace' : policy === 'eager' ? 'fails by retaining all approved bodies' : 'body exclusion only; changed prompt behavior unqualified',
      cache_hits: null, billed_cost: null};
  });
  const transientIndices = rows.flatMap((row, index) => row.request[3][7].some(skill => skill[3] === 1 && skill[4]) ? [index] : []);
  assert(transientIndices.length >= 2 && transientIndices.at(-1) < rows.length - 1);
  const active = rows[transientIndices[0]].request[3][7].find(skill => skill[3] === 1 && skill[4]);
  const transientBody = skillBodies.find(skill => skill.id === active[1]).body;
  for (const index of transientIndices) {
    const body = rows[index].http, position = body.input.findIndex(item => item.content?.some(part => part.text === transientBody));
    assert(position >= 0 && markers(body).every(path => Number(path.match(/^input\[(\d+)\]/)[1]) < position));
  }
  assert(calls[transientIndices[1]].local_visible_prefix_bytes < visible(rows[transientIndices[0]].http).length);
  const contains = value => typeof value === 'string' ? value.includes(transientBody) : value && typeof value === 'object' ? Object.values(value).some(contains) : false;
  assert(!contains(rows[transientIndices.at(-1) + 1].http));
  const report = {format: 'adaptive-observations/v1', source_head: process.env.GITHUB_SHA ?? null,
    scope_authority: '2026-10-09 authored Boundary program / World execution amendment',
    qualification: 'controlled native workload; no live provider or cache measurements',
    comparison_scope: 'same recorded work, provider replies and offers; alternatives are unexecuted byte-layout counterfactuals',
    prewarm_requests: 0, compaction_requests: 0, physical_model_attempts: rows.length, calls, comparison, resources};
  if (process.env.AGENT4_BUILD_PREFIX) {
    mkdirSync(process.env.AGENT4_BUILD_PREFIX, {recursive: true});
    writeFileSync(join(process.env.AGENT4_BUILD_PREFIX, 'adaptive-observations.json'), JSON.stringify(report, null, 2) + '\n');
  }
  return report;
}
