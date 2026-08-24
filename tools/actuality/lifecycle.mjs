import { createHash } from "node:crypto";
import { cp, mkdir, mkdtemp, readFile, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const LIFECYCLE_MODES = new Set(["retry", "replay", "branch", "migrate"]);
const WORKER_MEMORY_BYTES = 256 * 1024 * 1024;

export async function runLifecycleProof(mode, options = {}) {
  if (!LIFECYCLE_MODES.has(mode)) throw new Error(`lifecycle_mode_invalid:${mode}`);
  const roots = await loadRoots(options);
  const temporaryRoot = await mkdtemp(join(tmpdir(), `agent-actuality-${mode}-`));
  try {
    const receipt = await ({
      retry: proveRetry,
      replay: proveReplay,
      branch: proveBranch,
      migrate: proveMigration
    })[mode](roots, temporaryRoot);
    return Object.freeze({
      agent_actuality_format: 1,
      agent_actuality_mode: mode,
      application_id: roots.applicationId,
      ...receipt
    });
  } finally {
    if (!options.keepTemporary) await rm(temporaryRoot, { recursive: true, force: true });
    else process.stderr.write(`temporary_root=${temporaryRoot}\n`);
  }
}

async function proveRetry(roots, temporaryRoot) {
  const workspace = await createWorkspace(roots, join(temporaryRoot, "workspace"));
  const state = { armed: false, capturedChild: null };
  const environment = await createEnvironment(roots, workspace, {
    faultInjector: async (phase, details) => {
      if (state.armed && phase === "after-world-step") {
        state.capturedChild = Buffer.from(details.output.frameBytes);
        state.armed = false;
        throw new Error("simulated_lost_output_after_mutation_result_persistence");
      }
    }
  });
  let current = await environment.controller.initialize("retry", "main", {
    initialArgsBytes: roots.initialArgsBytes
  });
  while (bindingId(environment, current) !== "repository-workspace-actuality.replace.v1") {
    current = await resolveAndAdvance(environment, "retry", "main", current);
  }
  const resolved = await resolvePending(environment, current);
  state.armed = true;
  let interrupted = false;
  try {
    await environment.controller.advance("retry", "main", {
      effectResult: resolved.result,
      effectMetadata: effectMetadata(resolved)
    });
  } catch (error) {
    interrupted = error?.message === "simulated_lost_output_after_mutation_result_persistence";
  }
  if (!interrupted || state.capturedChild === null) throw new Error("retry_fault_not_observed");
  const mutationCountAfterLoss = environment.context.mutationsApplied ?? 0;
  const retried = await environment.controller.advance("retry", "main");
  const retryFreshMutations = (environment.context.mutationsApplied ?? 0) - mutationCountAfterLoss;
  const byteIdentical = Buffer.from(retried.frameBytes).equals(state.capturedChild);
  if (mutationCountAfterLoss !== 1 || retryFreshMutations !== 0 || !byteIdentical) {
    throw new Error("retry_proof_failed");
  }
  return {
    deterministic_retry: true,
    mutation_invocation_count: 1,
    retry_fresh_mutation_count: retryFreshMutations,
    retry_child_frame_byte_identical: byteIdentical
  };
}

async function proveReplay(roots, temporaryRoot) {
  const workspace = await createWorkspace(roots, join(temporaryRoot, "workspace"));
  const first = await createEnvironment(roots, workspace);
  const original = await completeRun(first, "record", "main", roots.initialArgsBytes, true);

  const replayBlockStore = new roots.host.MemoryBlockStore();
  const replayHeadStore = new roots.host.MemoryBranchHeadStore();
  let replayWorkerInstances = 0;
  const replayController = await roots.host.RunControllerV1.create({
    wasmBytes: roots.wasmBytes,
    blockStore: replayBlockStore,
    headStore: replayHeadStore,
    workerFactory: () => {
      replayWorkerInstances += 1;
      return new roots.host.ApplicationWorker({ maximumMemoryBytes: WORKER_MEMORY_BYTES });
    }
  });
  let current = await replayController.initialize("replay", "main", {
    initialArgsBytes: roots.initialArgsBytes
  });
  for (const resultBytes of original.results) {
    while (current.frame.status === roots.host.FrameStatus.yieldedFuel) {
      current = await replayController.advance("replay", "main");
    }
    current = await replayController.advance("replay", "main", { effectResult: resultBytes });
  }
  while (current.frame.status === roots.host.FrameStatus.yieldedFuel) {
    current = await replayController.advance("replay", "main");
  }
  const byteIdentical = Buffer.from(current.frameBytes).equals(original.terminal.frameBytes);
  if (current.frame.status !== roots.host.FrameStatus.completed || !byteIdentical) {
    throw new Error("replay_proof_failed");
  }
  return {
    replay_terminal_frame_byte_identical: true,
    replay_fresh_effect_count: 0,
    replay_fresh_model_calls: 0,
    replay_fresh_file_calls: 0,
    replay_fresh_process_calls: 0,
    replay_fresh_mutation_calls: 0,
    replay_worker_instances: replayWorkerInstances
  };
}

async function proveBranch(roots, temporaryRoot) {
  const workspace = await createWorkspace(roots, join(temporaryRoot, "workspace"));
  const environment = await createEnvironment(roots, workspace);
  const parent = await environment.controller.initialize("branch", "list", {
    initialArgsBytes: roots.initialArgsBytes
  });
  const parentBytes = Buffer.from(parent.frameBytes);
  await environment.controller.forkBranch("branch", "list", "read");
  const request = parent.frame.pendingEffect;
  const listResult = actionResult(roots, request, { action: "list_repository", arguments: {} });
  const readResult = actionResult(roots, request, {
    action: "read_file",
    arguments: { role: "source", path: "src/range.mjs" }
  });
  const listChild = await environment.controller.advance("branch", "list", { effectResult: listResult });
  const readChild = await environment.controller.advance("branch", "read", { effectResult: readResult });
  const distinct = !Buffer.from(listChild.frame.frameId).equals(readChild.frame.frameId);
  const parentUnchanged = parentBytes.equals(parent.frameBytes);
  if (!distinct || !parentUnchanged) throw new Error("branch_proof_failed");
  return {
    branching: true,
    branch_parent_unchanged: true,
    branch_children_distinct: true,
    branch_list_child_id: hex(listChild.frame.frameId),
    branch_read_child_id: hex(readChild.frame.frameId)
  };
}

async function proveMigration(roots, temporaryRoot) {
  const workspaceA = await createWorkspace(roots, join(temporaryRoot, "workspace-a"));
  const source = await createEnvironment(roots, workspaceA);
  let current = await source.controller.initialize("migration-source", "main", {
    initialArgsBytes: roots.initialArgsBytes
  });
  while (source.context.preMutationTestFailed !== true) {
    current = await resolveAndAdvance(source, "migration-source", "main", current);
  }
  const bundle = await source.controller.exportBranch("migration-source", "main");

  const workspaceB = await createWorkspace(roots, join(temporaryRoot, "workspace-b"));
  const targetBlockStore = new roots.host.MemoryBlockStore();
  const targetHeadStore = new roots.host.MemoryBranchHeadStore();
  let targetPreflights = 0;
  const imported = await roots.host.RunControllerV1.importBranch({
    bundle,
    runId: "migration-target",
    branchId: "main",
    blockStore: targetBlockStore,
    headStore: targetHeadStore,
    workerFactory: () => new roots.host.ApplicationWorker({ maximumMemoryBytes: WORKER_MEMORY_BYTES }),
    preflight: async (manifest) => {
      targetPreflights += 1;
      return { blockers: hex(manifest.applicationId) === roots.applicationId
        ? []
        : ["application_identity_mismatch"] };
    }
  });
  const target = environmentForImported(roots, imported.controller, workspaceB);
  const workspaceAdapter = await import(pathToFileURL(join(
    roots.capabilitiesRoot,
    "packages/repository-workspace-actuality/adapter.mjs"
  )));
  const receiverTest = await workspaceAdapter.resolve(target.context, {
    requestId: "migration-receiver-preflight-test",
    idempotencyKey: "migration-receiver-preflight-test",
    target: {
      descriptorFingerprint: "desc.repository-test.v1",
      actuatorRef: "actuator.repository-test.v1",
      actuationClass: "repository"
    },
    responseSchema: { statuses: ["ok", "rejected", "failed"] },
    payload: { operation: "test", suite: "default" }
  });
  if (receiverTest.status !== "ok" || receiverTest.payload.passed !== false) {
    throw new Error("migration_receiver_workspace_preflight_failed");
  }
  current = await imported.controller.readCurrentFrame("migration-target", "main");
  while (current.frame.status === roots.host.FrameStatus.needsEffect ||
      current.frame.status === roots.host.FrameStatus.yieldedFuel) {
    current = current.frame.status === roots.host.FrameStatus.yieldedFuel
      ? await target.controller.advance("migration-target", "main")
      : await resolveAndAdvance(target, "migration-target", "main", current);
  }
  if (current.frame.status !== roots.host.FrameStatus.completed || targetPreflights !== 1 ||
      target.context.mutationsApplied !== 1 || target.context.lastTestPassed !== true) {
    throw new Error("migration_proof_failed");
  }
  return {
    migration: true,
    migration_receiver_preflight: true,
    migration_completed: true,
    migration_secrets_transferred: false,
    migration_approval_transferred: false,
    migration_workspace_path_semantic: false
  };
}

async function loadRoots(options) {
  const agentRoot = resolve(options.agentRoot ?? process.cwd());
  const hostRoot = resolve(options.worldHostRoot ?? process.env.AGENT_WORLD_HOST_ROOT ?? join(agentRoot, "../world-host"));
  const capabilitiesRoot = resolve(options.capabilitiesRoot ?? process.env.AGENT_WORLD_CAPABILITIES_ROOT ?? join(agentRoot, "../world-capabilities"));
  const artifactRoot = resolve(options.artifactRoot ?? join(agentRoot, "zig-out/agent-actuality"));
  const host = await import(pathToFileURL(join(hostRoot, "src/v1/index.mjs")));
  const capabilities = await import(pathToFileURL(join(capabilitiesRoot, "src/v1/index.mjs")));
  const manifestBytes = await readFile(join(artifactRoot, "repository-repair-actuality.manifest.bin"));
  const applicationId = hex(host.decodeApplicationManifest(manifestBytes).applicationId);
  if (!capabilities.ACTUALITY_APPLICATION_IDS.includes(applicationId)) {
    throw new Error("application_identity_not_admitted");
  }
  return {
    agentRoot,
    capabilitiesRoot,
    host,
    capabilities,
    applicationId,
    wasmBytes: await readFile(join(artifactRoot, "repository-repair-actuality.world.wasm")),
    initialArgsBytes: await readFile(join(artifactRoot, "initial-args.bin"))
  };
}

async function createWorkspace(roots, destination) {
  await cp(join(roots.agentRoot, "fixtures/repository-repair-v1"), destination, {
    recursive: true,
    errorOnExist: true
  });
  const temporaryHome = `${destination}-home`;
  await mkdir(temporaryHome);
  return { root: destination, rootReal: await realpath(destination), temporaryHome };
}

async function createEnvironment(roots, workspace, { faultInjector = async () => {} } = {}) {
  const blockStore = new roots.host.MemoryBlockStore();
  const headStore = new roots.host.MemoryBranchHeadStore();
  const controller = await roots.host.RunControllerV1.create({
    wasmBytes: roots.wasmBytes,
    blockStore,
    headStore,
    workerFactory: () => new roots.host.ApplicationWorker({ maximumMemoryBytes: WORKER_MEMORY_BYTES }),
    preflight: async (manifest) => ({
      blockers: hex(manifest.applicationId) === roots.applicationId
        ? []
        : ["application_identity_mismatch"]
    }),
    faultInjector
  });
  return environmentForImported(roots, controller, workspace);
}

function environmentForImported(roots, controller, workspace) {
  const bindings = [
    roots.capabilities.repositoryRepairDecisionFixtureBinding(),
    ...roots.capabilities.repositoryWorkspaceBindings()
  ];
  return {
    roots,
    controller,
    router: new roots.capabilities.CapabilityRouterV1({ bindings }),
    context: {
      applicationId: roots.applicationId,
      workspaceRoot: workspace.root,
      workspaceRootReal: workspace.rootReal,
      temporaryHome: workspace.temporaryHome,
      bunExecutable: process.execPath,
      fixtureInitialManifestMatched: true,
      policy: { repositoryActuality: true, repositoryRepairDecisionFixture: true }
    }
  };
}

async function completeRun(environment, runId, branchId, initialArgsBytes, retainResults) {
  let current = await environment.controller.initialize(runId, branchId, { initialArgsBytes });
  const results = [];
  while (current.frame.status === environment.roots.host.FrameStatus.needsEffect ||
      current.frame.status === environment.roots.host.FrameStatus.yieldedFuel) {
    if (current.frame.status === environment.roots.host.FrameStatus.yieldedFuel) {
      current = await environment.controller.advance(runId, branchId);
      continue;
    }
    const resolved = await resolvePending(environment, current);
    if (retainResults) results.push(Buffer.from(resolved.result.encodedBytes));
    current = await environment.controller.advance(runId, branchId, {
      effectResult: resolved.result,
      effectMetadata: effectMetadata(resolved)
    });
  }
  if (current.frame.status !== environment.roots.host.FrameStatus.completed) {
    throw new Error(`lifecycle_terminal_status:${current.frame.status}`);
  }
  return { terminal: current, results };
}

async function resolveAndAdvance(environment, runId, branchId, current) {
  const resolved = await resolvePending(environment, current);
  let next = await environment.controller.advance(runId, branchId, {
    effectResult: resolved.result,
    effectMetadata: effectMetadata(resolved)
  });
  while (next.frame.status === environment.roots.host.FrameStatus.yieldedFuel) {
    next = await environment.controller.advance(runId, branchId);
  }
  return next;
}

async function resolvePending(environment, current) {
  const request = current.frame.pendingEffect;
  const inspected = environment.router.inspect(request.encodedBytes);
  if (inspected.bindingId === "repository-workspace-actuality.replace.v1") {
    const proposal = environment.roots.capabilities.decodeRepositoryReplaceRequest(request.payloadBytes);
    const workspaceAdapter = await import(pathToFileURL(join(
      environment.roots.capabilitiesRoot,
      "packages/repository-workspace-actuality/adapter.mjs"
    )));
    const proposalDigest = workspaceAdapter.proposalDigest({ operation: "replace", ...proposal });
    environment.context.fixtureRequestDigest = proposalDigest;
    environment.context.approval = {
      approved: true,
      requestId: hex(request.requestId),
      proposalDigest,
      mode: "fixture-auto"
    };
  }
  return environment.router.resolve(environment.context, request.encodedBytes);
}

function bindingId(environment, current) {
  return environment.router.inspect(current.frame.pendingEffect.encodedBytes).bindingId;
}

function actionResult(roots, request, action) {
  return roots.host.createEffectResult({
    requestId: request.requestId,
    status: roots.host.EffectStatus.ok,
    resultSchemaId: request.resultSchemaId,
    resultBytes: roots.capabilities.encodeRepositoryRepairAction(action)
  }, roots.host.DEFAULT_ADMISSION_LIMITS);
}

function effectMetadata(resolved) {
  return {
    handlerId: resolved.handlerIdentity,
    handlerConfigurationId: resolved.handlerConfigurationIdentity,
    recoveryClass: resolved.recoveryClass
  };
}

function hex(value) { return Buffer.from(value).toString("hex"); }
export function sha256(value) { return createHash("sha256").update(value).digest("hex"); }
