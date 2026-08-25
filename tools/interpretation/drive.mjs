#!/usr/bin/env bun
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { readBpi1EffectCatalog } from "./bpi1_effects.mjs";
import { buildInterpretedEffectMap, resolveInterpretedEffect } from "./effect_resolver.mjs";
import { PROOF_LIMITS } from "./proof_limits.mjs";
import {
  compileKernel,
  decodeRequestIdentity,
  encodeResumeAuxiliary,
  executeKernelCommand
} from "./kernel_client.mjs";

export async function runInterpreted(options) {
  const artifacts = await loadArtifacts(options);
  const hostProtocol = await import(pathToFileURL(join(
    options.worldHostRoot,
    "src/v1/protocol.mjs"
  )));
  const capabilityProtocol = await import(pathToFileURL(join(
    options.capabilitiesRoot,
    "src/v1/protocol.mjs"
  )));
  const environmentModule = await import(pathToFileURL(options.environmentModule));
  const kernel = await compileKernel(artifacts.kernel);
  const manifest = hostProtocol.decodeApplicationManifest(artifacts.manifest);
  const applicationId = Buffer.from(manifest.applicationId).toString("hex");
  verifyArtifactBindings(artifacts, manifest);
  const decisionContractDigest = verifyDecisionContract(artifacts.decisionContract);
  const validation = await executeKernelCommand({
    kernel,
    bpi1: artifacts.bpi1,
    mv2p1: artifacts.mv2p1,
    command: 0
  });
  if (validation.outcome !== 0) throw new Error("interpreted_image_validation_failed");
  const effects = readBpi1EffectCatalog(artifacts.bpi1);

  const environment = await environmentModule.createEnvironment({
    capabilitiesRoot: options.capabilitiesRoot,
    workspaceRoot: options.workspaceRoot,
    temporaryHome: options.temporaryHome,
    bunExecutable: options.bunExecutable,
    applicationId
  });
  if (environment.expectedDecisionContractDigest !== decisionContractDigest) {
    throw new Error("decision_contract_fixture_mismatch");
  }
  if (!environment.bindings.every((binding) => binding.applicationIds.some(
    (id) => Buffer.from(id).equals(manifest.applicationId)
  ))) throw new Error("interpreted_application_not_admitted");
  const effectAdmissions = buildInterpretedEffectMap({
    effects,
    manifest,
    bindings: environment.bindings,
    effectInterfaceId: capabilityProtocol.effectInterfaceId
  });

  let result = await executeKernelCommand({
    kernel,
    bpi1: artifacts.bpi1,
    mv2p1: artifacts.mv2p1,
    command: 1,
    auxiliary: artifacts.initialArgs
  });
  if (result.outcome !== 1 || result.state.length === 0) throw new Error("interpreted_initialization_failed");
  let state = result.state;
  const trace = [];
  const yieldBoundaries = [];
  let transitionIndex = 0;
  let terminal = null;

  while (terminal === null) {
    if (transitionIndex >= PROOF_LIMITS.maximumTransitions) {
      throw new Error("interpreted_transition_limit");
    }
    const stepped = await executeKernelCommand({
      kernel,
      bpi1: artifacts.bpi1,
      mv2p1: artifacts.mv2p1,
      command: 4,
      state,
      callerFuel: manifest.limits.maximumFuelPerStep
    });
    transitionIndex += 1;
    if (stepped.outcome === 3) {
      if (trace.length === PROOF_LIMITS.maximumEffects) {
        throw new Error("interpreted_effect_limit");
      }
      const inspected = await executeKernelCommand({
        kernel,
        bpi1: artifacts.bpi1,
        mv2p1: artifacts.mv2p1,
        command: 3,
        state: stepped.state,
        callerFuel: manifest.limits.maximumFuelPerStep
      });
      if (inspected.outcome !== 3 || !sameBytes(inspected.state, stepped.state) ||
          !sameBytes(inspected.value, stepped.value) || !sameBytes(inspected.metadata, stepped.metadata)) {
        throw new Error("interpreted_request_views_diverged");
      }
      const identity = decodeRequestIdentity(stepped.metadata);
      const effect = effects[identity.siteOrdinal];
      if (!effect || !sameBytes(identity.effectSiteDigest, effect.ordinalEffectDigest) ||
          !sameBytes(identity.machineContractDigest, artifacts.mv2p1.subarray(96, 128)) ||
          sha256Bytes(stepped.value) !== Buffer.from(identity.payloadDigest).toString("hex")) {
        throw new Error("interpreted_request_identity_invalid");
      }
      const admission = effectAdmissions[identity.siteOrdinal];
      if (admission?.effect !== effect) throw new Error("interpreted_effect_admission_missing");
      const resolved = await resolveInterpretedEffect({
        admission,
        manifest,
        requestIdentity: identity,
        payloadBytes: stepped.value,
        receiverContext: environment.context,
        statusNames: capabilityProtocol.statusNames,
        beforeResolve: environment.beforeResolve
      });
      trace.push(freezeBoundary({
        boundaryIndex: trace.length,
        transitionIndex,
        state: stepped.state,
        identity: stepped.metadata,
        effectIdentity: effect.identity,
        interfaceId: Buffer.from(admission.interfaceId),
        payload: stepped.value,
        response: resolved.responseBytes
      }));
      const resumed = await executeKernelCommand({
        kernel,
        bpi1: artifacts.bpi1,
        mv2p1: artifacts.mv2p1,
        command: 5,
        state: stepped.state,
        auxiliary: encodeResumeAuxiliary(stepped.metadata, resolved.responseBytes),
        callerFuel: manifest.limits.maximumFuelPerStep
      });
      if (resumed.outcome !== 1 || resumed.state.length === 0) throw new Error("interpreted_resume_failed");
      state = resumed.state;
      continue;
    }
    if (stepped.outcome === 4) {
      yieldBoundaries.push(Object.freeze({
        transitionIndex,
        state: Buffer.from(stepped.state)
      }));
      state = stepped.state;
      continue;
    }
    if (stepped.outcome === 5) {
      terminal = stepped.value;
      break;
    }
    throw new Error(`interpreted_terminal_failure:${stepped.outcome}`);
  }
  const verified = await environment.verifyTerminal(terminal);
  return Object.freeze({
    applicationId,
    manifest,
    kernelSha256: kernel.sha256,
    kernelImportCount: kernel.importCount,
    effectCount: trace.length,
    effectCatalogCount: effects.length,
    maximumFuelPerStep: manifest.limits.maximumFuelPerStep,
    trace: Object.freeze(trace),
    yieldBoundaries: Object.freeze(yieldBoundaries),
    yieldPositions: Object.freeze(yieldBoundaries.map((entry) => entry.transitionIndex)),
    terminalResultBytes: Buffer.from(terminal),
    terminalResultSha256: sha256Bytes(terminal),
    finalSourceBytes: Buffer.from(verified.finalSource),
    hiddenVerifierPassed: verified.hiddenVerifierPassed,
    context: environment.context
  });
}

