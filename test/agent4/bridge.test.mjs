import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { test } from "node:test";
import { promisify } from "node:util";
import { loadWorldRuntime } from "../../runtime/world.mjs";

const root = resolve(import.meta.dirname, "../..");
const runtimePath = resolve(process.env.AGENT4_WORLD_RUNTIME ?? join(root, ".agent4/out/world-runtime"));
const probeRoot = resolve(process.env.AGENT4_DIALOGUE_DIR ?? join(root, ".agent4/out/dialogue"));
const lockPath = join(root, "conformance/agent4/dependencies.lock.json");
const empty = new Uint8Array();
function u64(value) { const bytes = new Uint8Array(8); new DataView(bytes.buffer).setBigUint64(0, BigInt(value), true); return bytes; }
const bridge = () => loadWorldRuntime({ runtimePath, lockPath });
const image = (name = "twice") => readFile(join(probeRoot, `${name}.bpi2`));
const execute = promisify(execFile);

test("bridge rejects unknown options before loading a runtime", async () => {
  await assert.rejects(loadWorldRuntime({ runtimePath: "/absent", phase: "act" }), /UnknownRuntimeOption/);
  await assert.rejects(loadWorldRuntime({ runtimePath: "/absent", model: "override" }), /UnknownRuntimeOption/);
  await assert.rejects(loadWorldRuntime({}), /runtimePath/);
});

test("bridge preserves original World records through fresh-instance owned-dialogue transfer", async () => {
  const host = await bridge(), program = await image();
  const parked = await host.start(program, empty);
  assert.equal(parked.kind, "Requested");
  const request = host.inspectPending(parked);
  assert.equal(request.authoritative, false);
  assert.equal(request.classification, "typed_request");
  assert.equal(request.request.semanticIdentity, "agent.probe.dialogue.delay.v1");
  assert.deepEqual(request.request.payload, u64(10));
  assert.deepEqual(host.decodeOutcome(parked.bytes).state, parked.state);
  const original = Uint8Array.from(parked.bytes);

  // A new admitted bridge/kernel instance receives only canonical image, State,
  // current request and typed answer. No creator callback is supplied.
  const transferred = await bridge();
  const finished = await transferred.resume(program, parked.state, parked.request, u64(3));
  assert.equal(finished.kind, "Completed");
  assert.deepEqual(finished.value, u64(40));
  assert.deepEqual(parked.bytes, original);
  assert.deepEqual(host.inspectPending({ ...parked, kind: "Completed" }), request);

  // Bridge deletion: the unchanged public module and canonical bytes suffice.
  const world = await import(pathToFileURL(host.identity.entrypoint).href);
  const raw = await world.admitProcessKernel(await readFile(host.identity.kernelPath), {
    expectedSha256: host.identity.kernelSha256,
  });
  const rawParked = await raw.run({ image: program, initialArgs: empty });
  assert.deepEqual(rawParked.bytes, parked.bytes);
  const rawFinished = await raw.run({ image: program, state: rawParked.state,
    result: world.encodeResult(rawParked.request, u64(3)) });
  assert.deepEqual(rawFinished.bytes, finished.bytes);
});

test("bridge rejects wrong State, image and typed reply without changing the parked input", async () => {
  const host = await bridge(), program = await image();
  const parked = await host.start(program, empty);
  const before = Uint8Array.from(parked.bytes);
  const changedState = Uint8Array.from(parked.state);
  changedState[changedState.length - 1] ^= 1;
  await assert.rejects(async () => host.resume(program, changedState, parked.request, u64(3)), /RequestStateMismatch/);
  await assert.rejects(async () => host.resume(program, parked.state, parked.request, empty));
  const wrongImage = await image("dispose_owned");
  await assert.rejects(async () => host.resume(wrongImage, parked.state, parked.request, u64(3)));
  assert.deepEqual(parked.bytes, before);
  assert.equal((await host.resume(program, parked.state, parked.request, u64(3))).kind, "Completed");
});

test("interaction inspection decodes the declared tuple without selecting control", async () => {
  const host = await bridge(), program = await image("exchange");
  const parked = await host.start(program, empty);
  const before = Uint8Array.from(parked.bytes);
  const view = host.inspectPending(parked);
  assert.equal(view.classification, "awaiting_clarification");
  assert.equal(view.authoritative, false);
  assert.deepEqual(view.interaction, {
    channel: "human", purpose: "clarification", presentation: null, outgoing: 27n,
  });
  assert.deepEqual(parked.bytes, before);
  const accepted = await host.resume(program, parked.state, parked.request,
    Uint8Array.from([0, ...u64(41)]));
  assert.equal(accepted.kind, "Completed");
  assert.deepEqual(accepted.value, u64(42));
});

