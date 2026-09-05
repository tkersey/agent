import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  agentSourceSha256,
  gitRegularTree,
} from "../tools/release_source_identity.mjs";

test("source identity changes with source but not generated evidence", async (context) => {
  const root = await repository(context);
  const initial = agentSourceSha256(root);
  await writeFile(join(root, "economy/generated.json"), "{\"v\":2}\n");
  commit(root, "generated evidence");
  assert.equal(agentSourceSha256(root), initial);
  await mkdir(join(root, "test"));
  await writeFile(join(root, "test/source.test.zig"), "test {}\n");
  commit(root, "test-only change");
  assert.equal(agentSourceSha256(root), initial);
  await writeFile(join(root, "src/main.zig"), "const value = 2;\n");
  commit(root, "source change");
  assert.notEqual(agentSourceSha256(root), initial);
});

test("Git-owned release trees reject tracked symlinks", async (context) => {
  const root = await repository(context);
  await symlink("src/main.zig", join(root, "linked.zig"));
  commit(root, "tracked link");
  assert.throws(() => gitRegularTree(root), /not a regular Git file/);
});

async function repository(context) {
  const root = await mkdtemp(join(tmpdir(), "agent-source-identity-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  run("git", ["init", "--quiet"], root);
  run("git", ["config", "user.email", "test@example.invalid"], root);
  run("git", ["config", "user.name", "Agent Test"], root);
  await mkdir(join(root, "src"));
  await mkdir(join(root, "economy"));
  await mkdir(join(root, "system_closure_v1"));
  await writeFile(join(root, "src/main.zig"), "const value = 1;\n");
  await writeFile(join(root, "economy/generated.json"), "{\"v\":1}\n");
  await writeFile(join(root, "system_closure_v1/release_identity.json"), "{}\n");
  commit(root, "initial");
  return root;
}

function commit(root, message) {
  run("git", ["add", "--all"], root);
  run("git", ["commit", "--quiet", "-m", message], root);
}

function run(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
}