function verifyArtifactBindings(artifacts, manifest) {
  if (!sameBytes(artifacts.bpi1.subarray(32, 64), artifacts.mv2p1.subarray(32, 64))) {
    throw new Error("bpi1_mv2p1_transition_mismatch");
  }
  if (!sameBytes(manifest.rootProgramId, artifacts.mv2p1.subarray(96, 128))) {
    throw new Error("manifest_mv2p1_contract_mismatch");
  }
  if (manifest.boundaryPackageVersion !== "1.6.1" ||
      manifest.worldPackageVersion !== "3.1.4" ||
      manifest.boundaryStaticMachineAbiVersion !== 2) {
    throw new Error("manifest_boundary_identity_mismatch");
  }
}

function verifyDecisionContract(bytes) {
  if (bytes.length < 40 || bytes.subarray(0, 8).toString("ascii") !== "AGT_DCT2") {
    throw new Error("decision_contract_invalid");
  }
  const embedded = bytes.subarray(-32).toString("hex");
  const computed = sha256Bytes(bytes.subarray(0, -32));
  if (embedded !== computed) throw new Error("decision_contract_digest_invalid");
  return embedded;
}

async function loadArtifacts(options) {
  return Object.fromEntries(await Promise.all(
    ["bpi1", "mv2p1", "initialArgs", "decisionContract", "manifest", "kernel"]
      .map(async (key) => [key, await readFile(options[key])])
  ));
}

function freezeBoundary(value) {
  return Object.freeze({
    ...value,
    state: Buffer.from(value.state),
    identity: Buffer.from(value.identity),
    interfaceId: Buffer.from(value.interfaceId),
    payload: Buffer.from(value.payload),
    response: Buffer.from(value.response)
  });
}

function sameBytes(left, right) { return Buffer.from(left).equals(Buffer.from(right)); }
function sha256Bytes(bytes) { return createHash("sha256").update(bytes).digest("hex"); }

function parseArguments(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (!argument.startsWith("--") || index + 1 >= argv.length) throw new Error(`unknown_argument:${argument}`);
    result[argument.slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())] = argv[index += 1];
  }
  for (const key of [
    "bpi1", "mv2p1", "initialArgs", "decisionContract", "manifest", "kernel",
    "worldHostRoot", "capabilitiesRoot", "environmentModule", "workspaceRoot",
    "temporaryHome", "bunExecutable", "output"
  ]) {
    if (typeof result[key] !== "string") throw new Error(`missing_argument:${key}`);
    result[key] = resolve(result[key]);
  }
  return result;
}

if (import.meta.main) {
  const options = parseArguments(process.argv.slice(2));
  const result = await runInterpreted(options);
  const serializable = {
    ...result,
    maximumFuelPerStep: result.maximumFuelPerStep.toString(),
    manifest: undefined,
    context: summarizeContext(result.context),
    trace: result.trace.map((entry) => ({
      ...entry,
      state: entry.state.toString("base64"),
      identity: entry.identity.toString("base64"),
      interfaceId: entry.interfaceId.toString("base64"),
      payload: entry.payload.toString("base64"),
      response: entry.response.toString("base64")
    })),
    yieldBoundaries: result.yieldBoundaries.map((entry) => ({
      transitionIndex: entry.transitionIndex,
      state: entry.state.toString("base64")
    })),
    terminalResultBytes: result.terminalResultBytes.toString("base64"),
    finalSourceBytes: result.finalSourceBytes.toString("base64")
  };
  await writeFile(options.output, `${JSON.stringify(serializable, null, 2)}\n`, { flag: "wx" });
}

function summarizeContext(context) {
  return Object.freeze({
    effectAttempts: context.effectAttempts ?? 0,
    modelCalls: context.modelCalls ?? 0,
    fileReads: context.fileReads ?? 0,
    searches: context.searches ?? 0,
    testRuns: context.testRuns ?? 0,
    mutationAttempts: context.mutationAttempts ?? 0,
    mutationsApplied: context.mutationsApplied ?? 0,
    preMutationTestFailed: context.preMutationTestFailed === true,
    lastTestPassed: context.lastTestPassed === true
  });
}
