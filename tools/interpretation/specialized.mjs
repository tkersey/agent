import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { readBpi1EffectCatalog } from "./bpi1_effects.mjs";
import { compileKernel, decodeRequestIdentity, executeKernelCommand } from "./kernel_client.mjs";
import { PROOF_LIMITS } from "./proof_limits.mjs";

export async function runSpecialized(options) {
  const host = await import(pathToFileURL(join(options.worldHostRoot, "src/v1/index.mjs")));
  const capabilityProtocol = await import(pathToFileURL(join(
    options.capabilitiesRoot,
    "src/v1/protocol.mjs"
  )));
  const { CapabilityRouterV1 } = await import(pathToFileURL(join(
    options.capabilitiesRoot,
    "src/v1/router.mjs"
  )));
  const environmentModule = await import(pathToFileURL(options.environmentModule));
  const [wasmBytes, bpi1, mv2p1, manifestBytes, kernelBytes, initialArgsBytes] = await Promise.all([
    readFile(options.applicationWasm),
    readFile(join(options.artifactRoot, "repository-repair.agent.bpi1")),
    readFile(join(options.artifactRoot, "repository-repair.agent.mv2p1")),
    readFile(join(options.artifactRoot, "repository-repair-actuality.manifest.bin")),
    readFile(join(options.artifactRoot, "boundary-machine-v2-kernel-v1.wasm")),
    readFile(join(options.artifactRoot, "repository-repair.initial-args.bin"))
  ]);
  const manifest = host.decodeApplicationManifest(manifestBytes);
  const applicationId = Buffer.from(manifest.applicationId).toString("hex");
  const kernel = await compileKernel(kernelBytes);
  const effects = readBpi1EffectCatalog(bpi1);
  const environment = await environmentModule.createEnvironment({
    capabilitiesRoot: options.capabilitiesRoot,
    workspaceRoot: options.workspaceRoot,
    temporaryHome: options.temporaryHome,
    bunExecutable: options.bunExecutable,
    applicationId
  });
  const router = new CapabilityRouterV1({ bindings: environment.bindings });
  let preflightRuns = 0;
  const controller = await host.RunControllerV1.create({
    wasmBytes,
    blockStore: new host.MemoryBlockStore(),
    headStore: new host.MemoryBranchHeadStore(),
    workerFactory: () => new host.ApplicationWorker({ maximumMemoryBytes: 256 * 1024 * 1024 }),
    preflight: async (candidate) => {
      preflightRuns += 1;
      return { blockers: Buffer.from(candidate.applicationId).equals(manifest.applicationId)
        ? []
        : ["application_identity_mismatch"] };
    }
  });
  const trace = [];
  const yieldBoundaries = [];
  let transitionIndex = 1;
  let current = await controller.initialize("agent-interpretation-specialized", "main", { initialArgsBytes });
  while (current.frame.status === host.FrameStatus.needsEffect ||
      current.frame.status === host.FrameStatus.yieldedFuel) {
    if (current.frame.status === host.FrameStatus.yieldedFuel) {
      yieldBoundaries.push(Object.freeze({
        transitionIndex,
        state: rootMachineState(current.frame.stateBytes, manifest.applicationId)
      }));
      if (transitionIndex >= PROOF_LIMITS.maximumTransitions) {
        throw new Error("specialized_transition_limit");
      }
      current = await controller.advance("agent-interpretation-specialized", "main");
      transitionIndex += 1;
      continue;
    }
    if (trace.length === PROOF_LIMITS.maximumEffects) {
      throw new Error("specialized_effect_limit");
    }
    const pending = current.frame.pendingEffect;
    const machineState = rootMachineState(current.frame.stateBytes, manifest.applicationId);
    let inspected;
    try {
      inspected = await executeKernelCommand({
        kernel,
        bpi1,
        mv2p1,
        command: 3,
        state: machineState,
        callerFuel: manifest.limits.maximumFuelPerStep
      });
    } catch (error) {
      throw new Error(`specialized_state_rejected:${current.frame.stateBytes.length}:` +
        `${Buffer.from(current.frame.stateBytes).subarray(0, 16).toString("hex")}:${error.message}`);
    }
    if (inspected.outcome !== 3 || !Buffer.from(inspected.value).equals(Buffer.from(pending.payloadBytes))) {
      throw new Error("specialized_kernel_request_mismatch");
    }
    const identity = decodeRequestIdentity(inspected.metadata);
    const effect = effects[identity.siteOrdinal];
    if (!effect || !Buffer.from(identity.effectSiteDigest).equals(effect.ordinalEffectDigest)) {
      throw new Error("specialized_request_identity_invalid");
    }
    const decodedRequest = capabilityProtocol.decodeEffectRequest(pending.encodedBytes);
    const expectedInterfaceId = capabilityProtocol.effectInterfaceId(effect.identity);
    if (!Buffer.from(decodedRequest.interfaceId).equals(Buffer.from(expectedInterfaceId))) {
      throw new Error(`specialized_interface_identity_mismatch:${effect.identity}`);
    }
    await environment.beforeSpecializedResolve(decodedRequest);
    const resolved = await router.resolve(environment.context, pending.encodedBytes);
    if (resolved.result.status !== capabilityProtocol.EffectStatus.ok || resolved.result.resultBytes === null) {
      throw new Error("specialized_effect_not_ok");
    }
    trace.push(Object.freeze({
      boundaryIndex: trace.length,
      transitionIndex,
      frameStatus: current.frame.status,
      state: machineState,
      identity: Buffer.from(inspected.metadata),
      effectIdentity: effect.identity,
      interfaceId: Buffer.from(decodedRequest.interfaceId),
      payload: Buffer.from(pending.payloadBytes),
      response: Buffer.from(resolved.result.resultBytes)
    }));
    if (transitionIndex >= PROOF_LIMITS.maximumTransitions) {
      throw new Error("specialized_transition_limit");
    }
    current = await controller.advance("agent-interpretation-specialized", "main", {
      effectResult: resolved.result,
      effectMetadata: {
        handlerId: resolved.handlerIdentity,
        handlerConfigurationId: resolved.handlerConfigurationIdentity,
        recoveryClass: resolved.recoveryClass
      }
    });
    transitionIndex += 1;
  }
  if (current.frame.status !== host.FrameStatus.completed) {
    throw new Error(`specialized_terminal_failure:${current.frame.status}`);
  }
  const terminalResultBytes = Buffer.from(current.frame.finalResultBytes);
  const verified = await environment.verifyTerminal(terminalResultBytes);
  return Object.freeze({
    applicationId,
    applicationWasmSha256: sha256(wasmBytes),
    needsEffectFrameStatus: host.FrameStatus.needsEffect,
    trace: Object.freeze(trace),
    yieldBoundaries: Object.freeze(yieldBoundaries),
    yieldPositions: Object.freeze(yieldBoundaries.map((entry) => entry.transitionIndex)),
    terminalResultBytes,
    terminalResultSha256: sha256(terminalResultBytes),
    finalSourceBytes: Buffer.from(verified.finalSource),
    hiddenVerifierPassed: verified.hiddenVerifierPassed,
    preflightRuns,
    context: environment.context
  });
}

function sha256(bytes) { return createHash("sha256").update(bytes).digest("hex"); }

function rootMachineState(encoded, applicationId) {
  const bytes = Buffer.from(encoded);
  if (bytes.length < 60 || bytes.subarray(0, 8).toString("ascii") !== "WRLDAPP1" ||
      bytes.readUInt32LE(8) !== 1 || !bytes.subarray(12, 44).equals(Buffer.from(applicationId)) ||
      bytes.readUInt32LE(44) !== 1 || bytes.readUInt32LE(48) !== 0) {
    throw new Error("specialized_application_state_invalid");
  }
  const length = bytes.readUInt32LE(56);
  if (bytes.length !== 60 + length) throw new Error("specialized_application_state_length");
  return Buffer.from(bytes.subarray(60));
}
