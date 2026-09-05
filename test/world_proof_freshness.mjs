import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";

const [worldRoot, worldArchive, ...zigOptions] = process.argv.slice(2);
assert(worldRoot && isAbsolute(worldRoot), "supply an absolute World runtime root");
assert(worldArchive && isAbsolute(worldArchive), "supply an absolute World archive path");
const evidenceRoot = await mkdtemp(join(tmpdir(), "agent-world-proof-freshness-"));
const args = [
  "build", "check-agent-repository-system-world",
  `-Dworld-process-root=${worldRoot}`, `-Dworld-process-archive=${worldArchive}`,
  "--verbose", "--summary", "all", ...zigOptions,
];

// Exercise the production build graph twice with identical inputs and caches.
// External runtime proof must execute again, not replay captured stdout.
for (const phase of ["warmup", "repeat"]) {
  const result = spawnSync("zig", args, {
    encoding: "utf8", timeout: 30 * 60 * 1000, maxBuffer: 32 * 1024 * 1024,
  });
  const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
  await writeFile(join(evidenceRoot, `${phase}.log`), output, { flag: "wx" });
  assert.equal(result.error, undefined, `${phase}: ${result.error}; logs: ${evidenceRoot}`);
  assert.equal(result.status, 0, `${phase} build failed; logs: ${evidenceRoot}`);
  if (phase !== "repeat") continue;
  const commands = output.split("\n").filter((line) => line.startsWith("node "));
  const admissions = commands.filter((line) =>
    line.includes("tools/check_agent_system_admission_negatives.mjs "));
  assert.equal(admissions.length, 4, `cached admission proof reused; logs: ${evidenceRoot}`);
  for (const selector of [
    "--mode transfers", "--case pre-baseline-replacement",
    "--case disallowed-read-role", "--case premature-completion",
  ]) assert.equal(admissions.filter((line) => line.includes(selector)).length, 1);
  assert.equal(commands.filter((line) =>
    line.includes("tools/check_agent_system_closure_distribution.mjs ")).length, 1,
  `cached World execution proof reused; logs: ${evidenceRoot}`);
}
console.log(JSON.stringify({ result: "passed", evidenceRoot, capturedProofsReexecuted: 5 }));
