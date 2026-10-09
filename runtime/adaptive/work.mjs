import assert from 'node:assert/strict';
import {normalizeAdaptiveOutput} from './responses.mjs';
import {object, digest, same} from './admission.mjs';
import {open as openContext} from './context.mjs';
import {canonical, parse} from './json.mjs';
import {list, read} from './snapshot.mjs';

export const reference = bytes => ({digest: digest(bytes), bytes: bytes.length});
export function open(ctx, ref) {
  const record = ctx.codec.decode('WorkArtifact', object(ctx, ref, 128 * 1024));
  assert(record.version === 1 && same(record.task, ctx.task) && same(record.policy, digest(ctx.profile)), 'invalid work artifact');
  return record;
}
export function evidence(ctx, ref) {
  const item = open(ctx, ref.object).evidence;
  assert(item && same(item.snapshot, ref.snapshot) && item.path === ref.path && item.sha256 === ref.sha256 &&
    BigInt(item.start) === BigInt(ref.start) && BigInt(item.end) === BigInt(ref.end) && BigInt(item.file_bytes) === BigInt(ref.file_bytes), 'invalid evidence');
  return item;
}
export function verifyEvidence(ctx, item) {
  const file = ctx.snapshot.get(item.path);
  assert(file && same(item.snapshot, ctx.snapshot.identity) && item.sha256 === Buffer.from(file.sha256).toString('hex') &&
    BigInt(item.start) <= BigInt(item.end) && BigInt(item.end) <= BigInt(file.contents.length) &&
    BigInt(item.file_bytes) === BigInt(file.contents.length) && BigInt(item.end) - BigInt(item.start) <= 4096n &&
    same(Buffer.from(item.content), file.contents.subarray(Number(item.start), Number(item.end))), 'invalid evidence');
}

export function capturedCall(ctx, ref, callId) {
  const context = openContext(ctx, ref, ctx.policy.audience);
  const prepared = ctx.codec.decode('AdaptivePrepared', object(ctx, context.source_request, 2 * 1024 * 1024));
  const raw = ctx.codec.decode('CapturedResponse', object(ctx, context.source_capture, 4 * 1024 * 1024));
  const normalized = normalizeAdaptiveOutput(ctx.codec, prepared.request.invocation, parse(raw.body, 512 * 1024).output);
  assert.equal(normalized.tag, 'output', 'invalid source capture');
  const calls = normalized.value.items.filter(item => item.tag === 'function_call' && item.value.call_id === callId);
  assert.equal(calls.length, 1, 'missing or duplicate captured call');
  const call = calls[0].value;
  assert(prepared.request.offered[call.tool_ordinal_claim] === true && call.decoded_action.tag === 'decoded', 'unoffered or undecodable call');
  return {context, action: call.decoded_action.value};
}

export function prepare(ctx, bytes, inspection = false) {
  const request = ctx.codec.decode('WorkRequest', bytes);
  assert.equal(request.action.tag === 'inspect', inspection, 'wrong resource role');
  const {action} = capturedCall(ctx, request.context, request.call_id);
  const expected = request.action.tag === 'inspect' ? {tag: 'inspect', value: {evidence_index: request.action.value.evidence_index}} : request.action;
  assert(same(ctx.codec.encode('Action', expected), ctx.codec.encode('Action', action)), 'captured action mismatch');
  const record = {version: 1, task: ctx.task, policy: digest(ctx.profile), context: request.context, call_id: request.call_id,
    request: request.action, outcome: null, evidence: null, model_text: ''};
  if (request.action.tag === 'list') {
    const result = list(ctx.snapshot, request.action.value);
    record.outcome = {tag: 'list', value: {request: request.action.value, result}};
    record.model_text = canonical(ctx.codec.toClient('Listing', result)).toString();
  } else if (request.action.tag === 'read') {
    const result = read(ctx.snapshot, request.action.value);
    record.outcome = {tag: 'read', value: {request: request.action.value, result}};
    record.evidence = result.tag === 'found' ? result.value : null;
    record.model_text = canonical(ctx.codec.toClient('ReadResult', result)).toString();
  } else {
    const item = evidence(ctx, request.action.value.evidence); verifyEvidence(ctx, item);
    const guard_count = item.content.split('\n').filter(line => line.includes('if (') || line.includes('assert(')).length;
    const evidence_index = request.action.value.evidence_index;
    record.outcome = {tag: 'inspect', value: {evidence_index, guard_count}};
    record.model_text = `Observed ${guard_count} lines containing if/assert syntax in evidence ${evidence_index}. This lexical observation is not a correctness proof.`;
  }
  return ctx.codec.encode('WorkArtifact', record);
}
export function interpret(ctx, request, prepared, captured, inspection = false) {
  assert(same(prepared, captured) && same(prepare(ctx, request, inspection), prepared), 'invalid work capture');
  const record = ctx.codec.decode('WorkArtifact', prepared), ref = reference(prepared);
  const item = record.evidence;
  const evidence = item === null ? null : {object: ref, snapshot: item.snapshot, path: item.path, sha256: item.sha256,
    start: item.start, end: item.end, file_bytes: item.file_bytes};
  return {reply: ctx.codec.encode('WorkReply', {artifact: ref, evidence}), objects: [prepared], output_tokens: null};
}
