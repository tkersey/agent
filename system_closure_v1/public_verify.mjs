import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  assertRootMatchesArchive,
  assertWorldRootMatchesArchive,
  readBoundedRegularFile,
} from "./world_archive_binding.mjs";

const options = parseArgs(process.argv.slice(2));
const distributionRoot = dirname(fileURLToPath(import.meta.url));
const worldRoot = resolve(options.worldRoot);
const workRoot = resolve(options.workRoot);
assert.deepEqual(await readdir(workRoot), [], "--work-root must be empty");

const receipt = JSON.parse((await readBoundedRegularFile(
  options.agentReceipt,
  64 * 1024,
  "Agent receipt",
)).toString("utf8"));
const agentArchive = await readBoundedRegularFile(
  options.agentArchive,
  2 * 1024 * 1024,
  "Agent archive",
);
const distributionTree = await assertRootMatchesArchive({
  root: distributionRoot,
  archiveBytes: agentArchive,
  archiveRoot: "agent-v3.0.0-system-closure-v1",
  maximumExpandedBytes: 2 * 1024 * 1024,
});
const distributionFiles = new Map(
  [...distributionTree].filter(([, entry]) => entry.kind === "file"),
);
const identityBytes = distributionFiles.get("release_identity.json").bytes;
const identity = JSON.parse(identityBytes.toString("utf8"));
const worldArchive = await readBoundedRegularFile(
  options.worldArchive,
  16 * 1024 * 1024,
  "World archive",
);
assert.equal(receipt.format, "agent-system-closure-artifact-receipt/v1");
assert.equal(receipt.status, "artifact-built");
assert.equal(receipt.liveModelTestStatus, "not-run");
assert.equal(sha256(agentArchive), receipt.archiveSha256);
assert.equal(agentArchive.byteLength, receipt.archiveByteLength);
assert.equal(sha256(identityBytes), receipt.releaseIdentitySha256);
assert.equal(receipt.agentSourceSha256, identity.agentSourceSha256);
assert.equal(sha256(worldArchive), identity.world.archiveSha256);
assert.equal(worldArchive.byteLength, identity.world.archiveByteLength);
assert.equal(receipt.worldRuntimeArchiveSha256, identity.world.archiveSha256);
assert.equal(receipt.worldRuntimeArchiveByteLength, identity.world.archiveByteLength);
await assertWorldRootMatchesArchive({
  worldRoot,
  archiveBytes: worldArchive,
  worldVersion: identity.world.version,
});
const checksumsBytes = distributionFiles.get("checksums.sha256").bytes;
assert.equal(
  sha256(checksumsBytes),
  receipt.checksumsSha256,
  "distribution checksums differ from the supplied Agent receipt",
);
const distributionChecksums = parseChecksums(checksumsBytes);
assert.equal(distributionChecksums.size, receipt.inventoryCount - 1);
assert.deepEqual(
  [...distributionFiles.keys()],
  [...distributionChecksums.keys(), "checksums.sha256"].sort(compareUtf8),
  "distribution inventory differs from the supplied Agent receipt",
);
for (const [name, digest] of distributionChecksums) {
  assert.equal(
    sha256(distributionFiles.get(name).bytes),
    digest,
    `distribution checksum mismatch: ${name}`,
  );
}
assert.equal(identity.agentArtifacts.imageSha256, receipt.imageSha256);
assert.equal(identity.agentArtifacts.imageByteLength, receipt.imageByteLength);
assert.equal(identity.agentArtifacts.initialArgsSha256, receipt.initialArgsSha256);
assert.equal(identity.agentArtifacts.initialArgsByteLength, receipt.initialArgsByteLength);
assert.equal(identity.agentArtifacts.sourceMapSha256, receipt.sourceMapSha256);
assert.equal(
  identity.agentArtifacts.programTransitionDigest,
  receipt.programTransitionIdentity,
);

