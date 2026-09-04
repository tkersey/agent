import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const runner = fileURLToPath(new URL("../system_closure_v1/run.mjs", import.meta.url));

function run(extra) {
  return spawnSync(process.execPath, [
    runner,
    "--world-root", "unused-world",
    "--world-archive", "unused-archive",
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

test("fixture endpoint overrides reject at both entry points before effects", () => {
  for (const name of ["run.mjs", "runtime.mjs"]) {
    const entry = fileURLToPath(new URL(`../system_closure_v1/${name}`, import.meta.url));
    const result = spawnSync(process.execPath, [
      entry,
      "--worldRoot", "unused-world",
      "--worldArchive", "unused-archive",
      "--workDir", "unused-work",
      "--mode", "fixture",
      "--endpoint", "https://api.openai.com/v1/responses",
      ...(name === "runtime.mjs" ? ["--maximumReductions", "1"] : []),
    ], { encoding: "utf8", timeout: 10_000 });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /fixture mode does not accept --endpoint/);
    assert.doesNotMatch(result.stderr, /ENOENT/);
  }
});

test("live endpoint admission precedes workspace effects", () => {
  const work = mkdtempSync(join(tmpdir(), "agent-endpoint-preflight-"));
  try {
    const result = spawnSync(process.execPath, [
      runner,
      "--world-root", "unused-world",
      "--world-archive", "unused-archive",
      "--work-dir", work,
      "--mode", "live",
      "--endpoint", "https://example.com/v1/responses",
    ], {
      encoding: "utf8",
      env: { ...process.env, OPENAI_API_KEY: "fixture-secret" },
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /credentialed model endpoint must be the OpenAI Responses endpoint/);
    assert.deepEqual(readdirSync(work), []);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
});
