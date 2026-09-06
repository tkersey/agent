import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { cp, lstat, mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  decodeModelInvocation,
  normalizeOpenAIResponses,
} from "./model_protocol_adapter.mjs";
import {
  CORRECT_SOURCE,
  EXPECTED_FINAL_DIGEST,
  EXPECTED_INITIAL_DIGEST,
  createRepositoryEnvironment,
} from "./repository_environment.mjs";

const options = parseArgs(process.argv.slice(2));
const distributionRoot = dirname(fileURLToPath(import.meta.url));
const worldRoot = resolve(options.worldRoot);
const identity = JSON.parse(await readFile(
  join(distributionRoot, "release_identity.json"),
  "utf8",
));
const worldManifest = JSON.parse(await readFile(
  join(worldRoot, "runtime-manifest.json"),
  "utf8",
));
assert.equal(worldManifest.worldVersion, identity.world.version);
assert.equal(worldManifest.sourceCommit, identity.world.sourceCommit);
assert.equal(worldManifest.boundaryCommit, identity.boundary.sourceCommit);
assert.equal(worldManifest.productionSourceSha256, identity.world.productionSourceSha256);
assert.equal(await digestWorldProductionSource(worldRoot), identity.world.productionSourceSha256);
const kernel = await readFile(join(worldRoot, "boundary-process-kernel-v1.wasm"));
assert.equal(kernel.byteLength, identity.kernel.byteLength);
assert.equal(sha256(kernel), identity.kernel.sha256);
const world = await import(pathToFileURL(join(worldRoot, "src/process_v1/index.mjs")));
const image = await readFile(resolve(options.image ?? join(distributionRoot, "system.bpi1")));
const initial = await readFile(resolve(options.initial ?? join(distributionRoot, "initial-args.bin")));
const fixtureRoot = resolve(options.fixtureRoot ?? join(distributionRoot, "fixture"));

const validActions = Object.freeze([
  ["list_repository", {}],
  ["read_file", { role: 0 }],
  ["read_file", { role: 1 }],
  ["read_file", { role: 2 }],
  ["run_tests", {}],
  ["replace_file", {
    path: "src/range.mjs",
    expected_sha256: EXPECTED_INITIAL_DIGEST,
    replacement: CORRECT_SOURCE,
    rationale: "Correct ascending preservation and descending normalization.",
  }],
  ["run_tests", {}],
  ["finish", {
    summary: "Corrected normalizeRange and verified the complete suite.",
    changed_path: "src/range.mjs",
    final_source_sha256: EXPECTED_FINAL_DIGEST,
  }],
]);

const cases = Object.freeze([
  {
    name: "pre-baseline-replacement",
    decision: 4,
    calls: [["replace_file", validActions[5][1]]],
  },
  {
    name: "disallowed-read-role",
    decision: 1,
    calls: [["read_file", { role: 99 }]],
  },
  {
    name: "stale-digest-replacement",
    decision: 5,
    calls: [["replace_file", {
      ...validActions[5][1],
      expected_sha256: "0".repeat(64),
    }]],
  },
  {
    name: "premature-completion",
    decision: 6,
    calls: [["finish", validActions[7][1]]],
  },
  {
    name: "wrong-final-path",
    decision: 7,
    calls: [["finish", {
      ...validActions[7][1],
      changed_path: "README.md",
    }]],
  },
  {
    name: "wrong-final-digest",
    decision: 7,
    calls: [["finish", {
      ...validActions[7][1],
      final_source_sha256: "0".repeat(64),
    }]],
  },
  {
    name: "unknown-action",
    decision: 0,
    calls: [["unknown_action", {}]],
  },
  {
    name: "unoffered-action",
    decision: 0,
    calls: [["finish", validActions[7][1]]],
  },
  {
    name: "multiple-calls",
    decision: 0,
    calls: [["list_repository", {}], ["read_file", { role: 0 }]],
  },
  {
    name: "malformed-action-arguments",
    decision: 0,
    calls: [["list_repository", "{"]],
  },
]);

