import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { appendFile, cp, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const [runtime, worldRoot, image, initial, fixture] = process.argv
  .slice(2)
  .map((value) => resolve(value));

function run(selectedWorld, workDir, maximumReductions = 1) {
  return spawnSync(process.execPath, [
    runtime,
    "--worldRoot", selectedWorld,
    "--workDir", workDir,
    "--mode", "fixture",
    "--maximumReductions", String(maximumReductions),
    "--image", image,
    "--initialArgs", initial,
    "--fixtureRoot", fixture,
  ], {
    encoding: "utf8",
    timeout: 5 * 60 * 1000,
    maxBuffer: 4 * 1024 * 1024,
  });
}

const root = await mkdtemp(join(tmpdir(), "agent-runtime-binding-"));
try {
  const checkpointWork = join(root, "checkpoint-work");
  const first = run(worldRoot, checkpointWork);
  assert.equal(first.status, 0, first.stderr);
  assert.equal(JSON.parse(first.stdout.trim()).result, "checkpointed");
  const checkpoint = JSON.parse(await readFile(
    join(checkpointWork, "checkpoint.json"),
    "utf8",
  ));
  assert.match(checkpoint.workspaceSha256, /^[0-9a-f]{64}$/);
  await appendFile(
    join(checkpointWork, "workspace/test/range.test.mjs"),
    "\n// unauthorized post-checkpoint mutation\n",
  );
  const resumed = run(worldRoot, checkpointWork);
  assert.notEqual(resumed.status, 0);
  assert.match(resumed.stderr, /checkpoint workspace changed after suspension/);

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
