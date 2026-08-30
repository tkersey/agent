#!/usr/bin/env bun

import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import {
  cp,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";

import {
  advanceFresh,
  compileProcessKernel,
  createProcessKernelHost,
  decodeOutcome,
  decodeResult,
  encodeResult,
  forkProcessKernelHost,
} from "./process_kernel_client.mjs";
import {
  BOUNDARY_IDENTITY,
  TRANSCRIPT_ANCHORS,
  buildTranscriptManifest,
  buildTranscriptPayload,
  canonicalArtifactIds,
  encodeCanonicalManifest,
  validateTranscriptManifest,
  validateTranscriptPayload,
} from "./transcript_format.mjs";

export const PROGRAM_ANCHORS = Object.freeze({
  byteLength: TRANSCRIPT_ANCHORS.programImageByteLength,
  sha256: TRANSCRIPT_ANCHORS.programImageSha256,
  transitionDigest: "48eb6ec9a74b9a4c958d78c526f3eacded2ba5baad2402a05465e3f1dbe34816",
});

export const INITIAL_ARGS_ANCHORS = Object.freeze({
  byteLength: TRANSCRIPT_ANCHORS.initialArgsByteLength,
  sha256: TRANSCRIPT_ANCHORS.initialArgsSha256,
});

export const RUN_ANCHORS = Object.freeze({
  reductionCount: TRANSCRIPT_ANCHORS.reductionCount,
  residualBoundaryCount: TRANSCRIPT_ANCHORS.residualBoundaryCount,
  freshWasmInstanceCount: TRANSCRIPT_ANCHORS.freshWasmInstanceCount,
  transferAfterBoundary: TRANSCRIPT_ANCHORS.transferAfterBoundary,
  terminalReductionIndex: TRANSCRIPT_ANCHORS.terminalReductionIndex,
  terminalResultSha256: TRANSCRIPT_ANCHORS.terminalResultSha256,
  typedIoDigest: "bc3a65ec23bd18f166436a508da26d1e474d66a571ad7f8bb47d4cbac920e1b3",
  finalGitTree: "0d9ac8802aac6597cb0a443245efb6f92a0249fe",
});

export const EXPECTED_EFFECT_IDENTITIES = Object.freeze([
  "model.decide.v1",
  "repo.list.v1",
  "model.decide.v1",
  "repo.read.v1",
  "model.decide.v1",
  "repo.read.v1",
  "model.decide.v1",
  "repo.read.v1",
  "model.decide.v1",
  "repo.search.v1",
  "model.decide.v1",
  "repo.test.v1",
  "model.decide.v1",
  "repo.replace.approved.v1",
  "model.decide.v1",
  "repo.test.v1",
  "model.decide.v1",
]);

const GENERATION_RECEIPT_FORMAT =
  "agent-repository-repair-process-generation-receipt/v1";
const HISTORICAL_APPLICATION_ID =
  "b2e6628424ed95648a554ab5730566476360de86c9534a375357ba152031cf4c";
const HISTORICAL_DECISION_CONTRACT_DIGEST =
  "28ad8f64d48be98b260c14d91ef7a61387c0782b61f0cca641bd38ed8efae7ae";
const WORLD_CAPABILITIES_VERSION = "2.3.3";
const WORLD_CAPABILITIES_RUNTIME_SHA256 =
  "92067a800d42310b21d0ca417d2db9705d86c1050801e82335172f0740ead98b";
const CHECK_RELEASE_COMMIT = "0123456789abcdef0123456789abcdef01234567";
const AUTHORIZED_RELEASE_VERSIONS = new Set(["2.7.0", "2.7.1"]);
const MAXIMUM_RESULT_BYTES = 40 * 1024;
const ADMITTED_STATUS_MASK = 0b0000_0111;
const VERSION_PATTERN = /^[0-9]+\.[0-9]+\.[0-9]+$/;
const RELEASE_TAG_PATTERN = /^v[0-9]+\.[0-9]+\.[0-9]+$/;
const COMMIT_PATTERN = /^[0-9a-f]{40}$/;
const PROGRAM_MAGIC = Buffer.from("ABL_BPI1", "ascii");

export function programTransitionDigest(value) {
  const bytes = byteBuffer(value, "program image");
  if (bytes.length < 64) fail("program_transition_digest", "program image is too short");
  return bytes.subarray(32, 64).toString("hex");
}

export function validateProgramImage(value, expected = PROGRAM_ANCHORS) {
  const bytes = byteBuffer(value, "program image");
  if (bytes.length !== expected.byteLength) {
    fail("program_image_byte_length", `${bytes.length}`);
  }
  const digest = sha256(bytes);
  if (digest !== expected.sha256) fail("program_image_sha256", digest);
  if (!bytes.subarray(0, PROGRAM_MAGIC.length).equals(PROGRAM_MAGIC)) {
    fail("program_image_magic");
  }
  const transitionDigest = programTransitionDigest(bytes);
  if (transitionDigest !== expected.transitionDigest) {
    fail("program_transition_digest", transitionDigest);
  }
  return Object.freeze({ bytes, sha256: digest, transitionDigest });
}

export function validateInitialArgs(value, expected = INITIAL_ARGS_ANCHORS) {
  const bytes = byteBuffer(value, "InitialArgs");
  if (bytes.length !== expected.byteLength) {
    fail("initial_args_byte_length", `${bytes.length}`);
  }
  const digest = sha256(bytes);
  if (digest !== expected.sha256) fail("initial_args_sha256", digest);
  return Object.freeze({ bytes, sha256: digest });
}

export function typedIoDigest(boundaries) {
  if (!Array.isArray(boundaries)) fail("typed_io_rows");
  const rows = boundaries.map((entry, index) => {
    if (!entry || typeof entry.identity !== "string" || entry.identity.length === 0) {
      fail("typed_io_rows", `${index}:identity`);
    }
    const payload = byteBuffer(entry.payload, `typed I/O payload ${index}`);
    const response = byteBuffer(entry.response, `typed I/O response ${index}`);
    return Object.freeze({
      identity: entry.identity,
      payload_sha256: sha256(payload),
      result_sha256: sha256(response),
    });
  });
  return Object.freeze({
    rows: Object.freeze(rows),
    digest: sha256(Buffer.from(JSON.stringify(rows), "utf8")),
  });
}

export function validateRunAnchors(run, expected = RUN_ANCHORS) {
  if (run.reductionCount !== expected.reductionCount ||
      run.outcomeKinds?.length !== expected.reductionCount) {
    fail("reduction_count", `${run.reductionCount}`);
  }
  if (run.requestReductionIndices?.length !== expected.residualBoundaryCount ||
      run.effectIdentities?.length !== expected.residualBoundaryCount) {
    fail("requested_count", `${run.effectIdentities?.length ?? -1}`);
  }
  if (JSON.stringify(run.effectIdentities) !== JSON.stringify(EXPECTED_EFFECT_IDENTITIES)) {
    fail("effect_identity_order", JSON.stringify(run.effectIdentities));
  }
  const requestedCount = run.outcomeKinds.filter((kind) => kind === "Requested").length;
  if (requestedCount !== expected.residualBoundaryCount) {
    fail("requested_count", `${requestedCount}`);
  }
  for (const [index, kind] of run.outcomeKinds.entries()) {
    if (kind === "AuthoredFailure" || kind === "NeedsCapacity") {
      fail("forbidden_outcome", `${index}:${kind}`);
    }
    if (kind === "Completed" && index !== expected.terminalReductionIndex) {
      fail("terminal_reduction", `${index}`);
    }
  }
  if (run.outcomeKinds[expected.terminalReductionIndex] !== "Completed") {
    fail("terminal_kind", `${run.outcomeKinds[expected.terminalReductionIndex]}`);
  }
  if (run.freshWasmInstanceCount !== expected.freshWasmInstanceCount) {
    fail("fresh_wasm_instance_count", `${run.freshWasmInstanceCount}`);
  }
  if (run.transferAfterBoundary !== expected.transferAfterBoundary) {
    fail("transfer_boundary", `${run.transferAfterBoundary}`);
  }
  if (run.transferRecovered !== true) fail("request_reconstruction");
  if (run.terminalReductionIndex !== expected.terminalReductionIndex) {
    fail("terminal_reduction", `${run.terminalReductionIndex}`);
  }
  if (run.terminalKind !== "Completed") fail("terminal_kind", `${run.terminalKind}`);
  if (run.terminalResultSha256 !== expected.terminalResultSha256) {
    fail("terminal_result_sha256", `${run.terminalResultSha256}`);
  }
  if (run.typedIoDigest !== expected.typedIoDigest) {
    fail("typed_io_digest", `${run.typedIoDigest}`);
  }
  if (run.finalGitTree !== expected.finalGitTree) {
    fail("final_git_tree", `${run.finalGitTree}`);
  }
  return run;
}

export async function generateTranscriptPass({
  agentRoot,
  capabilitiesRoot,
  fixtureRoot,
  gitExecutable,
  kernel,
  programImage,
  initialArgs,
  temporaryRoot = null,
} = {}) {
  const ownedTemporaryRoot = temporaryRoot === null;
  const root = temporaryRoot ?? await mkdtemp(join(tmpdir(), "agent-process-transcript-"));
  try {
    const workspaceRoot = join(root, "repository");
    const temporaryHome = join(root, "home");
    const gitTemplate = join(root, "git-template");
    await Promise.all([
      cp(fixtureRoot, workspaceRoot, { recursive: true, errorOnExist: true }),
      mkdir(temporaryHome, { recursive: true }),
      mkdir(gitTemplate, { recursive: true }),
    ]);
    const gitEnvironment = hermeticGitEnvironment(temporaryHome);
    initializeGit(gitExecutable, workspaceRoot, gitTemplate, gitEnvironment);

    const owner = await createHistoricalOwner({
      agentRoot,
      capabilitiesRoot,
      workspaceRoot,
      temporaryHome,
    });
    const transitionDigest = Buffer.from(PROGRAM_ANCHORS.transitionDigest, "hex");
    const mainHost = createProcessKernelHost(kernel);
    const hosts = [mainHost];
    let activeHost = mainHost;
    let current = Buffer.from(initialArgs);
    let isState = false;
    let pendingResult = null;
    let transferRecovered = false;
    let terminalResult = null;
    let terminalReductionIndex = null;
    const outcomes = [];
    const outcomeKinds = [];
    const requests = [];
    const effectResults = [];
    const requestReductionIndices = [];
    const effectIdentities = [];
    const typedBoundaries = [];

    for (let reductionIndex = 0; reductionIndex < RUN_ANCHORS.reductionCount; reductionIndex += 1) {
      const outcomeValue = await advanceFresh(activeHost, {
        image: programImage,
        current,
        isState,
        effectResult: pendingResult,
      });
      pendingResult = null;
      // Bind the copied raw PKO1 to this exact historical program before using
      // any decoded view returned by the client.
      const outcome = decodeOutcome(outcomeValue.bytes, {
        expectedProgramTransitionDigest: transitionDigest,
      });
      outcomes.push(Buffer.from(outcome.bytes));
      outcomeKinds.push(outcome.kindName);

      if (outcome.kind === 0 || outcome.kind === 2) {
        current = Buffer.from(outcome.state);
        isState = true;
        continue;
      }

      if (outcome.kind === 1) {
        const boundaryIndex = requests.length;
        if (boundaryIndex >= RUN_ANCHORS.residualBoundaryCount) {
          fail("requested_count", `${boundaryIndex + 1}`);
        }
        current = Buffer.from(outcome.state);
        isState = true;
        let requestBytes = Buffer.from(outcome.request);
        let request = outcome.requestView;

        if (boundaryIndex === RUN_ANCHORS.transferAfterBoundary) {
          if (transferRecovered) fail("request_reconstruction", "duplicate transfer");
          const reconstructedHost = forkProcessKernelHost(activeHost);
          hosts.push(reconstructedHost);
          const reconstructedValue = await advanceFresh(reconstructedHost, {
            image: programImage,
            current,
            isState: true,
            effectResult: null,
          });
          const reconstructed = decodeOutcome(reconstructedValue.bytes, {
            expectedProgramTransitionDigest: transitionDigest,
          });
          if (reconstructed.kind !== 1 ||
              !reconstructed.bytes.equals(outcome.bytes) ||
              !reconstructed.state.equals(current) ||
              !reconstructed.request.equals(requestBytes)) {
            fail("request_reconstruction");
          }
          // The reconstructed wrapper is now the admitted execution context;
          // subsequent reductions still instantiate a fresh WASM instance.
          activeHost = reconstructedHost;
          current = Buffer.from(reconstructed.state);
          requestBytes = Buffer.from(reconstructed.request);
          request = reconstructed.requestView;
          transferRecovered = true;
        }

        const expectedIdentity = EXPECTED_EFFECT_IDENTITIES[boundaryIndex];
        if (request.identity !== expectedIdentity) {
          fail("effect_identity_order", `${boundaryIndex}:${request.identity}`);
        }
        if (!request.programTransitionDigest.equals(transitionDigest)) {
          fail("request_program_transition_digest", `${boundaryIndex}`);
        }
        const response = await resolveHistoricalEffect(owner, request, boundaryIndex);
        const effectResult = encodeResult(request, response);
        decodeResult(effectResult, { expectedRequest: request });
        requests.push(requestBytes);
        effectResults.push(Buffer.from(effectResult));
        requestReductionIndices.push(reductionIndex);
        effectIdentities.push(request.identity);
        typedBoundaries.push(Object.freeze({
          identity: request.identity,
          payload: Buffer.from(request.payload),
          response: Buffer.from(response),
        }));
        pendingResult = effectResult;
        continue;
      }

      if (outcome.kind === 3) {
        if (reductionIndex !== RUN_ANCHORS.terminalReductionIndex) {
          fail("terminal_reduction", `${reductionIndex}`);
        }
        terminalResult = Buffer.from(outcome.result);
        terminalReductionIndex = reductionIndex;
        if (reductionIndex !== RUN_ANCHORS.reductionCount - 1) {
          fail("completion_before_reduction_95", `${reductionIndex}`);
        }
        continue;
      }

      if (outcome.kind === 4) fail("authored_failure", `${reductionIndex}`);
      if (outcome.kind === 5) fail("needs_capacity", `${reductionIndex}`);
      fail("process_outcome_kind", `${outcome.kind}`);
    }

    if (terminalResult === null) fail("completion_after_reduction_95");
    if (pendingResult !== null) fail("effect_result_unconsumed");
    const terminalVerification = await owner.environment.verifyTerminal(terminalResult);
    if (terminalVerification.hiddenVerifierPassed !== true) fail("hidden_verifier");
    const changedPaths = git(gitExecutable, workspaceRoot, ["diff", "--name-only"], gitEnvironment)
      .split("\n")
      .filter(Boolean);
    git(gitExecutable, workspaceRoot, ["add", "-A"], gitEnvironment);
    const finalGitTree = git(gitExecutable, workspaceRoot, ["write-tree"], gitEnvironment);
    if (JSON.stringify(changedPaths) !== JSON.stringify(["src/range.mjs"])) {
      fail("final_git_tree", JSON.stringify(changedPaths));
    }
    const typedIo = typedIoDigest(typedBoundaries);
    const freshWasmInstanceCount = hosts.reduce(
      (total, host) => total + host.freshInstanceCount,
      0,
    );
    const run = Object.freeze({
      reductionCount: outcomes.length,
      residualBoundaryCount: requests.length,
      freshWasmInstanceCount,
      transferAfterBoundary: RUN_ANCHORS.transferAfterBoundary,
      transferRecovered,
      terminalReductionIndex,
      terminalKind: "Completed",
      terminalResultSha256: sha256(terminalResult),
      typedIoDigest: typedIo.digest,
      typedIoRows: typedIo.rows,
      finalGitTree,
      outcomes: Object.freeze(outcomes),
      outcomeKinds: Object.freeze(outcomeKinds),
      requests: Object.freeze(requests),
      effectResults: Object.freeze(effectResults),
      requestReductionIndices: Object.freeze(requestReductionIndices),
      effectIdentities: Object.freeze(effectIdentities),
      terminalResult,
    });
    validateRunAnchors(run);
    return run;
  } finally {
    if (ownedTemporaryRoot) await rm(root, { recursive: true, force: true });
  }
}

export function buildGeneratedAssets({ programImage, initialArgs, run, producer }) {
  const artifactInputs = [
    { id: "program-image", bytes: programImage },
    { id: "initial-args", bytes: initialArgs },
    ...run.outcomes.map((bytes, index) => ({
      id: `outcome-${String(index).padStart(3, "0")}`,
      bytes,
    })),
    ...run.requests.map((bytes, index) => ({
      id: `request-${String(index).padStart(3, "0")}`,
      bytes,
    })),
    ...run.effectResults.map((bytes, index) => ({
      id: `effect-result-${String(index).padStart(3, "0")}`,
      bytes,
    })),
  ];
  const expectedIds = canonicalArtifactIds();
  if (artifactInputs.length !== expectedIds.length ||
      artifactInputs.some((entry, index) => entry.id !== expectedIds[index])) {
    fail("artifact_inventory", `${artifactInputs.length}`);
  }
  const payload = buildTranscriptPayload(artifactInputs);
  const manifest = buildTranscriptManifest({
    producer,
    payload,
    outcomeKinds: run.outcomeKinds,
    requestReductionIndices: run.requestReductionIndices,
  });
  const manifestBytes = Buffer.from(encodeCanonicalManifest(manifest));
  const payloadBytes = Buffer.from(payload.bytes);
  validateTranscriptManifest(manifestBytes, { expectedProducer: producer });
  const slices = validateTranscriptPayload(manifestBytes, payloadBytes, {
    expectedProducer: producer,
  });
  if (slices.size !== TRANSCRIPT_ANCHORS.artifactCount) {
    fail("artifact_inventory", `${slices.size}`);
  }
  return Object.freeze({ manifest, manifestBytes, payloadBytes, payload });
}

export function assertDeterministicAssets(first, second) {
  const firstManifest = byteBuffer(first?.manifestBytes, "first manifest");
  const secondManifest = byteBuffer(second?.manifestBytes, "second manifest");
  const firstPayload = byteBuffer(first?.payloadBytes, "first payload");
  const secondPayload = byteBuffer(second?.payloadBytes, "second payload");
  if (!firstManifest.equals(secondManifest) || !firstPayload.equals(secondPayload)) {
    fail("deterministic_rebuild");
  }
  return true;
}

export async function generateTranscript(options) {
  const normalized = await normalizeOptions(options);
  // In release mode, bind HEAD and tracked cleanliness before importing or
  // executing any Agent-owned proof input.
  const producer = await validateProducerTuple(normalized);
  const [programImageBytes, initialArgsBytes] = await Promise.all([
    readFile(normalized.image),
    readFile(normalized.initialArgs),
  ]);
  const program = validateProgramImage(programImageBytes);
  const initial = validateInitialArgs(initialArgsBytes);
  const capabilitiesIdentity = await authenticateCapabilities(
    normalized.agentRoot,
    normalized.capabilitiesRoot,
  );
  const capabilitiesSnapshotRoot = await snapshotCapabilities(
    normalized.capabilitiesRoot,
    capabilitiesIdentity.runtimePaths,
  );
  try {
    const snapshotIdentity = await authenticateCapabilities(
      normalized.agentRoot,
      capabilitiesSnapshotRoot,
    );
    if (snapshotIdentity.sha256 !== capabilitiesIdentity.sha256) {
      fail("world_capabilities_snapshot_identity");
    }
  const kernel = await compileProcessKernel(normalized.kernel);
  if (kernel.byteLength !== BOUNDARY_IDENTITY.kernelByteLength ||
      kernel.sha256 !== BOUNDARY_IDENTITY.kernelSha256 ||
      kernel.importCount !== 0 ||
      kernel.expectedAbiVersion !== BOUNDARY_IDENTITY.processKernelAbiVersion) {
    fail("boundary_kernel_identity");
  }
  const firstRun = await generateTranscriptPass({
    agentRoot: normalized.agentRoot,
    capabilitiesRoot: capabilitiesSnapshotRoot,
    fixtureRoot: normalized.fixtureRoot,
    gitExecutable: normalized.gitExecutable,
    kernel,
    programImage: program.bytes,
    initialArgs: initial.bytes,
  });
  const firstAssets = buildGeneratedAssets({
    programImage: program.bytes,
    initialArgs: initial.bytes,
    run: firstRun,
    producer,
  });
  const secondRun = await generateTranscriptPass({
    agentRoot: normalized.agentRoot,
    capabilitiesRoot: capabilitiesSnapshotRoot,
    fixtureRoot: normalized.fixtureRoot,
    gitExecutable: normalized.gitExecutable,
    kernel,
    programImage: program.bytes,
    initialArgs: initial.bytes,
  });
  const secondAssets = buildGeneratedAssets({
    programImage: program.bytes,
    initialArgs: initial.bytes,
    run: secondRun,
    producer,
  });
  assertDeterministicAssets(firstAssets, secondAssets);
  const finalCapabilitiesIdentity = await authenticateCapabilities(
    normalized.agentRoot,
    capabilitiesSnapshotRoot,
  );
  if (finalCapabilitiesIdentity.sha256 !== capabilitiesIdentity.sha256) {
    fail("world_capabilities_changed_during_generation");
  }

  if (normalized.mode === "release") {
    const finalProducer = await validateProducerTuple(normalized);
    if (JSON.stringify(finalProducer) !== JSON.stringify(producer)) {
      fail("release_producer_changed_during_generation");
    }
  }

  const receipt = Object.freeze({
    format: GENERATION_RECEIPT_FORMAT,
    result: "passed",
    producerCommit: producer.commit,
    producerReleaseTag: producer.releaseTag,
    boundaryCommit: BOUNDARY_IDENTITY.commit,
    kernelSha256: kernel.sha256,
    kernelByteLength: kernel.byteLength,
    kernelImportCount: kernel.importCount,
    processKernelAbiVersion: kernel.expectedAbiVersion,
    programImageSha256: program.sha256,
    programImageByteLength: program.bytes.length,
    initialArgsSha256: initial.sha256,
    initialArgsByteLength: initial.bytes.length,
    programTransitionDigest: program.transitionDigest,
    reductionCount: firstRun.reductionCount,
    residualBoundaryCount: firstRun.residualBoundaryCount,
    freshWasmInstanceCount: firstRun.freshWasmInstanceCount,
    transferAfterBoundary: RUN_ANCHORS.transferAfterBoundary,
    terminalReductionIndex: firstRun.terminalReductionIndex,
    typedIoDigest: firstRun.typedIoDigest,
    terminalResultSha256: firstRun.terminalResultSha256,
    finalGitTree: firstRun.finalGitTree,
    manifestSha256: sha256(firstAssets.manifestBytes),
    manifestByteLength: firstAssets.manifestBytes.length,
    payloadSha256: sha256(firstAssets.payloadBytes),
    payloadByteLength: firstAssets.payloadBytes.length,
    artifactCount: TRANSCRIPT_ANCHORS.artifactCount,
    deterministicRebuild: true,
  });
  const receiptBytes = Buffer.from(`${JSON.stringify(receipt, null, 2)}\n`, "utf8");
  await Promise.all([
    writeOutput(normalized.manifestOut, firstAssets.manifestBytes),
    writeOutput(normalized.payloadOut, firstAssets.payloadBytes),
    writeOutput(normalized.receiptOut, receiptBytes),
  ]);
  if (normalized.mode === "release") {
    const writtenProducer = await validateProducerTuple(normalized);
    if (JSON.stringify(writtenProducer) !== JSON.stringify(producer)) {
      fail("release_producer_changed_during_output");
    }
  }
  return Object.freeze({
    producer,
    receipt,
    receiptBytes,
    manifest: firstAssets.manifest,
    manifestBytes: firstAssets.manifestBytes,
    payloadBytes: firstAssets.payloadBytes,
  });
  } finally {
    await rm(capabilitiesSnapshotRoot, { recursive: true, force: true });
  }
}

export async function validateProducerTuple(options) {
  const versions = await readPackageVersions(options.agentRoot);
  const packageVersion = versions[0];
  if (!versions.every((value) => value === packageVersion)) {
    fail("package_version_surfaces", JSON.stringify(versions));
  }
  if (!VERSION_PATTERN.test(packageVersion)) fail("package_version", packageVersion);
  const expectedReleaseTag = `v${packageVersion}`;
  const releaseTag = options.mode === "check" && options.releaseTag === "-"
    ? expectedReleaseTag
    : options.releaseTag;
  if (!RELEASE_TAG_PATTERN.test(releaseTag ?? "")) {
    fail("invalid_release_tag", `${releaseTag ?? ""}`);
  }
  if (releaseTag !== expectedReleaseTag) {
    fail("package_version_tag_relation", `${packageVersion}:${releaseTag}`);
  }
  if (!COMMIT_PATTERN.test(options.releaseCommit ?? "")) {
    fail("invalid_release_commit", `${options.releaseCommit ?? ""}`);
  }
  if (options.mode === "check") {
    if (options.releaseCommit !== CHECK_RELEASE_COMMIT) {
      fail("check_release_commit", options.releaseCommit);
    }
  } else if (options.mode === "release") {
    if (!AUTHORIZED_RELEASE_VERSIONS.has(packageVersion)) {
      fail("unauthorized_release_version", packageVersion);
    }
    if (options.releaseCommit === CHECK_RELEASE_COMMIT) {
      fail("release_test_tuple_forbidden");
    }
    if (existsSync(join(options.agentRoot, ".git"))) {
      const expectedRoot = await realpath(options.agentRoot);
      const environment = releaseGitEnvironment(expectedRoot);
      const topLevel = await realpath(git(
        options.gitExecutable,
        expectedRoot,
        ["rev-parse", "--show-toplevel"],
        environment,
      ));
      if (topLevel !== expectedRoot) fail("release_git_root", topLevel);
      const branch = git(
        options.gitExecutable,
        expectedRoot,
        ["symbolic-ref", "--short", "HEAD"],
        environment,
      );
      if (branch !== "main") fail("release_branch", branch);
      const head = git(options.gitExecutable, expectedRoot, ["rev-parse", "HEAD"], environment);
      if (head !== options.releaseCommit) {
        fail("release_commit_head", `${options.releaseCommit}:${head}`);
      }
      const remoteMain = git(
        options.gitExecutable,
        expectedRoot,
        ["rev-parse", "refs/remotes/origin/main"],
        environment,
      );
      if (remoteMain !== head) fail("release_origin_main", `${head}:${remoteMain}`);
      const tracked = git(options.gitExecutable, expectedRoot, [
        "status",
        "--porcelain=v1",
        "--untracked-files=no",
      ], environment);
      if (tracked.length !== 0) fail("dirty_tracked_source_tree", tracked);
      const existingTag = git(
        options.gitExecutable,
        expectedRoot,
        ["tag", "--list", releaseTag],
        environment,
      );
      if (existingTag.length !== 0) fail("release_tag_already_exists", releaseTag);
    }
  } else {
    fail("invalid_mode", `${options.mode}`);
  }
  return Object.freeze({
    repository: "tkersey/agent",
    releaseTag,
    releaseUrl: `https://github.com/tkersey/agent/releases/tag/${releaseTag}`,
    commit: options.releaseCommit,
  });
}

async function createHistoricalOwner({
  agentRoot,
  capabilitiesRoot,
  workspaceRoot,
  temporaryHome,
}) {
  const [environmentModule, resolverModule, capabilityProtocol] = await Promise.all([
    importModule(join(agentRoot, "tools/interpretation/repository_repair_environment.mjs")),
    importModule(join(agentRoot, "tools/interpretation/effect_resolver.mjs")),
    importModule(join(capabilitiesRoot, "src/v1/protocol.mjs")),
  ]);
  const environment = await environmentModule.createEnvironment({
    capabilitiesRoot,
    workspaceRoot,
    temporaryHome,
    bunExecutable: resolve(process.execPath),
    applicationId: HISTORICAL_APPLICATION_ID,
  });
  if (environment.expectedDecisionContractDigest !== HISTORICAL_DECISION_CONTRACT_DIGEST) {
    fail("decision_contract_fixture");
  }
  return Object.freeze({
    environment,
    resolveInterpretedEffect: resolverModule.resolveInterpretedEffect,
    effectInterfaceId: capabilityProtocol.effectInterfaceId,
    statusNames: capabilityProtocol.statusNames,
  });
}

async function resolveHistoricalEffect(owner, request, boundaryIndex) {
  const expectedInterface = Buffer.from(owner.effectInterfaceId(request.identity));
  const applicationId = Buffer.from(HISTORICAL_APPLICATION_ID, "hex");
  const matches = owner.environment.bindings.filter((binding) =>
    Buffer.from(binding.interfaceId).equals(expectedInterface) &&
    Buffer.from(binding.payloadSchemaId).equals(request.payloadSchemaDigest) &&
    Buffer.from(binding.resultSchemaId).equals(request.resumeSchemaDigest) &&
    binding.applicationIds.some((id) => Buffer.from(id).equals(applicationId))
  );
  if (matches.length !== 1) {
    fail("effect_binding_count", `${boundaryIndex}:${request.identity}:${matches.length}`);
  }
  const binding = matches[0];
  const resolved = await owner.resolveInterpretedEffect({
    admission: Object.freeze({
      effect: Object.freeze({ identity: request.identity }),
      interfaceId: expectedInterface,
      residual: Object.freeze({
        siteId: BigInt(boundaryIndex),
        allowedStatuses: ADMITTED_STATUS_MASK,
      }),
      binding,
    }),
    manifest: Object.freeze({
      limits: Object.freeze({ maximumResultBytes: MAXIMUM_RESULT_BYTES }),
    }),
    requestIdentity: Object.freeze({
      digest: Buffer.from(request.requestIdentity),
      sequence: BigInt(boundaryIndex),
    }),
    payloadBytes: Buffer.from(request.payload),
    receiverContext: owner.environment.context,
    admitCapabilityOutcome: owner.environment.admitCapabilityOutcome,
    statusNames: owner.statusNames,
    beforeResolve: owner.environment.beforeResolve,
  });
  const response = Buffer.from(resolved.responseBytes);
  if (response.length === 0 || response.length > MAXIMUM_RESULT_BYTES) {
    fail("effect_result_byte_length", `${boundaryIndex}:${response.length}`);
  }
  return response;
}

async function authenticateCapabilities(agentRoot, capabilitiesRoot) {
  const [lockModule, digestModule] = await Promise.all([
    importModule(join(agentRoot, "tools/interpretation/runtime_dependency_lock.mjs")),
    importModule(join(agentRoot, "tools/interpretation/dependency_digest.mjs")),
  ]);
  const lock = lockModule.readRuntimeDependencyLock(
    join(agentRoot, "interpretation/runtime-dependencies.lock.json"),
  );
  const entry = lock.worldCapabilities;
  if (entry.version !== WORLD_CAPABILITIES_VERSION ||
      entry.runtimeSha256 !== WORLD_CAPABILITIES_RUNTIME_SHA256) {
    fail("world_capabilities_lock_identity");
  }
  const observed = await digestModule.runtimeDependencyDigest(
    capabilitiesRoot,
    entry.runtimePaths,
  );
  if (observed.sha256 !== WORLD_CAPABILITIES_RUNTIME_SHA256) {
    fail("world_capabilities_runtime_sha256", observed.sha256);
  }
  return Object.freeze({
    ...observed,
    runtimePaths: Object.freeze([...entry.runtimePaths]),
  });
}

async function snapshotCapabilities(capabilitiesRoot, runtimePaths) {
  const snapshotRoot = await mkdtemp(join(tmpdir(), "agent-process-capabilities-"));
  try {
    for (const relativePath of runtimePaths) {
      const source = join(capabilitiesRoot, relativePath);
      const destination = join(snapshotRoot, relativePath);
      await mkdir(dirname(destination), { recursive: true });
      await cp(source, destination, {
        recursive: true,
        errorOnExist: true,
        force: false,
      });
    }
    return snapshotRoot;
  } catch (error) {
    await rm(snapshotRoot, { recursive: true, force: true });
    throw error;
  }
}

async function normalizeOptions(options) {
  if (!options || typeof options !== "object") fail("options");
  const result = { ...options };
  for (const key of [
    "agentRoot",
    "image",
    "initialArgs",
    "kernel",
    "capabilitiesRoot",
    "fixtureRoot",
    "gitExecutable",
    "manifestOut",
    "payloadOut",
    "receiptOut",
  ]) {
    if (typeof result[key] !== "string" || result[key].length === 0) {
      fail("missing_argument", key);
    }
    result[key] = resolve(result[key]);
  }
  if (result.mode !== "check" && result.mode !== "release") {
    fail("invalid_mode", `${result.mode}`);
  }
  for (const key of ["agentRoot", "capabilitiesRoot", "fixtureRoot"]) {
    const canonical = await realpath(result[key]);
    if (!(await stat(canonical)).isDirectory()) fail("input_not_directory", key);
    result[key] = canonical;
  }
  for (const key of ["image", "initialArgs", "kernel", "gitExecutable"]) {
    const canonical = await realpath(result[key]);
    if (!(await stat(canonical)).isFile()) fail("input_not_file", key);
    if (key === "gitExecutable" && ((await stat(canonical)).mode & 0o111) === 0) {
      fail("git_executable_not_executable");
    }
    result[key] = canonical;
  }
  return Object.freeze(result);
}

async function readPackageVersions(agentRoot) {
  const files = [
    ["build.zig.zon", /^\s*\.version\s*=\s*"([0-9]+\.[0-9]+\.[0-9]+)",\s*$/m],
    ["src/root.zig", /^pub const package_version\s*=\s*"([0-9]+\.[0-9]+\.[0-9]+)";\s*$/m],
    ["src/manifest.zig", /^pub const package_version\s*=\s*"([0-9]+\.[0-9]+\.[0-9]+)";\s*$/m],
  ];
  return Promise.all(files.map(async ([path, pattern]) => {
    const text = await readFile(join(agentRoot, path), "utf8");
    const match = pattern.exec(text);
    if (match === null) fail("package_version_missing", path);
    return match[1];
  }));
}

function initializeGit(executable, root, template, environment) {
  git(executable, root, ["init", "-q", `--template=${template}`], environment);
  git(executable, root, ["config", "user.name", "Agent Process Transcript"], environment);
  git(executable, root, ["config", "user.email", "agent-process-transcript@example.invalid"], environment);
  git(executable, root, ["config", "commit.gpgSign", "false"], environment);
  git(executable, root, ["config", "core.hooksPath", "/dev/null"], environment);
  git(executable, root, ["add", "."], environment);
  git(executable, root, ["commit", "-qm", "fixture baseline"], environment);
}

function hermeticGitEnvironment(home) {
  return Object.freeze({
    HOME: home,
    XDG_CONFIG_HOME: home,
    PATH: process.env.PATH ?? "/usr/bin:/bin",
    LC_ALL: "C",
    LANG: "C",
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_TERMINAL_PROMPT: "0",
  });
}

function releaseGitEnvironment(agentRoot) {
  return Object.freeze({
    HOME: agentRoot,
    XDG_CONFIG_HOME: agentRoot,
    PATH: process.env.PATH ?? "/usr/bin:/bin",
    LC_ALL: "C",
    LANG: "C",
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_TERMINAL_PROMPT: "0",
  });
}

function git(executable, root, args, environment = undefined) {
  const result = spawnSync(executable, args, {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
    env: environment,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    fail("git_command", `${args.join(" ")}:${result.stderr.trim()}`);
  }
  return result.stdout.trim();
}

async function importModule(path) {
  return import(pathToFileURL(path).href);
}

async function writeOutput(path, bytes) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, bytes);
}

