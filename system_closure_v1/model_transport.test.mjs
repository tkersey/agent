import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import { performModelRequest } from "./model_transport.mjs";

test("transport posts image-emitted bytes exactly and preserves HTTP response bytes", async () => {
  const requestBody = Buffer.from('{"model":"gpt-5.4-mini-2026-03-17"}');
  const responseBody = Buffer.from([0xff, 0x00, 0x7b, 0x7d]);
  let captured;
  const server = await listen(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    captured = Buffer.concat(chunks);
    response.writeHead(503, { "content-length": responseBody.byteLength });
    response.end(responseBody);
  });
  try {
    const result = await performModelRequest(encodeRequest(requestBody, 64), {
      endpoint: server.endpoint,
      apiKey: "test-secret",
    });
    assert.deepEqual(captured, requestBody);
    assert.equal(result.readUInt32LE(0), 0);
    assert.equal(result.readUInt16LE(4), 503);
    assert.equal(result.readUInt32LE(6), responseBody.byteLength);
    assert.deepEqual(result.subarray(10), responseBody);
  } finally {
    await server.close();
  }
});

test("transport rejects an oversized response without successful truncation", async () => {
  const server = await listen((_, response) => {
    response.writeHead(200, { "content-length": 32 });
    response.end(Buffer.alloc(32, 1));
  });
  try {
    const result = await performModelRequest(encodeRequest(Buffer.from("{}"), 8), {
      endpoint: server.endpoint,
    });
    assert.equal(result.readUInt32LE(0), 1);
    assert.equal(result.readUInt32LE(4), 3);
    assert.equal(result.byteLength, 8);
  } finally {
    await server.close();
  }
});

test("transport restricts plaintext endpoints to loopback", async () => {
  await assert.rejects(
    performModelRequest(encodeRequest(Buffer.from("{}"), 8), {
      endpoint: "http://example.com/v1/responses",
    }),
    /HTTPS or loopback HTTP/,
  );
});

function encodeRequest(body, maximumResponseBytes) {
  const length = Buffer.alloc(4);
  length.writeUInt32LE(body.byteLength);
  const maximum = Buffer.alloc(4);
  maximum.writeUInt32LE(maximumResponseBytes);
  return Buffer.concat([length, body, maximum]);
}

async function listen(handler) {
  const server = createServer(handler);
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  assert(address !== null && typeof address !== "string");
  return Object.freeze({
    endpoint: `http://127.0.0.1:${address.port}/v1/responses`,
    async close() {
      await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    },
  });
}
