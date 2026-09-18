// World owns canonical framing. The Python process independently invokes only
// the documented WASM ABI using a different engine and fresh Store/Instance.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { wasmtime, native } from "./independent/execute.mjs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { verifyRuntime } from "../../tools/agent4/dependencies.mjs";

const root = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));
const [runtimeArg, fixturesArg, diagnostic, ...extra] = process.argv.slice(2);
if (!runtimeArg || !fixturesArg || extra.length ||
    (diagnostic !== undefined && diagnostic !== "--wasmtime-only"))
  throw new Error("usage: independent.mjs WORLD_RUNTIME AGENT_FIXTURE_OUTPUT_ROOT [--wasmtime-only]");
if (!process.env.AGENT4_NATIVE && diagnostic !== "--wasmtime-only")
  throw new Error("AGENT4_NATIVE is required for full agreement; --wasmtime-only is diagnostic only");
const runtime = verifyRuntime(path.resolve(runtimeArg));
const fixtures = path.resolve(fixturesArg);
const output = path.join(root, ".agent4/out/independent");
fs.mkdirSync(output, { recursive: true });
const world = await import(pathToFileURL(runtime.entrypoint).href);
const kernelBytes = fs.readFileSync(runtime.kernelPath);
const kernel = await world.Kernel.create({ bytes: kernelBytes, expectedSha256: runtime.kernelSha256 });
kernel.setLimits({ input: 256 << 20, working: 256 << 20, output: 256 << 20 });
const invoke = async input => { const bytes = kernel.invoke(world.encodeInput(input)); return { ...world.decodeOutcome(bytes), bytes }; };
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const records = [];
const nativePath = process.env.AGENT4_NATIVE ? path.resolve(process.env.AGENT4_NATIVE) : null;
const nativeIdentity = nativePath ? hash(fs.readFileSync(nativePath)) : null;

function execute(name, inputBytes, expectedHash = runtime.kernelSha256) {
  const inputPath = path.join(output, `${name}.pki3`);
  fs.writeFileSync(inputPath, inputBytes);
  return wasmtime(runtime, inputPath, expectedHash);
}

function executeNative(name, inputBytes) {
  const inputPath = path.join(output, `${name}.pki3`);
  fs.writeFileSync(inputPath, inputBytes);
  return native(nativePath, inputPath);
}

async function agree(name, input, mode = "run") {
  const inputBytes = world.encodeInput({ ...input, quantum: mode === "advance" ? 1 : null });
  const bytes = kernel.invoke(inputBytes);
  const expected = { ...world.decodeOutcome(bytes), bytes };
  const independent = execute(name, inputBytes);
  assert.equal(independent.status, 0, independent.stderr.toString());
  assert.deepEqual(independent.stdout, Buffer.from(expected.bytes), name);
  if (nativePath) {
    const native = executeNative(name, inputBytes);
    assert.equal(native.status, 0, native.stderr.toString());
    assert.deepEqual(native.stdout, Buffer.from(expected.bytes), `${name}: native World`);
  }
  const decoded = world.decodeOutcome(independent.stdout);
  fs.writeFileSync(path.join(output, `${name}.pko3`), independent.stdout);
  records.push({ name, mode, outcome: decoded.kind, inputSha256: hash(inputBytes),
    outcomeSha256: hash(independent.stdout), relation: "identical canonical PKO3",
    nativeMatched: nativePath !== null });
  return { ...decoded, bytes: Uint8Array.from(independent.stdout) };
}

function integer(value) {
  const bytes = Buffer.alloc(8);
  bytes.writeBigUInt64LE(BigInt(value));
  return bytes;
}
const image = (family, name) => fs.readFileSync(path.join(fixtures, family, `${name}.bpi3`));

const twice = image("dialogue", "twice");
const dialogueInitial = { image: twice, initialArgs: new Uint8Array() };
const parked = await invoke(dialogueInitial);
await agree("dialogue-start", dialogueInitial);
assert.equal(parked.kind, "requested");
assert.equal((await world.decodeRequest(parked.request)).semanticIdentity, "agent.probe.dialogue.delay.v1");
const resumedInput = { image: twice, state: parked.state,
  control: "reply", value: (await world.encodeResult(parked.request, integer(3))) };
// Node -> Wasmtime one transition -> Node is an actual intermediate-state
// transfer, preserving non-tail continuation work without a host callback.
const intermediate = await agree("dialogue-resume-step", resumedInput, "advance");
assert.equal(intermediate.kind, "progressed");
const terminal = await invoke({ image: twice, state: intermediate.state });
assert.equal(terminal.kind, "completed");
assert.deepEqual(Buffer.from(terminal.value), integer(40));
const independentlyFinished = await agree("dialogue-finish", {
  image: twice, state: intermediate.state,
});
assert.deepEqual(independentlyFinished.bytes, terminal.bytes);

const multi = image("multi", "multi");
const initialArgs = Buffer.concat([Uint8Array.of(2), integer(11), integer(12)]);
const multiInitial = { image: multi, initialArgs };
const firstBranch = await invoke(multiInitial);
await agree("multi-start", multiInitial);
assert.equal(firstBranch.kind, "requested");
assert.equal((await world.decodeRequest(firstBranch.request)).semanticIdentity, "agent4.probe.assess");
assert.deepEqual(Buffer.from((await world.decodeRequest(firstBranch.request)).payload),
  Buffer.concat([integer(11), integer(10)]));