const negativeResults = [];
for (const spec of cases) {
  const root = await mkdtemp(join(tmpdir(), "agent-public-negative-"));
  try {
    const workspace = join(root, "workspace");
    await cp(fixtureRoot, workspace, {
      recursive: true,
      errorOnExist: true,
      force: false,
    });
    const repository = await createRepositoryEnvironment(workspace);
    const host = await world.admitProcessKernel(kernel);
    let boundary = await advanceToModel(host, { initialArgs: initial }, undefined, repository);
    for (let decision = 0; decision <= spec.decision; decision += 1) {
      const invocation = decodeModelInvocation(boundary.request.payload);
      const calls = decision === spec.decision ? spec.calls : [validActions[decision]];
      const normalized = normalizeCalls(invocation, calls);
      const effectResult = world.encodeEffectResult({
        request: boundary.outcome.request,
        resume: normalized,
      });
      if (decision === spec.decision) {
        const before = repository.snapshot();
        const terminal = await advanceInvalidTerminal(
          host,
          boundary.outcome.state,
          effectResult,
        );
        const after = repository.snapshot();
        assert.equal(terminal.kind, "AuthoredFailure", spec.name + " did not fail typed");
        assert.deepEqual(after, before, spec.name + " performed a repository effect");
        negativeResults.push({
          name: spec.name,
          terminal: terminal.kind,
          failureSha256: sha256(terminal.failure),
          dangerousRepositoryEffects: 0,
          prematureSuccessfulCompletions: 0,
        });
      } else {
        boundary = await advanceToModel(
          host,
          { state: boundary.outcome.state },
          effectResult,
          repository,
        );
      }
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

process.stdout.write(JSON.stringify({
  format: "agent-system-closure-public-negatives/v1",
  result: "passed",
  imageSha256: sha256(image),
  kernelSha256: sha256(kernel),
  negativeResults,
  dangerousRepositoryEffects: 0,
  prematureSuccessfulCompletions: 0,
}) + "\n");

async function advanceToModel(host, instance, effectResult, repository) {
  let current = instance;
  let resume = effectResult;
  for (let step = 0; step < 8_000; step += 1) {
    const outcome = await host.advance({
      image,
      instance: current,
      effectResult: resume,
    });
    resume = undefined;
    if (outcome.kind === "Requested") {
      const request = world.decodeEffectRequest(outcome.request);
      if (request.effectSemanticIdentity === "agent.model.invoke.v2") {
        return { outcome, request };
      }
      const repositoryResult = await repository.resolveEffect(request);
      resume = world.encodeEffectResult({
        request: outcome.request,
        resume: repositoryResult,
      });
      current = { state: outcome.state };
      continue;
    }
    if (outcome.kind !== "Progressed" && outcome.kind !== "ExplicitlyYielded") {
      throw new Error("expected model request, observed " + outcome.kind);
    }
    current = { state: outcome.state };
  }
  throw new Error("model request reduction limit exceeded");
}

async function advanceInvalidTerminal(host, state, effectResult) {
  let current = { state };
  let resume = effectResult;
  for (let step = 0; step < 8_000; step += 1) {
    const outcome = await host.advance({
      image,
      instance: current,
      effectResult: resume,
    });
    resume = undefined;
    if (outcome.kind === "AuthoredFailure" || outcome.kind === "Completed" ||
        outcome.kind === "NeedsCapacity") {
      return outcome;
    }
    if (outcome.kind === "Requested") {
      const request = world.decodeEffectRequest(outcome.request);
      throw new Error("invalid input escaped as effect " + request.effectSemanticIdentity);
    }
    current = { state: outcome.state };
  }
  throw new Error("invalid-input reduction limit exceeded");
}

function normalizeCalls(invocation, calls) {
  const output = calls.map(([name, value], index) => ({
    type: "function_call",
    id: "negative-" + index,
    call_id: "negative-call-" + index,
    status: "completed",
    name,
    arguments: typeof value === "string" ? value : JSON.stringify(value),
  }));
  return normalizeOpenAIResponses(Buffer.from(JSON.stringify({
    status: "completed",
    error: null,
    output,
  })), invocation.normalizationLimits, invocation.tools);
}

async function digestWorldProductionSource(root) {
  const records = [];
  async function addTree(sourceRoot, prefix) {
    for (const entry of (await readdir(sourceRoot, { withFileTypes: true }))
      .sort((left, right) => left.name.localeCompare(right.name))) {
      const source = join(sourceRoot, entry.name);
      const name = prefix + "/" + entry.name;
      const stat = await lstat(source);
      assert(!stat.isSymbolicLink(), "World production source link is forbidden: " + name);
      if (entry.isDirectory()) await addTree(source, name);
      else if (entry.isFile()) records.push([name, sha256(await readFile(source))]);
      else throw new Error("unsupported World production source: " + name);
    }
  }
  records.push(["bin/world.mjs", sha256(await readFile(join(root, "bin/world.mjs")))]);
  await addTree(join(root, "src/process_v1"), "src/process_v1");
  records.sort(([left], [right]) => Buffer.compare(Buffer.from(left), Buffer.from(right)));
  return sha256(Buffer.from(JSON.stringify([
    "world-production-source/v2",
    records,
  ])));
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function parseArgs(args) {
  const result = {};
  const admitted = new Set(["worldRoot", "image", "initial", "fixtureRoot"]);
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index];
    const value = args[index + 1];
    assert(key?.startsWith("--") && value !== undefined, "invalid arguments");
    const name = key.slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
    assert(admitted.has(name), "unknown public-negative argument --" + key.slice(2));
    assert(!(name in result), "duplicate public-negative argument --" + key.slice(2));
    result[name] = value;
  }
  assert("worldRoot" in result, "missing --world-root");
  return result;
}
