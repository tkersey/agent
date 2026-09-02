import assert from "node:assert/strict";
import { createHash } from "node:crypto";

const PROTOCOL = "agent.model.protocol.openai-responses-v2";
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "[::1]", "localhost"]);

const transportFailures = Object.freeze({
  unavailable: 0,
  denied: 1,
  interrupted: 2,
  response_too_large: 3,
});
const providerFailures = Object.freeze({
  http_status: 0,
  response_failed: 1,
  response_incomplete: 2,
});
const unsupportedResponses = Object.freeze({
  unsupported_protocol: 0,
  unsupported_parameter: 1,
  malformed_json: 2,
  invalid_utf8: 3,
  unsupported_status: 4,
  unsupported_output_item: 5,
  mixed_refusal: 6,
  normalization_limit: 7,
});
const argumentDecodeFailures = Object.freeze({
  malformed: 0,
  duplicate_field: 1,
  unknown_field: 2,
  missing_field: 3,
  wrong_type: 4,
  integer_range: 5,
  capacity: 6,
});

export async function performModelInvocation(payload, options) {
  const invocation = decodeModelInvocation(payload);
  if (invocation.protocol !== PROTOCOL) {
    return encodeUnsupported("unsupported_protocol");
  }
  let requestBody;
  try {
    requestBody = encodeOpenAIResponsesRequest(invocation);
  } catch {
    return encodeUnsupported("unsupported_parameter");
  }
  const endpoint = new URL(options.endpoint);
  assert(
    endpoint.protocol === "https:" ||
      (endpoint.protocol === "http:" && LOOPBACK_HOSTS.has(endpoint.hostname)),
    "model endpoint must use HTTPS or loopback HTTP",
  );
  const headers = { "content-type": "application/json" };
  if (options.apiKey !== undefined) headers.authorization = `Bearer ${options.apiKey}`;
  try {
    const signal = options.signal ?? AbortSignal.timeout(120_000);
    const response = await fetch(endpoint, {
      method: "POST",
      headers,
      body: requestBody,
      redirect: "error",
      signal,
    });
    const declaredLength = response.headers.get("content-length");
    if (declaredLength !== null &&
        Number(declaredLength) > invocation.maximumProviderResponseBytes) {
      return encodeTransportFailure("response_too_large");
    }
    const body = await readBoundedBody(
      response,
      invocation.maximumProviderResponseBytes,
    );
    if (body === null) return encodeTransportFailure("response_too_large");
    if (response.status < 200 || response.status >= 300) {
      return encodeProviderFailure("http_status", response.status);
    }
    return normalizeOpenAIResponses(
      body,
      invocation.normalizationLimits,
      invocation.tools,
    );
  } catch (error) {
    if (error?.name === "AbortError" || error?.name === "TimeoutError") {
      return encodeTransportFailure("interrupted");
    }
    if (error?.cause?.code === "EACCES" || error?.cause?.code === "EPERM") {
      return encodeTransportFailure("denied");
    }
    return encodeTransportFailure("unavailable");
  }
}

export function decodeModelInvocation(input) {
  const bytes = Buffer.from(input);
  const cursor = { value: 0 };
  const protocol = decodeText(bytes, cursor);
  const model = decodeText(bytes, cursor);
  const parameters = decodeParameters(bytes, cursor);
  const messages = decodeVector(bytes, cursor, () => ({
    role: decodeEnum(bytes, cursor, ["system", "developer", "user", "assistant"]),
    content: decodeText(bytes, cursor),
  }));
  const tools = decodeVector(bytes, cursor, () => ({
    actionOrdinal: readU32(bytes, cursor),
    name: decodeText(bytes, cursor),
    description: decodeText(bytes, cursor),
    inputSchemaJson: decodeBytes(bytes, cursor),
    strict: readBool(bytes, cursor),
    argumentCodec: decodeVector(bytes, cursor, () => ({
      name: decodeText(bytes, cursor),
      kind: decodeEnum(bytes, cursor, [
        "text",
        "signed_integer",
        "unsigned_integer",
        "boolean",
      ]),
      bitWidth: readU16(bytes, cursor),
      maximumBytes: readU32(bytes, cursor),
    })),
  }));
  const selection = Object.freeze({
    minimumCalls: readU32(bytes, cursor),
    maximumCalls: readU32(bytes, cursor),
    parallelCalls: readBool(bytes, cursor),
  });
  const responsePolicy = Object.freeze({
    store: readBool(bytes, cursor),
    stream: readBool(bytes, cursor),
    background: readBool(bytes, cursor),
    truncation: decodeEnum(bytes, cursor, ["disabled"]),
  });
  const normalizationLimits = Object.freeze({
    maximumOutputItems: readU32(bytes, cursor),
    maximumCallIdBytes: readU32(bytes, cursor),
    maximumNameBytes: readU32(bytes, cursor),
    maximumArgumentsBytes: readU32(bytes, cursor),
    maximumArgumentNameBytes: readU32(bytes, cursor),
    maximumArgumentFields: readU32(bytes, cursor),
    maximumResultTextBytes: readU32(bytes, cursor),
  });
  const maximumProviderResponseBytes = readU32(bytes, cursor);
  assert.equal(cursor.value, bytes.byteLength, "ModelInvocation has trailing bytes");
  assert(selection.minimumCalls <= selection.maximumCalls);
  assert(selection.maximumCalls <= normalizationLimits.maximumOutputItems);
  assert(maximumProviderResponseBytes > 0);
  return Object.freeze({
    protocol,
    model,
    parameters,
    messages,
    tools,
    selection,
    responsePolicy,
    normalizationLimits,
    maximumProviderResponseBytes,
  });
}

