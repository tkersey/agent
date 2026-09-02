import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  cp,
  lstat,
  mkdir,
  mkdtemp,
  open,
  readFile,
  realpath,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { ProcessStateCensus } from "../system_closure_v1/process_state_census.mjs";
import {
  decodeModelInvocation,
  encodeOpenAIResponsesRequest,
  normalizeOpenAIResponses,
} from "../system_closure_v1/model_protocol_adapter.mjs";

const EXPECTED_INITIAL_DIGEST = "8832f65e4bcf4a701dc76f310f3af34296bf8e95feb16ad70608041cb2e6dbb3";
const EXPECTED_FINAL_DIGEST = "8bf50f62e3a4294ef359a6b9096d66e5597ce37824b3483ddad541ee21438453";
const EXPECTED_FINAL_TREE = "0d9ac8802aac6597cb0a443245efb6f92a0249fe";
const CORRECT_SOURCE = `export function normalizeRange(start, end) {
  if (start <= end) {
    return { start, end };
  }
  return { start: end, end: start };
}
`;
const ACTIONS = [
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
];

const options = parseArgs(process.argv.slice(2));
const worldRoot = resolve(options.worldRoot);
const agentRoot = resolve(options.agentRoot);
const world = await import(pathToFileURL(join(worldRoot, "src/process_v1/index.mjs")));
const kernel = await readFile(join(worldRoot, "boundary-process-kernel-v1.wasm"));
const host = await world.admitProcessKernel(kernel);
const image = await readFile(options.image);
const initial = await readFile(options.initial);
const expectedFinal = await readFile(options.expectedFinal);
const sourceMap = options.sourceMap === undefined
  ? null
  : JSON.parse(await readFile(options.sourceMap, "utf8"));
const census = sourceMap === null ? null : new ProcessStateCensus({ image, sourceMap });
const temporaryRoot = options.workRoot === undefined
  ? await mkdtemp(join(tmpdir(), "agent-system-closure-v1-"))
  : resolve(options.workRoot);
const checkpointPath = options.workRoot === undefined
  ? undefined
  : join(temporaryRoot, "checkpoint.json");
let checkpoint;
if (checkpointPath !== undefined) {
  checkpoint = JSON.parse(await readFile(checkpointPath, "utf8").catch((error) => {
    if (error?.code === "ENOENT") return "null";
    throw error;
  }));
}
if (checkpoint !== undefined && checkpoint !== null) {
  assert.equal(checkpoint.format, "agent-system-closure-fixture-checkpoint/v1");
  assert.equal(checkpoint.imageSha256, sha256(image));
  assert.equal(checkpoint.initialArgsSha256, sha256(initial));
}
const workspaceRoot = join(temporaryRoot, "workspace");
if (checkpoint === undefined || checkpoint === null) {
  if (options.workRoot !== undefined) await mkdir(temporaryRoot, { recursive: true });
  await cp(join(agentRoot, "fixtures/repository-repair-v1"), workspaceRoot, {
    recursive: true,
    errorOnExist: true,
  });
  initializeGit(workspaceRoot);
}
const workspaceReal = await realpath(workspaceRoot);
const initialTree = checkpoint?.initialTree ?? git(workspaceRoot, ["rev-parse", "HEAD^{tree}"]);
if (checkpoint === undefined || checkpoint === null) {
  const sourceBefore = await admittedRead("src/range.mjs");
  assert.equal(sha256(sourceBefore), EXPECTED_INITIAL_DIGEST);
}

let instance = checkpoint === undefined || checkpoint === null
  ? { initialArgs: initial }
  : { state: Buffer.from(checkpoint.state, "base64") };
let effectResult = checkpoint?.effectResult === null || checkpoint?.effectResult === undefined
  ? undefined
  : Buffer.from(checkpoint.effectResult, "base64");
