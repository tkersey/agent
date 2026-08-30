import { createHash } from "node:crypto";

export const TRANSCRIPT_FORMAT = "agent-repository-repair-process-transcript/v1";
export const TRANSCRIPT_RECEIPT_FORMAT = "agent-repository-repair-process-transcript-receipt/v1";
export const TRANSCRIPT_MANIFEST_ASSET_NAME = "agent-repository-repair-process-v1-transcript.json";
export const TRANSCRIPT_PAYLOAD_ASSET_NAME = "agent-repository-repair-process-v1-transcript.bin";
export const PRODUCER_REPOSITORY = "tkersey/agent";

export const BOUNDARY_IDENTITY = Object.freeze({
  version: "1.7.0",
  commit: "4fd4cd959ea283a6b5af12a228f0d80a102683e3",
  processKernelAbiVersion: 1,
  kernelSha256: "178f9c2fb79402a85ab5a7905586879347ad5c99f988127eec001c9ecfd813f0",
  kernelByteLength: 647_473,
});

export const TRANSCRIPT_ANCHORS = Object.freeze({
  programImageSha256: "7440076a8078220d9d4000b871423d981bbbee19aedba499afaa4a86239fe6a6",
  programImageByteLength: 23_431,
  initialArgsSha256: "0b9e37f5ae18c387a8d7b02c4571f0ee76c6c1836795b02dcd3acf67254d4dfc",
  initialArgsByteLength: 288,
  reductionCount: 96,
  residualBoundaryCount: 17,
  freshWasmInstanceCount: 97,
  transferAfterBoundary: 8,
  terminalReductionIndex: 95,
  terminalResultSha256: "6a473b2e74e2f8229d10061d1b613ad71ab2ad5b139c21bd9a898b7a2778f75c",
  artifactCount: 132,
});

export const OUTCOME_KINDS = Object.freeze([
  "Progressed",
  "Requested",
  "ExplicitlyYielded",
  "Completed",
  "AuthoredFailure",
  "NeedsCapacity",
]);

const OUTCOME_KIND_SET = new Set(OUTCOME_KINDS);
const DIGEST_PATTERN = /^[0-9a-f]{64}$/;
const COMMIT_PATTERN = /^[0-9a-f]{40}$/;
const RELEASE_TAG_PATTERN = /^v(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)$/;
export const MAX_MANIFEST_BYTES = 64 * 1024;
export const MAX_PAYLOAD_BYTES = 512 * 1024;
const MAX_OUTCOME_ARTIFACT_BYTES = 16 * 1024;
const MAX_REQUEST_ARTIFACT_BYTES = 4 * 1024;
const MAX_EFFECT_RESULT_ARTIFACT_BYTES = 4 * 1024;
const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder("utf-8", { fatal: true });

export const CANONICAL_ARTIFACT_IDS = Object.freeze([
  "program-image",
  "initial-args",
  ...Array.from({ length: TRANSCRIPT_ANCHORS.reductionCount }, (_, index) => `outcome-${decimalIndex(index, 3)}`),
  ...Array.from(
    { length: TRANSCRIPT_ANCHORS.residualBoundaryCount },
    (_, index) => `request-${decimalIndex(index, 3)}`,
  ),
  ...Array.from(
    { length: TRANSCRIPT_ANCHORS.residualBoundaryCount },
    (_, index) => `effect-result-${decimalIndex(index, 3)}`,
  ),
]);

if (CANONICAL_ARTIFACT_IDS.length !== TRANSCRIPT_ANCHORS.artifactCount) {
  throw new Error("internal transcript artifact inventory mismatch");
}

export class TranscriptFormatError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "TranscriptFormatError";
    this.code = code;
    this.details = details;
  }
}

function decimalIndex(index, width) {
  return String(index).padStart(width, "0");
}

function fail(code, message, details = {}) {
  throw new TranscriptFormatError(code, message, details);
}

function isPlainObject(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function exactKeys(value, keys, label) {
  if (!isPlainObject(value)) {
    fail("AGENT_TRANSCRIPT_MANIFEST_INVALID", `${label} must be an object`, { label });
  }
  const actual = Object.keys(value);
  const expected = new Set(keys);
  for (const key of keys) {
    if (!Object.hasOwn(value, key)) {
      fail("AGENT_TRANSCRIPT_MANIFEST_INVALID", `${label} is missing ${key}`, { label, key });
    }
  }
  for (const key of actual) {
    if (!expected.has(key)) {
      fail("AGENT_TRANSCRIPT_MANIFEST_INVALID", `${label} has unexpected field ${key}`, { label, key });
    }
  }
}

function exactValue(value, expected, label) {
  if (value !== expected) {
    fail("AGENT_TRANSCRIPT_MANIFEST_INVALID", `${label} does not match the locked value`, {
      label,
      expected,
      observed: value,
    });
  }
  return value;
}

function safeInteger(value, minimum, maximum, label) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    fail("AGENT_TRANSCRIPT_MANIFEST_INVALID", `${label} is outside its admitted range`, {
      label,
      minimum,
      maximum,
      observed: value,
    });
  }
  return value;
}

