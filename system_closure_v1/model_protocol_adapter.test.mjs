import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

import {
  admitModelEndpoint,
  decodeModelInvocation,
  encodeOpenAIResponsesRequest,
  normalizeOpenAIResponses,
} from "./model_protocol_adapter.mjs";

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

test("decodes one self-contained semantic invocation", () => {
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
  assert.equal(normalizedSmall.readUInt32LE(0), 0);
  assert.equal(normalizedSmall.readUInt32LE(4), 3);
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

  assert.equal(decode('{"value":1,"value":2}').failure, 1);
  assert.equal(decode('{"value":1,"extra":2}').failure, 2);
  assert.equal(decode('{}').failure, 3);
  assert.equal(decode('{"value":"1"}').failure, 4);
  assert.equal(decode('{"value":2147483648}').failure, 5);
  assert.equal(decode('{"value":1,}').failure, 0);
});

test("typed Action encoding preserves explicit tags and enum payloads", () => {
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
  assert.equal(decoded.actionTag, 7);
  assert.equal(decoded.i32, 9);
});

test("malformed, duplicate, mixed refusal, and unsupported shapes fail typed", () => {
  const trailing = normalizeOpenAIResponses(
    Buffer.from('{"status":"completed","error":null,"output":[],}'),
    limits,
  );
  assert.equal(trailing.readUInt32LE(0), 4);
  assert.equal(trailing.readUInt32LE(4), 2);

  const duplicate = normalizeOpenAIResponses(
    Buffer.from('{"status":"completed","status":"completed","error":null,"output":[]}'),
    limits,
  );
  assert.equal(duplicate.readUInt32LE(0), 4);
  assert.equal(duplicate.readUInt32LE(4), 2);

  const mixed = normalizeOpenAIResponses(Buffer.from(JSON.stringify({
    status: "completed",
    error: null,
    output: [
      { type: "message", status: "completed", role: "assistant", content: [{ type: "refusal", refusal: "no" }] },
      { type: "function_call", status: "completed", call_id: "call", name: "choose", arguments: "{}" },
    ],
  })), limits);
  assert.equal(mixed.readUInt32LE(0), 4);
  assert.equal(mixed.readUInt32LE(4), 6);

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
    assert.equal(invalid.readUInt32LE(0), 4);
    assert.equal(invalid.readUInt32LE(4), 7);
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
  assert.equal(unfinished.readUInt32LE(0), 4);
  assert.equal(unfinished.readUInt32LE(4), 5);

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
  assert.equal(reasonedRefusal.readUInt32LE(0), 1);
});

test("reasoning normalization admits absent and multipart summaries", () => {
  const normalize = (summary) => normalizeOpenAIResponses(Buffer.from(JSON.stringify({
    status: "completed",
    error: null,
    output: [{ type: "reasoning", status: "completed", summary }],
  })), limits);
  const empty = normalize([]);
  assert.equal(empty.readUInt32LE(0), 0);
  assert.equal(empty.readUInt32LE(4), 1);
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
  assert.equal(normalized.readUInt32LE(0), 0);
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
  assert.equal(missingText.readUInt32LE(0), 4);
  assert.equal(missingText.readUInt32LE(4), 5);
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
    assert.equal(normalized.readUInt32LE(0), 4);
    assert.equal(normalized.readUInt32LE(4), 3);
  }
});

