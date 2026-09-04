import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHmac, timingSafeEqual } from "node:crypto";
import { cp, lstat, mkdir, readFile, readdir, realpath, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { startFixtureModelServer } from "./fixture_model_server.mjs";
import {
  decodeModelInvocation,
  encodeOpenAIResponsesRequest,
  performModelInvocation,
} from "./model_protocol_adapter.mjs";
import {
  MODEL_EFFECT_IDENTITY,
  ProcessStateCensus,
} from "./process_state_census.mjs";
import {
  CORRECT_SOURCE,
  EXPECTED_FINAL_DIGEST,
  EXPECTED_FINAL_TREE,
  EXPECTED_INITIAL_DIGEST,
  createRepositoryEnvironment,
  decodeFinalResult,
  sha256,
  validateFinalResult,
} from "./repository_environment.mjs";

const options = parseArgs(process.argv.slice(2));
assert(["fixture", "live"].includes(options.mode));
if (options.mode === "live") {
  assert(options.endpoint !== undefined, "live mode requires --endpoint");
  assert(process.env.OPENAI_API_KEY, "live mode requires OPENAI_API_KEY");
}
const distributionRoot = dirname(fileURLToPath(import.meta.url));
const releaseIdentity = JSON.parse(await readFile(
  join(distributionRoot, "release_identity.json"),
  "utf8",
));
assert.equal(releaseIdentity.format, "agent-system-closure-release-identity/v1");
assert.equal(releaseIdentity.agentVersion, "3.0.0");
const worldRoot = resolve(options.worldRoot);
const workRoot = resolve(options.workDir);
const checkpointPath = join(workRoot, "checkpoint.json");
const checkpointKeyHex = process.env.AGENT_SYSTEM_CHECKPOINT_KEY;
assert.match(checkpointKeyHex ?? "", /^[0-9a-f]{64}$/,
  "runtime requires one scheduler-owned checkpoint key");
const checkpointKey = Buffer.from(checkpointKeyHex, "hex");
const workspaceRoot = join(workRoot, "workspace");
const image = await readFile(join(distributionRoot, "system.bpi1"));
const initial = await readFile(join(distributionRoot, "initial-args.bin"));
const fixtureRoot = join(distributionRoot, "fixture");
const sourceMapBytes = options.sourceMap === undefined
  ? null
  : await readFile(resolve(options.sourceMap));
const sourceMap = sourceMapBytes === null
  ? null
  : JSON.parse(sourceMapBytes.toString("utf8"));
const census = sourceMap === null
  ? null
  : new ProcessStateCensus({ image, sourceMap, sourceMapBytes });
const runtimeInputSha256 = await digestRuntimeInputs(distributionRoot, fixtureRoot);
const kernel = await readFile(join(worldRoot, "boundary-process-kernel-v1.wasm"));
const worldManifest = JSON.parse(await readFile(join(worldRoot, "runtime-manifest.json"), "utf8"));
assert.equal(worldManifest.format, "world-process-host-runtime/v1");
assert.equal(worldManifest.worldVersion, releaseIdentity.world.version);
assert.equal(worldManifest.sourceCommit, releaseIdentity.world.sourceCommit);
assert.equal(worldManifest.boundaryVersion, releaseIdentity.boundary.version);
assert.equal(worldManifest.boundaryCommit, releaseIdentity.boundary.sourceCommit);
assert.equal(worldManifest.kernelSha256, releaseIdentity.kernel.sha256);
assert.equal(worldManifest.kernelByteLength, releaseIdentity.kernel.byteLength);
assert.equal(worldManifest.kernelImportCount, releaseIdentity.kernel.importCount);
assert.equal(worldManifest.processKernelAbiVersion, releaseIdentity.kernel.abiVersion);
const worldProductionSourceSha256 = await digestWorldProductionSource(worldRoot);
assert.equal(
  worldProductionSourceSha256,
  releaseIdentity.world.productionSourceSha256,
  "executed World production source differs from the pinned release",
);
assert.equal(worldManifest.productionSourceSha256, worldProductionSourceSha256);
const world = await import(pathToFileURL(join(worldRoot, "src/process_v1/index.mjs")));
const host = await world.admitProcessKernel(kernel);
assert.equal(worldManifest.kernelSha256, host.sha256);
assert.equal(worldManifest.kernelByteLength, host.byteLength);
const authorityIdentity = options.mode === "fixture"
  ? "fixture:model-responses-v2"
  : `live:${sha256(Buffer.from(new URL(options.endpoint).href))}:credential:${
    sha256(Buffer.from(process.env.OPENAI_API_KEY))
  }`;
let checkpoint = JSON.parse(await readFile(checkpointPath, "utf8").catch((error) => {
  if (error?.code === "ENOENT") return "null";
  throw error;
}));
assert(sourceMap === null || checkpoint === null,
  "Process State census requires one fresh uninterrupted execution");

if (checkpoint !== null) {
  const { checkpointMac, ...checkpointPayload } = checkpoint;
  assert.match(checkpointMac ?? "", /^[0-9a-f]{64}$/,
    "checkpoint integrity check failed");
  const observedMac = Buffer.from(checkpointMac, "hex");
  const expectedMac = checkpointAuthentication(checkpointPayload, checkpointKey);
  assert(observedMac.byteLength === expectedMac.byteLength &&
    timingSafeEqual(observedMac, expectedMac), "checkpoint integrity check failed");
  checkpoint = checkpointPayload;
  assert.equal(checkpoint.format, "agent-system-closure-fixture-checkpoint/v1");
  assert.equal(checkpoint.imageSha256, sha256(image));
  assert.equal(checkpoint.initialArgsSha256, sha256(initial));
  assert.equal(checkpoint.mode, options.mode, "checkpoint execution mode changed");
  assert.equal(checkpoint.authorityIdentity, authorityIdentity, "checkpoint model authority changed");
  assert.equal(checkpoint.runtimeInputSha256, runtimeInputSha256, "checkpoint runtime inputs changed");
  assert.equal(checkpoint.kernelSha256, host.sha256, "checkpoint Boundary kernel changed");
  assert.equal(checkpoint.kernelByteLength, host.byteLength, "checkpoint Boundary kernel length changed");
  assert.equal(
    checkpoint.worldProductionSourceSha256,
    worldProductionSourceSha256,
    "checkpoint World production source changed",
  );
  assert.equal(
    checkpoint.workspaceSha256,
    await digestWorkspace(workspaceRoot),
    "checkpoint workspace changed after suspension",
  );
} else {
  await mkdir(workRoot, { recursive: true });
  await lstat(workspaceRoot).then(
    () => assert.fail("workspace already exists"),
    (error) => {
      if (error?.code !== "ENOENT") throw error;
    },
  );
  await cp(fixtureRoot, workspaceRoot, {
    recursive: true,
    errorOnExist: true,
    force: false,
  });
  initializeGit(workspaceRoot);
}

const initialTree = checkpoint?.initialTree ?? git(workspaceRoot, ["rev-parse", "HEAD^{tree}"]);
const repository = await createRepositoryEnvironment(
  workspaceRoot,
  checkpoint ?? {},
  options.mode,
);
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
const modelInvocationSha256 = checkpoint?.modelInvocationSha256 ?? [];
const providerRequestBodySha256 = checkpoint?.providerRequestBodySha256 ?? [];
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
        census?.observe({ outcome });
        instance = { state: outcome.state };
        break;
      case "Requested": {
        const request = world.decodeEffectRequest(outcome.request);
        census?.observe({
          outcome,
          effectSemanticIdentity: request.effectSemanticIdentity,
        });
        identities.push(request.effectSemanticIdentity);
        let resume;
        if (request.effectSemanticIdentity === MODEL_EFFECT_IDENTITY) {
          modelRequests += 1;
          modelInvocationSha256.push(sha256(request.payload));
          const decoded = decodeModelInvocation(request.payload);
          assert.equal(decoded.maximumProviderResponseBytes, 64 * 1024);
          const expectedBody = encodeOpenAIResponsesRequest(decoded);
          if (fixtureModel !== null) {
            const captureIndex = fixtureModel.captures.length;
            resume = await performModelInvocation(request.payload, { endpoint: fixtureModel.endpoint });
            assert.equal(fixtureModel.captures.length, captureIndex + 1);
            assert.deepEqual(fixtureModel.captures[captureIndex], expectedBody);
            httpBodyEqualityCount += 1;
          } else {
            resume = await performModelInvocation(request.payload, {
              endpoint: options.endpoint,
              apiKey: process.env.OPENAI_API_KEY,
            });
          }
          providerRequestBodySha256.push(sha256(expectedBody));
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
        census?.observe({ outcome });
        terminal = outcome.result;
        break;
      case "AuthoredFailure":
        census?.observe({ outcome });
        throw new Error(`authored failure ${Buffer.from(outcome.failure).toString("hex")}`);
      case "NeedsCapacity":
        census?.observe({ outcome });
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
    kernelSha256: host.sha256,
    kernelByteLength: host.byteLength,
    worldProductionSourceSha256,
    workspaceSha256: await digestWorkspace(workspaceRoot),
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
    modelInvocationSha256,
    providerRequestBodySha256,
    ...repositoryState,
  };
  const replacement = `${checkpointPath}.next`;
  await rm(replacement, { force: true });
  const checkpointMac = checkpointAuthentication(persisted, checkpointKey).toString("hex");
  await writeFile(replacement, `${JSON.stringify({ ...persisted, checkpointMac })}\n`, "utf8");
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

const finalResult = decodeFinalResult(terminal);
validateFinalResult(finalResult, options.mode);
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

const stateCensus = census?.report() ?? null;
let stateCensusReceipt = stateCensus;
if (stateCensus !== null && options.censusOutput !== undefined) {
  await writeFile(resolve(options.censusOutput), `${JSON.stringify(stateCensus, null, 2)}\n`, {
    encoding: "utf8",
    flag: "wx",
  });
  const { rows: _, ...summary } = stateCensus;
  stateCensusReceipt = { ...summary, receiptPath: resolve(options.censusOutput) };
}

await writeStdout(`${JSON.stringify({
  format: "agent-system-closure-world-proof/v1",
  result: "passed",
  kernelSha256: host.sha256,
  kernelByteLength: host.byteLength,
  worldVersion: worldManifest.worldVersion,
  worldSourceCommit: worldManifest.sourceCommit,
  worldProductionSourceSha256,
  worldRuntimeArchiveSha256: releaseIdentity.world.archiveSha256,
  worldRuntimeArchiveByteLength: releaseIdentity.world.archiveByteLength,
  kernelBoundarySourceCommit: worldManifest.boundaryCommit,
  imageSha256: sha256(image),
  imageByteLength: image.byteLength,
  initialArgsSha256: sha256(initial),
  initialArgsByteLength: initial.byteLength,
  reductions,
  modelRequests,
  repositoryRequests: repositoryState.repositoryRequests,
  orderedIdentities: identities,
  modelInvocationSha256,
  providerRequestBodySha256,
  conditionalSkillVisible: true,
  httpBodyEqualityCount,
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
  realTestProcesses: repositoryState.realTestProcesses,
  liveModelTestStatus: options.mode === "live" ? "passed" : "not-run",
  stateCensus: stateCensusReceipt,
})}\n`);
await rm(checkpointPath, { force: true });

async function digestRuntimeInputs(root, fixture) {
  const runtimeNames = [
    "run.mjs",
    "runtime.mjs",
    "model_protocol_adapter.mjs",
    "fixture_model_server.mjs",
    "repository_environment.mjs",
    "process_state_census.mjs",
    "public_negatives.mjs",
    "public_verify.mjs",
    "release_identity.json",
  ];
  const records = [];
  async function addTree(directory, prefix) {
    for (const entry of (await readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      const path = join(directory, entry.name);
      const name = `${prefix}/${entry.name}`;
      const stat = await lstat(path);
      assert(!stat.isSymbolicLink(), `runtime input link is forbidden: ${name}`);
      if (entry.isDirectory()) await addTree(path, name);
      else if (entry.isFile()) records.push([name, sha256(await readFile(path))]);
      else throw new Error(`unsupported runtime input: ${name}`);
    }
  }
  await addTree(fixture, "fixture");
  for (const name of runtimeNames) {
    records.push([name, sha256(await readFile(join(root, name)))]);
  }
  records.sort(([left], [right]) => Buffer.compare(Buffer.from(left), Buffer.from(right)));
  return sha256(Buffer.from(JSON.stringify(records)));
}

async function digestWorldProductionSource(root) {
  const records = [];
  async function addTree(directory, prefix) {
    for (const entry of (await readdir(directory, { withFileTypes: true }))
      .sort((left, right) => left.name.localeCompare(right.name))) {
      const path = join(directory, entry.name);
      const name = `${prefix}/${entry.name}`;
      const stat = await lstat(path);
      assert(!stat.isSymbolicLink(), `World production source link is forbidden: ${name}`);
      if (entry.isDirectory()) await addTree(path, name);
      else if (entry.isFile()) records.push([name, await readFile(path)]);
      else throw new Error(`unsupported World production source: ${name}`);
    }
  }
  records.push(["bin/world.mjs", await readFile(join(root, "bin/world.mjs"))]);
  await addTree(join(root, "src/process_v1"), "src/process_v1");
  records.sort(([left], [right]) => Buffer.compare(Buffer.from(left), Buffer.from(right)));
  return sha256(Buffer.from(JSON.stringify([
    "world-production-source/v2",
    records.map(([name, bytes]) => [name, sha256(bytes)]),
  ])));
}

async function digestWorkspace(root) {
  const records = [];
  async function addTree(directory, prefix) {
    for (const entry of (await readdir(directory, { withFileTypes: true }))
      .sort((left, right) => left.name.localeCompare(right.name))) {
      if (prefix.length === 0 && entry.name === ".git") continue;
      const path = join(directory, entry.name);
      const name = prefix.length === 0 ? entry.name : `${prefix}/${entry.name}`;
      const stat = await lstat(path);
      assert(!stat.isSymbolicLink(), `checkpoint workspace link is forbidden: ${name}`);
      if (entry.isDirectory()) await addTree(path, name);
      else if (entry.isFile()) records.push([name, sha256(await readFile(path))]);
      else throw new Error(`unsupported checkpoint workspace entry: ${name}`);
    }
  }
  await addTree(root, "");
  records.sort(([left], [right]) => Buffer.compare(Buffer.from(left), Buffer.from(right)));
  return sha256(Buffer.from(JSON.stringify([
    "agent-checkpoint-workspace/v2",
    records,
  ])));
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

function checkpointAuthentication(checkpoint, key) {
  return createHmac("sha256", key).update(JSON.stringify(checkpoint)).digest();
}

function writeStdout(value) {
  return new Promise((resolve, reject) => {
    process.stdout.write(value, (error) => error ? reject(error) : resolve());
  });
}

function parseArgs(args) {
  const admitted = new Set([
    "worldRoot",
    "workDir",
    "mode",
    "maximumReductions",
    "endpoint",
    "sourceMap",
    "censusOutput",
  ]);
  const result = {};
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index];
    const value = args[index + 1];
    assert(key?.startsWith("--") && value !== undefined, "invalid arguments");
    const name = key.slice(2);
    assert(admitted.has(name), `unknown runtime argument --${name}`);
    assert(!(name in result), `duplicate runtime argument --${name}`);
    result[name] = value;
  }
  for (const key of ["worldRoot", "workDir", "mode", "maximumReductions"]) {
    assert(key in result, `missing --${key}`);
  }
  return result;
}
