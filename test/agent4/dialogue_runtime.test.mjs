// The consumer uses raw public World only. A new admitted kernel instance
// receives only image, detached State, and a publicly bound canonical result.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { verifyRuntime } from "../../tools/agent4/dependencies.mjs";

const [runtimePath, fixturePath, ...extra] = process.argv.slice(2);
if (!runtimePath || !fixturePath || extra.length)
  throw new Error("usage: dialogue_runtime.test.mjs WORLD_RUNTIME DIALOGUE_FIXTURES");
const runtime = verifyRuntime(runtimePath);
const world = await import(pathToFileURL(runtime.entrypoint).href);
const kernelBytes = fs.readFileSync(runtime.kernelPath);
const fresh = () => world.admitProcessKernel(kernelBytes, {
  expectedSha256: runtime.kernelSha256,
});
const u64 = (value) => {
  const bytes = Buffer.alloc(8);
  bytes.writeBigUInt64LE(BigInt(value));
  return bytes;
};
const read = (name) => fs.readFileSync(path.join(fixturePath, `${name}.bpi2`));
const records = [];

for (const [name, effect, payload, reply, result] of [
  ["twice", "agent.probe.dialogue.delay.v1", 10, u64(3), 40],
  ["dispose_owned", "agent.probe.dialogue.cleanup.v1", 42, new Uint8Array(), 42],
]) {
  const image = read(name);
  const parked = await (await fresh()).run({ image, initialArgs: new Uint8Array() });
  assert.equal(parked.kind, "Requested");
  const request = world.decodeRequest(parked.request);
  assert.equal(request.semanticIdentity, effect);
  assert.deepEqual(Buffer.from(request.payload), u64(payload));
  const detached = world.decodeOutcome(Uint8Array.from(parked.bytes));
  const saved = Uint8Array.from(detached.state);
  const resumed = await (await fresh()).run({
    image: Uint8Array.from(image), state: detached.state,
    result: world.encodeResult(detached.request, reply),
  });
  assert.equal(resumed.kind, "Completed");
  assert.deepEqual(Buffer.from(resumed.value), u64(result));
  assert.deepEqual(detached.state, saved);
  const wrongImage = read(name === "twice" ? "dispose_owned" : "twice");
  await assert.rejects((await fresh()).run({
    image: wrongImage, state: detached.state,
    result: world.encodeResult(detached.request, reply),
  }));
  assert.deepEqual(detached.state, saved);
  records.push({ name, imageBytes: image.length, stateBytes: saved.length,
    outgoing: payload, result, relation: "fresh-instance raw-World transfer" });
}

const image = read("exchange");
const exchange = await (await fresh()).run({ image, initialArgs: new Uint8Array() });
assert.equal(exchange.kind, "Requested");
const request = world.decodeRequest(exchange.request);
assert.equal(request.semanticIdentity, "agent.interaction.exchange.v1.probe.clarification");
const expectedPayload = Buffer.concat([
  Buffer.from([5]), Buffer.from("human"), Buffer.from([13]), Buffer.from("clarification"), u64(27),
]);
assert.deepEqual(Buffer.from(request.payload), expectedPayload);
const before = Uint8Array.from(exchange.state);
for (const invalid of [new Uint8Array(), Uint8Array.of(2), Uint8Array.of(0),
  Buffer.concat([Uint8Array.of(1), u64(0)])]) {
  assert.throws(() => world.encodeResult(exchange.request, invalid));
  assert.deepEqual(exchange.state, before);
}
for (const [reply, result] of [[Buffer.concat([Uint8Array.of(0), u64(41)]), 42],
  [Uint8Array.of(1), 0]]) {
  const completed = await (await fresh()).run({ image, state: exchange.state,
    result: world.encodeResult(exchange.request, reply) });
  assert.equal(completed.kind, "Completed");
  assert.deepEqual(Buffer.from(completed.value), u64(result));
}
records.push({ name: "exchange", imageBytes: image.length, stateBytes: before.length,
  outgoing: 27, valueResult: 42, closeResult: 0,
  relation: "declared Value/Close variants and four malformed replies" });
verifyRuntime(runtimePath);
console.log(JSON.stringify({ kernelSha256: runtime.kernelSha256, records }));
