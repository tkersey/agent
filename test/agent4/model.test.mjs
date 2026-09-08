import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

import {
  MODEL_EFFECT,
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

test("generic adapter source contains no repository-repair configuration", async () => {
  const source = await readFile(
    new URL("../../runtime/model.mjs", import.meta.url),
    "utf8",
  );
  for (const forbidden of [
    "gpt-5.4-mini-2026-03-17",
    "repository-inspection",
    "correct-construction",
    "list_repository",
    "read_file",
    "search_text",
    "run_tests",
    "replace_file",
    "src/range.mjs",
    "normalizeRange",
    "Repair only the admitted repository fixture",
  ]) {
    assert(!source.includes(forbidden), `adapter contains forbidden system literal: ${forbidden}`);
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
) {
  return encodeInvocationFixture({ temperature, tools: [{
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

function encodeInvocationFixture({tools, temperature = null}) {
  return Buffer.concat([
    text("agent.model.protocol.openai-responses-v2"), text("fixture-model"),
    temperature === null ? Buffer.from([0, 0, 0])
      : Buffer.concat([Buffer.from([0, 1]), text(temperature), Buffer.from([0])]),
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
    u32(tools.length > 0 ? 1 : 0), u32(1), Buffer.from([0]), Buffer.from([0, 0, 0]), u32(0),
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