const fixtureWork = join(workRoot, "fixture");
await mkdir(fixtureWork);
const fixture = runJson([
  join(distributionRoot, "run.mjs"),
  "--world-root", worldRoot,
  "--world-archive", resolve(options.worldArchive),
  "--mode", "fixture",
  "--work-dir", fixtureWork,
], "public fixture");
assert.equal(fixture.result, "passed");
assert(fixture.reductions <= 512);
assert.equal(fixture.modelRequests, 8);
assert.equal(fixture.repositoryRequests, 7);
assert.equal(fixture.imageSha256, receipt.imageSha256);
assert.equal(fixture.initialArgsSha256, receipt.initialArgsSha256);
assert.equal(fixture.runtimeInputSha256, receipt.runtimeInputSha256);
assert.equal(fixture.worldSourceCommit, identity.world.sourceCommit);
assert.equal(fixture.worldRuntimeArchiveSha256, identity.world.archiveSha256);
assert.equal(fixture.kernelSha256, identity.kernel.sha256);
assert.equal(fixture.liveModelTestStatus, "not-run");

const censusWork = join(workRoot, "census");
await mkdir(censusWork);
const census = runJson([
  join(distributionRoot, "run.mjs"),
  "--world-root", worldRoot,
  "--world-archive", resolve(options.worldArchive),
  "--mode", "fixture",
  "--work-dir", censusWork,
  "--census-output", resolve(options.censusOutput),
], "public census");
assert.equal(census.result, "passed");
assert(census.stateCensus !== null);
assert.equal(census.stateCensus.sourceMapSha256, receipt.sourceMapSha256);
assert(census.stateCensus.summary.stateBytes.maximum <= 131_072);
assert(census.stateCensus.maximumProgressedBetweenResidualBoundaries <= 64);

const semanticNegatives = runJson([
  join(distributionRoot, "public_negatives.mjs"),
  "--world-root", worldRoot,
], "public semantic negatives");
assert.equal(semanticNegatives.result, "passed");
assert.equal(semanticNegatives.dangerousRepositoryEffects, 0);
assert.equal(semanticNegatives.prematureSuccessfulCompletions, 0);

const schedulerResults = [];
for (const [name, extra, expected] of [
  ["host-model-substitution", ["--model", "other-model"], /unknown scheduler argument --model/],
  ["host-prompt-mutation", ["--prompt", "other-prompt"], /unknown scheduler argument --prompt/],
  ["host-tool-mutation", ["--tools", "other-tools"], /unknown scheduler argument --tools/],
  ["duplicate-scheduler-control", ["--mode", "fixture"], /duplicate scheduler argument --mode/],
  ["misspelled-scheduler-control", ["--census-ouput", "x"], /unknown scheduler argument --census-ouput/],
]) {
  const work = join(workRoot, name);
  await mkdir(work);
  const result = spawnSync(process.execPath, [
    join(distributionRoot, "run.mjs"),
    "--world-root", worldRoot,
    "--mode", "fixture",
    "--work-dir", work,
    ...extra,
  ], { encoding: "utf8", env: { PATH: process.env.PATH ?? "" } });
  assert.notEqual(result.status, 0, name + " was admitted");
  assert.match(result.stderr, expected);
  assert.deepEqual(await readdir(work), [], name + " performed an effect");
  schedulerResults.push({ name, result: "passed", dangerousRepositoryEffects: 0 });
}

const checkpointWork = join(workRoot, "checkpoint-mode-mismatch");
await mkdir(checkpointWork);
const checkpointKey = "7f".repeat(32);
const first = spawnSync(process.execPath, [
  join(distributionRoot, "runtime.mjs"),
  "--worldRoot", worldRoot,
  "--worldArchive", resolve(options.worldArchive),
  "--workDir", checkpointWork,
  "--mode", "fixture",
  "--maximumReductions", "1",
], {
  encoding: "utf8",
  env: { PATH: process.env.PATH ?? "", AGENT_SYSTEM_CHECKPOINT_KEY: checkpointKey },
  maxBuffer: 4 * 1024 * 1024,
});
assert.equal(first.status, 0, first.stderr);
const checkpoint = JSON.parse(first.stdout.trim());
assert.equal(checkpoint.result, "checkpointed");
assert.equal(checkpoint.repositoryRequests, 0);
const resumed = spawnSync(process.execPath, [
  join(distributionRoot, "runtime.mjs"),
  "--worldRoot", worldRoot,
  "--worldArchive", resolve(options.worldArchive),
  "--workDir", checkpointWork,
  "--mode", "live",
  "--maximumReductions", "1",
  "--endpoint", "https://api.openai.com/v1/responses",
], {
  encoding: "utf8",
  env: {
    PATH: process.env.PATH ?? "",
    AGENT_SYSTEM_CHECKPOINT_KEY: checkpointKey,
    OPENAI_API_KEY: "public-negative-dummy-key",
  },
  maxBuffer: 4 * 1024 * 1024,
});
assert.notEqual(resumed.status, 0);
assert.match(resumed.stderr, /checkpoint execution mode changed/);
schedulerResults.push({
  name: "checkpoint-mode-mismatch",
  result: "passed",
  dangerousRepositoryEffects: 0,
});

