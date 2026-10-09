// Adaptive capture preparation and pure interpretation for the JS environment.
import assert from 'node:assert/strict';
import {decodeModelInvocation, normalizeOpenAIResponses, admitModelEndpoint, parseJsonStrict} from '../model.mjs';
import {request as httpsRequest} from 'node:https';
import {X509Certificate} from 'node:crypto';
import {policy, catalog, bind, digest, same, identities} from './admission.mjs';
import {render, replayItem, pending} from './context.mjs';
import {parse, canonical, integer} from './json.mjs';

function admitted(ctx, bytes) {
  const request = ctx.codec.decode('AdaptiveRequest', bytes);
  assert(ctx.profile.length <= 256 * 1024, 'policy capacity');
  const profile = parseJsonStrict(new TextDecoder('utf-8', {fatal: true, ignoreBOM: true}).decode(ctx.profile));
  const frozen = policy(ctx.codec, ctx.codec.fromClient('Policy', profile.adaptive));
  const skills = catalog(ctx, frozen);
  const selected = bind(ctx, frozen, request, skills);
  return {request, frozen, skills, selected};
}

export function prepare(ctx, bytes) {
  const {request, frozen, skills, selected} = admitted(ctx, bytes);
  const projected = render(ctx, request, frozen, selected, skills);
  const allowed = ctx.tools.filter((_tool, index) => request.offered[index]).map(tool => ({type: 'function', name: tool.name}));
  const selection = request.invocation.selection;
  let toolChoice = 'none';
  if (selection.maximum_calls === 0 || !allowed.length) assert.equal(selection.minimum_calls, 0);
  else toolChoice = {type: 'allowed_tools', mode: selection.minimum_calls === 1 ? 'required' : 'auto', tools: allowed};
  const body = {
    model: selected.model, input: projected.input, tools: projected.coreTools,
    max_output_tokens: selected.max_output_tokens,
    reasoning: {effort: request.invocation.parameters.reasoning.effort, mode: selected.reasoning_mode, context: selected.reasoning_context},
    tool_choice: toolChoice, parallel_tool_calls: false, store: false, stream: false, background: false, truncation: 'disabled',
  };
  if (selected.explicit_cache) body.prompt_cache_options = {mode: 'explicit', ttl: '30m',
    ...(selected.cache_diagnostics && projected.priorResponseId !== null ? {comparison_response_id: projected.priorResponseId} : {})};
  return ctx.codec.encode('AdaptivePrepared', {version: 1, request, body: canonical(body, selected.request_bytes)});
}

