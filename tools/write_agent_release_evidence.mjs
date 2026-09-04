import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

const options = parseArgs(process.argv.slice(2));
const root = resolve(options.outputRoot ?? ".");

const [
  distribution,
  census,
  admission,
  publicNegatives,
  imageEconomy,
  ablationEconomy,
  marginalsInput,
  sourceMap,
  releaseIdentity,
  receipt,
  historicalEvidence,
] = await Promise.all([
  readJson(options.distribution),
  readJson(options.census),
  readJson(options.admission),
  readJson(options.publicNegatives),
  readJson(options.imageEconomy),
  readJson(options.ablationImageEconomy),
  readJson(options.marginals),
  readJson(options.sourceMap),
  readJson(join(root, "system_closure_v1/release_identity.json")),
  readJson(options.receipt),
  readJson(join(root, "economy/semantic-closure-obstruction.json")),
]);
const image = await readFile(resolve(options.image));

assert.equal(releaseIdentity.format, "agent-system-closure-release-identity/v1");
assert.equal(distribution.format, "agent-system-closure-distribution-check/v1");
assert.equal(distribution.result, "passed");
assert.equal(distribution.publicVerification?.result, "passed");
assert.equal(distribution.publicVerification?.publicNegativeResult, "passed");
assert.equal(publicNegatives.format, "agent-system-closure-public-negative-proof/v1");
assert.equal(publicNegatives.result, "passed");
assert.equal(publicNegatives.dangerousRepositoryEffects, 0);
assert.equal(publicNegatives.prematureSuccessfulCompletions, 0);
assert.equal(
  publicNegatives.semanticResults.length + publicNegatives.schedulerResults.length,
  distribution.publicVerification.negativeCaseCount,
);
assert.equal(census.format, "agent-process-state-census/v1");
assert.equal(census.rows.length, census.stateBearingOutcomeCount);
assert.equal(imageEconomy.format, "boundary-image-economy/v1");
assert.equal(ablationEconomy.format, "boundary-image-economy/v1");
assert.equal(marginalsInput.format, "agent-system-economy-marginals/v1");
assert.equal(sourceMap.format, "agent-bpi1-source-map/v1");
assert.equal(admission.format, "agent-system-closure-admission-negatives/v1");
assert.equal(admission.result, "passed");
assert.equal(historicalEvidence.format, "agent-system-economy-obstruction/v1");

const fixture = distribution.execution;
const publicFixture = distribution.publicVerification.fixture;
for (const field of [
  "format", "result", "kernelSha256", "kernelByteLength", "worldVersion",
  "worldSourceCommit", "worldProductionSourceSha256",
  "worldRuntimeArchiveSha256", "worldRuntimeArchiveByteLength",
  "kernelBoundarySourceCommit", "imageSha256", "imageByteLength",
  "initialArgsSha256", "initialArgsByteLength", "reductions",
  "modelRequests", "repositoryRequests", "runtimeInputSha256",
  "initialTree", "finalTree", "finalSourceSha256", "terminalSha256",
]) assert.deepEqual(publicFixture[field], fixture[field], `fixture disagreement: ${field}`);

const imageSha256 = sha256(image);
assert.deepEqual(releaseIdentity.agentArtifacts, {
  imageSha256,
  imageByteLength: image.byteLength,
  initialArgsSha256: fixture.initialArgsSha256,
  initialArgsByteLength: fixture.initialArgsByteLength,
  sourceMapSha256: sha256(await readFile(resolve(options.sourceMap))),
  programTransitionDigest: sourceMap.programTransitionDigest,
});
assert.equal(imageSha256, imageEconomy.imageSha256);
assert.equal(image.byteLength, imageEconomy.imageByteLength);
assert.equal(imageSha256, fixture.imageSha256);
assert.equal(imageSha256, census.imageSha256);
assert.equal(imageSha256, sourceMap.imageSha256);
assert.equal(imageSha256, admission.imageSha256);
assert.equal(releaseIdentity.agentArtifacts.sourceMapSha256, receipt.sourceMapSha256);
assert.equal(receipt.imageSha256, imageSha256);
assert.equal(receipt.archiveSha256, distribution.archiveSha256);
assert.equal(receipt.archiveByteLength, distribution.archiveByteLength);
assert.deepEqual(stripCensus(census), stripCensus(distribution.publicVerification.census));
assert.equal(census.programTransitionDigest, sourceMap.programTransitionDigest);
assert.equal(census.reductionCount, fixture.reductions);
assert.equal(census.summary.stateBytes.maximum, fixture.peakStateBytes);

