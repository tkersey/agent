// Independent expected trace for the first owned-future witness. The host
// answers outer effects only; queue selection and fan-out are program terms.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { verifyRuntime } from "../../tools/agent4/dependencies.mjs";
import { native, wasmtime } from "./independent/execute.mjs";

const [runtimePath, imagePath, nativePath, inspectorPath, ...extra] = process.argv.slice(2);
assert(runtimePath && imagePath && nativePath && inspectorPath && !extra.length,
  "usage: inquiry_runtime.mjs WORLD_RUNTIME IMAGE NATIVE INSPECTOR");
const runtime = verifyRuntime(runtimePath);
const world = await import(pathToFileURL(runtime.entrypoint));
const kernel = await readFile(runtime.kernelPath);
const image = await readFile(imagePath);
const scratch = await mkdtemp(join(tmpdir(), "agent-inquiry-"));
const u64 = value => {
  const bytes = Buffer.alloc(8);
  bytes.writeBigUInt64LE(BigInt(value));
  return bytes;
};
const followup = basename(imagePath) === "followup.bpi2";
const composition = followup || basename(imagePath) === "composition.bpi2";
const cases = followup ? [
  ["experiment", 7, u64(7), 3],
  ["model", 17, u64(1), 2],
  ["model", 27, u64(1), 2],
  ["cleanup", 30, new Uint8Array(), 2],
  ["cleanup", 10, new Uint8Array(), 1],
  ["cleanup", 20, new Uint8Array(), 0],
] : composition ? [
  ["experiment", 7, u64(7), 3],
  ["model", 17, u64(1), 2],
  ["cleanup", 10, new Uint8Array(), 2],
  ["model", 27, u64(1), 1],
  ["cleanup", 20, new Uint8Array(), 1],
  ["cleanup", 30, new Uint8Array(), 0],
] : [
  ["experiment", 7, u64(7), 3],
  ["model", 17, u64(1), 2],
  ["cleanup", 10, new Uint8Array(), 2],
  ["cleanup", 30, new Uint8Array(), 1],
  ["model", 27, u64(1), 0],
  ["cleanup", 20, new Uint8Array(), 0],
];
const records = [];

async function invoke(input) {
  const fresh = await world.admitProcessKernel(kernel, {
    expectedSha256: runtime.kernelSha256,
  });
  const observed = await fresh.run(input);
  const filename = join(scratch, "input.pki2");
  await writeFile(filename, world.encodeInput({ ...input, mode: "run" }));
  const n = native(resolve(nativePath), filename);
  assert.equal(n.status, 0, n.stderr.toString());
  assert.deepEqual(n.stdout, Buffer.from(observed.bytes), "native/Node outcome equality");
  const independent = wasmtime(runtime, filename);
  assert.equal(independent.status, 0, independent.stderr.toString());
  assert.deepEqual(independent.stdout, Buffer.from(observed.bytes), "Wasmtime/Node equality");
  // Subsequent execution uses the independent embedding's actual successor.
  return world.decodeOutcome(Uint8Array.from(independent.stdout));
}

try {
  let outcome = await invoke({ image, initialArgs: new Uint8Array() });
  for (const [kind, payload, reply, packages] of cases) {
    assert.equal(outcome.kind, "Requested");
    const request = world.decodeRequest(outcome.request);
    assert.equal(request.semanticIdentity, `agent.probe.inquiry.${kind}.v1`);
    assert.deepEqual(Buffer.from(request.payload), u64(payload));
    const snapshot = join(scratch, "state.pst2");
    await writeFile(snapshot, outcome.state);
    const graph = JSON.parse(execFileSync(resolve(inspectorPath), ["inspect-state", snapshot]));
    assert.equal(graph.packages, packages, `${kind}(${payload}): retained owners`);
    assert.equal(graph.multiTemplates, 0);
    records.push({ kind, payload, stateBytes: outcome.state.length, graph });
    outcome = await invoke({ image: Uint8Array.from(image), state: outcome.state,
      result: world.encodeResult(outcome.request, reply) });
  }
  assert.equal(outcome.kind, "Completed");
  const findings = followup ? [[1, 54], [3, 74]] : [[1, 36], [3, 56]];
  const expected = composition ? Buffer.concat([Buffer.from([2]),
    ...findings.flat().map(u64)]) : u64(92);
  assert.deepEqual(Buffer.from(outcome.value), expected);
  console.log(JSON.stringify({ imageBytes: image.length,
    imageSha256: createHash("sha256").update(image).digest("hex"),
    kernelSha256: runtime.kernelSha256, experiments: 1, modelRequests: 2,
    cleanupRequests: 3, result: composition ? findings : 92, records }));
} finally {
  await rm(scratch, { recursive: true, force: true });
}
