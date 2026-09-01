import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cp, mkdir, readFile, realpath, rename, rm, writeFile } from "node:fs/promises";
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
assert.equal(options.mode, "fixture");
const distributionRoot = dirname(fileURLToPath(import.meta.url));
const worldRoot = resolve(options.worldRoot);
const workRoot = resolve(options.workDir);
const checkpointPath = join(workRoot, "checkpoint.json");
const workspaceRoot = join(workRoot, "workspace");
const image = await readFile(join(distributionRoot, "system.bpi1"));
const initial = await readFile(join(distributionRoot, "initial-args.bin"));
const world = await import(pathToFileURL(join(worldRoot, "src/process_v1/index.mjs")));
const kernel = await readFile(join(worldRoot, "boundary-process-kernel-v1.wasm"));
const host = await world.admitProcessKernel(kernel);
const checkpoint = JSON.parse(await readFile(checkpointPath, "utf8").catch((error) => {
  if (error?.code === "ENOENT") return "null";
  throw error;
}));

if (checkpoint !== null) {
  assert.equal(checkpoint.format, "agent-system-closure-fixture-checkpoint/v1");
  assert.equal(checkpoint.imageSha256, sha256(image));
  assert.equal(checkpoint.initialArgsSha256, sha256(initial));
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
const fixtureModel = await startFixtureModelServer(checkpoint?.modelDecision ?? 0);
let instance = checkpoint === null
  ? { initialArgs: initial }
  : { state: Buffer.from(checkpoint.state, "base64") };
let effectResult = checkpoint?.effectResult === null || checkpoint?.effectResult === undefined
  ? undefined
  : Buffer.from(checkpoint.effectResult, "base64");
let reductions = checkpoint?.reductions ?? 0;
let modelRequests = checkpoint?.modelRequests ?? 0;
let httpBodyEqualityCount = checkpoint?.httpBodyEqualityCount ?? 0;
const identities = checkpoint?.identities ?? [];
const requestBodySha256 = checkpoint?.requestBodySha256 ?? [];
const maximumReductions = Number(options.maximumReductions);
assert(Number.isSafeInteger(maximumReductions) && maximumReductions > 0);
let chunkReductions = 0;
let terminal;

try {
  for (;;) {
    const outcome = await host.advance({ image, instance, effectResult });
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
          const captureIndex = fixtureModel.captures.length;
          resume = await performModelRequest(request.payload, { endpoint: fixtureModel.endpoint });
          assert.equal(fixtureModel.captures.length, captureIndex + 1);
          assert.deepEqual(fixtureModel.captures[captureIndex], decoded.body);
          httpBodyEqualityCount += 1;
          requestBodySha256.push(sha256(decoded.body));
        } else {
          resume = await repository.resolveEffect(request);
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
  await fixtureModel.close();
}

const repositoryState = repository.snapshot();
if (terminal === undefined) {
  assert(instance.state !== undefined);
  const persisted = {
    format: "agent-system-closure-fixture-checkpoint/v1",
    imageSha256: sha256(image),
    initialArgsSha256: sha256(initial),
    initialTree,
    state: Buffer.from(instance.state).toString("base64"),
    effectResult: effectResult === undefined ? null : Buffer.from(effectResult).toString("base64"),
    reductions,
    modelDecision: fixtureModel.decision,
    modelRequests,
    httpBodyEqualityCount,
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
    modelDecision: fixtureModel.decision,
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
assert.equal(fixtureModel.decision, 8);
const sourceAfter = await repository.admittedRead("src/range.mjs");
assert.equal(sha256(sourceAfter), EXPECTED_FINAL_DIGEST);
assert.equal(sourceAfter.toString("utf8"), CORRECT_SOURCE);
git(workspaceRoot, ["add", "--", "src/range.mjs"]);
const finalTree = git(workspaceRoot, ["write-tree"]);
assert.equal(finalTree, EXPECTED_FINAL_TREE);
assert.deepEqual(git(workspaceRoot, ["diff", "--cached", "--name-only"]).split("\n"), ["src/range.mjs"]);
assert.equal(httpBodyEqualityCount, modelRequests);

process.stdout.write(`${JSON.stringify({
  format: "agent-system-closure-world-proof/v1",
  result: "passed",
  kernelSha256: host.sha256,
  kernelByteLength: host.byteLength,
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
  initialTree,
  finalTree,
  finalSourceSha256: EXPECTED_FINAL_DIGEST,
  terminalSha256: sha256(terminal),
  realFilesystemEffects: true,
  realTestProcesses: 2,
  liveModelTestStatus: "not-run",
})}\n`);

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