function byteBuffer(value, label) {
  if (!(value instanceof Uint8Array)) fail("invalid_bytes", label);
  return Buffer.from(value);
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function fail(code, details = "") {
  throw new Error(details.length === 0 ? code : `${code}:${details}`);
}

function parseArguments(argv) {
  const aliases = new Map([
    ["program-image", "image"],
    ["manifest-output", "manifestOut"],
    ["payload-output", "payloadOut"],
    ["receipt-output", "receiptOut"],
  ]);
  const names = new Map([
    ["mode", "mode"],
    ["agent-root", "agentRoot"],
    ["image", "image"],
    ["initial-args", "initialArgs"],
    ["kernel", "kernel"],
    ["capabilities-root", "capabilitiesRoot"],
    ["fixture-root", "fixtureRoot"],
    ["git-executable", "gitExecutable"],
    ["release-tag", "releaseTag"],
    ["release-commit", "releaseCommit"],
    ["manifest-out", "manifestOut"],
    ["payload-out", "payloadOut"],
    ["receipt-out", "receiptOut"],
    ...aliases,
  ]);
  const result = {};
  for (let index = 0; index < argv.length; index += 2) {
    const argument = argv[index];
    const value = argv[index + 1];
    if (!argument?.startsWith("--") || value === undefined) {
      fail("invalid_argument", `${argument ?? ""}`);
    }
    const key = names.get(argument.slice(2));
    if (key === undefined || Object.hasOwn(result, key)) {
      fail("invalid_argument", argument);
    }
    result[key] = value;
  }
  return result;
}

async function main() {
  const result = await generateTranscript(parseArguments(process.argv.slice(2)));
  process.stdout.write(`${JSON.stringify({
    format: GENERATION_RECEIPT_FORMAT,
    result: "passed",
    producer: result.producer,
    manifestSha256: result.receipt.manifestSha256,
    payloadSha256: result.receipt.payloadSha256,
    artifactCount: result.receipt.artifactCount,
    reductionCount: result.receipt.reductionCount,
    residualBoundaryCount: result.receipt.residualBoundaryCount,
    freshWasmInstanceCount: result.receipt.freshWasmInstanceCount,
  })}\n`);
}

const isMain = process.argv[1] !== undefined &&
  resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (isMain) await main();