export function encodeOpenAIResponsesRequest(invocation) {
  const body = {
    model: invocation.model,
    input: invocation.messages.map((message) => ({
      role: message.role,
      content: message.content,
    })),
  };
  if (invocation.parameters.maxOutputTokens !== null) {
    body.max_output_tokens = invocation.parameters.maxOutputTokens;
  }
  if (invocation.parameters.temperature !== null) {
    const temperature = Number(invocation.parameters.temperature);
    assert(Number.isFinite(temperature));
    body.temperature = temperature;
  }
  if (invocation.parameters.reasoning !== null) {
    body.reasoning = Object.fromEntries(Object.entries({
      effort: invocation.parameters.reasoning.effort,
      summary: invocation.parameters.reasoning.summary,
    }).filter(([, value]) => value !== null));
  }
  body.tools = invocation.tools.map((tool) => {
    const schemaText = fatalUtf8(tool.inputSchemaJson);
    const parameters = parseJsonStrict(schemaText);
    assert(parameters !== null && typeof parameters === "object" && !Array.isArray(parameters));
    return {
      type: "function",
      name: tool.name,
      description: tool.description,
      parameters,
      strict: tool.strict,
    };
  });
  body.tool_choice = invocation.selection.minimumCalls > 0 ? "required" : "auto";
  body.parallel_tool_calls = invocation.selection.parallelCalls;
  body.store = invocation.responsePolicy.store;
  body.stream = invocation.responsePolicy.stream;
  body.background = invocation.responsePolicy.background;
  body.truncation = invocation.responsePolicy.truncation;
  return Buffer.from(JSON.stringify(body));
}