let reductions = checkpoint?.reductions ?? 0;
let modelDecision = checkpoint?.modelDecision ?? 0;
let baselineFailed = checkpoint?.baselineFailed ?? false;
let mutationApplied = checkpoint?.mutationApplied ?? false;
let postMutationPassed = checkpoint?.postMutationPassed ?? false;
let modelRequests = checkpoint?.modelRequests ?? 0;
let repositoryRequests = checkpoint?.repositoryRequests ?? 0;
const identities = checkpoint?.identities ?? [];
const requestBodies = checkpoint?.requestBodies ?? [];
const modelInvocationSha256 = checkpoint?.modelInvocationSha256 ?? [];
const maximumReductions = options.maximumReductions === undefined
  ? undefined
  : Number(options.maximumReductions);
assert(maximumReductions === undefined ||
  (Number.isSafeInteger(maximumReductions) && maximumReductions > 0));
assert(census === null || maximumReductions === undefined,
  "State census requires one uninterrupted fixture execution");
let chunkReductions = 0;
let terminal;

for (;;) {
  const outcome = await host.advance({ image, instance, effectResult });
  reductions += 1;
  chunkReductions += 1;
  effectResult = undefined;
  if (reductions > 30_000) fail("reduction limit exceeded");
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
      const resume = await resolveEffect(request);
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
      fail(`authored failure ${Buffer.from(outcome.failure).toString("hex")}`);
      break;
    case "NeedsCapacity":
      census?.observe({ outcome });
      fail("unexpected NeedsCapacity");
      break;
    default:
      fail(`unexpected Process outcome ${outcome.kind}`);
  }
  if (terminal !== undefined) break;
  if (maximumReductions !== undefined && chunkReductions >= maximumReductions) {
    assert(checkpointPath !== undefined);
    assert(instance.state !== undefined);
    const persisted = {
      format: "agent-system-closure-fixture-checkpoint/v1",
      imageSha256: sha256(image),
      initialArgsSha256: sha256(initial),
      initialTree,
      state: Buffer.from(instance.state).toString("base64"),
      effectResult: effectResult === undefined
        ? null
        : Buffer.from(effectResult).toString("base64"),
      reductions,
      modelDecision,
      baselineFailed,
      mutationApplied,
      postMutationPassed,
      modelRequests,
      repositoryRequests,
      identities,
      requestBodies,
      modelInvocationSha256,
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
      modelDecision,
      repositoryRequests,
      checkpointPath,
    })}\n`);
    break;
  }
}

if (terminal === undefined) process.exit(0);
if (checkpointPath !== undefined) await rm(checkpointPath, { force: true });

assert.deepEqual(Buffer.from(terminal), Buffer.from(expectedFinal));
const finalResult = decodeFinalResult(terminal);
assert.deepEqual(finalResult, {
  summary: "Corrected normalizeRange and verified the complete suite.",
  changed_path: "src/range.mjs",
  final_source_sha256: EXPECTED_FINAL_DIGEST,
});
assert.equal(baselineFailed, true);
assert.equal(mutationApplied, true);
assert.equal(postMutationPassed, true);
assert.equal(modelDecision, ACTIONS.length);
const sourceAfter = await admittedRead("src/range.mjs");
assert.equal(sha256(sourceAfter), EXPECTED_FINAL_DIGEST);
assert.equal(sourceAfter.toString("utf8"), CORRECT_SOURCE);
git(workspaceRoot, ["add", "--", "src/range.mjs"]);
const finalTree = git(workspaceRoot, ["write-tree"]);
assert.equal(finalTree, EXPECTED_FINAL_TREE);
assert.deepEqual(git(workspaceRoot, ["diff", "--cached", "--name-only"]).split("\n"), ["src/range.mjs"]);

const stateCensus = census?.report() ?? null;
let stateCensusReceipt = stateCensus;
if (stateCensus !== null && options.censusOutput !== undefined) {
  await writeFile(options.censusOutput, `${JSON.stringify(stateCensus, null, 2)}\n`, {
    encoding: "utf8",
    flag: "wx",
  });
  const { rows: _, ...summary } = stateCensus;
  stateCensusReceipt = { ...summary, receiptPath: options.censusOutput };
}

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
  repositoryRequests,
  orderedIdentities: identities,
  modelInvocationSha256,
  providerRequestBodySha256: requestBodies.map((body) => sha256(Buffer.from(body))),
  conditionalSkillVisible: requestBodies.slice(5).every((body) =>
    body.includes("After the baseline failure")),
  initialTree,
  finalTree,
  finalSourceSha256: EXPECTED_FINAL_DIGEST,
  terminalSha256: sha256(terminal),
  realFilesystemEffects: true,
  realTestProcesses: 2,
  liveModelTestStatus: "not-run",
  stateCensus: stateCensusReceipt,
})}\n`);

