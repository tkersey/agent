import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { appendFile, copyFile, cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

const [runtime, worldRoot, image, initial, fixture] = process.argv
  .slice(2)
  .map((value) => resolve(value));
const checkpointKey = "7f".repeat(32);
let runtimeUnderTest;

function run(selectedWorld, workDir, maximumReductions = 1, extra = []) {
  return spawnSync(process.execPath, [
    runtimeUnderTest,
    "--worldRoot", selectedWorld,
    "--workDir", workDir,
    "--mode", "fixture",
    "--maximumReductions", String(maximumReductions),
    ...extra,
  ], {
    encoding: "utf8",
    env: { ...process.env, AGENT_SYSTEM_CHECKPOINT_KEY: checkpointKey },
    timeout: 5 * 60 * 1000,
    maxBuffer: 4 * 1024 * 1024,
  });
}

const root = await mkdtemp(join(tmpdir(), "agent-runtime-binding-"));
try {
  const distributionRoot = join(root, "distribution");
  await mkdir(distributionRoot);
  for (const name of [
    "run.mjs",
    "runtime.mjs",
    "model_protocol_adapter.mjs",
    "fixture_model_server.mjs",
    "repository_environment.mjs",
    "process_state_census.mjs",
  ]) {
    await copyFile(join(dirname(runtime), name), join(distributionRoot, name));
  }
  await copyFile(image, join(distributionRoot, "system.bpi1"));
  await copyFile(initial, join(distributionRoot, "initial-args.bin"));
  await cp(fixture, join(distributionRoot, "fixture"), { recursive: true });
  runtimeUnderTest = join(distributionRoot, "runtime.mjs");

  const alternateImage = run(
    worldRoot,
    join(root, "alternate-image-work"),
    1,
    ["--image", image],
  );
  assert.notEqual(alternateImage.status, 0);
  assert.match(alternateImage.stderr, /unknown runtime argument --image/);

  const duplicateMode = run(
    worldRoot,
    join(root, "duplicate-mode-work"),
    1,
    ["--mode", "fixture"],
  );
  assert.notEqual(duplicateMode.status, 0);
  assert.match(duplicateMode.stderr, /duplicate runtime argument --mode/);

  const checkpointWork = join(root, "checkpoint-work");
  const first = run(worldRoot, checkpointWork);
  assert.equal(first.status, 0, first.stderr);
  assert.equal(JSON.parse(first.stdout.trim()).result, "checkpointed");
  const checkpoint = JSON.parse(await readFile(
    join(checkpointWork, "checkpoint.json"),
    "utf8",
  ));
  assert.match(checkpoint.workspaceSha256, /^[0-9a-f]{64}$/);
  assert.match(checkpoint.kernelSha256, /^[0-9a-f]{64}$/);
  assert.equal(checkpoint.worldProductionSourceSha256,
    "8450ef58c83283fae6863b53728a7a8cfc28c61897ff6f077b076c84e1ab8b1e");
  const checkpointPath = join(checkpointWork, "checkpoint.json");
  await writeFile(checkpointPath, `${JSON.stringify({
    ...checkpoint,
    kernelSha256: "0".repeat(64),
  })}\n`);
  const changedKernel = run(worldRoot, checkpointWork);
  assert.notEqual(changedKernel.status, 0);
  assert.match(changedKernel.stderr, /checkpoint integrity check failed/);
  await writeFile(checkpointPath, `${JSON.stringify({
    ...checkpoint,
    baselineFailed: true,
  })}\n`);
  const forgedEvidence = run(worldRoot, checkpointWork);
  assert.notEqual(forgedEvidence.status, 0);
  assert.match(forgedEvidence.stderr, /checkpoint integrity check failed/);
  await writeFile(checkpointPath, `${JSON.stringify(checkpoint)}\n`);
  await appendFile(
    join(checkpointWork, "workspace/test/range.test.mjs"),
    "\n// unauthorized post-checkpoint mutation\n",
  );
  const resumed = run(worldRoot, checkpointWork);
  assert.notEqual(resumed.status, 0);
  assert.match(resumed.stderr, /checkpoint workspace changed after suspension/);

  const existingWork = join(root, "existing-work");
  const existingSource = join(existingWork, "workspace/src/range.mjs");
  await mkdir(join(existingWork, "workspace/src"), { recursive: true });
  await writeFile(existingSource, "must survive\n");
  const overwrite = run(worldRoot, existingWork);
  assert.notEqual(overwrite.status, 0);
  assert.match(overwrite.stderr, /workspace already exists/);
  assert.equal(await readFile(existingSource, "utf8"), "must survive\n");

  const changedWorld = join(root, "changed-world");
  await cp(worldRoot, changedWorld, { recursive: true });
  await appendFile(
    join(changedWorld, "src/process_v1/index.mjs"),
    "\n// unauthorized host mutation\n",
  );
  const changedHost = run(changedWorld, join(root, "changed-host-work"));
  assert.notEqual(changedHost.status, 0);
  assert.match(changedHost.stderr, /executed World production source differs/);
} finally {
  await rm(root, { recursive: true, force: true });
}
