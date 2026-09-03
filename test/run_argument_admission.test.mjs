import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const runner = fileURLToPath(new URL("../system_closure_v1/run.mjs", import.meta.url));

function run(extra) {
  return spawnSync(process.execPath, [
    runner,
    "--world-root", "unused-world",
    "--work-dir", "unused-work",
    "--mode", "fixture",
    ...extra,
  ], { encoding: "utf8" });
}

test("scheduler rejects unknown arguments before execution", () => {
  const result = run(["--census-ouput", "unused-census"]);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /unknown scheduler argument --census-ouput/);
});

test("scheduler rejects duplicate arguments before execution", () => {
  const result = run(["--mode", "fixture"]);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /duplicate scheduler argument --mode/);
});
