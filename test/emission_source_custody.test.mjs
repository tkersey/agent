import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

const emitter = resolve("tools/emit_agent_system_closure_v1.mjs");

test("emission rejects an untracked Agent source", async (context) => {
  const root = await cleanRepository(context);
  await writeFile(join(root, "untracked.zig"), "const changed = true;\n");
  assertDirtyRejected(root);
});

test("emission rejects a modified tracked Agent source", async (context) => {
  const root = await cleanRepository(context);
  await writeFile(join(root, "tracked.zig"), "const changed = true;\n");
  assertDirtyRejected(root);
});

async function cleanRepository(context) {
  const root = await mkdtemp(join(tmpdir(), "agent-emission-custody-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  run("git", ["init", "--quiet"], root);
  run("git", ["config", "user.email", "test@example.invalid"], root);
  run("git", ["config", "user.name", "Agent Test"], root);
  await writeFile(join(root, "tracked.zig"), "const original = true;\n");
  run("git", ["add", "tracked.zig"], root);
  run("git", ["commit", "--quiet", "-m", "fixture"], root);
  return root;
}

function assertDirtyRejected(agentRoot) {
  const result = spawnSync(process.execPath, [
    emitter,
    "--agent-root", agentRoot,
    "--boundary-root", agentRoot,
    "--zig-executable", "zig",
    "--image", "missing",
    "--initial-args", "missing",
    "--source-map", "missing",
    "--archive", "missing",
    "--checksum", "missing",
    "--receipt", "missing",
  ], { encoding: "utf8" });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /active Agent source tree contains uncommitted changes/);
  assert.doesNotMatch(result.stderr, /ENOENT/);
}

function run(command, args, cwd = undefined) {
  const result = spawnSync(command, args, { cwd, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
}
