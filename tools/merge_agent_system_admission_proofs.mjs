import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const paths = process.argv.slice(2);
assert.equal(paths.length, 6, "expected transfer, portable negatives, native, and fixture proofs");
const proofs = await Promise.all(
  paths.map(async (path) => JSON.parse(await readFile(path, "utf8"))),
);
const transfers = proofs.find((proof) =>
  proof.format === "agent-system-closure-admission-transfers/v1");
const nativeProof = proofs.find((proof) =>
  proof.format === "agent-system-native-admission-proof/v1");
const distributionProof = proofs.find((proof) =>
  proof.format === "agent-system-closure-distribution-check/v1");
const fixtureProof = distributionProof?.execution;
const negativeCases = proofs.filter((proof) =>
  proof.format === "agent-system-closure-admission-negative-case/v1");
assert.equal(proofs.filter((proof) =>
  proof.format === "agent-system-closure-admission-transfers/v1").length, 1);
assert.equal(proofs.filter((proof) =>
  proof.format === "agent-system-native-admission-proof/v1").length, 1);
assert.equal(proofs.filter((proof) =>
  proof.format === "agent-system-closure-distribution-check/v1").length, 1);
assert(transfers !== undefined, "transfer proof is missing");
assert(nativeProof !== undefined, "native admission proof is missing");
assert(fixtureProof !== undefined, "World fixture proof is missing");
assert.equal(distributionProof.result, "passed");
assert.equal(distributionProof.extractionBindingNegative, "passed");
assert.equal(distributionProof.extractionInventoryNegative, "passed");
assert.equal(transfers.format, "agent-system-closure-admission-transfers/v1");
assert.equal(transfers.result, "passed");
assert.equal(transfers.freshHostOutcomeEquality, true);
assert.equal(transfers.repeatedPendingRequestEquality, true);
assert.equal(nativeProof.result, "passed");
assert.equal(nativeProof.nativeProcessImageSemantics, true);
assert.equal(fixtureProof.result, "passed");
const publicProof = distributionProof.publicVerification;
assert.equal(publicProof?.result, "passed");
assert.equal(publicProof.publicNegativeResult, "passed");
assert.equal(publicProof.dangerousRepositoryEffects, 0);
assert.equal(publicProof.prematureSuccessfulCompletions, 0);
assert.equal(publicProof.liveModelTestStatus, "not-run");
assert(Array.isArray(publicProof.semanticResults));
assert.equal(nativeProof.imageSha256, transfers.imageSha256);
assert.equal(fixtureProof.imageSha256, transfers.imageSha256);
assert.equal(fixtureProof.kernelSha256, transfers.kernelSha256);
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
  assertZeroCounter(proof.dangerousRepositoryEffects, "dangerousRepositoryEffects");
  assertZeroCounter(
    proof.successfulPrematureCompletions,
    "successfulPrematureCompletions",
  );
}
negativeCases.sort(
  (left, right) => expectedNames.indexOf(left.negativeResult.name) -
    expectedNames.indexOf(right.negativeResult.name),
);
assert.deepEqual(negativeCases.map((proof) => proof.negativeResult.name), expectedNames);
const negativeResults = negativeCases.map((proof) => proof.negativeResult);
const staleDigestResults = publicProof.semanticResults.filter(
  (entry) => entry.name === "stale-digest-replacement",
);
assert.equal(staleDigestResults.length, 1);
const policyFailureSha256 = staleDigestResults[0].failureSha256;
const wasmParity = {
  ...transfers.parity,
  policyFailureSha256,
  completionSha256: fixtureProof.terminalSha256,
};
assert.deepEqual(nativeProof.parity, wasmParity,
  "native and WASM Agent outcomes differ");
assert.deepEqual(nativeProof.negativeResults, [
  { name: "stale-digest-replacement", failure: "policy_denied" },
  { name: "wrong-final-path", failure: "policy_denied" },
  { name: "wrong-final-digest", failure: "policy_denied" },
]);
const dangerousRepositoryEffects = negativeCases.reduce(
  (sum, proof) => sum + proof.dangerousRepositoryEffects,
  0,
);
const successfulPrematureCompletions = negativeCases.reduce(
  (sum, proof) => sum + proof.successfulPrematureCompletions,
  0,
);
assert.equal(dangerousRepositoryEffects, 0, "admission proof observed a dangerous effect");
assert.equal(successfulPrematureCompletions, 0,
  "admission proof observed a premature completion");

process.stdout.write(`${JSON.stringify({
  format: "agent-system-closure-admission-negatives/v1",
  result: "passed",
  kernelSha256: transfers.kernelSha256,
  imageSha256: transfers.imageSha256,
  negativeResults,
  nativeNegativeResults: nativeProof.negativeResults,
  nativeProcessImageSemantics: nativeProof.nativeProcessImageSemantics,
  dangerousRepositoryEffects,
  successfulPrematureCompletions,
  transferPoints: transfers.transferPoints,
  freshHostOutcomeEquality: transfers.freshHostOutcomeEquality,
  repeatedPendingRequestEquality: transfers.repeatedPendingRequestEquality,
  nativeWasmParity: nativeProof.parity,
}, null, 2)}\n`);

function assertZeroCounter(value, label) {
  assert(Number.isSafeInteger(value) && value >= 0, `${label} must be nonnegative`);
  assert.equal(value, 0, `admission proof observed ${label}`);
}
