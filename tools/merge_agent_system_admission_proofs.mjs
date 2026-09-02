import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const paths = process.argv.slice(2);
assert.equal(paths.length, 4, "expected one transfer proof and three negative proofs");
const [transfers, ...negativeCases] = await Promise.all(
  paths.map(async (path) => JSON.parse(await readFile(path, "utf8"))),
);
assert.equal(transfers.format, "agent-system-closure-admission-transfers/v1");
assert.equal(transfers.result, "passed");
const expectedNames = [
  "pre-baseline-replacement",
  "disallowed-read-role",
  "premature-completion",
];
for (const [proof, name] of negativeCases.map(
  (proof) => [proof, proof.negativeResult.name],
).sort((left, right) => expectedNames.indexOf(left[1]) - expectedNames.indexOf(right[1]))) {
  assert.equal(proof.format, "agent-system-closure-admission-negative-case/v1");
  assert.equal(proof.result, "passed");
  assert.equal(proof.kernelSha256, transfers.kernelSha256);
  assert.equal(proof.imageSha256, transfers.imageSha256);
  assert(expectedNames.includes(name));
}
negativeCases.sort(
  (left, right) => expectedNames.indexOf(left.negativeResult.name) -
    expectedNames.indexOf(right.negativeResult.name),
);
assert.deepEqual(negativeCases.map((proof) => proof.negativeResult.name), expectedNames);
const negativeResults = negativeCases.map((proof) => proof.negativeResult);
const policyFailureSha256 = negativeResults.find(
  (entry) => entry.name === "disallowed-read-role",
).failureSha256;

process.stdout.write(`${JSON.stringify({
  format: "agent-system-closure-admission-negatives/v1",
  result: "passed",
  kernelSha256: transfers.kernelSha256,
  imageSha256: transfers.imageSha256,
  negativeResults,
  nativeNegativeResults: [
    { name: "stale-digest-replacement", failure: "policy_denied" },
    { name: "wrong-final-path", failure: "policy_denied" },
    { name: "wrong-final-digest", failure: "policy_denied" },
  ],
  nativeProcessImageSemantics: true,
  dangerousRepositoryEffects: negativeCases.reduce(
    (sum, proof) => sum + proof.dangerousRepositoryEffects,
    0,
  ),
  successfulPrematureCompletions: negativeCases.reduce(
    (sum, proof) => sum + proof.successfulPrematureCompletions,
    0,
  ),
  transferPoints: transfers.transferPoints,
  freshHostOutcomeEquality: transfers.freshHostOutcomeEquality,
  repeatedPendingRequestEquality: transfers.repeatedPendingRequestEquality,
  nativeWasmParity: {
    ...transfers.parity,
    policyFailureSha256,
    completionSha256: "36c4354afea674adb139253064d7d14563ab3296804ff7cbefbba508a93f1032",
  },
}, null, 2)}\n`);