export function normalizeOpenAIResponses(body, limits, tools = []) {
  let text;
  try {
    text = fatalUtf8(body);
  } catch {
    return encodeUnsupported("invalid_utf8");
  }
  let response;
  try {
    response = parseJsonStrict(text);
  } catch {
    return encodeUnsupported("malformed_json");
  }
  if (response?.status === "failed") {
    return encodeProviderFailure("response_failed", 0);
  }
  if (response?.status === "incomplete") {
    return encodeProviderFailure("response_incomplete", 0);
  }
  if (response?.status !== "completed" || response.error !== null ||
      !Array.isArray(response.output)) {
    return encodeUnsupported("unsupported_status");
  }
  if (response.output.length > limits.maximumOutputItems) {
    return encodeUnsupported("normalization_limit");
  }
  if (containsUnfinishedRefusal(response.output)) {
    return encodeUnsupported("unsupported_output_item");
  }
  let refusal;
  try {
    refusal = refusalOnly(response.output, limits);
  } catch {
    return encodeUnsupported("normalization_limit");
  }
  if (refusal !== null) return encodeRefusal(refusal);
  if (containsRefusal(response.output)) return encodeUnsupported("mixed_refusal");

  const items = [];
  try {
    for (const item of response.output) {
      if (item?.type === "function_call" && item.status === "completed") {
        requireTextLimit(item.call_id, limits.maximumCallIdBytes);
        requireTextLimit(item.name, limits.maximumNameBytes);
        requireTextLimit(item.arguments, limits.maximumArgumentsBytes);
        const argumentsJson = Buffer.from(item.arguments);
        const decodedAction = decodeActionArguments(
          item.arguments,
          item.name,
          tools,
          limits,
        );
        items.push({
          kind: "function_call",
          callId: item.call_id,
          name: item.name,
          argumentsJson,
          toolOrdinalClaim: decodedAction.toolOrdinalClaim,
          decodedAction,
        });
      } else if (item?.type === "message" && item.status === "completed" &&
          item.role === "assistant" && Array.isArray(item.content) &&
          item.content.length === 1 && item.content[0]?.type === "output_text" &&
          Array.isArray(item.content[0].annotations) &&
          item.content[0].annotations.length === 0) {
        requireTextLimit(item.content[0].text, limits.maximumResultTextBytes);
        items.push({ kind: "message", role: "assistant", content: item.content[0].text });
      } else if (item?.type === "reasoning" &&
          (item.status === undefined || item.status === "completed")) {
        items.push({
          kind: "reasoning",
          summary: normalizeReasoningSummary(
            item.summary,
            limits.maximumResultTextBytes,
          ),
        });
      } else {
        return encodeUnsupported("unsupported_output_item");
      }
    }
  } catch {
    return encodeUnsupported("normalization_limit");
  }
  const encodedItems = encodeOutputItems(items);
  const semanticDigest = createHash("sha256").update(encodedItems).digest();
  return encodeOutput(items, semanticDigest);
}

function decodeParameters(bytes, cursor) {
  const maxOutputTokens = decodeOptional(bytes, cursor, () => readU32(bytes, cursor));
  const temperature = decodeOptional(bytes, cursor, () => decodeText(bytes, cursor));
  const reasoning = decodeOptional(bytes, cursor, () => ({
    effort: decodeOptional(bytes, cursor, () => decodeEnum(
      bytes,
      cursor,
      ["none", "minimal", "low", "medium", "high", "xhigh", "max"],
    )),
    summary: decodeOptional(bytes, cursor, () => decodeEnum(
      bytes,
      cursor,
      ["auto", "concise", "detailed"],
    )),
  }));
  return Object.freeze({ maxOutputTokens, temperature, reasoning });
}

function decodeActionArguments(text, toolName, tools, limits) {
  const tool = tools.find((candidate) => candidate.name === toolName);
  if (tool === undefined) {
    return Object.freeze({
      kind: "invalid",
      failure: "unknown_field",
      toolOrdinalClaim: 0xffff_ffff,
    });
  }
  try {
    const fields = new ArgumentScanner(text, limits).objectFields();
    const encodedPayload = encodeTypedPayload(fields, tool.argumentCodec);
    return Object.freeze({
      kind: "decoded",
      toolOrdinalClaim: tool.actionOrdinal,
      actionBytes: Buffer.concat([u32(tool.actionOrdinal), encodedPayload]),
    });
  } catch (error) {
    return Object.freeze({
      kind: "invalid",
      failure: error instanceof ArgumentDecodeError ? error.code : "malformed",
      toolOrdinalClaim: tool.actionOrdinal,
    });
  }
}

class ArgumentDecodeError extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}

function encodeTypedPayload(fields, codec) {
  const admitted = new Set(codec.map((field) => field.name));
  if (fields.some((field) => !admitted.has(field.name))) {
    throw new ArgumentDecodeError("unknown_field");
  }
  const encoded = [];
  for (const contract of codec) {
    const matches = fields.filter((field) => field.name === contract.name);
    if (matches.length === 0) throw new ArgumentDecodeError("missing_field");
    if (matches.length !== 1) throw new ArgumentDecodeError("duplicate_field");
    const value = matches[0].value;
    switch (contract.kind) {
      case "text": {
        if (value.kind !== "text") throw new ArgumentDecodeError("wrong_type");
        if (Buffer.byteLength(value.value) > contract.maximumBytes) {
          throw new ArgumentDecodeError("capacity");
        }
        encoded.push(encodeText(value.value));
        break;
      }
      case "signed_integer": {
        if (value.kind !== "signed" && value.kind !== "unsigned") {
          throw new ArgumentDecodeError("wrong_type");
        }
        const minimum = -(1n << BigInt(contract.bitWidth - 1));
        const maximum = (1n << BigInt(contract.bitWidth - 1)) - 1n;
        if (value.value < minimum || value.value > maximum) {
          throw new ArgumentDecodeError("integer_range");
        }
        encoded.push(encodeIntegerWidth(value.value, contract.bitWidth));
        break;
      }
      case "unsigned_integer": {
        if (value.kind !== "unsigned") throw new ArgumentDecodeError("wrong_type");
        const maximum = (1n << BigInt(contract.bitWidth)) - 1n;
        if (value.value > maximum) throw new ArgumentDecodeError("integer_range");
        encoded.push(encodeIntegerWidth(value.value, contract.bitWidth));
        break;
      }
      case "boolean": {
        if (value.kind !== "boolean") throw new ArgumentDecodeError("wrong_type");
        encoded.push(Buffer.from([value.value ? 1 : 0]));
        break;
      }
      default: throw new ArgumentDecodeError("wrong_type");
    }
  }
  return Buffer.concat(encoded);
}