assertTuple(releaseIdentity, fixture, receipt, admission);
assertMarginalGates(marginalsInput);

const gzip = spawnSync("gzip", ["-9", "-c", resolve(options.image)], {
  encoding: null,
  maxBuffer: 2 * 1024 * 1024,
});
assert.equal(gzip.status, 0, `gzip failed: ${gzip.stderr?.toString() ?? ""}`);
const gzip9ByteLength = gzip.stdout.byteLength;
const duplicateEnvironmentBlobCopies = Math.max(
  ...census.rows.map((row) => row.identicalEnvironmentBlobCopies),
);
const duplicatedEnvironmentBytes = Math.max(
  ...census.rows.map((row) => row.duplicatedEnvironmentBytes),
);

const marginals = {
  format: marginalsInput.format,
  boundaryCommit: releaseIdentity.boundary.sourceCommit,
  images: marginalsInput.images,
  deltas: marginalsInput.deltas,
  gates: {
    prompt1To8Maximum: marginalsInput.gates.prompt1To8Maximum,
    prompt1To8: "pass",
    prompt8To16Maximum: marginalsInput.gates.prompt8To16Maximum,
    prompt8To16: "pass",
    skill4kMaximum: marginalsInput.gates.skill4kMaximum,
    skill4k: "pass",
    extraToolMaximum: marginalsInput.gates.extraToolMaximum,
    extraTool: "pass",
  },
};
const decoder = {
  format: "agent-system-decoder-ablation/v1",
  boundaryCommit: releaseIdentity.boundary.sourceCommit,
  fullRepositorySystem: {
    imageSha256,
    imageByteLength: image.byteLength,
  },
  withoutActionDecode: {
    imageSha256: ablationEconomy.imageSha256,
    imageByteLength: ablationEconomy.imageByteLength,
    sections: sectionTotals(ablationEconomy),
  },
  decoderImageByteDelta: image.byteLength - ablationEconomy.imageByteLength,
  sixSimpleTools: {
    withoutActionDecodeBytes: marginals.images["six-tools-no-decode"],
    withActionDecodeBytes: marginals.images["six-tools-decode"],
    decoderImageByteDelta: marginals.deltas.sixToolDecoder,
  },
  conclusion: "Strict typed Action verification is not the dominant remaining image term.",
};

const ablation = {
  format: "agent-system-economy-ablation/v1",
  boundaryCommit: releaseIdentity.boundary.sourceCommit,
  rows: {
    A: {
      system: "prior landed Agent Interpretation image",
      imageByteLength: 23_431,
      reductions: 96,
    },
    B: {
      system: "semantic model effect, fixed message, no tools",
      imageByteLength: marginals.images["model-fixed-no-tools"],
    },
    C: {
      system: "B with bounded Text Goal",
      imageByteLength: marginals.images["model-dynamic-goal"],
    },
    D: {
      system: "one-tool system with one 4 KiB always-active skill",
      imageByteLength: marginals.images["skill-4k"],
    },
    E: {
      system: "one simple final tool",
      imageByteLength: marginals.images["tool-base"],
    },
    F: {
      system: "six simple actions, Action verification ablated",
      imageByteLength: marginals.images["six-tools-no-decode"],
    },
    G: {
      system: "F with strict typed Action verification",
      imageByteLength: marginals.images["six-tools-decode"],
    },
    H: {
      system: "repository Memory and admission, Action verification ablated",
      imageByteLength: ablationEconomy.imageByteLength,
    },
    I: {
      system: "full corrected repository-repair system",
      imageByteLength: image.byteLength,
      gzip9ByteLength,
      reductions: fixture.reductions,
      peakStateBytes: census.summary.stateBytes.maximum,
    },
    J: {
      system: "provider-wire-closure baseline",
      imageByteLength: historicalEvidence.providerWireBaseline.imageByteLength,
      gzip9ByteLength: historicalEvidence.providerWireBaseline.gzip9ByteLength,
      reductions: historicalEvidence.providerWireBaseline.reductions,
    },
  },
  dominantTerms: {},
  detailReceipts: {
    baselineImage: "wire-closure-baseline-image.json",
    baselineProcess: "wire-closure-baseline-process.json",
    correctedImage: "semantic-closure-corrected-image.json",
    correctedProcess: "semantic-closure-corrected-process.json",
    marginals: "semantic-closure-marginals.json",
    decoder: "semantic-closure-decoder-ablation.json",
  },
};
ablation.dominantTerms = {
  repositoryMemoryAndAdmissionOverSixToolDecoderBytes:
    ablation.rows.H.imageByteLength - ablation.rows.G.imageByteLength,
  strictRepositoryActionVerificationBytes:
    ablation.rows.I.imageByteLength - ablation.rows.H.imageByteLength,
  providerWireRemovalBytes:
    ablation.rows.J.imageByteLength - ablation.rows.I.imageByteLength,
  providerWireRemovalReductions:
    ablation.rows.J.reductions - ablation.rows.I.reductions,
};

