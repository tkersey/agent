import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";

import {
  decodeModelInvocation,
  normalizeOpenAIResponses,
} from "../system_closure_v1/model_protocol_adapter.mjs";

const options = parseArgs(process.argv.slice(2));
options.mode ??= "transfers";
assert(["transfers", "negative"].includes(options.mode), "invalid admission-check mode");
if (options.mode === "negative") assert(options.case !== undefined, "negative mode requires --case");
const worldRoot = resolve(options.worldRoot);
const world = await import(pathToFileURL(join(worldRoot, "src/process_v1/index.mjs")));
const kernel = await readFile(join(worldRoot, "boundary-process-kernel-v1.wasm"));
const image = await readFile(options.image);
const initialArgs = await readFile(options.initial);
const primary = await world.admitProcessKernel(kernel);
const transferred = await world.admitProcessKernel(kernel);

const initialModel = await advanceUntilRequested(primary, { initialArgs });
const modelRequest = world.decodeEffectRequest(initialModel.request);
assert.equal(modelRequest.effectSemanticIdentity, "agent.model.invoke.v2");
const modelInvocation = decodeModelInvocation(modelRequest.payload);
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

if (options.mode === "negative") {
  const candidate = invalidCases.find((entry) => entry.name === options.case);
  assert(candidate !== undefined, "unknown admission-negative case");
  const result = world.encodeEffectResult({
    request: initialModel.request,
    resume: encodeModelResponse(candidate.action, candidate.arguments),
  });
  const terminal = await advanceUntilTerminal(primary, initialModel.state, result);
  assert.equal(terminal.kind, "AuthoredFailure", `${candidate.name} did not fail locally`);
  await writeStdout(`${JSON.stringify({
    format: "agent-system-closure-admission-negative-case/v1",
    result: "passed",
    kernelSha256: primary.sha256,
    imageSha256: sha256(image),
    negativeResult: {
      name: candidate.name,
      terminal: terminal.kind,
      failureSha256: sha256(terminal.failure),
    },
    dangerousRepositoryEffects: 0,
    successfulPrematureCompletions: 0,
  })}\n`);
  process.exit(0);
}

const [repeatedPrimary, repeatedTransferred] = await Promise.all([
  primary.advance({ image, instance: { state: initialModel.state } }),
  transferred.advance({ image, instance: { state: initialModel.state } }),
]);
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
const [parserPrimary, parserTransferred] = await Promise.all([
  primary.advance({ image, instance: { state: parserStep.state } }),
  transferred.advance({ image, instance: { state: parserStep.state } }),
]);
assertOutcomeEqual(parserPrimary, parserTransferred);

const repositoryRequest = await advanceUntilRequested(primary, {
  state: parserStep.state,
});
const decodedRepository = world.decodeEffectRequest(repositoryRequest.request);
assert.equal(decodedRepository.effectSemanticIdentity, "repo.list.v1");
const [repeatedRepositoryPrimary, repeatedRepositoryTransferred] = await Promise.all([
  primary.advance({ image, instance: { state: repositoryRequest.state } }),
  transferred.advance({ image, instance: { state: repositoryRequest.state } }),
]);
assertOutcomeEqual(repositoryRequest, repeatedRepositoryPrimary);
assertOutcomeEqual(repositoryRequest, repeatedRepositoryTransferred);

const parity = {
  pendingModelStateSha256: sha256(initialModel.state),
  pendingModelRequestSha256: sha256(initialModel.request),
  parserStateSha256: sha256(parserStep.state),
  pendingRepositoryStateSha256: sha256(repositoryRequest.state),
  pendingRepositoryRequestSha256: sha256(repositoryRequest.request),
};
if (options.mode === "transfers") {
  await writeStdout(`${JSON.stringify({
    format: "agent-system-closure-admission-transfers/v1",
    result: "passed",
    kernelSha256: primary.sha256,
    imageSha256: sha256(image),
    transferPoints: [
      "normalized-model-resume",
      "pending-model-request",
      "pending-repository-request",
    ],
    freshHostOutcomeEquality: true,
    repeatedPendingRequestEquality: true,
    parity,
  })}\n`);
  process.exit(0);
}

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
      id: "fixture-function-call",
      call_id: "fixture-call",
      status: "completed",
      name,
      arguments: JSON.stringify(argumentsValue),
    }],
  }));
  return normalizeOpenAIResponses(
    providerBody,
    modelInvocation.normalizationLimits,
    modelInvocation.tools,
  );
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

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function writeStdout(value) {
  return new Promise((resolve, reject) => {
    process.stdout.write(value, (error) => error ? reject(error) : resolve());
  });
}

function parseArgs(args) {
  const admitted = new Set(["worldRoot", "image", "initial", "mode", "case"]);
  const result = {};
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index];
    const value = args[index + 1];
    assert(key?.startsWith("--") && value !== undefined, "invalid arguments");
    const name = toCamel(key.slice(2));
    assert(admitted.has(name), `unknown admission-check argument --${key.slice(2)}`);
    assert(!(name in result), `duplicate admission-check argument --${key.slice(2)}`);
    result[name] = value;
  }
  for (const key of ["worldRoot", "image", "initial"]) assert(key in result, `missing --${key}`);
  return result;
}

function toCamel(value) {
  return value.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
}