function encodeIntegerWidth(value, bitWidth) {
  if (!Number.isInteger(bitWidth) || bitWidth <= 0 || bitWidth > 64 || bitWidth % 8 !== 0) {
    throw new ArgumentDecodeError("integer_range");
  }
  let remaining = BigInt.asUintN(bitWidth, BigInt(value));
  const bytes = Buffer.alloc(bitWidth / 8);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number(remaining & 0xffn);
    remaining >>= 8n;
  }
  return bytes;
}

function encodeOutputItems(items) {
  const encoded = [u32(items.length)];
  for (const item of items) {
    if (item.kind === "function_call") {
      encoded.push(
        u32(0),
        encodeText(item.callId),
        encodeText(item.name),
        encodeBytes(item.argumentsJson),
        u32(item.toolOrdinalClaim),
        encodeDecodedAction(item.decodedAction),
      );
    } else if (item.kind === "message") {
      encoded.push(u32(1), u32(3), encodeText(item.content));
    } else {
      encoded.push(u32(2), encodeText(item.summary));
    }
  }
  return Buffer.concat(encoded);
}

function encodeOutput(items, digest) {
  return Buffer.concat([u32(0), encodeOutputItems(items), Buffer.from(digest)]);
}

function encodeDecodedAction(decoded) {
  if (decoded.kind === "decoded") {
    return Buffer.concat([u32(0), decoded.actionBytes]);
  }
  return Buffer.concat([u32(1), u32(argumentDecodeFailures[decoded.failure])]);
}

function encodeRefusal(text) {
  return Buffer.concat([u32(1), encodeText(text)]);
}

function encodeTransportFailure(kind) {
  return Buffer.concat([u32(2), u32(transportFailures[kind])]);
}

function encodeProviderFailure(kind, status) {
  return Buffer.concat([u32(3), u32(providerFailures[kind]), u16(status)]);
}

function encodeUnsupported(kind) {
  return Buffer.concat([u32(4), u32(unsupportedResponses[kind])]);
}

function refusalOnly(output, limits) {
  if (output.length !== 1) return null;
  const item = output[0];
  if (item?.type !== "message" || item.status !== "completed" ||
      item.role !== "assistant" ||
      !Array.isArray(item.content) || item.content.length !== 1 ||
      item.content[0]?.type !== "refusal") return null;
  requireTextLimit(item.content[0].refusal, limits.maximumResultTextBytes);
  return item.content[0].refusal;
}

function containsUnfinishedRefusal(output) {
  return output.some((item) => item?.status !== "completed" &&
    Array.isArray(item?.content) &&
    item.content.some((part) => part?.type === "refusal"));
}

function normalizeReasoningSummary(summary, maximumBytes) {
  assert(Array.isArray(summary));
  const parts = summary.map((part) => {
    assert.equal(part?.type, "summary_text");
    assert.equal(typeof part.text, "string");
    return part.text;
  });
  const text = parts.join("\n");
  requireTextLimit(text, maximumBytes);
  return text;
}

function containsRefusal(output) {
  return output.some((item) => Array.isArray(item?.content) &&
    item.content.some((part) => part?.type === "refusal"));
}

function requireTextLimit(value, maximumBytes) {
  assert.equal(typeof value, "string");
  assert(Buffer.byteLength(value) <= maximumBytes);
}