// The execution owner must durably charge and record dispatch before calling
// acquire, and retain captured bytes before calling interpret. No automatic
// repeat is performed, including after an unknown transport outcome.
export async function acquire(ctx, preparedBytes, options) {
  let prepared, frozen, selected;
  try {
    prepared = ctx.codec.decode('AdaptivePrepared', preparedBytes);
    assert.equal(prepared.version, 1);
    const requestBytes = ctx.codec.encode('AdaptiveRequest', prepared.request);
    ({frozen, selected} = admitted(ctx, requestBytes));
    assert(same(prepare(ctx, requestBytes), preparedBytes));
    assert(options?.enabled === true && typeof options.token === 'string' && /^[\x21-\x7e]{1,4096}$/.test(options.token));
    assert.equal(options.endpoint, frozen.endpoint);
    if (options.testTrustRoot === undefined) admitModelEndpoint(options.endpoint, true);
    else {
      const endpoint = new URL(options.endpoint);
      assert(endpoint.protocol === 'https:' && ['localhost', '127.0.0.1', '[::1]'].includes(endpoint.hostname));
      assert(options.testTrustRoot instanceof Uint8Array && options.testTrustRoot.length > 0 && options.testTrustRoot.length <= 64 * 1024);
    }
    assert(!options.signal?.aborted);
  } catch (error) { return {kind: 'definitely_not_sent', error: error.code ?? 'InvalidAcquisition'}; }
  return new Promise(resolve => {
    let sent = false, settled = false, timer;
    const finish = value => { if (settled) return; settled = true; clearTimeout(timer); resolve(value); };
    let req;
    try {
      req = httpsRequest(frozen.endpoint, {
        method: 'POST', agent: false, signal: options.signal,
        ...(options.testTrustRoot === undefined ? {} : {ca: new X509Certificate(options.testTrustRoot).toString()}),
        headers: {authorization: `Bearer ${options.token}`, 'content-type': 'application/json', 'accept-encoding': 'identity',
          'content-length': prepared.body.length},
      }, response => {
        const chunks = []; let length = 0;
        const fail = code => { finish({kind: 'unknown', error: code}); response.destroy(); req.destroy(); };
        const declared = response.headers['content-length'];
        if (declared !== undefined && (!/^\d+$/.test(declared) || BigInt(declared) > BigInt(selected.response_bytes))) return fail('ResponseCapacity');
        const ids = [];
        for (let i = 0; i < response.rawHeaders.length; i += 2) if (response.rawHeaders[i].toLowerCase() === 'x-request-id') ids.push(response.rawHeaders[i + 1]);
        if (ids.length > 1 || (ids.length && Buffer.byteLength(ids[0]) > 256)) return fail('InvalidResponseIdentifier');
        response.on('data', bytes => {
          length += bytes.length;
          if (length > selected.response_bytes) return fail('ResponseCapacity');
          chunks.push(bytes);
        });
        response.on('error', () => fail('TruncatedResponse'));
        response.on('end', () => {
          if (!response.complete || (declared !== undefined && BigInt(length) !== BigInt(declared))) return fail('TruncatedResponse');
          try {
            finish({kind: 'captured', bytes: ctx.codec.encode('CapturedResponse', {status: response.statusCode,
              identity_encoding: response.headers['content-encoding'] === undefined || response.headers['content-encoding'] === 'identity',
              request_id: ids[0] ?? null, body: Buffer.concat(chunks, length)})});
          } catch { fail('InvalidCapture'); }
        });
      });
      req.on('error', () => finish({kind: sent ? 'unknown' : 'definitely_not_sent', error: 'TransportInterrupted'}));
      timer = setTimeout(() => { finish({kind: sent ? 'unknown' : 'definitely_not_sent', error: 'Timeout'}); req.destroy(); }, selected.timeout_ms);
      sent = true;
      req.end(prepared.body);
    } catch { req?.destroy(); finish({kind: sent ? 'unknown' : 'definitely_not_sent', error: 'TransportUnavailable'}); }
  });
}

export function usage(body) {
  let valid = true;
  const count = value => {
    if (value === undefined || value === null) return null;
    try { return integer(value); } catch { valid = false; return null; }
  };
  const detail = (value, key) => {
    if (value === undefined || value === null) return null;
    if (typeof value !== 'object' || Array.isArray(value)) { valid = false; return null; }
    return count(value[key]);
  };
  const value = body?.usage;
  if (value === undefined || value === null) return {value: null, valid};
  if (typeof value !== 'object' || Array.isArray(value)) return {value: null, valid: false};
  const observed = {input_tokens: count(value.input_tokens), output_tokens: count(value.output_tokens),
    cached_input_tokens: detail(value.input_tokens_details, 'cached_tokens'), cache_write_tokens: detail(value.input_tokens_details, 'cache_write_tokens'),
    reasoning_tokens: detail(value.output_tokens_details, 'reasoning_tokens')};
  if (observed.input_tokens !== null && (observed.cached_input_tokens ?? 0n) + (observed.cache_write_tokens ?? 0n) > observed.input_tokens) valid = false;
  if (observed.output_tokens !== null && (observed.reasoning_tokens ?? 0n) > observed.output_tokens) valid = false;
  return {value: observed, valid};
}