const secondBranch = await agree("multi-second-branch", {
  image: multi, state: firstBranch.state,
  control: "reply", value: (await world.encodeResult(firstBranch.request, integer(33))),
});
assert.equal(secondBranch.kind, "requested");
assert.deepEqual(Buffer.from((await world.decodeRequest(secondBranch.request)).payload),
  Buffer.concat([integer(12), integer(10)]));
const lastInput = { image: multi, state: secondBranch.state,
  control: "reply", value: (await world.encodeResult(secondBranch.request, integer(36))) };
const lastBranch = await invoke(lastInput);
assert.equal(lastBranch.kind, "completed");
assert.deepEqual(Buffer.from(lastBranch.value), Buffer.concat([
  Uint8Array.of(2), integer(10), integer(11), integer(33), integer(10), integer(12), integer(36),
]));
await agree("multi-finish", lastInput);

const disposal = image("dialogue", "dispose_owned");
const cleanupInitial = { image: disposal, initialArgs: new Uint8Array() };
const cleanup = await invoke(cleanupInitial);
await agree("cleanup-start", cleanupInitial);
assert.equal(cleanup.kind, "requested");
const restored = await agree("cleanup-restore", { image: disposal, state: cleanup.state });
assert.deepEqual(restored.bytes, cleanup.bytes);
const disposed = await agree("cleanup-finish", { image: disposal, state: restored.state,
  control: "reply", value: (await world.encodeResult(restored.request, new Uint8Array())) });
assert.equal(disposed.kind, "completed");
assert.deepEqual(Buffer.from(disposed.value), integer(42));

const cancelling = await agree("cleanup-cancel", { image: disposal, state: cleanup.state,
  control: "cancel_text", value: "independent-stop" });
assert.equal(cancelling.kind, "requested");
assert.notDeepEqual(cancelling.request, cleanup.request);
assert.deepEqual(Buffer.from((await world.decodeRequest(cancelling.request)).payload),
  Buffer.from((await world.decodeRequest(cleanup.request)).payload));
const staleInput = { image: disposal, state: cancelling.state,
  control: "reply", value: (await world.encodeResult(cleanup.request, new Uint8Array())) };
const saved = Uint8Array.from(cancelling.state);
await assert.rejects(invoke(staleInput));
const stale = execute("cleanup-stale-result", world.encodeInput({ ...staleInput, mode: "run" }));
assert.notEqual(stale.status, 0);
assert.equal(stale.stdout.length, 0);
if (nativePath) {
  const nativeStale = executeNative("cleanup-stale-result",
    world.encodeInput({ ...staleInput, mode: "run" }));
  assert.notEqual(nativeStale.status, 0);
  assert.equal(nativeStale.stdout.length, 0);
}
assert.deepEqual(Buffer.from(cancelling.state), Buffer.from(saved));
const cancelled = await agree("cleanup-cancel-finish", { image: disposal, state: saved,
  control: "reply", value: (await world.encodeResult(cancelling.request, new Uint8Array())) });
assert.equal(cancelled.kind, "cancelled");
assert.deepEqual(cancelled.reason, { kind: "text", value: "independent-stop" });
assert.deepEqual(cancelled.cleanupFailures, []);

const malformed = execute("malformed-input", Uint8Array.of(1, 2, 3));
assert.notEqual(malformed.status, 0);
assert.equal(malformed.stdout.length, 0);
if (nativePath) {
  const nativeMalformed = executeNative("malformed-input", Uint8Array.of(1, 2, 3));
  assert.notEqual(nativeMalformed.status, 0);
  assert.equal(nativeMalformed.stdout.length, 0);
}
const wrongHash = runtime.kernelSha256 === "0".repeat(64) ? "1".repeat(64) : "0".repeat(64);
const substituted = execute("wrong-kernel-identity",
  world.encodeInput({ image: twice, initialArgs: new Uint8Array() }), wrongHash);
assert.notEqual(substituted.status, 0);
assert.equal(substituted.stdout.length, 0);
verifyRuntime(path.resolve(runtimeArg));
const evidence = {
  format: "agent4-independent-embedding/v1", kernelSha256: runtime.kernelSha256,
  engines: { standard: `Node ${process.version}`, independent: "Wasmtime 48.0.0 / Python 3.14.7",
    native: nativePath ? { executableSha256: nativeIdentity, runtime: "World public invocation" }
      : "not executed: AGENT4_NATIVE required for native agreement" },
  nativeAgreementEstablished: nativePath !== null,
  images: { dialogue: hash(twice), disposal: hash(disposal), multi: hash(multi) },
  records, negatives: ["stale-cleanup-result", "malformed-PKI3", "wrong-kernel-identity"],
  limits: nativePath ? "Finite prescribed inputs; no capacity-pressure or live model claim"
    : "Wasmtime-only diagnostic; native-Zig agreement is unestablished; no live model claim",
};
fs.writeFileSync(path.join(output, "receipt.json"), `${JSON.stringify(evidence, null, 2)}\n`);
console.log(JSON.stringify(evidence));