async function readBoundedBody(response, maximumBytes) {
  if (response.body === null) return Buffer.alloc(0);
  const reader = response.body.getReader();
  const chunks = [];
  let length = 0;
  for (;;) {
    const next = await reader.read();
    if (next.done) return Buffer.concat(chunks, length);
    const chunk = Buffer.from(next.value);
    length += chunk.byteLength;
    if (length > maximumBytes) {
      await reader.cancel();
      return null;
    }
    chunks.push(chunk);
  }
}

function decodeOptional(bytes, cursor, decode) {
  const tag = readByte(bytes, cursor);
  assert(tag === 0 || tag === 1, "optional tag is invalid");
  return tag === 0 ? null : decode();
}

function readByte(bytes, cursor) {
  assert(cursor.value < bytes.byteLength, "byte is truncated");
  return bytes[cursor.value++];
}

function decodeVector(bytes, cursor, decode) {
  const length = readU32(bytes, cursor);
  const result = [];
  for (let index = 0; index < length; index += 1) result.push(Object.freeze(decode()));
  return Object.freeze(result);
}

function decodeEnum(bytes, cursor, names) {
  const tag = readU32(bytes, cursor);
  assert(tag < names.length, "enum tag is invalid");
  return names[tag];
}

function decodeText(bytes, cursor) {
  return fatalUtf8(decodeBytes(bytes, cursor));
}

function decodeBytes(bytes, cursor) {
  const length = readU32(bytes, cursor);
  assert(length <= bytes.byteLength - cursor.value, "byte vector is truncated");
  const result = Buffer.from(bytes.subarray(cursor.value, cursor.value + length));
  cursor.value += length;
  return result;
}

function readBool(bytes, cursor) {
  const value = readByte(bytes, cursor);
  assert(value === 0 || value === 1, "boolean is noncanonical");
  return value === 1;
}

function readU32(bytes, cursor) {
  assert(cursor.value + 4 <= bytes.byteLength, "u32 is truncated");
  const value = bytes.readUInt32LE(cursor.value);
  cursor.value += 4;
  return value;
}

function readU16(bytes, cursor) {
  assert(cursor.value + 2 <= bytes.byteLength, "u16 exceeds input");
  const value = bytes.readUInt16LE(cursor.value);
  cursor.value += 2;
  return value;
}

function encodeText(value) {
  return encodeBytes(Buffer.from(value));
}

function encodeBytes(value) {
  const bytes = Buffer.from(value);
  return Buffer.concat([u32(bytes.byteLength), bytes]);
}

function u16(value) {
  const bytes = Buffer.alloc(2);
  bytes.writeUInt16LE(value);
  return bytes;
}

function u32(value) {
  const bytes = Buffer.alloc(4);
  bytes.writeUInt32LE(value);
  return bytes;
}

function i64(value) {
  const bytes = Buffer.alloc(8);
  bytes.writeBigInt64LE(BigInt(value));
  return bytes;
}

function u64(value) {
  const bytes = Buffer.alloc(8);
  bytes.writeBigUInt64LE(BigInt(value));
  return bytes;
}

function fatalUtf8(bytes) {
  return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
}

function parseJsonStrict(text) {
  const scanner = new JsonScanner(text);
  scanner.value();
  scanner.whitespace();
  assert.equal(scanner.index, text.length, "JSON has trailing bytes");
  return JSON.parse(text);
}

