import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cp, lstat, mkdir, readFile, readdir, realpath, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { startFixtureModelServer } from "./fixture_model_server.mjs";
import { decodeModelRequest, performModelRequest } from "./model_transport.mjs";
import {
  CORRECT_SOURCE,
  EXPECTED_FINAL_DIGEST,
  EXPECTED_FINAL_TREE,
  EXPECTED_INITIAL_DIGEST,
  createRepositoryEnvironment,
  decodeFinalResult,
  sha256,
} from "./repository_environment.mjs";

const options = parseArgs(process.argv.slice(2));
assert(["fixture", "live"].includes(options.mode));
if (options.mode === "live") {
  assert(options.endpoint !== undefined, "live mode requires --endpoint");
  assert(process.env.OPENAI_API_KEY, "live mode requires OPENAI_API_KEY");
}
const distributionRoot = dirname(fileURLToPath(import.meta.url));
const worldRoot = resolve(options.worldRoot);
const workRoot = resolve(options.workDir);
const checkpointPath = join(workRoot, "checkpoint.json");
const workspaceRoot = join(workRoot, "workspace");
const image = await readFile(join(distributionRoot, "system.bpi1"));
const initial = await readFile(join(distributionRoot, "initial-args.bin"));
const runtimeInputSha256 = await digestRuntimeInputs(distributionRoot);
const world = await import(pathToFileURL(join(worldRoot, "src/process_v1/index.mjs")));
const kernel = await readFile(join(worldRoot, "boundary-process-kernel-v1.wasm"));
const worldManifest = JSON.parse(await readFile(join(worldRoot, "runtime-manifest.json"), "utf8"));
assert.equal(worldManifest.format, "world-process-host-runtime/v1");
assert.equal(worldManifest.sourceCommit, "622735238addc1c2612b060a6f6d9c2eb17a7abd");
assert.equal(worldManifest.boundaryCommit, "79a17edafab2ce751a441cfabc7f9f3881474d51");
const worldArchive = await readFile(
  join(worldRoot, "dist/world-v4.1.0-process-host-runtime.tar.gz"),
).catch((error) => error?.code === "ENOENT" ? null : Promise.reject(error));
if (worldArchive !== null) {
  assert.equal(sha256(worldArchive), "ff2d0ae55fb778444f4610c8abcaab01202693ff026fbed3c2c07c8e3c7943ab");
  assert.equal(worldArchive.byteLength, 1_485_957);
}
const host = await world.admitProcessKernel(kernel);
assert.equal(worldManifest.kernelSha256, host.sha256);
assert.equal(worldManifest.kernelByteLength, host.byteLength);
const authorityIdentity = options.mode === "fixture"
  ? "fixture:model-responses-v1"
  : `live:${sha256(Buffer.from(new URL(options.endpoint).href))}`;
const checkpoint = JSON.parse(await readFile(checkpointPath, "utf8").catch((error) => {
  if (error?.code === "ENOENT") return "null";
  throw error;
}));

if (checkpoint !== null) {
  assert.equal(checkpoint.format, "agent-system-closure-fixture-checkpoint/v1");
  assert.equal(checkpoint.imageSha256, sha256(image));
  assert.equal(checkpoint.initialArgsSha256, sha256(initial));
  assert.equal(checkpoint.mode, options.mode, "checkpoint execution mode changed");
  assert.equal(checkpoint.authorityIdentity, authorityIdentity, "checkpoint model authority changed");
  assert.equal(checkpoint.runtimeInputSha256, runtimeInputSha256, "checkpoint runtime inputs changed");
} else {
  await mkdir(workRoot, { recursive: true });
  await cp(join(distributionRoot, "fixture"), workspaceRoot, { recursive: true, errorOnExist: true });
  initializeGit(workspaceRoot);
}

const initialTree = checkpoint?.initialTree ?? git(workspaceRoot, ["rev-parse", "HEAD^{tree}"]);
const repository = await createRepositoryEnvironment(workspaceRoot, checkpoint ?? {});
if (checkpoint === null) {
  assert.equal(sha256(await repository.admittedRead("src/range.mjs")), EXPECTED_INITIAL_DIGEST);
}
const fixtureModel = options.mode === "fixture"
  ? await startFixtureModelServer(checkpoint?.modelDecision ?? 0)
  : null;
let instance = checkpoint === null
  ? { initialArgs: initial }
  : { state: Buffer.from(checkpoint.state, "base64") };
let effectResult = checkpoint?.effectResult === null || checkpoint?.effectResult === undefined
  ? undefined
  : Buffer.from(checkpoint.effectResult, "base64");