const boundary170KernelBytes = 647_473;
const kernelGrowth = releaseIdentity.kernel.byteLength - boundary170KernelBytes;
const summary = {
  format: "agent-system-economy/v1",
  status: "passed",
  providerWireBaseline: historicalEvidence.providerWireBaseline,
  semanticClosure: {
    effectIdentity: "agent.model.invoke.v2",
    protocolIdentity: "agent.model.protocol.openai-responses-v2",
    imageSha256,
    imageByteLength: image.byteLength,
    gzip9ByteLength,
    reductions: fixture.reductions,
    modelRequests: fixture.modelRequests,
    repositoryRequests: fixture.repositoryRequests,
    maximumProgressedBetweenResidualBoundaries:
      census.maximumProgressedBetweenResidualBoundaries,
    peakStateBytes: census.summary.stateBytes.maximum,
    p95StateBytes: census.summary.stateBytes.p95,
    largestRequestBytes: census.summary.requestBytes.maximum,
    duplicateEnvironmentBlobCopies,
    duplicatedEnvironmentBytes,
    terminalSha256: fixture.terminalSha256,
    finalTree: fixture.finalTree,
  },
  sections: sectionTotals(imageEconomy),
  gates: {
    rawImageMaximumBytes: 98_304,
    rawImage: image.byteLength <= 98_304 ? "pass" : "fail",
    reductionMaximum: 512,
    reductions: fixture.reductions <= 512 ? "pass" : "fail",
    betweenEffectMaximum: 64,
    betweenEffectWork:
      census.maximumProgressedBetweenResidualBoundaries <= 64 ? "pass" : "fail",
    peakStateMaximumBytes: 131_072,
    peakState:
      census.summary.stateBytes.maximum <= 131_072 ? "pass" : "fail",
    largeDuplicateLiveEnvironment:
      duplicateEnvironmentBlobCopies === 0 && duplicatedEnvironmentBytes === 0
        ? "pass" : "fail",
  },
  boundary: {
    commit: releaseIdentity.boundary.sourceCommit,
    kernelSha256: releaseIdentity.kernel.sha256,
    kernelByteLength: releaseIdentity.kernel.byteLength,
    growthFromBoundary170Bytes: kernelGrowth,
    growthFromBoundary170Percent:
      Math.round((kernelGrowth / boundary170KernelBytes) * 10_000) / 100,
    compilerMaximumValues: 1_280,
    compilerMaximumBlocks: 192,
  },
  world: {
    commit: releaseIdentity.world.sourceCommit,
    runtimeArchiveSha256: releaseIdentity.world.archiveSha256,
    runtimeArchiveByteLength: releaseIdentity.world.archiveByteLength,
  },
};
assert(Object.values(summary.gates).every((value) =>
  typeof value === "number" || value === "pass"));

await Promise.all([
  writeJson(join(root, "economy/semantic-closure-corrected-image.json"), imageEconomy, true),
  writeJson(join(root, "economy/semantic-closure-corrected-phases.json"), sourceMap, true),
  writeJson(join(root, "economy/semantic-closure-corrected-process.json"), census),
  writeJson(join(root, "economy/semantic-closure-marginals.json"), marginals),
  writeJson(join(root, "economy/semantic-closure-decoder-ablation.json"), decoder),
  writeJson(join(root, "economy/semantic-closure-ablation-matrix.json"), ablation),
  writeJson(join(root, "economy/semantic-closure-corrected.json"), summary),
  writeJson(join(root, "system_closure_v1/fixture-proof.json"), fixture),
  writeJson(join(root, "system_closure_v1/admission-proof.json"), admission),
]);

