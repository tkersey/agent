import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  ProcessStateCensus,
  decodeProcessState,
} from "../system_closure_v1/process_state_census.mjs";

const [imagePath, sourceMapPath] = process.argv.slice(2);
assert(imagePath && sourceMapPath, "expected image and source-map paths");
const image = await readFile(imagePath);
const sourceMap = JSON.parse(await readFile(sourceMapPath, "utf8"));
const environment = Buffer.alloc(5_000, 0x5a);
const state = encodeState(sourceMap.programTransitionDigest, [
  { constructorId: 0, environment },
  { constructorId: 0, environment },
]);

const decoded = decodeProcessState(state);
assert.equal(decoded.frames.length, 2);
assert.equal(decoded.frames[0].environment.byteLength, 5_000);
assert.throws(() => decodeProcessState(state, Buffer.alloc(32)));

const census = new ProcessStateCensus({ image, sourceMap });
census.observe({ outcome: { kind: "Progressed", state } });
census.observe({
  outcome: { kind: "Requested", state, request: Buffer.alloc(100) },
  effectSemanticIdentity: "agent.model.openai.responses.v1",
});
census.observe({ outcome: { kind: "Completed", result: Buffer.alloc(0) } });
const report = census.report();
assert.equal(report.format, "agent-process-state-census/v1");
assert.equal(report.reductionCount, 3);
assert.equal(report.stateBearingOutcomeCount, 2);
assert.equal(report.maximumProgressedBetweenResidualBoundaries, 1);
assert.equal(report.rows[0].identicalEnvironmentBlobCopies, 1);
assert.equal(report.rows[0].duplicatedEnvironmentBytes, 5_000);
assert.equal(report.phaseMaxima.pending_model_request.requestBytes, 100);
assert.equal(report.summary.stateBytes.minimum, state.byteLength);
assert.throws(() => decodeProcessState(Buffer.from("not-a-state")));

function encodeState(digestHex, frames) {
  const parts = [
    Buffer.from("ABL_PST1"),
    u16(1),
    u16(0),
    Buffer.from(digestHex, "hex"),
    natural(frames.length),
  ];
  for (const frame of frames) {
    parts.push(natural(frame.constructorId));
    parts.push(natural(frame.environment.byteLength));
    parts.push(frame.environment);
  }
  return Buffer.concat(parts);
}

function natural(value) {
  let remaining = BigInt(value);
  const bytes = [];
  do {
    let byte = Number(remaining & 0x7fn);
    remaining >>= 7n;
    if (remaining !== 0n) byte |= 0x80;
    bytes.push(byte);
  } while (remaining !== 0n);
  return Buffer.from(bytes);
}

function u16(value) {
  const bytes = Buffer.alloc(2);
  bytes.writeUInt16LE(value);
  return bytes;
}