async function resolveEffect(request) {
  if (request.effectSemanticIdentity === "agent.model.invoke.v2") {
    modelRequests += 1;
    modelInvocationSha256.push(sha256(request.payload));
    const decoded = decodeModelInvocation(request.payload);
    assert.equal(decoded.maximumProviderResponseBytes, 32 * 1024);
    const requestBody = encodeOpenAIResponsesRequest(decoded);
    const body = JSON.parse(requestBody);
    requestBodies.push(requestBody.toString("utf8"));
    assert.equal(body.model, "gpt-5.4-mini-2026-03-17");
    assert.equal(body.tool_choice, "required");
    assert.equal(body.parallel_tool_calls, false);
    assert.equal(body.store, false);
    assert.equal(body.stream, false);
    assert.equal(body.background, false);
    assert.equal(body.truncation, "disabled");
    const toolNames = body.tools.map((tool) => tool.name);
    const inspection = ["list_repository", "read_file", "search_text", "run_tests"];
    const expectedTools = modelDecision < 5
      ? inspection
      : [...inspection, "replace_file", "finish"];
    assert.deepEqual(toolNames, expectedTools);
    const rendered = JSON.stringify(body.input);
    assert(rendered.includes("List, read the admitted files"));
    if (modelDecision < 5) assert(!rendered.includes("After the baseline failure"));
    else assert(rendered.includes("After the baseline failure"));
    const action = ACTIONS[modelDecision++] ?? fail("unexpected extra model request");
    const providerBody = Buffer.from(JSON.stringify({
      status: "completed",
      error: null,
      output: [{
        type: "function_call",
        id: `fc_${modelDecision}`,
        call_id: `call_${modelDecision}`,
        status: "completed",
        name: action[0],
        arguments: JSON.stringify(action[1]),
      }],
    }));
    return normalizeOpenAIResponses(
      providerBody,
      decoded.normalizationLimits,
      decoded.tools,
    );
  }

  repositoryRequests += 1;
  switch (request.effectSemanticIdentity) {
    case "repo.list.v1": {
      assert.equal(request.payload.length, 0);
      const paths = ["README.md", "package.json", "src/range.mjs", "test/range.test.mjs"];
      for (const path of paths) await admittedRead(path);
      return encodeText(paths.join("\n"));
    }
    case "repo.read.v1": {
      assert.equal(request.payload.length, 1);
      const role = request.payload[0];
      const path = ["package.json", "src/range.mjs", "test/range.test.mjs"][role];
      if (path === undefined) fail("invalid read role");
      const contents = await admittedRead(path);
      return concat(Buffer.from([role]), encodeText(path), encodeText(sha256(contents)), encodeText(contents));
    }
    case "repo.search.v1":
      fail("nominal fixture must not require search");
      break;
    case "repo.test.v1": {
      assert.equal(request.payload.length, 0);
      const result = spawnSync("bun", ["test"], {
        cwd: workspaceRoot,
        encoding: "utf8",
        env: { PATH: process.env.PATH ?? "" },
      });
      const passed = result.status === 0;
      const output = clipUtf8(`${result.stdout ?? ""}${result.stderr ?? ""}`, 1900);
      if (!mutationApplied) {
        assert.equal(passed, false);
        baselineFailed = true;
      } else {
        assert.equal(passed, true);
        postMutationPassed = true;
      }
      return concat(Buffer.from([Number(passed)]), encodeText(output));
    }
    case "repo.replace.approved.v1": {
      assert.equal(baselineFailed, true);
      const proposal = decodeReplaceRequest(request.payload);
      assert.deepEqual(proposal, {
        path: "src/range.mjs",
        expected_sha256: EXPECTED_INITIAL_DIGEST,
        replacement: CORRECT_SOURCE,
        rationale: "Correct ascending preservation and descending normalization.",
      });
      const handle = await admittedFile(proposal.path, "r+");
      try {
        const current = await handle.readFile();
        assert.equal(sha256(current), proposal.expected_sha256);
        await handle.truncate(0);
        const replacement = Buffer.from(proposal.replacement, "utf8");
        const written = await handle.write(replacement, 0, replacement.length, 0);
        assert.equal(written.bytesWritten, replacement.length);
        await handle.sync();
      } finally {
        await handle.close();
      }
      mutationApplied = true;
      return concat(
        Buffer.from([1]),
        encodeText(proposal.path),
        encodeText(EXPECTED_INITIAL_DIGEST),
        encodeText(EXPECTED_FINAL_DIGEST),
        encodeText("replacement applied"),
      );
    }
    default:
      fail(`unexpected effect ${request.effectSemanticIdentity}`);
  }
}

