import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const checker = fileURLToPath(new URL(
  "../tools/check_agent_system_admission_negatives.mjs",
  import.meta.url,
));

function run(extra) {
  return spawnSync(process.execPath, [
    checker,
    "--world-root", "unused-world",
    "--image", "unused-image",
    "--initial", "unused-initial",
    ...extra,
  ], { encoding: "utf8" });
}

test("admission proof rejects unknown arguments before execution", () => {
  const result = run(["--modde", "negative", "--case", "premature-completion"]);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /unknown admission-check argument --modde/);
  assert.doesNotMatch(result.stderr, /ENOENT/);
});

test("admission proof rejects duplicate mode selection", () => {
  const result = run(["--mode", "transfers", "--mode", "negative"]);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /duplicate admission-check argument --mode/);
  assert.doesNotMatch(result.stderr, /ENOENT/);
});
