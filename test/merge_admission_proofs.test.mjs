import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

const merger = resolve("tools/merge_agent_system_admission_proofs.mjs");

test("admission merger rejects nonzero violation counters", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "agent-admission-merge-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const paths = await fixtureProofs(root);
  const baseline = spawnSync(process.execPath, [merger, ...paths], { encoding: "utf8" });
  assert.equal(baseline.status, 0, baseline.stderr);
  const changed = JSON.parse(await import("node:fs/promises").then((fs) =>
    fs.readFile(paths[3], "utf8")));
  changed.dangerousRepositoryEffects = 1;
  await writeFile(paths[3], JSON.stringify(changed));
  const rejected = spawnSync(process.execPath, [merger, ...paths], { encoding: "utf8" });
  assert.notEqual(rejected.status, 0);
  assert.match(rejected.stderr, /admission proof observed a dangerous effect/);
});

async function fixtureProofs(root) {
  const parity = { pending: "p" };
  const proofs = [
    {
      format: "agent-system-closure-admission-transfers/v1",
      result: "passed",
      kernelSha256: "kernel",
      imageSha256: "image",
      parity,
      transferPoints: [],
      freshHostOutcomeEquality: true,
      repeatedPendingRequestEquality: true,
    },
    {
      format: "agent-system-native-admission-proof/v1",
      result: "passed",
      imageSha256: "image",
      parity: { ...parity, policyFailureSha256: "policy", completionSha256: "done" },
      negativeResults: [],
      nativeProcessImageSemantics: true,
    },
    {
      format: "agent-system-closure-distribution-check/v1",
      result: "passed",
      execution: { imageSha256: "image", kernelSha256: "kernel", terminalSha256: "done" },
    },
    negative("pre-baseline-replacement", "other"),
    negative("disallowed-read-role", "policy"),
    negative("premature-completion", "other"),
  ];
  const paths = [];
  for (const [index, proof] of proofs.entries()) {
    const path = join(root, `${index}.json`);
    await writeFile(path, JSON.stringify(proof));
    paths.push(path);
  }
  return paths;
}

function negative(name, failureSha256) {
  return {
    format: "agent-system-closure-admission-negative-case/v1",
    result: "passed",
    kernelSha256: "kernel",
    imageSha256: "image",
    negativeResult: { name, failureSha256 },
    dangerousRepositoryEffects: 0,
    successfulPrematureCompletions: 0,
  };
}