let reductions = checkpoint?.reductions ?? 0;
let modelRequests = checkpoint?.modelRequests ?? 0;
let httpBodyEqualityCount = checkpoint?.httpBodyEqualityCount ?? 0;
let peakStateBytes = checkpoint?.peakStateBytes ?? 0;
let renderingMilliseconds = checkpoint?.renderingMilliseconds ?? 0;
let decodingMilliseconds = checkpoint?.decodingMilliseconds ?? 0;
let offlineRuntimeMilliseconds = checkpoint?.offlineRuntimeMilliseconds ?? 0;
let phase = checkpoint?.phase ?? "rendering";
const identities = checkpoint?.identities ?? [];
const requestBodySha256 = checkpoint?.requestBodySha256 ?? [];
const maximumReductions = Number(options.maximumReductions);
assert(Number.isSafeInteger(maximumReductions) && maximumReductions > 0);
let chunkReductions = 0;
let terminal;

try {
  for (;;) {
    const advanceStarted = performance.now();
    const outcome = await host.advance({ image, instance, effectResult });
    const advanceMilliseconds = performance.now() - advanceStarted;
    offlineRuntimeMilliseconds += advanceMilliseconds;
    if (phase === "rendering") renderingMilliseconds += advanceMilliseconds;
    if (phase === "decoding") decodingMilliseconds += advanceMilliseconds;
    if (outcome.state !== undefined) peakStateBytes = Math.max(peakStateBytes, outcome.state.byteLength);
    reductions += 1;
    chunkReductions += 1;
    effectResult = undefined;
    assert(reductions <= 30_000, "reduction limit exceeded");
    switch (outcome.kind) {
      case "Progressed":
      case "ExplicitlyYielded":
        instance = { state: outcome.state };
        break;
      case "Requested": {
        const request = world.decodeEffectRequest(outcome.request);
        identities.push(request.effectSemanticIdentity);
        let resume;
        if (request.effectSemanticIdentity === "agent.model.openai.responses.v1") {
          modelRequests += 1;
          const decoded = decodeModelRequest(request.payload);
          assert.equal(decoded.maximumResponseBytes, 32 * 1024);
          if (fixtureModel !== null) {
            const captureIndex = fixtureModel.captures.length;
            resume = await performModelRequest(request.payload, { endpoint: fixtureModel.endpoint });
            assert.equal(fixtureModel.captures.length, captureIndex + 1);
            assert.deepEqual(fixtureModel.captures[captureIndex], decoded.body);
            httpBodyEqualityCount += 1;
          } else {
            resume = await performModelRequest(request.payload, {
              endpoint: options.endpoint,
              apiKey: process.env.OPENAI_API_KEY,
            });
          }
          requestBodySha256.push(sha256(decoded.body));
          phase = "decoding";
        } else {
          resume = await repository.resolveEffect(request);
          phase = "rendering";
        }
        effectResult = world.encodeEffectResult({ request: outcome.request, resume });
        instance = { state: outcome.state };
        break;
      }
      case "Completed":
        terminal = outcome.result;
        break;
      case "AuthoredFailure":
        throw new Error(`authored failure ${Buffer.from(outcome.failure).toString("hex")}`);
      case "NeedsCapacity":
        throw new Error("unexpected NeedsCapacity");
      default:
        throw new Error(`unexpected Process outcome ${outcome.kind}`);
    }
    if (terminal !== undefined || chunkReductions >= maximumReductions) break;
  }
} finally {
  if (fixtureModel !== null) await fixtureModel.close();
}

const repositoryState = repository.snapshot();
if (terminal === undefined) {
  assert(instance.state !== undefined);
  const persisted = {
    format: "agent-system-closure-fixture-checkpoint/v1",
    imageSha256: sha256(image),
    initialArgsSha256: sha256(initial),
    mode: options.mode,
    authorityIdentity,
    runtimeInputSha256,
    initialTree,
    state: Buffer.from(instance.state).toString("base64"),
    effectResult: effectResult === undefined ? null : Buffer.from(effectResult).toString("base64"),
    reductions,
    modelDecision: fixtureModel?.decision,
    modelRequests,
    httpBodyEqualityCount,
    peakStateBytes,
    renderingMilliseconds,
    decodingMilliseconds,
    offlineRuntimeMilliseconds,
    phase,
    identities,
    requestBodySha256,
    ...repositoryState,
  };
  const replacement = `${checkpointPath}.next`;
  await rm(replacement, { force: true });
  await writeFile(replacement, `${JSON.stringify(persisted)}\n`, "utf8");
  await rename(replacement, checkpointPath);
  process.stdout.write(`${JSON.stringify({
    format: "agent-system-closure-world-chunk/v1",
    result: "checkpointed",
    chunkReductions,
    reductions,
    modelDecision: fixtureModel?.decision,
    repositoryRequests: repositoryState.repositoryRequests,
  })}\n`);
  process.exit(0);
}