test("equal-content independent occurrences are executed and never globally deduplicated", async () => {
  const host = await bridge(), program = await image();
  const first = await host.start(program, empty);
  const second = await host.start(program, empty);
  assert.deepEqual(first.request, second.request);
  const firstResult = await host.resume(program, first.state, first.request, u64(3));
  const secondResult = await host.resume(program, second.state, second.request, u64(4));
  assert.deepEqual(firstResult.value, u64(40));
  assert.notDeepEqual(secondResult.value, firstResult.value);
});

test("cancelling suspended cleanup returns its current request and preserves cleanup control", async () => {
  const host = await bridge(), program = await image("dispose_owned");
  const parked = await host.start(program, empty);
  assert.equal(parked.kind, "Requested");
  assert.deepEqual(host.inspectPending(parked).request.payload, u64(42));
  const cancelled = await host.cancel(program, parked.state, "stop during cleanup");
  assert.equal(cancelled.kind, "Requested");
  assert.deepEqual(host.inspectPending(cancelled).request.payload, u64(42));
  assert.notDeepEqual(cancelled.request, parked.request);
  await assert.rejects(async () => host.resume(program, cancelled.state, parked.request, empty), /RequestStateMismatch/);
  const fresh = await bridge();
  // The semantic cleanup result is bound to the CURRENT ERQ2 by World. No old
  // ERS2 or State is patched, and the cleanup operation is not invoked again.
  const terminal = await fresh.resume(program, cancelled.state, cancelled.request, empty);
  assert.equal(terminal.kind, "Cancelled");
  assert.equal(terminal.reason, "stop during cleanup");
  assert.deepEqual(terminal.cleanupFailures, []);
});

test("source-independent bridge installation executes the same compiled image", async (t) => {
  const isolated = await mkdtemp(join(tmpdir(), "agent4-bridge-installation-"));
  t.after(() => rm(isolated, { recursive: true, force: true }));
  const files = ["runtime/world.mjs", "runtime/values.mjs", "tools/agent4/dependencies.mjs",
    "conformance/agent4/dependencies.lock.json"];
  for (const file of files) {
    await mkdir(dirname(join(isolated, file)), { recursive: true });
    await cp(join(root, file), join(isolated, file));
  }
  await cp(runtimePath, join(isolated, "world-runtime"), { recursive: true });
  await writeFile(join(isolated, "example.bpi2"), await image());
  // A new process has only the installed runtime, pure value support and image.
  // It cannot accidentally reuse a compiler/source module cached by this test.
  const script = `
    import { readFile } from "node:fs/promises";
    import { loadWorldRuntime } from "./runtime/world.mjs";
    const host = await loadWorldRuntime({runtimePath: "./world-runtime"});
    const program = await readFile("./example.bpi2");
    const pending = await host.start(program, new Uint8Array());
    const reply = new Uint8Array(8);
    new DataView(reply.buffer).setBigUint64(0, 3n, true);
    const result = await host.resume(program, pending.state, pending.request, reply);
    console.log(JSON.stringify({kind: result.kind, value: [...result.value]}));
  `;
  const { stdout, stderr } = await execute(process.execPath, ["--input-type=module", "--eval", script],
    { cwd: isolated, env: {} });
  assert.equal(stderr, "");
  assert.deepEqual(JSON.parse(stdout), { kind: "Completed", value: [...u64(40)] });
});

test("runtime byte changes reject against the external Agent lock before import", async (t) => {
  const isolated = await mkdtemp(join(tmpdir(), "agent4-bridge-tamper-"));
  t.after(() => rm(isolated, { recursive: true, force: true }));
  await cp(runtimePath, join(isolated, "world-runtime"), { recursive: true });
  const kernelPath = join(isolated, "world-runtime/world-process-kernel-v2.wasm");
  const kernel = await readFile(kernelPath);
  kernel[kernel.length - 1] ^= 1;
  await writeFile(kernelPath, kernel);
  await assert.rejects(loadWorldRuntime({ runtimePath: join(isolated, "world-runtime"), lockPath }), /Agent4DependencyMismatch/);
});