test("generic adapter source contains no repository-repair configuration", async () => {
  const source = await readFile(
    new URL("./model_protocol_adapter.mjs", import.meta.url),
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

function invocationBytes(
  schemaText = '{"type":"object","properties":{"value":{"type":"integer"}},"required":["value"],"additionalProperties":false}',
  actionTag = 0,
  temperature = null,
) {
  const schema = Buffer.from(schemaText);
  return Buffer.concat([
    text("agent.model.protocol.openai-responses-v2"),
    text("fixture-model"),
    temperature === null
      ? Buffer.from([0, 0, 0])
      : Buffer.concat([Buffer.from([0, 1]), text(temperature), Buffer.from([0])]),
    u32(1),
    u32(2),
    text("decide"),
    u32(1),
    u32(0),
    u32(actionTag),
    text("choose"),
    text("Choose one value."),
    bytes(schema),
    Buffer.from([1]),
    u32(1),
    text("value"),
    u32(1),
    u16(32),
    u32(0),
    u32(0),
    u32(0),
    u32(1),
    u32(1),
    Buffer.from([0]),
    Buffer.from([0, 0, 0]),
    u32(0),
    u32(32),
    u32(256),
    u32(64),
    u32(32 * 1024),
    u32(256),
    u32(64),
    u32(32 * 1024),
    u32(32 * 1024),
  ]);
}

function enumInvocationBytes() {
  const schema = Buffer.from('{"type":"object","properties":{"value":{"type":"string","enum":["cancelled","rejected"]}},"required":["value"],"additionalProperties":false}');
  return Buffer.concat([
    text("agent.model.protocol.openai-responses-v2"),
    text("fixture-model"),
    Buffer.from([0, 0, 0]),
    u32(1),
    u32(2),
    text("decide"),
    u32(1),
    u32(0),
    u32(7),
    text("abort"),
    text("Abort with one authored failure."),
    bytes(schema),
    Buffer.from([1]),
    u32(1),
    text("value"),
    u32(4),
    u16(0),
    u32(0),
    u32(2),
    text("cancelled"),
    text("rejected"),
    u32(2),
    u32(3),
    u32(9),
    u32(1),
    u32(1),
    Buffer.from([0]),
    Buffer.from([0, 0, 0]),
    u32(0),
    u32(32),
    u32(256),
    u32(64),
    u32(32 * 1024),
    u32(256),
    u32(64),
    u32(32 * 1024),
    u32(32 * 1024),
  ]);
}

function noToolInvocationBytes() {
  return Buffer.concat([
    text("agent.model.protocol.openai-responses-v2"),
    text("fixture-model"),
    Buffer.from([0, 0, 0]),
    u32(1),
    u32(2),
    text("decide"),
    u32(0),
    u32(0),
    u32(1),
    Buffer.from([0]),
    Buffer.from([0, 0, 0]),
    u32(0),
    u32(32),
    u32(256),
    u32(64),
    u32(32 * 1024),
    u32(256),
    u32(64),
    u32(32 * 1024),
    u32(32 * 1024),
  ]);
}

function text(value) {
  return bytes(Buffer.from(value));
}

function bytes(value) {
  const input = Buffer.from(value);
  return Buffer.concat([u32(input.byteLength), input]);
}

function decodeSingleCall(input) {
  const bytes = Buffer.from(input);
  const cursor = { value: 0 };
  assert.equal(readU32(bytes, cursor), 0);
  assert.equal(readU32(bytes, cursor), 1);
  assert.equal(readU32(bytes, cursor), 0);
  const callId = readBytes(bytes, cursor).toString("utf8");
  const name = readBytes(bytes, cursor).toString("utf8");
  const argumentsJson = readBytes(bytes, cursor).toString("utf8");
  const toolOrdinal = readU32(bytes, cursor);
  const decodeTag = readU32(bytes, cursor);
  if (decodeTag === 1) {
    return { callId, name, argumentsJson, toolOrdinal, decodeTag, failure: readU32(bytes, cursor) };
  }
  const actionTag = readU32(bytes, cursor);
  const i32 = bytes.readInt32LE(cursor.value);
  cursor.value += 4;
  return { callId, name, argumentsJson, toolOrdinal, decodeTag, actionTag, i32 };
}

function readBytes(input, cursor) {
  const length = readU32(input, cursor);
  const result = input.subarray(cursor.value, cursor.value + length);
  cursor.value += length;
  return result;
}

function readU32(input, cursor) {
  const value = input.readUInt32LE(cursor.value);
  cursor.value += 4;
  return value;
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
