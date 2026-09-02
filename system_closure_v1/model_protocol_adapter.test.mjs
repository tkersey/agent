import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

import {
  decodeModelInvocation,
  encodeOpenAIResponsesRequest,
  normalizeOpenAIResponses,
} from "./model_protocol_adapter.mjs";

const limits = Object.freeze({
  maximumOutputItems: 32,
  maximumCallIdBytes: 256,
  maximumNameBytes: 64,
  maximumArgumentsBytes: 32 * 1024,
  maximumResultTextBytes: 32 * 1024,
});

test("decodes one self-contained semantic invocation", () => {
  const invocation = decodeModelInvocation(invocationBytes());
  assert.equal(invocation.protocol, "agent.model.protocol.openai-responses-v1");
  assert.equal(invocation.model, "fixture-model");
  assert.deepEqual(invocation.messages, [{ role: "user", content: "decide" }]);
  assert.deepEqual(invocation.tools.map(({ inputSchemaJson, ...tool }) => ({
    ...tool,
    inputSchemaJson: inputSchemaJson.toString("utf8"),
  })), [{
    actionOrdinal: 0,
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

test("normalization preserves every call and ignores irrelevant envelope size", () => {
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
  const normalizedSmall = normalizeOpenAIResponses(small, limits);
  const normalizedLarge = normalizeOpenAIResponses(large, limits);
  assert.deepEqual(normalizedLarge, normalizedSmall);
  assert.equal(normalizedSmall.readUInt32LE(0), 0);
  assert.equal(normalizedSmall.readUInt32LE(4), 3);
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

function invocationBytes() {
  const schema = Buffer.from('{"type":"object","properties":{"value":{"type":"integer"}},"required":["value"],"additionalProperties":false}');
  return Buffer.concat([
    text("agent.model.protocol.openai-responses-v1"),
    text("fixture-model"),
    Buffer.from([0, 0, 0]),
    u32(1),
    u32(2),
    text("decide"),
    u32(1),
    u32(0),
    text("choose"),
    text("Choose one value."),
    bytes(schema),
    Buffer.from([1]),
    u32(1),
    u32(1),
    Buffer.from([0]),
    Buffer.from([0, 0, 0]),
    u32(0),
    u32(32),
    u32(256),
    u32(64),
    u32(32 * 1024),
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

function u32(value) {
  const result = Buffer.alloc(4);
  result.writeUInt32LE(value);
  return result;
}
