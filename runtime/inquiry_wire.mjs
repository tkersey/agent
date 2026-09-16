// Binding adapter for the inquiry consumer's ordinary declared effect values.
// No investigator scheduling, hypothesis interpretation or candidate selection.
import assert from "node:assert/strict";
import { acceptanceContract, sourceDigest } from "./inquiry.mjs";

const v = (tag, value = null) => ({ tag, value });

export async function executeInquiryRequest(executor, payload, options = {}) {
  const [subject, key, demand, occurrence] = payload;
  const [path, base, runner, , contract] = subject;
  assert.equal(path, "session.mjs");
  assert.equal(contract, acceptanceContract);
  const experiment = demand.tag === 0 ? [0, "", demand.value[0]]
    : demand.tag === 1 ? [1, demand.value, [0, []]] : null;
  assert(experiment, "unsupported demand");
  assert.deepEqual(key, [subject, experiment], "experiment content key differs from the admitted request");
  assert.equal(typeof occurrence, "bigint");
  assert(occurrence > 0n);
  if (executor.kind !== "qualified") return [subject, key, occurrence, v(2)];
  const source = demand.tag === 0 ? base : demand.value;
  let result;
  try {
    result = demand.tag === 0 ? await executor.probe({ path, source, runner }, {
      mode: experiment[2][0], steps: experiment[2][1],
    }, options) : await executor.validate({ path, source, runner }, contract, options);
  } catch (error) {
    if (error instanceof TypeError) return [subject, key, occurrence, v(1)];
    throw error;
  }
  if (result.kind !== "completed") return [subject, key, occurrence,
    v(result.kind === "unavailable" ? 2 : 1)];
  assert.equal(result.runner, runner);
  assert.equal(result.sourceDigest, sourceDigest(source));
  const observation = demand.tag === 0 ? v(0, result.rows.map(row => [
    row[0], BigInt(row[1]), row[2], BigInt(row[3]), BigInt(row[4]), row[5], BigInt(row[6]), row[7],
  ])) : v(1, [result.passed, BigInt(result.checks.length),
    BigInt(result.checks.filter(check => !check.passed).length),
    [...new Set(result.checks.flatMap(check => check.failures))].sort().join(", ")]);
  return [subject, key, occurrence, v(0, observation)];
}
