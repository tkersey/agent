import assert from "node:assert/strict";
import { createHash } from "node:crypto";

const STATE_MAGIC = Buffer.from("ABL_PST1");
const IMAGE_MAGIC = Buffer.from("ABL_BPI1");
const STATE_HEADER_BYTES = 44;
const IMAGE_FIXED_PREFIX_BYTES = 76;
const IMAGE_SECTION_DESCRIPTOR_BYTES = 24;
const CONSTRUCTORS_SECTION_INDEX = 8;
const DUPLICATE_ENVIRONMENT_THRESHOLD = 4 * 1024;

export class ProcessStateCensus {
  constructor({ image, sourceMap, sourceMapBytes }) {
    this.image = Buffer.from(image);
    this.sourceMap = sourceMap;
    this.sourceMapBytes = Buffer.from(sourceMapBytes);
    assert.deepEqual(JSON.parse(this.sourceMapBytes.toString("utf8")), sourceMap);
    assert.equal(sourceMap?.format, "agent-bpi1-source-map/v1");
    assert.equal(sourceMap.imageSha256, sha256(this.image));
    this.programTransitionDigest = Buffer.from(
      sourceMap.programTransitionDigest,
      "hex",
    );
    assert.equal(this.programTransitionDigest.byteLength, 32);
    this.constructorSegments = decodeConstructorSegments(this.image);
    this.segments = new Map(sourceMap.segments.map((segment) => [segment.segmentId, segment]));
    this.rows = [];
    this.reductions = 0;
    this.progressedSinceBoundary = 0;
    this.maximumProgressedBetweenResidualBoundaries = 0;
  }

  observe({ outcome, effectSemanticIdentity = null }) {
    this.reductions += 1;
    if (outcome.kind === "Progressed" || outcome.kind === "ExplicitlyYielded") {
      this.progressedSinceBoundary += 1;
      this.maximumProgressedBetweenResidualBoundaries = Math.max(
        this.maximumProgressedBetweenResidualBoundaries,
        this.progressedSinceBoundary,
      );
    } else if (outcome.kind === "Requested" || outcome.kind === "Completed") {
      this.progressedSinceBoundary = 0;
    }
    if (outcome.state === undefined) return;

    const state = decodeProcessState(
      outcome.state,
      this.programTransitionDigest,
    );
    const top = state.frames.at(-1);
    const segmentId = this.constructorSegments.get(top.constructorId);
    assert(segmentId !== undefined, "State constructor is absent from BPI1");
    const segment = this.segments.get(segmentId);
    assert(segment !== undefined, "State segment is absent from source map");
    const phases = [...new Set([
      ...segment.phaseSpans.map((span) => span.phase),
      segment.terminatorPhase,
    ])];
    const phase = phases.length === 1 ? phases[0] : null;
    const categories = phaseCategories(outcome.kind, phases, effectSemanticIdentity);
    const environmentGroups = new Map();
    let totalEnvironmentBytes = 0;
    let largestEnvironmentBytes = 0;
    for (const frame of state.frames) {
      totalEnvironmentBytes += frame.environment.byteLength;
      largestEnvironmentBytes = Math.max(largestEnvironmentBytes, frame.environment.byteLength);
      if (frame.environment.byteLength <= DUPLICATE_ENVIRONMENT_THRESHOLD) continue;
      const key = `${frame.environment.byteLength}:${sha256(frame.environment)}`;
      environmentGroups.set(key, (environmentGroups.get(key) ?? 0) + 1);
    }
    let identicalEnvironmentBlobCopies = 0;
    let duplicatedEnvironmentBytes = 0;
    for (const [key, copies] of environmentGroups) {
      if (copies < 2) continue;
      const byteLength = Number(key.slice(0, key.indexOf(":")));
      identicalEnvironmentBlobCopies += copies - 1;
      duplicatedEnvironmentBytes += (copies - 1) * byteLength;
    }
    this.rows.push(Object.freeze({
      reductionIndex: this.reductions,
      phase,
      phases,
      phaseCategory: categories.length === 1 ? categories[0] : null,
      phaseCategories: categories,
      outcomeKind: outcome.kind,
      stateByteLength: state.bytes.byteLength,
      frameCount: state.frames.length,
      totalFrameEnvironmentBytes: totalEnvironmentBytes,
      largestFrameEnvironmentBytes: largestEnvironmentBytes,
      pendingRequestByteLength: outcome.request?.byteLength ?? 0,
      identicalEnvironmentBlobCopies,
      duplicatedEnvironmentBytes,
    }));
  }