process.stdout.write(`${JSON.stringify({
  format: "agent-release-evidence-write/v1",
  result: "passed",
  boundaryCommit: releaseIdentity.boundary.sourceCommit,
  worldCommit: releaseIdentity.world.sourceCommit,
  kernelSha256: releaseIdentity.kernel.sha256,
  imageSha256,
  imageByteLength: image.byteLength,
  reductions: fixture.reductions,
  peakStateBytes: census.summary.stateBytes.maximum,
  publicNegativeCases:
    publicNegatives.semanticResults.length + publicNegatives.schedulerResults.length,
})}\n`);

function assertTuple(identity, fixtureProof, artifactReceipt, admissionProof) {
  const pairs = [
    [fixtureProof.kernelSha256, identity.kernel.sha256],
    [fixtureProof.kernelByteLength, identity.kernel.byteLength],
    [fixtureProof.kernelBoundarySourceCommit, identity.boundary.sourceCommit],
    [fixtureProof.worldSourceCommit, identity.world.sourceCommit],
    [fixtureProof.worldProductionSourceSha256, identity.world.productionSourceSha256],
    [fixtureProof.worldRuntimeArchiveSha256, identity.world.archiveSha256],
    [fixtureProof.worldRuntimeArchiveByteLength, identity.world.archiveByteLength],
    [artifactReceipt.boundarySourceCommit, identity.boundary.sourceCommit],
    [artifactReceipt.worldSourceCommit, identity.world.sourceCommit],
    [artifactReceipt.worldRuntimeArchiveSha256, identity.world.archiveSha256],
    [artifactReceipt.kernelSha256, identity.kernel.sha256],
    [admissionProof.kernelSha256, identity.kernel.sha256],
  ];
  for (const [actual, expected] of pairs) assert.equal(actual, expected);
}

function assertMarginalGates(marginals) {
  assert(marginals.deltas.prompt1To8 <= marginals.gates.prompt1To8Maximum);
  assert(marginals.deltas.prompt8To16 <= marginals.gates.prompt8To16Maximum);
  assert(marginals.deltas.skill4k <= marginals.gates.skill4kMaximum);
  assert(marginals.deltas.extraTool <= marginals.gates.extraToolMaximum);
}

function sectionTotals(report) {
  return {
    schemasBytes: report.sections.schemas.bytes,
    constantsBytes: report.sections.constants.bytes,
    constantPayloadBytes: report.sections.constants.payloadBytes,
    effectsBytes: report.sections.effects.bytes,
    valuesBytes: report.sections.values.bytes,
    valueCount: report.sections.values.records,
    functionsBytes: report.sections.functions.bytes,
    functionCount: report.sections.functions.records,
    segmentsBytes: report.sections.segments.bytes,
    segmentCount: report.sections.segments.records,
    instructionCount: report.sections.segments.instructions,
    operandCount: report.sections.segments.operands,
    constructorsBytes: report.sections.constructors.bytes,
    constructorCount: report.sections.constructors.records,
    environmentFieldCount: report.sections.constructors.environmentFields,
    invariantTermCount: report.sections.constructors.invariantTerms,
  };
}

function stripCensus(value) {
  const { rows: _, receiptPath: __, ...rest } = value;
  return rest;
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

async function readJson(path) {
  const bytes = await readFile(resolve(path));
  assert(bytes.byteLength <= 16 * 1024 * 1024, `JSON input is too large: ${path}`);
  return JSON.parse(bytes);
}

async function writeJson(path, value, compact = false) {
  const encoded = compact ? JSON.stringify(value) : JSON.stringify(value, null, 2);
  await writeFile(path, `${encoded}\n`);
}

function parseArgs(args) {
  const admitted = new Set([
    "distribution", "census", "admission", "publicNegatives",
    "imageEconomy", "ablationImageEconomy", "marginals", "sourceMap",
    "image", "receipt", "outputRoot",
  ]);
  const result = {};
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index];
    const value = args[index + 1];
    assert(key?.startsWith("--") && value !== undefined, "invalid arguments");
    const name = key.slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
    assert(admitted.has(name), `unknown argument ${key}`);
    assert(!(name in result), `duplicate argument ${key}`);
    result[name] = value;
  }
  for (const name of admitted) {
    if (name !== "outputRoot") assert(name in result, `missing --${name}`);
  }
  return result;
}