class JsonScanner {
  constructor(text) {
    this.text = text;
    this.index = 0;
  }
  whitespace() {
    while (this.index < this.text.length && /[\x20\t\r\n]/.test(this.text[this.index])) {
      this.index += 1;
    }
  }
  value() {
    this.whitespace();
    const byte = this.text[this.index];
    if (byte === "{") return this.object();
    if (byte === "[") return this.array();
    if (byte === '"') return this.string();
    const match = this.text.slice(this.index).match(/^(?:true|false|null|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)/);
    assert(match, "invalid JSON value");
    this.index += match[0].length;
  }
  object() {
    this.index += 1;
    this.whitespace();
    const keys = new Set();
    if (this.text[this.index] === "}") return void (this.index += 1);
    for (;;) {
      assert.equal(this.text[this.index], '"', "object key is not a string");
      const key = this.string();
      assert(!keys.has(key), `duplicate JSON key: ${key}`);
      keys.add(key);
      this.whitespace();
      assert.equal(this.text[this.index++], ":", "object colon is missing");
      this.value();
      this.whitespace();
      const delimiter = this.text[this.index++];
      if (delimiter === "}") return;
      assert.equal(delimiter, ",", "object delimiter is invalid");
      this.whitespace();
      assert.notEqual(this.text[this.index], "}", "object trailing comma");
    }
  }
  array() {
    this.index += 1;
    this.whitespace();
    if (this.text[this.index] === "]") return void (this.index += 1);
    for (;;) {
      this.value();
      this.whitespace();
      const delimiter = this.text[this.index++];
      if (delimiter === "]") return;
      assert.equal(delimiter, ",", "array delimiter is invalid");
      this.whitespace();
      assert.notEqual(this.text[this.index], "]", "array trailing comma");
    }
  }
  string() {
    const start = this.index++;
    for (;;) {
      assert(this.index < this.text.length, "string is truncated");
      const code = this.text.charCodeAt(this.index++);
      if (code === 0x22) break;
      assert(code >= 0x20, "string contains a control character");
      if (code !== 0x5c) continue;
      assert(this.index < this.text.length, "escape is truncated");
      const escaped = this.text[this.index++];
      if (escaped === "u") {
        assert(/^[0-9a-fA-F]{4}$/.test(this.text.slice(this.index, this.index + 4)));
        this.index += 4;
      } else {
        assert('"\\/bfnrt'.includes(escaped), "escape is invalid");
      }
    }
    return JSON.parse(this.text.slice(start, this.index));
  }
}

class ArgumentScanner extends JsonScanner {
  constructor(text, limits) {
    super(text);
    this.limits = limits;
  }

  objectFields() {
    this.whitespace();
    if (this.text[this.index] !== "{") throw new ArgumentDecodeError("malformed");
    this.index += 1;
    this.whitespace();
    const observedFields = [];
    if (this.text[this.index] === "}") {
      this.index += 1;
    } else {
      for (;;) {
        if (observedFields.length >= this.limits.maximumArgumentFields) {
          throw new ArgumentDecodeError("capacity");
        }
        assert.equal(this.text[this.index], '"', "argument field name is not a string");
        const name = this.string();
        requireTextLimit(name, this.limits.maximumArgumentNameBytes);
        assert.equal(fatalUtf8(Buffer.from(name)), name, "argument field name is not portable UTF-8");
        this.whitespace();
        assert.equal(this.text[this.index++], ":", "argument field colon is missing");
        observedFields.push(Object.freeze({ name, value: this.argumentValue() }));
        this.whitespace();
        const delimiter = this.text[this.index++];
        if (delimiter === "}") break;
        assert.equal(delimiter, ",", "argument object delimiter is invalid");
        this.whitespace();
        assert.notEqual(this.text[this.index], "}", "argument object trailing comma");
      }
    }
    this.whitespace();
    assert.equal(this.index, this.text.length, "arguments JSON has trailing bytes");
    return Object.freeze(observedFields);
  }

  argumentValue() {
    this.whitespace();
    const byte = this.text[this.index];
    if (byte === '"') {
      const value = this.string();
      requireTextLimit(value, this.limits.maximumArgumentsBytes);
      assert.equal(fatalUtf8(Buffer.from(value)), value, "argument text is not portable UTF-8");
      return Object.freeze({ kind: "text", value });
    }
    if (byte === "{") {
      this.object();
      return Object.freeze({ kind: "object" });
    }
    if (byte === "[") {
      this.array();
      return Object.freeze({ kind: "array" });
    }
    const match = this.text.slice(this.index).match(
      /^(?:true|false|null|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)/,
    );
    assert(match, "invalid argument JSON value");
    const lexeme = match[0];
    this.index += lexeme.length;
    if (lexeme === "true") return Object.freeze({ kind: "boolean", value: true });
    if (lexeme === "false") return Object.freeze({ kind: "boolean", value: false });
    if (lexeme === "null") return Object.freeze({ kind: "null" });
    if (/[.eE]/.test(lexeme)) return Object.freeze({ kind: "non_integer_number" });
    const value = BigInt(lexeme);
    if (value < 0n) {
      if (value < -(1n << 63n)) return Object.freeze({ kind: "non_integer_number" });
      return Object.freeze({ kind: "signed", value });
    }
    if (value > (1n << 64n) - 1n) {
      return Object.freeze({ kind: "non_integer_number" });
    }
    return Object.freeze({ kind: "unsigned", value });
  }
}