  report() {
    const metrics = Object.freeze({
      stateBytes: "stateByteLength",
      frameCount: "frameCount",
      environmentBytes: "totalFrameEnvironmentBytes",
      largestFrame: "largestFrameEnvironmentBytes",
      requestBytes: "pendingRequestByteLength",
    });
    const summary = {};
    for (const [name, field] of Object.entries(metrics)) {
      summary[name] = distribution(this.rows.map((row) => row[field]));
    }
    const phaseMaxima = {};
    for (const category of [
      "before_model_request",
      "pending_model_request",
      "model_resume",
      "action_argument_decode",
      "pending_repository_request",
      "observation_fold",
      "completion",
    ]) {
      const rows = this.rows.filter((row) => row.phaseCategories.includes(category));
      phaseMaxima[category] = rows.length === 0 ? null : Object.fromEntries(
        Object.entries(metrics).map(([name, field]) => [
          name,
          Math.max(...rows.map((row) => row[field])),
        ]),
      );
    }
    return Object.freeze({
      format: "agent-process-state-census/v1",
      imageSha256: sha256(this.image),
      sourceMapSha256: sha256(this.sourceMapBytes),
      programTransitionDigest: this.sourceMap.programTransitionDigest,
      reductionCount: this.reductions,
      stateBearingOutcomeCount: this.rows.length,
      maximumProgressedBetweenResidualBoundaries:
        this.maximumProgressedBetweenResidualBoundaries,
      summary,
      phaseMaxima,
      rows: this.rows,
    });
  }
}

export function decodeProcessState(input, expectedProgramTransitionDigest = null) {
  const bytes = Buffer.from(input);
  assert(bytes.byteLength >= STATE_HEADER_BYTES + 1, "PST1 is truncated");
  assert(bytes.subarray(0, 8).equals(STATE_MAGIC), "PST1 magic is invalid");
  assert.equal(bytes.readUInt16LE(8), 1, "PST1 version is unsupported");
  assert.equal(bytes.readUInt16LE(10), 0, "PST1 flags are unsupported");
  const programTransitionDigest = Buffer.from(bytes.subarray(12, 44));
  if (expectedProgramTransitionDigest !== null) {
    assert(
      programTransitionDigest.equals(Buffer.from(expectedProgramTransitionDigest)),
      "PST1 program-transition digest differs from the source map",
    );
  }
  const cursor = { value: STATE_HEADER_BYTES };
  const frameCount = readNatural(bytes, cursor);
  assert(frameCount > 0, "PST1 must contain a frame");
  const frames = [];
  for (let index = 0; index < frameCount; index += 1) {
    const constructorId = readNatural(bytes, cursor);
    assert(constructorId <= 0xffff_ffff, "PST1 constructor exceeds u32");
    const environmentLength = readNatural(bytes, cursor);
    assert(environmentLength <= bytes.byteLength - cursor.value, "PST1 environment is truncated");
    const environment = Buffer.from(
      bytes.subarray(cursor.value, cursor.value + environmentLength),
    );
    cursor.value += environmentLength;
    frames.push(Object.freeze({ constructorId, environment }));
  }
  assert.equal(cursor.value, bytes.byteLength, "PST1 has trailing bytes");
  return Object.freeze({ bytes, programTransitionDigest, frames });
}