function digest(value, label) {
  if (typeof value !== "string" || !DIGEST_PATTERN.test(value)) {
    fail("AGENT_TRANSCRIPT_MANIFEST_INVALID", `${label} must be a lowercase SHA-256 digest`, { label });
  }
  return value;
}

function bytesView(value, label, code = "AGENT_TRANSCRIPT_PAYLOAD_INVALID") {
  if (!(value instanceof Uint8Array)) {
    fail(code, `${label} must be a Uint8Array or Buffer`, { label });
  }
  return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
}

function bytesEqual(left, right) {
  if (left.byteLength !== right.byteLength) return false;
  for (let index = 0; index < left.byteLength; index += 1) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}

function deepFreeze(value) {
  if (value === null || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

export function sha256Hex(value) {
  const bytes = bytesView(value, "SHA-256 input");
  return createHash("sha256").update(bytes).digest("hex");
}

export function canonicalArtifactIds() {
  return [...CANONICAL_ARTIFACT_IDS];
}

function normalizeProducer(value, expectedProducer) {
  exactKeys(value, ["repository", "releaseTag", "releaseUrl", "commit"], "manifest.producer");
  exactValue(value.repository, PRODUCER_REPOSITORY, "manifest.producer.repository");
  if (typeof value.releaseTag !== "string" || !RELEASE_TAG_PATTERN.test(value.releaseTag)) {
    fail("AGENT_TRANSCRIPT_MANIFEST_INVALID", "manifest.producer.releaseTag must be a canonical vMAJOR.MINOR.PATCH tag");
  }
  exactValue(
    value.releaseUrl,
    `https://github.com/${PRODUCER_REPOSITORY}/releases/tag/${value.releaseTag}`,
    "manifest.producer.releaseUrl",
  );
  if (typeof value.commit !== "string" || !COMMIT_PATTERN.test(value.commit)) {
    fail("AGENT_TRANSCRIPT_MANIFEST_INVALID", "manifest.producer.commit must be an exact lowercase 40-character commit SHA");
  }

  if (expectedProducer !== undefined) {
    if (!isPlainObject(expectedProducer)) {
      fail("AGENT_TRANSCRIPT_MANIFEST_INVALID", "expectedProducer must be an object");
    }
    for (const key of ["repository", "releaseTag", "releaseUrl", "commit"]) {
      if (Object.hasOwn(expectedProducer, key)) {
        exactValue(value[key], expectedProducer[key], `manifest.producer.${key}`);
      }
    }
  }

  return {
    repository: PRODUCER_REPOSITORY,
    releaseTag: value.releaseTag,
    releaseUrl: value.releaseUrl,
    commit: value.commit,
  };
}

function normalizeBoundary(value) {
  exactKeys(
    value,
    ["version", "commit", "processKernelAbiVersion", "kernelSha256", "kernelByteLength"],
    "manifest.boundary",
  );
  for (const key of Object.keys(BOUNDARY_IDENTITY)) {
    exactValue(value[key], BOUNDARY_IDENTITY[key], `manifest.boundary.${key}`);
  }
  return { ...BOUNDARY_IDENTITY };
}

function normalizePayload(value) {
  exactKeys(value, ["assetName", "sha256", "byteLength"], "manifest.payload");
  exactValue(value.assetName, TRANSCRIPT_PAYLOAD_ASSET_NAME, "manifest.payload.assetName");
  return {
    assetName: TRANSCRIPT_PAYLOAD_ASSET_NAME,
    sha256: digest(value.sha256, "manifest.payload.sha256"),
    byteLength: safeInteger(value.byteLength, 1, MAX_PAYLOAD_BYTES, "manifest.payload.byteLength"),
  };
}

function normalizeArtifacts(value, payloadByteLength) {
  if (!Array.isArray(value) || value.length !== CANONICAL_ARTIFACT_IDS.length) {
    fail(
      "AGENT_TRANSCRIPT_MANIFEST_INCOMPLETE",
      `manifest.artifacts must contain exactly ${CANONICAL_ARTIFACT_IDS.length} artifacts`,
      { observed: Array.isArray(value) ? value.length : null },
    );
  }

  let cursor = 0;
  const records = value.map((artifact, index) => {
    const label = `manifest.artifacts[${index}]`;
    exactKeys(artifact, ["id", "offset", "byteLength", "sha256"], label);
    const expectedId = CANONICAL_ARTIFACT_IDS[index];
    exactValue(artifact.id, expectedId, `${label}.id`);
    const offset = safeInteger(artifact.offset, 0, payloadByteLength, `${label}.offset`);
    const byteLength = safeInteger(artifact.byteLength, 0, payloadByteLength, `${label}.byteLength`);
    const maximumByteLength = maximumArtifactByteLength(expectedId);
    if (byteLength > maximumByteLength) {
      fail("AGENT_TRANSCRIPT_MANIFEST_INVALID", `${label}.byteLength exceeds its artifact class maximum`, {
        artifact: expectedId,
        maximumByteLength,
        observed: byteLength,
      });
    }
    if (offset !== cursor) {
      fail("AGENT_TRANSCRIPT_MANIFEST_INVALID", "artifact slices must be canonical, contiguous, and non-overlapping", {
        artifact: expectedId,
        expectedOffset: cursor,
        observedOffset: offset,
      });
    }
    if (byteLength > payloadByteLength - offset) {
      fail("AGENT_TRANSCRIPT_MANIFEST_INVALID", `${label} exceeds the payload`, {
        artifact: expectedId,
        offset,
        byteLength,
        payloadByteLength,
      });
    }
    cursor += byteLength;
    return { id: expectedId, offset, byteLength, sha256: digest(artifact.sha256, `${label}.sha256`) };
  });

  if (cursor !== payloadByteLength) {
    fail("AGENT_TRANSCRIPT_MANIFEST_INVALID", "artifact slices must cover the complete payload", {
      coveredBytes: cursor,
      payloadByteLength,
    });
  }

  const programImage = records[0];
  exactValue(
    programImage.byteLength,
    TRANSCRIPT_ANCHORS.programImageByteLength,
    "manifest.artifacts[0].byteLength",
  );
  exactValue(programImage.sha256, TRANSCRIPT_ANCHORS.programImageSha256, "manifest.artifacts[0].sha256");
  const initialArgs = records[1];
  exactValue(
    initialArgs.byteLength,
    TRANSCRIPT_ANCHORS.initialArgsByteLength,
    "manifest.artifacts[1].byteLength",
  );
  exactValue(initialArgs.sha256, TRANSCRIPT_ANCHORS.initialArgsSha256, "manifest.artifacts[1].sha256");

  return records;
}

function maximumArtifactByteLength(id) {
  if (id === "program-image") return TRANSCRIPT_ANCHORS.programImageByteLength;
  if (id === "initial-args") return TRANSCRIPT_ANCHORS.initialArgsByteLength;
  if (id.startsWith("outcome-")) return MAX_OUTCOME_ARTIFACT_BYTES;
  if (id.startsWith("request-")) return MAX_REQUEST_ARTIFACT_BYTES;
  if (id.startsWith("effect-result-")) return MAX_EFFECT_RESULT_ARTIFACT_BYTES;
  throw new Error(`internal transcript artifact id unsupported:${id}`);
}

function normalizeExpectedOutcomes(value) {
  if (!Array.isArray(value) || value.length !== TRANSCRIPT_ANCHORS.reductionCount) {
    fail(
      "AGENT_TRANSCRIPT_MANIFEST_INCOMPLETE",
      `manifest.transcript.expectedOutcomes must contain exactly ${TRANSCRIPT_ANCHORS.reductionCount} entries`,
    );
  }

  let requestedCount = 0;
  let completedCount = 0;
  const entries = value.map((entry, index) => {
    const label = `manifest.transcript.expectedOutcomes[${index}]`;
    exactKeys(entry, ["reductionIndex", "kind", "artifact"], label);
    exactValue(entry.reductionIndex, index, `${label}.reductionIndex`);
    if (typeof entry.kind !== "string" || !OUTCOME_KIND_SET.has(entry.kind)) {
      fail("AGENT_TRANSCRIPT_MANIFEST_INVALID", `${label}.kind is not an admitted Process outcome kind`, {
        kind: entry.kind,
      });
    }
    if (entry.kind === "Requested") requestedCount += 1;
    if (entry.kind === "Completed") completedCount += 1;
    if (entry.kind === "AuthoredFailure" || entry.kind === "NeedsCapacity") {
      fail("AGENT_TRANSCRIPT_MANIFEST_INCOMPLETE", `${label}.kind cannot appear in the completed transcript`, {
        kind: entry.kind,
      });
    }
    if (index === TRANSCRIPT_ANCHORS.terminalReductionIndex) {
      exactValue(entry.kind, "Completed", `${label}.kind`);
    } else if (entry.kind === "Completed") {
      fail("AGENT_TRANSCRIPT_MANIFEST_INCOMPLETE", "completion before reduction 95 is forbidden", {
        reductionIndex: index,
      });
    }
    const artifact = `outcome-${decimalIndex(index, 3)}`;
    exactValue(entry.artifact, artifact, `${label}.artifact`);
    return { reductionIndex: index, kind: entry.kind, artifact };
  });

  exactValue(requestedCount, TRANSCRIPT_ANCHORS.residualBoundaryCount, "Requested outcome count");
  exactValue(completedCount, 1, "Completed outcome count");
  return entries;
}

function normalizeRequests(value, expectedOutcomes) {
  if (!Array.isArray(value) || value.length !== TRANSCRIPT_ANCHORS.residualBoundaryCount) {
    fail(
      "AGENT_TRANSCRIPT_MANIFEST_INCOMPLETE",
      `manifest.transcript.requests must contain exactly ${TRANSCRIPT_ANCHORS.residualBoundaryCount} entries`,
    );
  }
  const requestedReductions = expectedOutcomes
    .filter((entry) => entry.kind === "Requested")
    .map((entry) => entry.reductionIndex);

  return value.map((entry, index) => {
    const label = `manifest.transcript.requests[${index}]`;
    exactKeys(entry, ["boundaryIndex", "reductionIndex", "artifact"], label);
    exactValue(entry.boundaryIndex, index, `${label}.boundaryIndex`);
    const reductionIndex = safeInteger(
      entry.reductionIndex,
      0,
      TRANSCRIPT_ANCHORS.terminalReductionIndex - 1,
      `${label}.reductionIndex`,
    );
    exactValue(reductionIndex, requestedReductions[index], `${label}.reductionIndex`);
    const artifact = `request-${decimalIndex(index, 3)}`;
    exactValue(entry.artifact, artifact, `${label}.artifact`);
    return { boundaryIndex: index, reductionIndex, artifact };
  });
}

function normalizeEffectResults(value) {
  if (!Array.isArray(value) || value.length !== TRANSCRIPT_ANCHORS.residualBoundaryCount) {
    fail(
      "AGENT_TRANSCRIPT_MANIFEST_INCOMPLETE",
      `manifest.transcript.effectResults must contain exactly ${TRANSCRIPT_ANCHORS.residualBoundaryCount} entries`,
    );
  }
  return value.map((entry, index) => {
    const label = `manifest.transcript.effectResults[${index}]`;
    exactKeys(entry, ["boundaryIndex", "artifact"], label);
    exactValue(entry.boundaryIndex, index, `${label}.boundaryIndex`);
    const artifact = `effect-result-${decimalIndex(index, 3)}`;
    exactValue(entry.artifact, artifact, `${label}.artifact`);
    return { boundaryIndex: index, artifact };
  });
}

function normalizeTerminal(value, expectedOutcomes) {
  exactKeys(value, ["reductionIndex", "kind", "outcomeArtifact", "resultSha256"], "manifest.transcript.terminal");
  exactValue(
    value.reductionIndex,
    TRANSCRIPT_ANCHORS.terminalReductionIndex,
    "manifest.transcript.terminal.reductionIndex",
  );
  exactValue(value.kind, "Completed", "manifest.transcript.terminal.kind");
  exactValue(value.outcomeArtifact, "outcome-095", "manifest.transcript.terminal.outcomeArtifact");
  exactValue(
    value.outcomeArtifact,
    expectedOutcomes[TRANSCRIPT_ANCHORS.terminalReductionIndex].artifact,
    "manifest.transcript.terminal.outcomeArtifact",
  );
  exactValue(
    digest(value.resultSha256, "manifest.transcript.terminal.resultSha256"),
    TRANSCRIPT_ANCHORS.terminalResultSha256,
    "manifest.transcript.terminal.resultSha256",
  );
  return {
    reductionIndex: TRANSCRIPT_ANCHORS.terminalReductionIndex,
    kind: "Completed",
    outcomeArtifact: "outcome-095",
    resultSha256: TRANSCRIPT_ANCHORS.terminalResultSha256,
  };
}

function normalizeReceipt(value) {
  exactKeys(
    value,
    [
      "format",
      "programImageSha256",
      "reductionCount",
      "residualBoundaryCount",
      "freshWasmInstanceCount",
      "terminalResultSha256",
    ],
    "manifest.receipt",
  );
  exactValue(value.format, TRANSCRIPT_RECEIPT_FORMAT, "manifest.receipt.format");
  exactValue(
    value.programImageSha256,
    TRANSCRIPT_ANCHORS.programImageSha256,
    "manifest.receipt.programImageSha256",
  );
  exactValue(value.reductionCount, TRANSCRIPT_ANCHORS.reductionCount, "manifest.receipt.reductionCount");
  exactValue(
    value.residualBoundaryCount,
    TRANSCRIPT_ANCHORS.residualBoundaryCount,
    "manifest.receipt.residualBoundaryCount",
  );
  exactValue(
    value.freshWasmInstanceCount,
    TRANSCRIPT_ANCHORS.freshWasmInstanceCount,
    "manifest.receipt.freshWasmInstanceCount",
  );
  exactValue(
    value.terminalResultSha256,
    TRANSCRIPT_ANCHORS.terminalResultSha256,
    "manifest.receipt.terminalResultSha256",
  );
  return {
    format: TRANSCRIPT_RECEIPT_FORMAT,
    programImageSha256: TRANSCRIPT_ANCHORS.programImageSha256,
    reductionCount: TRANSCRIPT_ANCHORS.reductionCount,
    residualBoundaryCount: TRANSCRIPT_ANCHORS.residualBoundaryCount,
    freshWasmInstanceCount: TRANSCRIPT_ANCHORS.freshWasmInstanceCount,
    terminalResultSha256: TRANSCRIPT_ANCHORS.terminalResultSha256,
  };
}

function normalizeManifest(manifest, { expectedProducer } = {}) {
  exactKeys(
    manifest,
    ["format", "producer", "boundary", "payload", "artifacts", "transcript", "receipt"],
    "manifest",
  );
  exactValue(manifest.format, TRANSCRIPT_FORMAT, "manifest.format");
  const producer = normalizeProducer(manifest.producer, expectedProducer);
  const boundary = normalizeBoundary(manifest.boundary);
  const payload = normalizePayload(manifest.payload);
  const artifacts = normalizeArtifacts(manifest.artifacts, payload.byteLength);

  exactKeys(
    manifest.transcript,
    [
      "programImage",
      "initialArgs",
      "reductionCount",
      "residualBoundaryCount",
      "expectedOutcomes",
      "requests",
      "effectResults",
      "transferAfterBoundary",
      "terminal",
    ],
    "manifest.transcript",
  );
  exactValue(manifest.transcript.programImage, "program-image", "manifest.transcript.programImage");
  exactValue(manifest.transcript.initialArgs, "initial-args", "manifest.transcript.initialArgs");
  exactValue(
    manifest.transcript.reductionCount,
    TRANSCRIPT_ANCHORS.reductionCount,
    "manifest.transcript.reductionCount",
  );
  exactValue(
    manifest.transcript.residualBoundaryCount,
    TRANSCRIPT_ANCHORS.residualBoundaryCount,
    "manifest.transcript.residualBoundaryCount",
  );
  const expectedOutcomes = normalizeExpectedOutcomes(manifest.transcript.expectedOutcomes);
  const requests = normalizeRequests(manifest.transcript.requests, expectedOutcomes);
  const effectResults = normalizeEffectResults(manifest.transcript.effectResults);
  exactValue(
    manifest.transcript.transferAfterBoundary,
    TRANSCRIPT_ANCHORS.transferAfterBoundary,
    "manifest.transcript.transferAfterBoundary",
  );
  const terminal = normalizeTerminal(manifest.transcript.terminal, expectedOutcomes);
  const receipt = normalizeReceipt(manifest.receipt);

  const referenced = new Set([
    "program-image",
    "initial-args",
    ...expectedOutcomes.map((entry) => entry.artifact),
    ...requests.map((entry) => entry.artifact),
    ...effectResults.map((entry) => entry.artifact),
  ]);
  if (referenced.size !== CANONICAL_ARTIFACT_IDS.length) {
    fail("AGENT_TRANSCRIPT_MANIFEST_INCOMPLETE", "manifest does not reference the complete canonical artifact inventory", {
      expected: CANONICAL_ARTIFACT_IDS.length,
      observed: referenced.size,
    });
  }
  for (const id of CANONICAL_ARTIFACT_IDS) {
    if (!referenced.has(id)) {
      fail("AGENT_TRANSCRIPT_MANIFEST_INCOMPLETE", `manifest contains unreferenced artifact ${id}`, { id });
    }
  }

  return deepFreeze({
    format: TRANSCRIPT_FORMAT,
    producer,
    boundary,
    payload,
    artifacts,
    transcript: {
      programImage: "program-image",
      initialArgs: "initial-args",
      reductionCount: TRANSCRIPT_ANCHORS.reductionCount,
      residualBoundaryCount: TRANSCRIPT_ANCHORS.residualBoundaryCount,
      expectedOutcomes,
      requests,
      effectResults,
      transferAfterBoundary: TRANSCRIPT_ANCHORS.transferAfterBoundary,
      terminal,
    },
    receipt,
  });
}

function encodeManifestObject(manifest) {
  return textEncoder.encode(`${JSON.stringify(manifest, null, 2)}\n`);
}

function parseCanonicalManifestBytes(value, options) {
  const bytes = bytesView(value, "transcript manifest", "AGENT_TRANSCRIPT_MANIFEST_INVALID");
  if (bytes.byteLength < 1 || bytes.byteLength > MAX_MANIFEST_BYTES) {
    fail("AGENT_TRANSCRIPT_MANIFEST_INVALID", "transcript manifest byte length is outside its admitted range", {
      observed: bytes.byteLength,
    });
  }
  let text;
  try {
    text = textDecoder.decode(bytes);
  } catch (error) {
    fail("AGENT_TRANSCRIPT_MANIFEST_INVALID", "transcript manifest is not valid UTF-8", {
      cause: error?.message ?? String(error),
    });
  }
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    fail("AGENT_TRANSCRIPT_MANIFEST_INVALID", "transcript manifest is not valid JSON", {
      cause: error?.message ?? String(error),
    });
  }
  const normalized = normalizeManifest(parsed, options);
  const canonicalBytes = encodeManifestObject(normalized);
  if (!bytesEqual(bytes, canonicalBytes)) {
    fail(
      "AGENT_TRANSCRIPT_MANIFEST_INVALID",
      "transcript manifest bytes must equal JSON.stringify(manifest, null, 2) plus one newline",
    );
  }
  return normalized;
}

export function validateTranscriptManifest(manifestOrBytes, options = {}) {
  if (manifestOrBytes instanceof Uint8Array) {
    return parseCanonicalManifestBytes(manifestOrBytes, options);
  }
  if (typeof manifestOrBytes === "string") {
    return parseCanonicalManifestBytes(textEncoder.encode(manifestOrBytes), options);
  }
  return normalizeManifest(manifestOrBytes, options);
}

export function encodeCanonicalManifest(manifest) {
  return encodeManifestObject(validateTranscriptManifest(manifest));
}

export function buildTranscriptPayload(artifactInputs) {
  if (!Array.isArray(artifactInputs) || artifactInputs.length !== CANONICAL_ARTIFACT_IDS.length) {
    fail(
      "AGENT_TRANSCRIPT_BUILD_INVALID",
      `artifact inputs must contain exactly ${CANONICAL_ARTIFACT_IDS.length} entries in canonical order`,
      { observed: Array.isArray(artifactInputs) ? artifactInputs.length : null },
    );
  }

  let totalByteLength = 0;
  const normalizedInputs = artifactInputs.map((entry, index) => {
    const label = `artifactInputs[${index}]`;
    if (!isPlainObject(entry)) fail("AGENT_TRANSCRIPT_BUILD_INVALID", `${label} must be an object`);
    const id = entry.id;
    const expectedId = CANONICAL_ARTIFACT_IDS[index];
    if (id !== expectedId) {
      fail("AGENT_TRANSCRIPT_BUILD_INVALID", `${label}.id is not the canonical artifact at this position`, {
        expected: expectedId,
        observed: id,
      });
    }
    const source = bytesView(entry.bytes, `${label}.bytes`, "AGENT_TRANSCRIPT_BUILD_INVALID");
    if (source.byteLength === 0) {
      fail("AGENT_TRANSCRIPT_BUILD_INVALID", `${label}.bytes must not be empty`, { id });
    }
    const maximumByteLength = maximumArtifactByteLength(id);
    if (source.byteLength > maximumByteLength) {
      fail("AGENT_TRANSCRIPT_BUILD_INVALID", `${label}.bytes exceeds its artifact class maximum`, {
        id,
        maximumByteLength,
        observed: source.byteLength,
      });
    }
    if (source.byteLength > MAX_PAYLOAD_BYTES - totalByteLength) {
      fail("AGENT_TRANSCRIPT_BUILD_INVALID", "transcript payload exceeds its admitted maximum byte length");
    }
    const bytes = Uint8Array.from(source);
    totalByteLength += bytes.byteLength;
    return { id, bytes };
  });

  const programImage = normalizedInputs[0].bytes;
  if (
    programImage.byteLength !== TRANSCRIPT_ANCHORS.programImageByteLength ||
    sha256Hex(programImage) !== TRANSCRIPT_ANCHORS.programImageSha256
  ) {
    fail("AGENT_TRANSCRIPT_BUILD_INVALID", "program-image is not the exact landed repository-repair BPI1", {
      expectedByteLength: TRANSCRIPT_ANCHORS.programImageByteLength,
      observedByteLength: programImage.byteLength,
      expectedSha256: TRANSCRIPT_ANCHORS.programImageSha256,
      observedSha256: sha256Hex(programImage),
    });
  }
  const initialArgs = normalizedInputs[1].bytes;
  if (
    initialArgs.byteLength !== TRANSCRIPT_ANCHORS.initialArgsByteLength ||
    sha256Hex(initialArgs) !== TRANSCRIPT_ANCHORS.initialArgsSha256
  ) {
    fail("AGENT_TRANSCRIPT_BUILD_INVALID", "initial-args is not the exact landed repository-repair InitialArgs", {
      expectedByteLength: TRANSCRIPT_ANCHORS.initialArgsByteLength,
      observedByteLength: initialArgs.byteLength,
      expectedSha256: TRANSCRIPT_ANCHORS.initialArgsSha256,
      observedSha256: sha256Hex(initialArgs),
    });
  }

  const payloadBytes = new Uint8Array(totalByteLength);
  const artifacts = [];
  let offset = 0;
  for (const entry of normalizedInputs) {
    payloadBytes.set(entry.bytes, offset);
    artifacts.push(
      Object.freeze({
        id: entry.id,
        offset,
        byteLength: entry.bytes.byteLength,
        sha256: sha256Hex(entry.bytes),
      }),
    );
    offset += entry.bytes.byteLength;
  }
  const payload = Object.freeze({
    assetName: TRANSCRIPT_PAYLOAD_ASSET_NAME,
    sha256: sha256Hex(payloadBytes),
    byteLength: payloadBytes.byteLength,
  });
  return Object.freeze({
    bytes: payloadBytes,
    payloadBytes,
    payload,
    artifacts: Object.freeze(artifacts),
  });
}

function producerForBuild(value) {
  if (!isPlainObject(value)) fail("AGENT_TRANSCRIPT_BUILD_INVALID", "producer must be an object");
  const releaseTag = value.releaseTag;
  return {
    repository: value.repository ?? PRODUCER_REPOSITORY,
    releaseTag,
    releaseUrl: value.releaseUrl ?? `https://github.com/${PRODUCER_REPOSITORY}/releases/tag/${releaseTag}`,
    commit: value.commit,
  };
}

export function buildTranscriptManifest({
  producer,
  boundary = BOUNDARY_IDENTITY,
  payload,
  artifacts,
  expectedOutcomes,
  outcomeKinds,
  requests,
  requestReductionIndices,
  effectResults,
  terminal,
} = {}) {
  const payloadDescriptor = payload?.payload ?? payload;
  const artifactRecords = artifacts ?? payload?.artifacts;
  const outcomeSource =
    expectedOutcomes ??
    outcomeKinds?.map((kind, reductionIndex) => ({
      reductionIndex,
      kind,
      artifact: `outcome-${decimalIndex(reductionIndex, 3)}`,
    }));
  const requestSource =
    requests ??
    requestReductionIndices?.map((reductionIndex, boundaryIndex) => ({
      boundaryIndex,
      reductionIndex,
      artifact: `request-${decimalIndex(boundaryIndex, 3)}`,
    }));
  const effectResultSource =
    effectResults ??
    Array.from({ length: TRANSCRIPT_ANCHORS.residualBoundaryCount }, (_, boundaryIndex) => ({
      boundaryIndex,
      artifact: `effect-result-${decimalIndex(boundaryIndex, 3)}`,
    }));
  const terminalValue =
    terminal ??
    {
      reductionIndex: TRANSCRIPT_ANCHORS.terminalReductionIndex,
      kind: "Completed",
      outcomeArtifact: "outcome-095",
      resultSha256: TRANSCRIPT_ANCHORS.terminalResultSha256,
    };

  const manifest = {
    format: TRANSCRIPT_FORMAT,
    producer: producerForBuild(producer),
    boundary: { ...boundary },
    payload: { ...payloadDescriptor },
    artifacts: artifactRecords?.map((artifact) => ({
      id: artifact.id,
      offset: artifact.offset,
      byteLength: artifact.byteLength,
      sha256: artifact.sha256,
    })),
    transcript: {
      programImage: "program-image",
      initialArgs: "initial-args",
      reductionCount: TRANSCRIPT_ANCHORS.reductionCount,
      residualBoundaryCount: TRANSCRIPT_ANCHORS.residualBoundaryCount,
      expectedOutcomes: outcomeSource?.map((entry, reductionIndex) => ({
        reductionIndex: entry.reductionIndex ?? reductionIndex,
        kind: entry.kind,
        artifact: entry.artifact ?? `outcome-${decimalIndex(reductionIndex, 3)}`,
      })),
      requests: requestSource?.map((entry, boundaryIndex) => ({
        boundaryIndex: entry.boundaryIndex ?? boundaryIndex,
        reductionIndex: entry.reductionIndex,
        artifact: entry.artifact ?? `request-${decimalIndex(boundaryIndex, 3)}`,
      })),
      effectResults: effectResultSource.map((entry, boundaryIndex) => ({
        boundaryIndex: entry.boundaryIndex ?? boundaryIndex,
        artifact: entry.artifact ?? `effect-result-${decimalIndex(boundaryIndex, 3)}`,
      })),
      transferAfterBoundary: TRANSCRIPT_ANCHORS.transferAfterBoundary,
      terminal: { ...terminalValue },
    },
    receipt: {
      format: TRANSCRIPT_RECEIPT_FORMAT,
      programImageSha256: TRANSCRIPT_ANCHORS.programImageSha256,
      reductionCount: TRANSCRIPT_ANCHORS.reductionCount,
      residualBoundaryCount: TRANSCRIPT_ANCHORS.residualBoundaryCount,
      freshWasmInstanceCount: TRANSCRIPT_ANCHORS.freshWasmInstanceCount,
      terminalResultSha256: TRANSCRIPT_ANCHORS.terminalResultSha256,
    },
  };
  return validateTranscriptManifest(manifest);
}

export function validateTranscriptPayload(manifestOrBytes, payloadValue, options = {}) {
  const manifest = validateTranscriptManifest(manifestOrBytes, options);
  const payloadBytes = bytesView(payloadValue, "transcript payload");
  if (payloadBytes.byteLength !== manifest.payload.byteLength) {
    fail("AGENT_TRANSCRIPT_PAYLOAD_INVALID", "transcript payload byte length does not match its manifest", {
      expected: manifest.payload.byteLength,
      observed: payloadBytes.byteLength,
    });
  }
  const payloadSha256 = sha256Hex(payloadBytes);
  if (payloadSha256 !== manifest.payload.sha256) {
    fail("AGENT_TRANSCRIPT_PAYLOAD_INVALID", "transcript payload digest does not match its manifest", {
      expected: manifest.payload.sha256,
      observed: payloadSha256,
    });
  }

  const slices = new Map();
  for (const artifact of manifest.artifacts) {
    const bytes = payloadBytes.subarray(artifact.offset, artifact.offset + artifact.byteLength);
    const observed = sha256Hex(bytes);
    if (observed !== artifact.sha256) {
      fail("AGENT_TRANSCRIPT_PAYLOAD_INVALID", `artifact ${artifact.id} digest does not match its manifest`, {
        artifact: artifact.id,
        expected: artifact.sha256,
        observed,
      });
    }
    slices.set(artifact.id, bytes);
  }
  return slices;
}

export function sliceArtifact(manifestOrBytes, payloadBytes, id, options = {}) {
  if (typeof id !== "string" || !CANONICAL_ARTIFACT_IDS.includes(id)) {
    fail("AGENT_TRANSCRIPT_PAYLOAD_INVALID", "artifact id is not in the canonical transcript inventory", { id });
  }
  return validateTranscriptPayload(manifestOrBytes, payloadBytes, options).get(id);
}

export function validateReleaseMetadata(
  manifestOrBytes,
  { releaseTag, releaseUrl, tagCommit, assets } = {},
  options = {},
) {
  const manifest = validateTranscriptManifest(manifestOrBytes, options);
  if (releaseTag !== manifest.producer.releaseTag) {
    fail("AGENT_TRANSCRIPT_RELEASE_INVALID", "containing release tag does not match manifest.producer.releaseTag", {
      expected: manifest.producer.releaseTag,
      observed: releaseTag,
    });
  }
  if (releaseUrl !== manifest.producer.releaseUrl) {
    fail("AGENT_TRANSCRIPT_RELEASE_INVALID", "containing release URL does not match manifest.producer.releaseUrl", {
      expected: manifest.producer.releaseUrl,
      observed: releaseUrl,
    });
  }
  if (typeof tagCommit !== "string" || !COMMIT_PATTERN.test(tagCommit)) {
    fail("AGENT_TRANSCRIPT_RELEASE_INVALID", "release tag must resolve to an exact lowercase 40-character commit SHA");
  }
  if (tagCommit !== manifest.producer.commit) {
    fail("AGENT_TRANSCRIPT_RELEASE_INVALID", "release tag commit does not match manifest.producer.commit", {
      expected: manifest.producer.commit,
      observed: tagCommit,
    });
  }
  if (!Array.isArray(assets)) {
    fail("AGENT_TRANSCRIPT_RELEASE_INVALID", "release assets metadata must be an array");
  }

  const manifestBytes = encodeManifestObject(manifest);
  const required = new Map([
    [
      TRANSCRIPT_MANIFEST_ASSET_NAME,
      { byteLength: manifestBytes.byteLength, sha256: sha256Hex(manifestBytes) },
    ],
    [
      TRANSCRIPT_PAYLOAD_ASSET_NAME,
      { byteLength: manifest.payload.byteLength, sha256: manifest.payload.sha256 },
    ],
  ]);
  const observed = new Map();
  for (const asset of assets) {
    if (!isPlainObject(asset) || typeof asset.name !== "string" || !required.has(asset.name)) continue;
    if (observed.has(asset.name)) {
      fail("AGENT_TRANSCRIPT_RELEASE_INVALID", `release contains duplicate required asset ${asset.name}`, {
        asset: asset.name,
      });
    }
    const expected = required.get(asset.name);
    if (asset.size !== expected.byteLength) {
      fail("AGENT_TRANSCRIPT_RELEASE_INVALID", `release asset ${asset.name} has the wrong byte length`, {
        asset: asset.name,
        expected: expected.byteLength,
        observed: asset.size,
      });
    }
    const expectedDigest = `sha256:${expected.sha256}`;
    if (asset.digest !== expectedDigest) {
      fail("AGENT_TRANSCRIPT_RELEASE_INVALID", `release asset ${asset.name} has the wrong digest`, {
        asset: asset.name,
        expected: expectedDigest,
        observed: asset.digest,
      });
    }
    observed.set(asset.name, Object.freeze({
      name: asset.name,
      size: asset.size,
      digest: asset.digest,
    }));
  }
  for (const name of required.keys()) {
    if (!observed.has(name)) {
      fail("AGENT_TRANSCRIPT_RELEASE_INVALID", `release is missing required asset ${name}`, { asset: name });
    }
  }
  return Object.freeze({
    releaseTag,
    releaseUrl,
    tagCommit,
    assets: Object.freeze([...observed.values()]),
  });
}