await rm(checkpointPath, { force: true });
const finalResult = decodeFinalResult(terminal);
assert.deepEqual(finalResult, {
  summary: "Corrected normalizeRange and verified the complete suite.",
  changed_path: "src/range.mjs",
  final_source_sha256: EXPECTED_FINAL_DIGEST,
});
assert.equal(repositoryState.baselineFailed, true);
assert.equal(repositoryState.mutationApplied, true);
assert.equal(repositoryState.postMutationPassed, true);
if (fixtureModel !== null) assert.equal(fixtureModel.decision, 8);
const sourceAfter = await repository.admittedRead("src/range.mjs");
assert.equal(sha256(sourceAfter), EXPECTED_FINAL_DIGEST);
assert.equal(sourceAfter.toString("utf8"), CORRECT_SOURCE);
git(workspaceRoot, ["add", "--", "src/range.mjs"]);
const finalTree = git(workspaceRoot, ["write-tree"]);
assert.equal(finalTree, EXPECTED_FINAL_TREE);
assert.deepEqual(git(workspaceRoot, ["diff", "--cached", "--name-only"]).split("\n"), ["src/range.mjs"]);
if (fixtureModel !== null) assert.equal(httpBodyEqualityCount, modelRequests);

process.stdout.write(`${JSON.stringify({
  format: "agent-system-closure-world-proof/v1",
  result: "passed",
  kernelSha256: host.sha256,
  kernelByteLength: host.byteLength,
  worldVersion: worldManifest.worldVersion,
  worldSourceCommit: worldManifest.sourceCommit,
  worldRuntimeArchiveSha256: worldArchive === null ? null : sha256(worldArchive),
  worldRuntimeArchiveByteLength: worldArchive?.byteLength ?? null,
  boundarySourceCommit: worldManifest.boundaryCommit,
  imageSha256: sha256(image),
  imageByteLength: image.byteLength,
  initialArgsSha256: sha256(initial),
  initialArgsByteLength: initial.byteLength,
  reductions,
  modelRequests,
  repositoryRequests: repositoryState.repositoryRequests,
  orderedIdentities: identities,
  requestBodySha256,
  conditionalSkillVisible: true,
  httpBodyEqualityCount,
  rawHttpResponsePreserved: true,
  runtimeInputSha256,
  peakStateBytes,
  renderingMilliseconds: Math.round(renderingMilliseconds),
  decodingMilliseconds: Math.round(decodingMilliseconds),
  offlineRuntimeMilliseconds: Math.round(offlineRuntimeMilliseconds),
  initialTree,
  finalTree,
  finalSourceSha256: EXPECTED_FINAL_DIGEST,
  terminalSha256: sha256(terminal),
  realFilesystemEffects: true,
  realTestProcesses: 2,
  liveModelTestStatus: options.mode === "live" ? "passed" : "not-run",
})}\n`);

async function digestRuntimeInputs(root) {
  const names = [
    "run.mjs",
    "runtime.mjs",
    "model_transport.mjs",
    "fixture_model_server.mjs",
    "repository_environment.mjs",
  ];
  async function addTree(directory, prefix) {
    for (const entry of (await readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      const path = join(directory, entry.name);
      const name = `${prefix}/${entry.name}`;
      const stat = await lstat(path);
      assert(!stat.isSymbolicLink(), `runtime input link is forbidden: ${name}`);
      if (entry.isDirectory()) await addTree(path, name);
      else if (entry.isFile()) names.push(name);
      else throw new Error(`unsupported runtime input: ${name}`);
    }
  }
  await addTree(join(root, "fixture"), "fixture");
  const records = [];
  for (const name of names.sort()) records.push([name, sha256(await readFile(join(root, name)))]);
  return sha256(Buffer.from(JSON.stringify(records)));
}

function initializeGit(cwd) {
  git(cwd, ["init", "--quiet"]);
  git(cwd, ["config", "user.name", "Agent System Closure Fixture"]);
  git(cwd, ["config", "user.email", "agent-system@example.invalid"]);
  git(cwd, ["add", "--", "README.md", "package.json", "src/range.mjs", "test/range.test.mjs"]);
  git(cwd, ["commit", "--quiet", "-m", "fixture baseline"]);
}

function git(cwd, args) {
  const result = spawnSync("git", args, {
    cwd,
    encoding: "utf8",
    env: { PATH: process.env.PATH ?? "" },
  });
  if (result.status !== 0) throw new Error(`git ${args[0]} failed: ${result.stderr}`);
  return result.stdout.trim();
}

function parseArgs(args) {
  const result = {};
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index];
    const value = args[index + 1];
    assert(key?.startsWith("--") && value !== undefined, "invalid arguments");
    result[key.slice(2)] = value;
  }
  for (const key of ["worldRoot", "workDir", "mode", "maximumReductions"]) {
    assert(key in result, `missing --${key}`);
  }
  return result;
}