function decodeConstructorSegments(image) {
  assert(image.byteLength >= 316, "BPI1 is truncated");
  assert(image.subarray(0, 8).equals(IMAGE_MAGIC), "BPI1 magic is invalid");
  assert.equal(image.readUInt16LE(8), 1, "BPI1 version is unsupported");
  assert.equal(image.readUInt32LE(20), 10, "BPI1 section count is unsupported");
  assert.equal(Number(image.readBigUInt64LE(24)), image.byteLength, "BPI1 length mismatch");
  const descriptor = IMAGE_FIXED_PREFIX_BYTES +
    CONSTRUCTORS_SECTION_INDEX * IMAGE_SECTION_DESCRIPTOR_BYTES;
  assert.equal(image.readUInt16LE(descriptor), 9, "BPI1 constructor section is misplaced");
  const offset = Number(image.readBigUInt64LE(descriptor + 8));
  const length = Number(image.readBigUInt64LE(descriptor + 16));
  assert(offset >= 316 && length >= 4 && offset + length <= image.byteLength);
  const section = image.subarray(offset, offset + length);
  const count = section.readUInt32LE(0);
  const result = new Map();
  let cursor = 4;
  for (let index = 0; index < count; index += 1) {
    assert(cursor + 24 <= section.byteLength, "BPI1 constructor is truncated");
    const recordLength = section.readUInt32LE(cursor);
    assert(recordLength >= 24 && cursor + recordLength <= section.byteLength);
    const constructorId = section.readUInt32LE(cursor + 4);
    assert.equal(constructorId, index, "BPI1 constructor IDs are noncanonical");
    result.set(constructorId, section.readUInt16LE(cursor + 12));
    cursor += recordLength;
  }
  assert.equal(cursor, section.byteLength, "BPI1 constructor section has trailing bytes");
  return result;
}

function readNatural(bytes, cursor) {
  let value = 0n;
  for (let index = 0; index < 10; index += 1) {
    assert(cursor.value < bytes.byteLength, "natural is truncated");
    const byte = bytes[cursor.value++];
    const payload = BigInt(byte & 0x7f);
    assert(index !== 9 || payload <= 1n, "natural overflows u64");
    value |= payload << BigInt(index * 7);
    if ((byte & 0x80) === 0) {
      assert.equal(naturalLength(value), index + 1, "natural is noncanonical");
      assert(value <= BigInt(Number.MAX_SAFE_INTEGER), "natural exceeds safe integer");
      return Number(value);
    }
  }
  assert.fail("natural overflows u64");
}

function naturalLength(value) {
  let remaining = value;
  let length = 1;
  while (remaining >= 0x80n) {
    remaining >>= 7n;
    length += 1;
  }
  return length;
}

function distribution(values) {
  assert(values.length > 0, "census has no State-bearing outcomes");
  const sorted = values.toSorted((left, right) => left - right);
  return Object.freeze({
    minimum: sorted[0],
    median: nearestRank(sorted, 0.5),
    p95: nearestRank(sorted, 0.95),
    maximum: sorted.at(-1),
  });
}

function nearestRank(sorted, quantile) {
  return sorted[Math.max(0, Math.ceil(quantile * sorted.length) - 1)];
}

function phaseCategories(outcomeKind, phases, effectSemanticIdentity) {
  if (outcomeKind === "Requested") {
    return [effectSemanticIdentity?.startsWith("agent.model.")
      ? "pending_model_request"
      : "pending_repository_request"];
  }
  const categoryByPhase = {
    "agent.model_request": "before_model_request",
    "agent.model_resume": "model_resume",
    "agent.action_argument_decode": "action_argument_decode",
    "agent.observation_fold": "observation_fold",
    "agent.completion": "completion",
  };
  return [...new Set(phases.map((phase) => categoryByPhase[phase]).filter(Boolean))];
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}
