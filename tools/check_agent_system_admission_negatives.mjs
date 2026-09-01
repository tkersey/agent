import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";

const options = parseArgs(process.argv.slice(2));
const worldRoot = resolve(options.worldRoot);
const world = await import(pathToFileURL(join(worldRoot, "src/process_v1/index.mjs")));
const kernel = await readFile(join(worldRoot, "boundary-process-kernel-v1.wasm"));
const image = await readFile(options.image);
const initialArgs = await readFile(options.initial);
const primary = await world.admitProcessKernel(kernel);
const transferred = await world.admitProcessKernel(kernel);

const initialModel = await advanceUntilRequested(primary, { initialArgs });
const modelRequest = world.decodeEffectRequest(initialModel.request);
assert.equal(modelRequest.effectSemanticIdentity, "agent.model.openai.responses.v1");

const repeatedPrimary = await primary.advance({
  image,
  instance: { state: initialModel.state },
});
const repeatedTransferred = await transferred.advance({
  image,
  instance: { state: initialModel.state },
});
assertOutcomeEqual(initialModel, repeatedPrimary);
assertOutcomeEqual(initialModel, repeatedTransferred);

const listResult = world.encodeEffectResult({
  request: initialModel.request,
  resume: encodeModelResponse("list_repository", {}),
});
const parserStep = await primary.advance({
  image,
  instance: { state: initialModel.state },
  effectResult: listResult,
});
assert(["Progressed", "ExplicitlyYielded"].includes(parserStep.kind));
const parserPrimary = await primary.advance({
  image,
  instance: { state: parserStep.state },
});
const parserTransferred = await transferred.advance({
  image,
  instance: { state: parserStep.state },
});
assertOutcomeEqual(parserPrimary, parserTransferred);

const repositoryRequest = await advanceUntilRequested(primary, {
  state: parserStep.state,
});
const decodedRepository = world.decodeEffectRequest(repositoryRequest.request);
assert.equal(decodedRepository.effectSemanticIdentity, "repo.list.v1");
const repeatedRepositoryPrimary = await primary.advance({
  image,
  instance: { state: repositoryRequest.state },
});
const repeatedRepositoryTransferred = await transferred.advance({
  image,
  instance: { state: repositoryRequest.state },
});
assertOutcomeEqual(repositoryRequest, repeatedRepositoryPrimary);
assertOutcomeEqual(repositoryRequest, repeatedRepositoryTransferred);

const invalidCases = [
  {
    name: "pre-baseline-replacement",
    action: "replace_file",
    arguments: {
      path: "src/range.mjs",
      expected_sha256: "8832f65e4bcf4a701dc76f310f3af34296bf8e95feb16ad70608041cb2e6dbb3",
      replacement: "forbidden",
      rationale: "must not execute before the baseline failure",
    },
  },
  {
    name: "disallowed-read-role",
    action: "read_file",
    arguments: { role: 99 },
  },
  {
    name: "premature-completion",
    action: "finish",
    arguments: {
      summary: "not verified",
      changed_path: "src/range.mjs",
      final_source_sha256: "8bf50f62e3a4294ef359a6b9096d66e5597ce37824b3483ddad541ee21438453",
    },
  },
];
const negativeResults = [];
for (const candidate of invalidCases) {
  const result = world.encodeEffectResult({
    request: initialModel.request,
    resume: encodeModelResponse(candidate.action, candidate.arguments),
  });
  const terminal = await advanceUntilTerminal(primary, initialModel.state, result);
  assert.equal(terminal.kind, "AuthoredFailure", `${candidate.name} did not fail locally`);
  negativeResults.push({
    name: candidate.name,
    terminal: terminal.kind,
    failureSha256: sha256(terminal.failure),
  });
}

process.stdout.write(`${JSON.stringify({
  format: "agent-system-closure-admission-negatives/v1",
  result: "passed",
  kernelSha256: primary.sha256,
  imageSha256: createHash("sha256").update(image).digest("hex"),
  negativeResults,
  dangerousRepositoryEffects: 0,
  successfulPrematureCompletions: 0,
  transferPoints: [
    "internal-response-parser",
    "pending-model-request",
    "pending-repository-request",
  ],
  freshHostOutcomeEquality: true,
  repeatedPendingRequestEquality: true,
  parity: {
    pendingModelStateSha256: sha256(initialModel.state),
    pendingModelRequestSha256: sha256(initialModel.request),
    parserStateSha256: sha256(parserStep.state),
    pendingRepositoryStateSha256: sha256(repositoryRequest.state),
    pendingRepositoryRequestSha256: sha256(repositoryRequest.request),
  },
})}\n`);

async function advanceUntilRequested(host, instance) {
  let current = instance;
  for (let step = 0; step < 8_000; step += 1) {
    const outcome = await host.advance({ image, instance: current });
    if (outcome.kind === "Requested") return outcome;
    if (outcome.kind !== "Progressed" && outcome.kind !== "ExplicitlyYielded") {
      throw new Error(`expected request, observed ${outcome.kind}`);
    }
    current = { state: outcome.state };
  }
  throw new Error("request reduction limit exceeded");
}

async function advanceUntilTerminal(host, state, effectResult) {
  let current = { state };
  let result = effectResult;
  for (let step = 0; step < 8_000; step += 1) {
    const outcome = await host.advance({ image, instance: current, effectResult: result });
    result = undefined;
    if (["Completed", "AuthoredFailure", "NeedsCapacity"].includes(outcome.kind)) return outcome;
    if (outcome.kind === "Requested") {
      const request = world.decodeEffectRequest(outcome.request);
      throw new Error(`invalid candidate emitted external effect ${request.effectSemanticIdentity}`);
    }
    current = { state: outcome.state };
  }
  throw new Error("terminal reduction limit exceeded");
}

function encodeModelResponse(name, argumentsValue) {
  const providerBody = Buffer.from(JSON.stringify({
    status: "completed",
    error: null,
    output: [{
      type: "function_call",
      status: "completed",
      name,
      arguments: JSON.stringify(argumentsValue),
    }],
  }));
  return concat(u32(0), u16(200), u32(providerBody.byteLength), providerBody);
}

function assertOutcomeEqual(left, right) {
  assert.equal(right.kind, left.kind);
  for (const field of ["state", "request", "result", "failure"]) {
    if (left[field] === undefined || right[field] === undefined) {
      assert.equal(right[field], left[field]);
    } else {
      assert.deepEqual(Buffer.from(right[field]), Buffer.from(left[field]), `${left.kind}.${field}`);
    }
  }
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

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function parseArgs(args) {
  const result = {};
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index];
    const value = args[index + 1];
    assert(key?.startsWith("--") && value !== undefined, "invalid arguments");
    result[toCamel(key.slice(2))] = value;
  }
  for (const key of ["worldRoot", "image", "initial"]) assert(key in result, `missing --${key}`);
  return result;
}

function toCamel(value) {
  return value.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
}
