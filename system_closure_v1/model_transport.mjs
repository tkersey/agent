import assert from "node:assert/strict";

const failureKinds = Object.freeze({
  unavailable: 0,
  denied: 1,
  interrupted: 2,
  response_too_large: 3,
});

export async function performModelRequest(payload, options) {
  const request = decodeModelRequest(payload);
  const headers = { "content-type": "application/json" };
  if (options.apiKey !== undefined) headers.authorization = `Bearer ${options.apiKey}`;
  try {
    const response = await fetch(options.endpoint, {
      method: "POST",
      headers,
      body: request.body,
      redirect: "error",
      signal: options.signal,
    });
    const body = Buffer.from(await response.arrayBuffer());
    if (body.byteLength > request.maximumResponseBytes) {
      return encodeTransportFailure("response_too_large");
    }
    return encodeResponse(response.status, body);
  } catch (error) {
    if (error?.name === "AbortError") return encodeTransportFailure("interrupted");
    if (error?.cause?.code === "EACCES" || error?.cause?.code === "EPERM") {
      return encodeTransportFailure("denied");
    }
    return encodeTransportFailure("unavailable");
  }
}

export function decodeModelRequest(bytes) {
  const cursor = { value: 0 };
  const body = decodeBytes(bytes, cursor);
  const maximumResponseBytes = readU32(bytes, cursor);
  assert.equal(cursor.value, bytes.length);
  assert(maximumResponseBytes > 0);
  return Object.freeze({ body, maximumResponseBytes });
}

function encodeResponse(status, body) {
  assert(Number.isInteger(status) && status >= 0 && status <= 0xffff);
  return concat(u32(0), u16(status), encodeBytes(body));
}

function encodeTransportFailure(kind) {
  const value = failureKinds[kind];
  assert(value !== undefined);
  return concat(u32(1), u32(value));
}

function encodeBytes(value) {
  const bytes = Buffer.from(value);
  return concat(u32(bytes.length), bytes);
}

function decodeBytes(bytes, cursor) {
  const length = readU32(bytes, cursor);
  assert(length <= bytes.length - cursor.value);
  const result = Buffer.from(bytes.subarray(cursor.value, cursor.value + length));
  cursor.value += length;
  return result;
}

function readU32(bytes, cursor) {
  assert(cursor.value + 4 <= bytes.length);
  const value = Buffer.from(bytes).readUInt32LE(cursor.value);
  cursor.value += 4;
  return value;
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

function concat(...parts) {
  return Buffer.concat(parts.map((part) => Buffer.from(part)));
}