const negativeReceipt = {
  format: "agent-system-closure-public-negative-proof/v1",
  result: "passed",
  semanticResults: semanticNegatives.negativeResults,
  schedulerResults,
  dangerousRepositoryEffects: 0,
  prematureSuccessfulCompletions: 0,
};
await writeFile(
  resolve(options.negativeOutput),
  JSON.stringify(negativeReceipt, null, 2) + "\n",
  { encoding: "utf8", flag: "wx" },
);

process.stdout.write(JSON.stringify({
  format: "agent-system-closure-public-verification/v1",
  result: "passed",
  agentArchiveSha256: receipt.archiveSha256,
  worldArchiveSha256: identity.world.archiveSha256,
  kernelSha256: identity.kernel.sha256,
  fixture,
  census: census.stateCensus,
  semanticResults: semanticNegatives.negativeResults,
  negativeCaseCount: semanticNegatives.negativeResults.length + schedulerResults.length,
  publicNegativeResult: "passed",
  dangerousRepositoryEffects: 0,
  prematureSuccessfulCompletions: 0,
  liveModelTestStatus: "not-run",
}) + "\n");

function runJson(args, label) {
  const result = spawnSync(process.execPath, args, {
    encoding: "utf8",
    env: { PATH: process.env.PATH ?? "" },
    timeout: 30 * 60 * 1000,
    maxBuffer: 8 * 1024 * 1024,
  });
  if (result.status !== 0) {
    throw new Error(label + " failed: " + result.stderr);
  }
  return JSON.parse(result.stdout.trim().split("\n").filter(Boolean).at(-1));
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function parseChecksums(bytes) {
  const result = new Map();
  for (const line of bytes.toString("utf8").trimEnd().split("\n")) {
    const match = /^([0-9a-f]{64})  ([^\0\r\n]+)$/.exec(line);
    assert(match, "invalid distribution checksum line");
    const name = match[2];
    assert(!name.startsWith("/") && !name.includes("\\"));
    assert(!name.split("/").includes(".."));
    assert(name !== "checksums.sha256");
    assert(!result.has(name), `duplicate distribution checksum: ${name}`);
    result.set(name, match[1]);
  }
  for (const required of [
    "system.bpi1", "initial-args.bin", "source-map.json",
    "release_identity.json", "run.mjs", "runtime.mjs",
    "model_protocol_adapter.mjs", "repository_environment.mjs",
  ]) assert(result.has(required), `missing distribution checksum: ${required}`);
  return result;
}

function compareUtf8(left, right) {
  return Buffer.compare(Buffer.from(left), Buffer.from(right));
}

function parseArgs(args) {
  const result = {};
  const admitted = new Set([
    "worldRoot", "worldArchive", "agentArchive", "agentReceipt", "workRoot",
    "censusOutput", "negativeOutput",
  ]);
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index];
    const value = args[index + 1];
    assert(key?.startsWith("--") && value !== undefined, "invalid arguments");
    const name = key.slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
    assert(admitted.has(name), "unknown public-verifier argument --" + key.slice(2));
    assert(!(name in result), "duplicate public-verifier argument --" + key.slice(2));
    result[name] = value;
  }
  for (const name of admitted) {
    assert(name in result, "missing public-verifier argument " + name);
  }
  return result;
}
