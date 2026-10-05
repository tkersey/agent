import assert from "node:assert/strict";
import { test } from "node:test";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { modelBinding } from "../../runtime/mobility/model.mjs";

import {
  MODEL_EFFECT,
  REPLAY_MODEL_EFFECT,
  MAXIMUM_REPLAY_BYTES,
  decodeReplayModelInvocation,
  performReplayModelInvocation,
  admitModelEndpoint,
  decodeModelInvocation,
  encodeOpenAIResponsesRequest,
  normalizeOpenAIResponses,
  performModelInvocation,
} from "../../runtime/model.mjs";

const limits = Object.freeze({
  maximumOutputItems: 32,
  maximumCallIdBytes: 256,
  maximumNameBytes: 64,
  maximumArgumentsBytes: 32 * 1024,
  maximumArgumentNameBytes: 256,
  maximumArgumentFields: 64,
  maximumResultTextBytes: 32 * 1024,
});

test("credentialed transport is bound to the exact OpenAI Responses endpoint", () => {
  assert.equal(
    admitModelEndpoint("https://api.openai.com/v1/responses", true).href,
    "https://api.openai.com/v1/responses",
  );
  assert.throws(
    () => admitModelEndpoint("https://example.com/v1/responses", true),
    /credentialed model endpoint must be the OpenAI Responses endpoint/,
  );
  assert.throws(
    () => admitModelEndpoint("http://127.0.0.1:9000/v1/responses", true),
    /credentialed model endpoint must be the OpenAI Responses endpoint/,
  );
  assert.equal(
    admitModelEndpoint("http://127.0.0.1:9000/v1/responses", false).href,
    "http://127.0.0.1:9000/v1/responses",
  );
});