async function admittedRead(relativePath) {
  const handle = await admittedFile(relativePath, "r");
  try {
    return await handle.readFile();
  } finally {
    await handle.close();
  }
}

async function admittedFile(relativePath, flags) {
  assert(!relativePath.startsWith("/") && !relativePath.split("/").includes(".."));
  const absolute = join(workspaceRoot, relativePath);
  const parentReal = await realpath(dirname(absolute));
  assert(parentReal === workspaceReal || parentReal.startsWith(`${workspaceReal}/`));
  const stat = await lstat(absolute);
  assert(stat.isFile() && !stat.isSymbolicLink());
  return open(absolute, flags);
}

function decodeReplaceRequest(bytes) {
  const cursor = { value: 0 };
  const result = {
    path: decodeText(bytes, cursor),
    expected_sha256: decodeText(bytes, cursor),
    replacement: decodeText(bytes, cursor),
    rationale: decodeText(bytes, cursor),
  };
  assert.equal(cursor.value, bytes.length);
  return result;
}

function decodeFinalResult(bytes) {
  const cursor = { value: 0 };
  const result = {
    summary: decodeText(bytes, cursor),
    changed_path: decodeText(bytes, cursor),
    final_source_sha256: decodeText(bytes, cursor),
  };
  assert.equal(cursor.value, bytes.length);
  return result;
}

function encodeText(value) {
  return encodeBytes(Buffer.from(value));
}

function encodeBytes(value) {
  const bytes = Buffer.from(value);
  return concat(u32(bytes.length), bytes);
}

function decodeText(bytes, cursor) {
  return new TextDecoder("utf-8", { fatal: true }).decode(decodeBytes(bytes, cursor));
}

function decodeBytes(bytes, cursor) {
  const length = readU32(bytes, cursor);
  assert(length <= bytes.length - cursor.value);
  const result = Buffer.from(bytes.subarray(cursor.value, cursor.value + length));
  cursor.value += length;
  return result;
}

function readU32(bytes, cursor) {
  assert(cursor.value + 4 <= bytes.length);
  const value = Buffer.from(bytes).readUInt32LE(cursor.value);
  cursor.value += 4;
  return value;
}

function u32(value) {
  const bytes = Buffer.alloc(4);
  bytes.writeUInt32LE(value);
  return bytes;
}

function concat(...parts) {
  return Buffer.concat(parts.map((part) => Buffer.from(part)));
}

function clipUtf8(value, maximumBytes) {
  const source = Buffer.from(value);
  if (source.length <= maximumBytes) return value;
  return source.subarray(0, maximumBytes).toString("utf8");
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
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
  if (result.status !== 0) fail(`git ${args[0]} failed: ${result.stderr}`);
  return result.stdout.trim();
}

function parseArgs(args) {
  const result = {};
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index];
    const value = args[index + 1];
    if (!key?.startsWith("--") || value === undefined) fail("invalid arguments");
    result[key.slice(2)] = value;
  }
  for (const key of ["worldRoot", "agentRoot", "image", "initial", "expectedFinal"]) {
    if (!(key in result)) fail(`missing --${key}`);
  }
  return result;
}

function fail(message) {
  throw new Error(message);
}