export function interpret(ctx, requestBytes, preparedBytes, capturedBytes) {
  assert(same(prepare(ctx, requestBytes), preparedBytes), 'capture preparation mismatch');
  const {request, frozen, skills, selected} = admitted(ctx, requestBytes);
  const raw = ctx.codec.decode('CapturedResponse', capturedBytes);
  const encode = (result, observed = null, replay = null, status = 'unsupported', objects = []) => ({
    reply: ctx.codec.encode('AdaptiveResult', {result, replay, replay_status: status, usage: observed}),
    objects, output_tokens: observed?.output_tokens ?? null,
  });
  const unsupported = (reason, observed = null) => encode({tag: 'unsupported_response', value: reason}, observed, null,
    reason === 'normalization_limit' ? 'capacity' : 'unsupported');
  if (raw.status < 200 || raw.status >= 300) return encode({tag: 'provider_failure', value: {kind: 'http_status', http_status: raw.status}});
  if (!raw.identity_encoding) return unsupported('unsupported_output_item');
  try { new TextDecoder('utf-8', {fatal: true, ignoreBOM: true}).decode(raw.body); }
  catch { return unsupported('invalid_utf8'); }
  let body;
  try { body = parse(raw.body, selected.response_bytes); }
  catch (error) { return unsupported(/capacity/.test(error.message) ? 'normalization_limit' : 'malformed_json'); }
  const observed = usage(body);
  if (body?.status === 'failed' || body?.status === 'incomplete') return encode({tag: 'provider_failure', value: {
    kind: body.status === 'failed' ? 'response_failed' : 'response_incomplete', http_status: 0}}, observed.value);
  if (body?.status !== 'completed' || body.error !== null) return unsupported('unsupported_status', observed.value);
  if (!Array.isArray(body.output)) return unsupported('unsupported_output_item', observed.value);
  const invocation = decodeModelInvocation(ctx.codec.encode('Invocation', request.invocation));
  if (body.output.length > invocation.normalizationLimits.maximumOutputItems) return unsupported('normalization_limit', observed.value);
  const normalized = ctx.codec.decode('ModelResult', normalizeOpenAIResponses(raw.body, invocation.normalizationLimits, invocation.tools));
  if (normalized.tag === 'unsupported_response' || normalized.tag === 'provider_failure') return encode(normalized, observed.value, null,
    normalized.value === 'normalization_limit' ? 'capacity' : 'unsupported');
  if (!observed.valid) return unsupported('unsupported_output_item', observed.value);
  const projected = render(ctx, request, frozen, selected, skills);
  try { projected.history.push(...body.output.map(replayItem)); pending(projected.history); }
  catch { return unsupported('unsupported_output_item', observed.value); }
  let items;
  try { items = canonical(projected.history, 2 * 1024 * 1024); }
  catch { return unsupported('normalization_limit', observed.value); }
  const responseId = body.id ?? null;
  if (Object.hasOwn(body, 'id') && (typeof body.id !== 'string' || !body.id.length || Buffer.byteLength(body.id) > 256)) return unsupported('unsupported_output_item', observed.value);
  const watermark = BigInt(request.plan.watermark) + 1n;
  assert(watermark <= (1n << 64n) - 1n);
  const ref = bytes => ({digest: digest(bytes), bytes: bytes.length});
  const artifact = ctx.codec.encode('AdaptiveContext', {
    schema: identities.context, policy: request.policy, task: ctx.task, tenant: ctx.tenant, audience: frozen.audience,
    selection: request.selection, top_effort: request.invocation.parameters.reasoning.effort, plan: request.plan, watermark,
    source_capture: ref(capturedBytes), source_request: ref(preparedBytes), response_id: responseId, items,
  });
  if (artifact.length > 2 * 1024 * 1024) return unsupported('normalization_limit', observed.value);
  return encode(normalized, observed.value, {object: ref(artifact), schema: identities.context, policy: request.policy,
    selection: request.selection.profile_digest, task: ctx.task, tenant: ctx.tenant, audience: frozen.audience,
    epoch: request.plan.epoch, watermark, eviction_generation: request.plan.eviction_generation}, 'complete', [artifact]);
}