test("declared oversized responses cancel their unread body", async () => {
  const originalFetch = globalThis.fetch;
  let cancelled = false;
  globalThis.fetch = async () => ({
    status: 200,
    headers: {
      get(name) {
        return name === "content-length" ? String(128 * 1024) : null;
      },
    },
    body: {
      async cancel() {
        cancelled = true;
      },
    },
  });
  try {
    await performModelInvocation(invocationBytes(), {
      endpoint: "http://127.0.0.1:1/v1/responses",
    });
    assert.equal(cancelled, true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("oversized HTTP failures retain their provider status class", async () => {
  const originalFetch = globalThis.fetch;
  let cancelled = false;
  globalThis.fetch = async () => ({
    status: 503,
    headers: { get: () => String(128 * 1024) },
    body: { async cancel() { cancelled = true; } },
  });
  try {
    const result = await performModelInvocation(invocationBytes(), {
      endpoint: "http://127.0.0.1:1/v1/responses",
    });
    assert.equal(cancelled, true);
    assert.equal(result[0], 3);
    assert.equal(result.readUInt16LE(5), 503);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("decodes one self-contained semantic invocation", () => {
  assert.equal(MODEL_EFFECT, "agent.model.invoke.v3");
  const invocation = decodeModelInvocation(invocationBytes());
  assert.equal(invocation.protocol, "agent.model.protocol.openai-responses-v2");
  assert.equal(invocation.model, "fixture-model");
  assert.deepEqual(invocation.messages, [{ role: "user", content: "decide" }]);
  assert.deepEqual(invocation.tools.map(({ inputSchemaJson, argumentCodec: _, ...tool }) => ({
    ...tool,
    inputSchemaJson: inputSchemaJson.toString("utf8"),
  })), [{
    actionOrdinal: 0,
    actionTag: 0,
    name: "choose",
    description: "Choose one value.",
    inputSchemaJson: '{"type":"object","properties":{"value":{"type":"integer"}},"required":["value"],"additionalProperties":false}',
    strict: true,
  }]);
  const request = JSON.parse(encodeOpenAIResponsesRequest(invocation));
  assert.equal(request.model, "fixture-model");
  assert.equal(request.tool_choice, "required");
  assert.equal(request.parallel_tool_calls, false);
  assert.deepEqual(request.tools.map((tool) => tool.name), ["choose"]);
});

test("zero offered tools use a non-required provider policy", () => {
  const invocation = decodeModelInvocation(noToolInvocationBytes());
  assert.deepEqual(invocation.tools, []);
  assert.equal(invocation.selection.minimumCalls, 0);
  const request = JSON.parse(encodeOpenAIResponsesRequest(invocation));
  assert.deepEqual(request.tools, []);
  assert.equal(request.tool_choice, "auto");
  assert.equal(request.parallel_tool_calls, false);
});

test("provider request preserves 64-bit schema bound lexemes", () => {
  const maximum = "18446744073709551615";
  const schema = `{"type":"object","properties":{"value":{"type":"integer","maximum":${maximum}}},"required":["value"],"additionalProperties":false}`;
  const request = encodeOpenAIResponsesRequest(
    decodeModelInvocation(invocationBytes(schema)),
  ).toString("utf8");
  assert(request.includes(`"maximum":${maximum}`));
  assert(!request.includes('"maximum":18446744073709552000'));
});

test("provider tool choice preserves zero, optional, and required call policies", () => {
  for (const [minimumCalls, maximumCalls, expected] of [
    [0, 0, "none"], [0, 1, "auto"], [1, 1, "required"], [0, 2, "auto"], [1, 2, "required"],
  ]) {
    const invocation = decodeModelInvocation(invocationBytes(undefined, 0, null,
      { minimumCalls, maximumCalls }));
    assert.equal(invocation.tools.length, 1);
    const request = JSON.parse(encodeOpenAIResponsesRequest(invocation));
    assert.equal(request.tool_choice, expected);
    assert.equal(request.tools[0].name, "choose");
  }
});

test("unsupported asynchronous response policies reject before provider I/O", async (t) => {
  const fetch = t.mock.method(globalThis, "fetch", async () => {
    throw new Error("unsupported policies must not perform I/O");
  });
  for (const [stream, background] of [[true, false], [false, true], [true, true]]) {
    const bytes = invocationBytes(undefined, 0, null, undefined,
      { store: false, stream, background });
    assert.throws(() => encodeOpenAIResponsesRequest(decodeModelInvocation(bytes)), /nonstreaming/);
    const result = await performModelInvocation(bytes, { endpoint: "http://127.0.0.1:1" });
    assert.deepEqual(result, Buffer.from([4, 1, 0, 0, 0]));
  }
  assert.equal(fetch.mock.callCount(), 0);
  const allowed = decodeModelInvocation(invocationBytes(undefined, 0, null, undefined,
    { store: true, stream: false, background: false }));
  assert.equal(JSON.parse(encodeOpenAIResponsesRequest(allowed)).store, true);
});

test("provider request preserves canonical temperature lexemes", () => {
  const temperature = "0.12345678901234567890123456789";
  const request = encodeOpenAIResponsesRequest(
    decodeModelInvocation(invocationBytes(undefined, 0, temperature)),
  ).toString("utf8");
  assert(request.includes(`"temperature":${temperature}`));
});

test("normalization preserves every call and ignores irrelevant envelope size", () => {
  const tools = decodeModelInvocation(invocationBytes()).tools;
  const output = [
    { type: "reasoning", summary: [{ type: "summary_text", text: "summary" }] },
    { type: "function_call", status: "completed", id: "fc1", call_id: "call1", name: "choose", arguments: '{"value":1}' },
    { type: "function_call", status: "completed", id: "fc2", call_id: "call2", name: "choose", arguments: '{"value":2}' },
  ];
  const small = Buffer.from(JSON.stringify({ status: "completed", error: null, output }));
  const large = Buffer.from(JSON.stringify({
    status: "completed",
    error: null,
    output,
    metadata: { irrelevant: "x".repeat(8 * 1024) },
  }));
  const normalizedSmall = normalizeOpenAIResponses(small, limits, tools);
  const normalizedLarge = normalizeOpenAIResponses(large, limits, tools);
  assert.deepEqual(normalizedLarge, normalizedSmall);
  assert.equal(normalizedSmall[0], 0);
  assert.equal(normalizedSmall[1], 3);
});

test("typed Action codec preserves raw bytes and rejects every structural violation", () => {
  const tools = decodeModelInvocation(invocationBytes()).tools;
  const decode = (argumentsText) => decodeSingleCall(normalizeOpenAIResponses(
    Buffer.from(JSON.stringify({
      status: "completed",
      error: null,
      output: [{
        type: "function_call",
        status: "completed",
        call_id: "call",
        name: "choose",
        arguments: argumentsText,
      }],
    })),
    limits,
    tools,
  ));

  const valid = decode('{"value":-2147483648}');
  assert.equal(valid.argumentsJson, '{"value":-2147483648}');
  assert.equal(valid.toolOrdinal, 0);
  assert.equal(valid.decodeTag, 0);
  assert.equal(valid.actionTag, 0);
  assert.equal(valid.i32, -2147483648);

  assert.equal(decode('{"value":1.0}').i32, 1);
  assert.equal(decode('{"value":1e0}').i32, 1);
  const hugeExponent = "9".repeat(24);
  assert.equal(decode(`{"value":0e${hugeExponent}}`).i32, 0);
  assert.equal(decode(`{"value":-0e${hugeExponent}}`).i32, 0);
  assert.equal(decode(`{"value":0e-${hugeExponent}}`).i32, 0);
  assert.notEqual(decode(`{"value":1e${hugeExponent}}`).failure, undefined);
  assert.notEqual(decode(`{"value":1e-${hugeExponent}}`).failure, undefined);

  assert.equal(decode('{"value":1,"value":2}').failure, 1);
  assert.equal(decode('{"value":1,"extra":2}').failure, 2);
  assert.equal(decode('{}').failure, 3);
  assert.equal(decode('{"value":"1"}').failure, 4);
  assert.equal(decode('{"value":2147483648}').failure, 5);
  assert.equal(decode('{"value":1,}').failure, 0);
});

test("typed Answer uses its declaration ordinal and preserves explicit enum payload tags", () => {
  const tools = decodeModelInvocation(enumInvocationBytes()).tools;
  const encoded = normalizeOpenAIResponses(Buffer.from(JSON.stringify({
    status: "completed",
    error: null,
    output: [{
      type: "function_call",
      status: "completed",
      call_id: "call",
      name: "abort",
      arguments: '{"value":"rejected"}',
    }],
  })), limits, tools);
  const decoded = decodeSingleCall(encoded);
  assert.equal(decoded.toolOrdinal, 0);
  assert.equal(tools[0].actionTag, 7);
  assert.equal(decoded.actionTag, 0);
  assert.equal(decoded.i32, 9);
});

test("malformed, duplicate, mixed refusal, and unsupported shapes fail typed", () => {
  const trailing = normalizeOpenAIResponses(
    Buffer.from('{"status":"completed","error":null,"output":[],}'),
    limits,
  );
  assert.equal(trailing[0], 4);
  assert.equal(trailing.readUInt32LE(1), 2);

  const duplicate = normalizeOpenAIResponses(
    Buffer.from('{"status":"completed","status":"completed","error":null,"output":[]}'),
    limits,
  );
  assert.equal(duplicate[0], 4);
  assert.equal(duplicate.readUInt32LE(1), 2);

  const mixed = normalizeOpenAIResponses(Buffer.from(JSON.stringify({
    status: "completed",
    error: null,
    output: [
      { type: "message", status: "completed", role: "assistant", content: [{ type: "refusal", refusal: "no" }] },
      { type: "function_call", status: "completed", call_id: "call", name: "choose", arguments: "{}" },
    ],
  })), limits);
  assert.equal(mixed[0], 4);
  assert.equal(mixed.readUInt32LE(1), 6);

  for (const refusal of [42, "x".repeat(limits.maximumResultTextBytes + 1)]) {
    const invalid = normalizeOpenAIResponses(Buffer.from(JSON.stringify({
      status: "completed",
      error: null,
      output: [{
        type: "message",
        status: "completed",
        role: "assistant",
        content: [{ type: "refusal", refusal }],
      }],
    })), limits);
    assert.equal(invalid[0], 4);
    assert.equal(invalid.readUInt32LE(1), 7);
  }

  const unfinished = normalizeOpenAIResponses(Buffer.from(JSON.stringify({
    status: "completed",
    error: null,
    output: [{
      type: "message",
      status: "in_progress",
      role: "assistant",
      content: [{ type: "refusal", refusal: "not terminal" }],
    }],
  })), limits);
  assert.equal(unfinished[0], 4);
  assert.equal(unfinished.readUInt32LE(1), 5);

  const reasonedRefusal = normalizeOpenAIResponses(Buffer.from(JSON.stringify({
    status: "completed",
    error: null,
    output: [
      { type: "reasoning", status: "completed", summary: [] },
      {
        type: "message",
        status: "completed",
        role: "assistant",
        content: [{ type: "refusal", refusal: "no" }],
      },
    ],
  })), limits);
  assert.equal(reasonedRefusal[0], 1);

  const multipartRefusal = normalizeOpenAIResponses(Buffer.from(JSON.stringify({
    status: "completed",
    error: null,
    output: [{
      type: "message",
      status: "completed",
      role: "assistant",
      content: [
        { type: "refusal", refusal: "first" },
        { type: "refusal", refusal: " second" },
      ],
    }],
  })), limits);
  assert.equal(multipartRefusal[0], 1);
  assert(multipartRefusal.includes(Buffer.from("first second")));

  const oversizedMultipartRefusal = normalizeOpenAIResponses(
    Buffer.from(JSON.stringify({
      status: "completed",
      error: null,
      output: [{
        type: "message",
        status: "completed",
        role: "assistant",
        content: [
          { type: "refusal", refusal: "x".repeat(limits.maximumResultTextBytes) },
          { type: "refusal", refusal: "x" },
        ],
      }],
    })),
    limits,
  );
  assert.equal(oversizedMultipartRefusal[0], 4);
  assert.equal(oversizedMultipartRefusal.readUInt32LE(1), 7);
});

test("reasoning normalization admits absent and multipart summaries", () => {
  const normalize = (summary) => normalizeOpenAIResponses(Buffer.from(JSON.stringify({
    status: "completed",
    error: null,
    output: [{ type: "reasoning", status: "completed", summary }],
  })), limits);
  const empty = normalize([]);
  assert.equal(empty[0], 0);
  assert.equal(empty[1], 1);
  const multipart = normalize([
    { type: "summary_text", text: "first" },
    { type: "summary_text", text: "second" },
  ]);
  assert(multipart.includes(Buffer.from("first\nsecond")));
});

test("message normalization preserves ordered multipart output text", () => {
  const normalized = normalizeOpenAIResponses(Buffer.from(JSON.stringify({
    status: "completed",
    error: null,
    output: [{
      type: "message",
      status: "completed",
      role: "assistant",
      content: [
        { type: "output_text", text: "first", annotations: [] },
        { type: "output_text", text: " second", annotations: [] },
      ],
    }],
  })), limits);
  assert.equal(normalized[0], 0);
  assert(normalized.includes(Buffer.from("first second")));

  const missingText = normalizeOpenAIResponses(Buffer.from(JSON.stringify({
    status: "completed",
    error: null,
    output: [{
      type: "message",
      status: "completed",
      role: "assistant",
      content: [{ type: "output_text", annotations: [] }],
    }],
  })), limits);
  assert.equal(missingText[0], 4);
  assert.equal(missingText.readUInt32LE(1), 5);
});

test("normalization rejects lone surrogates in every semantic Text field", () => {
  const tools = decodeModelInvocation(invocationBytes()).tools;
  const lone = "\ud800";
  const cases = [
    [{ type: "function_call", status: "completed", call_id: lone, name: "choose", arguments: '{"value":1}' }, tools],
    [{ type: "function_call", status: "completed", call_id: "call", name: lone, arguments: '{"value":1}' }, tools],
    [{ type: "function_call", status: "completed", call_id: "call", name: "choose", arguments: `{"value":"${lone}"}` }, tools],
    [{ type: "message", status: "completed", role: "assistant", content: [{ type: "output_text", text: lone, annotations: [] }] }, []],
    [{ type: "message", status: "completed", role: "assistant", content: [{ type: "refusal", refusal: lone }] }, []],
    [{ type: "reasoning", status: "completed", summary: [{ type: "summary_text", text: lone }] }, []],
  ];
  for (const [item, offeredTools] of cases) {
    const normalized = normalizeOpenAIResponses(Buffer.from(JSON.stringify({
      status: "completed",
      error: null,
      output: [item],
    })), limits, offeredTools);
    assert.equal(normalized[0], 4);
    assert.equal(normalized.readUInt32LE(1), 3);
  }
});

test("model invocation rejects malformed and noncanonical Boundary 2 values before I/O", async () => {
  const valid = invocationBytes();
  const badUtf8 = Buffer.from(valid);
  badUtf8[1] = 0xff;
  const noncanonicalLength = Buffer.concat([
    Buffer.from([valid[0] | 0x80, 0]), valid.subarray(1),
  ]);
  for (const invalid of [
    Buffer.from([0x80]),
    Buffer.from([0xff, 0xff, 0xff, 0xff, 0x10]),
    noncanonicalLength,
    badUtf8,
    valid.subarray(0, valid.length - 1),
    Buffer.concat([valid, Buffer.from([0])]),
  ]) {
    assert.throws(() => decodeModelInvocation(invalid));
  }
  // Optional sums remain one-byte minimal ordinals; neither a wider encoding
  // nor another variant may be interpreted as absent or present.
  const parametersAt = text("agent.model.protocol.openai-responses-v2").length + text("fixture-model").length;
  for (const tag of [2, 0x80]) {
    const invalid = Buffer.from(valid);
    invalid[parametersAt] = tag;
    assert.throws(() => decodeModelInvocation(invalid), /optional tag/);
  }
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => { calls += 1; throw new Error("unexpected I/O"); };
  try {
    await assert.rejects(performModelInvocation(noncanonicalLength, {
      endpoint: "http://127.0.0.1:1/v1/responses",
    }), { code: "NonCanonical" });
    await assert.rejects(performModelInvocation(valid, {
      endpoint: "http://127.0.0.1:1/v1/responses", retry: true,
    }), /unknown model transport option: retry/);
    assert.equal(calls, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("portable typed claims preserve 64-bit boundaries and declaration ordinals beyond 31", () => {
  const codec = [
    { name: "signed", kind: 1, bitWidth: 64, maximumBytes: 0, enumNames: [], enumTags: [] },
    { name: "unsigned", kind: 2, bitWidth: 64, maximumBytes: 0, enumNames: [], enumTags: [] },
    { name: "enabled", kind: 3, bitWidth: 0, maximumBytes: 0, enumNames: [], enumTags: [] },
    { name: "text", kind: 0, bitWidth: 0, maximumBytes: 1024, enumNames: [], enumTags: [] },
  ];
  const tools = decodeModelInvocation(encodeInvocationFixture({ tools: [{
    actionOrdinal: 63, actionTag: 4095, name: "answer", description: "Answer a typed question.",
    schemaText: '{"type":"object","properties":{"signed":{"type":"integer"},"unsigned":{"type":"integer"},"enabled":{"type":"boolean"},"text":{"type":"string"}},"required":["signed","unsigned","enabled","text"],"additionalProperties":false}', codec,
  }] })).tools;
  const normalize = (argumentsText) => decodeSingleCall(normalizeOpenAIResponses(Buffer.from(JSON.stringify({
    status: "completed", error: null, output: [{
      type: "function_call", status: "completed", call_id: "wide", name: "answer", arguments: argumentsText,
    }],
  })), limits, tools));
  const content = "λ".repeat(80);
  const valid = normalize(`{"signed":-9223372036854775808,"unsigned":18446744073709551615,"enabled":true,"text":${JSON.stringify(content)}}`);
  assert.equal(valid.toolOrdinal, 63);
  assert.equal(valid.actionTag, 63);
  assert.equal(valid.payload.readBigInt64LE(0), -(1n << 63n));
  assert.equal(valid.payload.readBigUInt64LE(8), (1n << 64n) - 1n);
  assert.equal(valid.payload[16], 1);
  assert.deepEqual(valid.payload.subarray(17, 19), Buffer.from([0xa0, 1]));
  assert.equal(valid.payload.subarray(19).toString("utf8"), content);
  assert.equal(normalize('{"signed":9223372036854775808,"unsigned":0,"enabled":true,"text":""}').failure, 5);
  assert.notEqual(normalize('{"signed":0,"unsigned":18446744073709551616,"enabled":true,"text":""}').decodeTag, 0);
});

test("unknown declarations and unsupported argument shapes retain typed failure claims", () => {
  const tools = decodeModelInvocation(invocationBytes()).tools;
  const normalize = (name, argumentsText) => decodeSingleCall(normalizeOpenAIResponses(Buffer.from(JSON.stringify({
    status: "completed", error: null, output: [{
      type: "function_call", status: "completed", call_id: "call", name, arguments: argumentsText,
    }],
  })), limits, tools));
  const unknown = normalize("not_offered", '{"value":1}');
  assert.equal(unknown.toolOrdinal, 0xffff_ffff);
  assert.equal(unknown.failure, 2);
  for (const value of ["[]", "{}", "null", "true", "1.5"]) {
    assert.equal(normalize("choose", `{"value":${value}}`).failure, 4);
  }
  const invalidUtf8 = normalizeOpenAIResponses(Buffer.from([0xff]), limits, tools);
  assert.deepEqual(invalidUtf8, Buffer.from([4, 3, 0, 0, 0]));
});

test("schema and argument-codec substitutions reject before provider transport", () => {
  const field = { name: "value", kind: 4, bitWidth: 0, maximumBytes: 0,
    enumNames: ["yes", "no"], enumTags: [7, 3] };
  const tool = {
    actionOrdinal: 0, actionTag: 9, name: "answer", description: "Typed answer.",
    schemaText: '{"type":"object","properties":{"value":{"type":"string","enum":["yes","no"]}},"required":["value"],"additionalProperties":false}',
    codec: [field],
  };
  // Declaration order need not be numeric tag order; both mappings are explicit.
  assert.deepEqual(decodeModelInvocation(encodeInvocationFixture({ tools: [tool] }))
    .tools[0].argumentCodec[0].enumTags, [7, 3]);
  const malformed = [
    [{ ...tool, codec: [{ ...field, enumTags: [7] }] }],
    [{ ...tool, codec: [{ ...field, enumNames: ["yes", "yes"] }] }],
    [{ ...tool, codec: [{ ...field, enumTags: [7, 7] }] }],
    [{ ...tool, codec: [field, field] }],
    [{ ...tool, codec: [{ ...field, kind: 1, bitWidth: 7, enumNames: [], enumTags: [] }] }],
    [{ ...tool, codec: [{ ...field, kind: 3 }] }],
    [tool, { ...tool, actionOrdinal: 1, actionTag: 10 }],
    [tool, { ...tool, name: "other", actionTag: 10 }],
    [tool, { ...tool, name: "other", actionOrdinal: 1 }],
    [{ ...tool, schemaText: '{}' }],
    [{ ...tool, schemaText: tool.schemaText.replace('"string"', '"boolean"') }],
    [{ ...tool, schemaText: tool.schemaText.replace('["yes","no"]', '["yes","maybe"]') }],
    [{ ...tool, schemaText: tool.schemaText.replace('"required":["value"]', '"required":[]') }],
    [{ ...tool, schemaText: tool.schemaText.replace('"additionalProperties":false', '"additionalProperties":true') }],
    [{ ...tool, schemaText: tool.schemaText.replace('"type":"object"', '"type":"object","type":"object"') }],
  ];
  for (const tools of malformed) {
    assert.throws(() => decodeModelInvocation(encodeInvocationFixture({ tools })));
  }
});

function invocationBytes(
  schemaText = '{"type":"object","properties":{"value":{"type":"integer"}},"required":["value"],"additionalProperties":false}',
  actionTag = 0,
  temperature = null,
  selection,
  responsePolicy,
) {
  return encodeInvocationFixture({ temperature, selection, responsePolicy, tools: [{
    actionOrdinal: 0, actionTag, name: "choose", description: "Choose one value.", schemaText,
    codec: [{ name: "value", kind: 1, bitWidth: 32, maximumBytes: 0, enumNames: [], enumTags: [] }],
  }] });
}

function enumInvocationBytes() {
  return encodeInvocationFixture({ tools: [{
    actionOrdinal: 0, actionTag: 7, name: "abort", description: "Abort with one authored failure.",
    schemaText: '{"type":"object","properties":{"value":{"type":"string","enum":["cancelled","rejected"]}},"required":["value"],"additionalProperties":false}',
    codec: [{ name: "value", kind: 4, bitWidth: 0, maximumBytes: 0,
      enumNames: ["cancelled", "rejected"], enumTags: [3, 9] }],
  }] });
}

function noToolInvocationBytes() {
  return encodeInvocationFixture({ tools: [] });
}

function encodeInvocationFixture({tools, temperature = null, maxOutputTokens = null,
  selection = { minimumCalls: tools.length > 0 ? 1 : 0, maximumCalls: 1 },
  responsePolicy = { store: false, stream: false, background: false }}) {
  return Buffer.concat([
    text("agent.model.protocol.openai-responses-v2"), text("fixture-model"),
    maxOutputTokens === null ? Buffer.from([0]) : Buffer.concat([Buffer.from([1]), u32(maxOutputTokens)]),
    temperature === null ? Buffer.from([0, 0])
      : Buffer.concat([Buffer.from([1]), text(temperature), Buffer.from([0])]),
    variable(1), u32(2), text("decide"), variable(tools.length),
    ...tools.flatMap((tool) => [
      u32(tool.actionOrdinal), u32(tool.actionTag), text(tool.name), text(tool.description),
      text(tool.schemaText), Buffer.from([1]), variable(tool.codec.length),
      ...tool.codec.flatMap((field) => [
        text(field.name), u32(field.kind), u16(field.bitWidth), u32(field.maximumBytes),
        variable(field.enumNames.length), ...field.enumNames.map(text),
        variable(field.enumTags.length), ...field.enumTags.map(u32),
      ]),
    ]),
    u32(selection.minimumCalls), u32(selection.maximumCalls), Buffer.from([0]),
    Buffer.from([Number(responsePolicy.store), Number(responsePolicy.stream), Number(responsePolicy.background)]), u32(0),
    u32(32), u32(256), u32(64), u32(32 * 1024), u32(256), u32(64),
    u32(32 * 1024), u32(32 * 1024),
  ]);
}

function text(value) { return bytes(Buffer.from(value)); }
function bytes(value) {
  const input = Buffer.from(value);
  return Buffer.concat([variable(input.byteLength), input]);
}

function decodeSingleCall(input) {
  const bytes = Buffer.from(input);
  const cursor = { value: 0 };
  assert.equal(readVariable(bytes, cursor), 0);
  assert.equal(readVariable(bytes, cursor), 1);
  assert.equal(readVariable(bytes, cursor), 0);
  const callId = readBytes(bytes, cursor).toString("utf8");
  const name = readBytes(bytes, cursor).toString("utf8");
  const argumentsJson = readBytes(bytes, cursor).toString("utf8");
  const toolOrdinal = readU32(bytes, cursor);
  const decodeTag = readVariable(bytes, cursor);
  if (decodeTag === 1) {
    return { callId, name, argumentsJson, toolOrdinal, decodeTag, failure: readU32(bytes, cursor) };
  }
  const actionTag = readVariable(bytes, cursor);
  const payload = Buffer.from(bytes.subarray(cursor.value, bytes.length - 32));
  const i32 = bytes.readInt32LE(cursor.value);
  cursor.value += 4;
  return { callId, name, argumentsJson, toolOrdinal, decodeTag, actionTag, i32, payload };
}

function readBytes(input, cursor) {
  const length = readVariable(input, cursor);
  const result = input.subarray(cursor.value, cursor.value + length);
  cursor.value += length;
  return result;
}
function readU32(input, cursor) {
  const value = input.readUInt32LE(cursor.value);
  cursor.value += 4;
  return value;
}
function readVariable(input, cursor) {
  let value = 0;
  let scale = 1;
  for (;;) {
    const byte = input[cursor.value++];
    assert.notEqual(byte, undefined);
    value += (byte & 0x7f) * scale;
    if (byte < 128) return value;
    scale *= 128;
  }
}
function variable(value) {
  const result = [];
  do {
    const byte = value % 128;
    value = Math.floor(value / 128);
    result.push(byte | (value ? 128 : 0));
  } while (value);
  return Buffer.from(result);
}
function u32(value) {
  const result = Buffer.alloc(4);
  result.writeUInt32LE(value);
  return result;
}
function u16(value) {
  const result = Buffer.alloc(2);
  result.writeUInt16LE(value);
  return result;
}

test("caller abort reasons retain interruption classification during fetch and body reads", async () => {
  const payload = invocationBytes();
  for (const reason of [new Error("stopped"), "stopped", { request: "stopped" }, undefined]) {
    const controller = new AbortController();
    controller.abort(reason);
    const result = await performModelInvocation(payload, {
      endpoint: "http://127.0.0.1:1/v1/responses", signal: controller.signal,
    });
    assert.deepEqual(result, Buffer.from([2, 2, 0, 0, 0]));
  }
  const originalFetch = globalThis.fetch;
  try {
    for (const phase of ["fetch", "body"]) {
      const controller = new AbortController();
      const reason = { stopped: phase };
      globalThis.fetch = async () => {
        if (phase === "fetch") { controller.abort(reason); throw reason; }
        return { status: 200, headers: { get() { return null; } },
          body: new ReadableStream({ pull() { controller.abort(reason); throw reason; } }) };
      };
      const result = await performModelInvocation(payload, {
        endpoint: "http://127.0.0.1:1/v1/responses", signal: controller.signal,
      });
      assert.deepEqual(result, Buffer.from([2, 2, 0, 0, 0]), phase);
    }
    globalThis.fetch = async () => { throw new TypeError("network failure"); };
    assert.deepEqual(await performModelInvocation(payload, {
      endpoint: "http://127.0.0.1:1/v1/responses", signal: new AbortController().signal,
    }), Buffer.from([2, 0, 0, 0, 0]));
  } finally { globalThis.fetch = originalFetch; }
});

function replayInvocation(history = [], results = [], legacy = invocationBytes()) {
  return Buffer.concat([legacy, bytes(Buffer.from(JSON.stringify(history))), variable(results.length), ...results.flatMap(row => [text(row.callId), text(row.output)])]);
}
function replayTail(reply, legacyLength) {
  const cursor = { value: legacyLength }, history = readBytes(reply, cursor), status = readU32(reply, cursor);
  const present = readVariable(reply, cursor); let usage = null;
  if (present) {
    const input = reply.readBigUInt64LE(cursor.value); cursor.value += 8;
    const output = reply.readBigUInt64LE(cursor.value); cursor.value += 8;
    const cachedPresent = readVariable(reply, cursor);
    const cached = cachedPresent ? reply.readBigUInt64LE(cursor.value) : null; if (cachedPresent) cursor.value += 8;
    usage = { input, output, cached };
  }
  assert.equal(cursor.value, reply.length); return { history: history.length ? JSON.parse(history) : null, status, usage };
}

test('stateless envelope preserves complete items, assistant phase, opaque reasoning and call pairing across a fresh provider', async () => {
  assert.equal(REPLAY_MODEL_EFFECT, 'agent.model.invoke.v4');
  const response = { status: 'completed', error: null, output: [
    { type: 'reasoning', id: 'r1', summary: [], encrypted_content: 'opaque-synthetic-continuation' },
    { type: 'message', id: 'm1', status: 'completed', role: 'assistant', phase: 'commentary', content: [{ type: 'output_text', text: 'Inspecting.', annotations: [] }] },
    { type: 'function_call', id: 'f1', status: 'completed', call_id: 'call-one', name: 'choose', arguments: '{"value":42}' },
  ], usage: { input_tokens: 91, output_tokens: 23, input_tokens_details: { cached_tokens: 11 } } };
  const body = Buffer.from(JSON.stringify(response)), legacy = normalizeOpenAIResponses(body, limits, decodeModelInvocation(invocationBytes()).tools);
  const serve = async handler => {
    const server = createServer(async (req, res) => { const chunks = []; for await (const chunk of req) chunks.push(chunk); handler(JSON.parse(Buffer.concat(chunks))); res.end(body); });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    return { endpoint: `http://127.0.0.1:${server.address().port}/v1/responses`, close: () => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }) };
  };
  const children = [];
  const freshInvocation = (payload, endpoint) => new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--input-type=module', '-e',
      'const chunks=[]; for await (const chunk of process.stdin) chunks.push(chunk); const {performReplayModelInvocation}=await import(process.argv[2]); process.stdout.write(await performReplayModelInvocation(Buffer.concat(chunks), {endpoint:process.argv[1]}));',
      endpoint, new URL('../../runtime/model.mjs', import.meta.url).href], { env: { PATH: '/nonexistent' }, stdio: ['pipe', 'pipe', 'pipe'] });
    children.push(child.pid); const output = [], errors = [];
    child.stdout.on('data', chunk => output.push(chunk)); child.stderr.on('data', chunk => errors.push(chunk));
    child.on('error', reject); child.on('close', code => code === 0 ? resolve(Buffer.concat(output)) : reject(new Error(Buffer.concat(errors).toString())));
    child.stdin.end(payload);
  });
  let firstRequest;
  const first = await serve(value => { firstRequest = value; });
  let reply;
  try { reply = await freshInvocation(replayInvocation(), first.endpoint); } finally { await first.close(); }
  assert.deepEqual(reply.subarray(0, legacy.length), legacy);
  const saved = replayTail(reply, legacy.length);
  assert.equal(saved.status, 0); assert.deepEqual(saved.usage, { input: 91n, output: 23n, cached: 11n });
  assert.deepEqual(saved.history, [...firstRequest.input, ...response.output]);
  let secondRequest;
  const second = await serve(value => { secondRequest = value; });
  try { await freshInvocation(replayInvocation(saved.history, [{ callId: 'call-one', output: '42 checked independently' }]), second.endpoint); }
  finally { await second.close(); }
  assert.equal(children.length, 2); assert.notEqual(children[0], children[1]);
  for (const pid of children) assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' });
  assert.equal(secondRequest.store, false); assert.equal(secondRequest.previous_response_id, undefined); assert.equal(secondRequest.conversation, undefined);
  assert.deepEqual(secondRequest.input, [...saved.history, { type: 'function_call_output', call_id: 'call-one', output: '42 checked independently' }, { role: 'user', content: 'decide' }]);
});

test('replay admission rejects lost reasoning, missing/duplicate/mismatched results and unsupported items before I/O', async () => {
  const call = { type: 'function_call', status: 'completed', call_id: 'one', name: 'choose', arguments: '{"value":1}' };
  const good = { callId: 'one', output: 'done' };
  for (const [history, results] of [
    [[call], []], [[call], [{ ...good, callId: 'other' }]], [[call], [good, good]], [[call, call], [good]],
    [[{ type: 'reasoning', summary: [] }], []], [[{ type: 'item_reference', id: 'stored' }], []],
    [[{ type: 'function_call_output', call_id: 'missing', output: 'forged' }], []],
    [[{ role: 'user', content: 'x', unsafe_id: 9007199254740992 }], []],
  ]) await assert.rejects(performReplayModelInvocation(replayInvocation(history, results), { endpoint: 'http://127.0.0.1:1/v1/responses' }));
  assert.throws(() => decodeReplayModelInvocation(replayInvocation([], [], invocationBytes(undefined, 0, null, undefined, { store: true, stream: false, background: false }))), /ReplayRequiresStateless/);
  assert.throws(() => decodeReplayModelInvocation(replayInvocation([{ role: 'user', content: 'x'.repeat(MAXIMUM_REPLAY_BYTES) }])) , /ReplayCapacity/);
});

test('lost opaque reasoning and replay exhaustion remain explicit even with a valid normalized answer', async () => {
  const original = globalThis.fetch;
  try {
    const call = { type: 'function_call', status: 'completed', call_id: 'one', name: 'choose', arguments: '{"value":7}' };
    for (const opaque of [false, true]) {
      const response = { status: 'completed', error: null, output: [{ type: 'reasoning', summary: [], ...(opaque ? { encrypted_content: 'x'.repeat(200) } : {}) }, call] };
      const body = Buffer.from(JSON.stringify(response)), legacy = normalizeOpenAIResponses(body, limits, decodeModelInvocation(invocationBytes()).tools);
      globalThis.fetch = async () => new Response(body);
      const history = opaque ? [{ role: 'user', content: 'x'.repeat(MAXIMUM_REPLAY_BYTES - 150) }] : [];
      const reply = await performReplayModelInvocation(replayInvocation(history), { endpoint: 'http://127.0.0.1:1/v1/responses' });
      assert.deepEqual(reply.subarray(0, legacy.length), legacy);
      const tail = replayTail(reply, legacy.length); assert.equal(tail.status, opaque ? 2 : 1); assert.equal(tail.history, null);
    }
  } finally { globalThis.fetch = original; }
});

test('deployment model profile binds actual replay payload, disclosure, owner and positive budgets before provider I/O', async () => {
  const profile = { kind: 'openai-responses-replay', owner: 'W', mode: 'loopback-fixture', endpoint: 'http://127.0.0.1:1/v1/responses', credentialEnv: null,
    model: 'fixture-model', parameters: { maxOutputTokens: 128, temperature: null, reasoning: null }, timeoutMs: 1000,
    maximumRequestBytes: 100000, maximumResponseBytes: 32768, disclosure: { audience: 'fixture-provider', policyRevision: 'p1', labels: ['shared'] },
    allowance: { attempts: 2, request_bytes: 200000, output_tokens: 256, concurrent: 2 } };
  const metadata = { operation: REPLAY_MODEL_EFFECT, audience: 'fixture-provider' };
  const binding = modelBinding(metadata, profile, 'W');
  profile.allowance.attempts = 32;
  const payload = replayInvocation([], [], encodeInvocationFixture({ tools: [], maxOutputTokens: 128 }));
  const request = { payload }, run = { classification: ['shared'] };
  const charge = binding.charge({ request, run });
  assert.equal(charge.limit.attempts, 2); assert.equal(charge.amount.output_tokens, 128);
  assert.equal(charge.amount.request_bytes, encodeOpenAIResponsesRequest(decodeReplayModelInvocation(payload).invocation, decodeReplayModelInvocation(payload).input).length);
  assert.throws(() => binding.charge({ request, run: { classification: ['secret'] } }), /LeafDisclosureDenied/);
  assert.throws(() => binding.charge({ request: { payload: replayInvocation() }, run }), /ModelProfileMismatch/);
  assert.throws(() => modelBinding(metadata, { ...profile, owner: 'other' }, 'W'), /ModelProfile/);
  assert.throws(() => modelBinding(metadata, { ...profile, credentialEnv: 'SECRET_KEY' }, 'W'), /ModelEndpoint/);
  assert.throws(() => modelBinding(metadata, { ...profile, mode: 'openai-live', credentialEnv: 'SECRET_KEY' }, 'W'), /credentialed model endpoint/);
  const fetch = globalThis.fetch; let sent = 0;
  try {
    globalThis.fetch = async (_url, options) => { sent++; assert.equal(options.headers.authorization, undefined); return new Response(JSON.stringify({ status: 'completed', error: null, output: [] })); };
    assert.equal((await binding.handle({ request, run, signal: new AbortController().signal }))[0], 0);
    assert.equal(sent, 1);
    globalThis.fetch = async () => { sent++; throw new Error('lost response'); };
    await assert.rejects(binding.handle({ request, run, signal: new AbortController().signal }), { code: 'ModelDeliveryUnknown' });
    assert.equal(sent, 2, 'ambiguous transport has exactly one physical attempt');
    globalThis.fetch = async () => { sent++; return new Response('failed', { status: 503 }); };
    await assert.rejects(binding.handle({ request, run, signal: new AbortController().signal }), { code: 'ModelDeliveryUnknown' });
    assert.equal(sent, 3);
  } finally { globalThis.fetch = fetch; }
});
