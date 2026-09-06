import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

import {
  MODEL_EFFECT_IDENTITY,
  ProcessStateCensus,
  decodeProcessState,
} from "../system_closure_v1/process_state_census.mjs";

const [imagePath, sourceMapPath] = process.argv.slice(2);
assert(imagePath && sourceMapPath, "expected image and source-map paths");
const image = await readFile(imagePath);
const sourceMapBytes = await readFile(sourceMapPath);
const sourceMap = JSON.parse(sourceMapBytes.toString("utf8"));
const environment = Buffer.alloc(5_000, 0x5a);
const state = encodeState(sourceMap.programTransitionDigest, [
  { constructorId: 0, environment },
  { constructorId: 0, environment },
]);

const decoded = decodeProcessState(state);
assert.equal(decoded.frames.length, 2);
assert.equal(decoded.frames[0].environment.byteLength, 5_000);
assert.throws(() => decodeProcessState(state, Buffer.alloc(32)));

const census = new ProcessStateCensus({ image, sourceMap, sourceMapBytes });
census.observe({ outcome: { kind: "Progressed", state } });
census.observe({
  outcome: { kind: "Requested", state, request: Buffer.alloc(100) },
  effectSemanticIdentity: MODEL_EFFECT_IDENTITY,
});
census.observe({ outcome: { kind: "Completed", result: Buffer.alloc(0) } });
const report = census.report();
assert.equal(report.format, "agent-process-state-census/v1");
assert.equal(report.sourceMapSha256, sha256(sourceMapBytes));
assert.equal(report.reductionCount, 3);
assert.equal(report.stateBearingOutcomeCount, 2);
assert.equal(report.maximumProgressedBetweenResidualBoundaries, 1);
assert.equal(report.rows[0].identicalEnvironmentBlobCopies, 1);
assert.equal(report.rows[0].duplicatedEnvironmentBytes, 5_000);
assert.equal(
  report.rows[0].phase,
  sourceMap.segments.find((segment) => segment.segmentId === 0).phaseSpans[0].phase,
);
assert.equal(report.phaseMaxima.pending_model_request.requestBytes, 100);
assert.equal(report.summary.stateBytes.minimum, state.byteLength);
assert.throws(() => decodeProcessState(Buffer.from("not-a-state")));

const prefixedNonModelCensus = new ProcessStateCensus({
  image,
  sourceMap,
  sourceMapBytes,
});
prefixedNonModelCensus.observe({
  outcome: { kind: "Requested", state, request: Buffer.alloc(101) },
  effectSemanticIdentity: "agent.model.cache.v1",
});
const prefixedNonModelReport = prefixedNonModelCensus.report();
assert.equal(prefixedNonModelReport.phaseMaxima.pending_model_request, null);
assert.equal(
  prefixedNonModelReport.phaseMaxima.pending_repository_request.requestBytes,
  101,
);

const mixedSourceMap = structuredClone(sourceMap);
const mixedSegment = mixedSourceMap.segments.find((segment) => segment.segmentId === 0);
mixedSegment.phaseSpans = [
  { phase: "agent.model_request", firstInstruction: 0, instructionCount: 1 },
  { phase: "agent.action_argument_decode", firstInstruction: 1, instructionCount: 1 },
];
mixedSegment.terminatorPhase = "agent.action_name_match";
const mixedSourceMapBytes = Buffer.from(JSON.stringify(mixedSourceMap));
const mixedCensus = new ProcessStateCensus({
  image,
  sourceMap: mixedSourceMap,
  sourceMapBytes: mixedSourceMapBytes,
});
mixedCensus.observe({ outcome: { kind: "Progressed", state } });
const mixedReport = mixedCensus.report();
assert.equal(mixedReport.rows[0].phase, null);
assert.deepEqual(mixedReport.rows[0].phases, [
  "agent.model_request",
  "agent.action_argument_decode",
  "agent.action_name_match",
]);
assert.deepEqual(mixedReport.rows[0].phaseCategories, [
  "before_model_request",
  "action_argument_decode",
]);
assert.equal(mixedReport.phaseMaxima.before_model_request.stateBytes, state.byteLength);
assert.equal(mixedReport.phaseMaxima.action_argument_decode.stateBytes, state.byteLength);

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

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}
