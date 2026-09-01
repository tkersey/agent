import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { join, resolve } from "node:path";

const options = parseArgs(process.argv.slice(2));
const world = await import(pathToFileURL(join(resolve(options.worldRoot), "src/process_v1/index.mjs")));
const kernel = await readFile(join(resolve(options.worldRoot), "boundary-process-kernel-v1.wasm"));
const host = await world.admitProcessKernel(kernel);
const image = await readFile(options.image);
const initial = await readFile(options.initial);
const toolResult = await readFile(options.toolResult);

const set = await run([
  await readFile(options.modelSet),
  await readFile(options.modelFinish),
]);
assert.deepEqual(Buffer.from(set.result), Buffer.from(await readFile(options.expectedFinish)));
assert.deepEqual(set.identities, [
  "agent.model.openai.responses.v1",
  "slice.set.v1",
  "agent.model.openai.responses.v1",
]);

const finish = await run([await readFile(options.modelFinish)], true);
assert.deepEqual(Buffer.from(finish.failure), Buffer.from([4, 0, 0, 0]));
assert.deepEqual(finish.identities, ["agent.model.openai.responses.v1"]);

process.stdout.write(`${JSON.stringify({
  format: "agent-closed-turn-world-proof/v1",
  result: "passed",
  kernelSha256: host.sha256,
  kernelByteLength: host.byteLength,
  imageByteLength: image.byteLength,
  setReductions: set.reductions,
  finishReductions: finish.reductions,
  setIdentities: set.identities,
  finishIdentities: finish.identities,
  prematureFinishRejected: true,
})}\n`);

async function run(modelResults, expectFailure = false) {
  let instance = { initialArgs: initial };
  let effectResult;
  let reductions = 0;
  const identities = [];
  let modelIndex = 0;
  for (;;) {
    const outcome = await host.advance({ image, instance, effectResult });
    reductions += 1;
    effectResult = undefined;
    switch (outcome.kind) {
      case "Progressed": instance = { state: outcome.state }; break;
      case "Requested": {
        const request = world.decodeEffectRequest(outcome.request);
        identities.push(request.effectSemanticIdentity);
        const resume = request.effectSemanticIdentity === "agent.model.openai.responses.v1"
          ? modelResults[modelIndex++] ?? fail("missing model fixture")
          : request.effectSemanticIdentity === "slice.set.v1"
            ? toolResult
            : fail(`unexpected effect ${request.effectSemanticIdentity}`);
        effectResult = world.encodeEffectResult({ request: outcome.request, resume });
        instance = { state: outcome.state };
        break;
      }
      case "Completed": {
        if (expectFailure) fail("expected authored failure");
        return { result: outcome.result, reductions, identities };
      }
      case "AuthoredFailure": {
        if (!expectFailure) fail(`authored failure ${Buffer.from(outcome.failure).toString("hex")}`);
        return { failure: outcome.failure, reductions, identities };
      }
      case "ExplicitlyYielded": instance = { state: outcome.state }; break;
      case "NeedsCapacity": fail("unexpected NeedsCapacity"); break;
      default: fail(`unexpected outcome ${outcome.kind}`);
    }
    if (reductions > 20000) fail("reduction limit exceeded");
  }
}

function parseArgs(args) {
  const result = {};
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index];
    const value = args[index + 1];
    if (!key?.startsWith("--") || value === undefined) fail("invalid arguments");
    result[key.slice(2)] = value;
  }
  for (const key of ["worldRoot", "image", "initial", "modelSet", "modelFinish", "toolResult", "expectedSet", "expectedFinish"]) {
    if (!(key in result)) fail(`missing --${key}`);
  }
  return result;
}

function fail(message) { throw new Error(message); }
