import { createHash } from "node:crypto";
import { cp, mkdir, mkdtemp, readFile, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const LIFECYCLE_MODES = new Set(["retry", "replay", "branch", "migrate"]);
const WORKER_MEMORY_BYTES = 256 * 1024 * 1024;
const SLOT_NAMES = [
  "readme", "package", "methods_source", "pattern_source", "errors_source",
  "router_source", "index_source", "methods_test", "router_test",
];

export async function runLifecycleProof(mode, options = {}) {
  if (!LIFECYCLE_MODES.has(mode)) throw new Error(`lifecycle_mode_invalid:${mode}`);
  const roots = await loadRoots(options);
  const temporaryRoot = await mkdtemp(join(tmpdir(), `agent-adequacy-${mode}-`));
  try {
    const receipt = await ({
      retry: proveRetry,
      replay: proveReplay,
      branch: proveBranch,
      migrate: proveMigration,
    })[mode](roots, temporaryRoot);
    return Object.freeze({
      agent_adequacy_format: 1,
      agent_adequacy_mode: mode,
      application_id: roots.capabilities.ADEQUACY_APPLICATION_ID,
      ...receipt,
    });
  } finally {
    if (!options.keepTemporary) await rm(temporaryRoot, { recursive: true, force: true });
    else process.stderr.write(`temporary_root=${temporaryRoot}\n`);
  }
}

async function proveRetry(roots, temporaryRoot) {
  const workspace = await createWorkspace(roots, join(temporaryRoot, "workspace"));
  const fault = { armed: false, child: null };
  const environment = await createEnvironment(roots, workspace, {
    faultInjector: async (phase, details) => {
      if (fault.armed && phase === "after-world-step") {
        fault.child = Buffer.from(details.output.frameBytes);
        fault.armed = false;
        throw new Error("simulated_lost_output_after_replacement_result_persistence");
      }
    },
  });
  let current = await environment.controller.initialize("retry", "main", {
    initialArgsBytes: roots.initialArgsBytes,
  });
  while (!isReplacement(environment, current) || (environment.context.mutationsApplied ?? 0) !== 2) {
    current = await advanceOne(environment, "retry", "main", current);
  }

  const parentBytes = Buffer.from(current.frameBytes);
  const attemptsBefore = environment.context.mutationAttempts ?? 0;
  const writesBefore = environment.context.mutationsApplied ?? 0;
  const resolved = await resolvePending(environment, current);
  fault.armed = true;
  let interrupted = false;
  try {
    await environment.controller.advance("retry", "main", {
      effectResult: resolved.result,
      effectMetadata: effectMetadata(resolved),
    });
  } catch (error) {
    interrupted = error?.message === "simulated_lost_output_after_replacement_result_persistence";
  }
  if (!interrupted || fault.child === null) throw new Error("retry_fault_not_observed");
  const retained = await environment.controller.advance("retry", "main");
  const byteIdentical = Buffer.from(retained.frameBytes).equals(fault.child);
  const headParentUnchanged = parentBytes.equals(current.frameBytes);
  const attemptDelta = (environment.context.mutationAttempts ?? 0) - attemptsBefore;
  const writeDelta = (environment.context.mutationsApplied ?? 0) - writesBefore;
  if (!byteIdentical || !headParentUnchanged || attemptDelta !== 1 || writeDelta !== 1) {
    throw new Error("retry_proof_failed");
  }
  return {
    deterministic_retry: true,
    retry_capability_invocations: attemptDelta,
    retry_content_writes: writeDelta,
    retry_child_frame_byte_identical: true,
    retry_parent_frame_unchanged: true,
  };
}

async function proveReplay(roots, temporaryRoot) {
  const workspace = await createWorkspace(roots, join(temporaryRoot, "workspace"));
  const recorded = await createEnvironment(roots, workspace);
  const original = await completeRun(recorded, "record", "main", roots.initialArgsBytes, true);

  let workerInstances = 0;
  const controller = await roots.host.RunControllerV1.create({
    wasmBytes: roots.wasmBytes,
    blockStore: new roots.host.MemoryBlockStore(),
    headStore: new roots.host.MemoryBranchHeadStore(),
    workerFactory: () => {
      workerInstances += 1;
      return new roots.host.ApplicationWorker({ maximumMemoryBytes: WORKER_MEMORY_BYTES });
    },
    preflight: applicationPreflight(roots),
  });
  let current = await controller.initialize("replay", "main", { initialArgsBytes: roots.initialArgsBytes });
  for (const retained of original.results) {
    current = await advanceFuel(controller, roots.host, "replay", "main", current);
    current = await controller.advance("replay", "main", {
      effectResult: retained.bytes,
      effectMetadata: retained.metadata,
    });
  }
  current = await advanceFuel(controller, roots.host, "replay", "main", current);
  const byteIdentical = Buffer.from(current.frameBytes).equals(original.terminal.frameBytes);
  if (current.frame.status !== roots.host.FrameStatus.completed || !byteIdentical) {
    throw new Error("replay_proof_failed");
  }
  return {
    replay_fresh_effect_count: 0,
    replay_fresh_model_effect_count: 0,
    replay_fresh_file_effect_count: 0,
    replay_fresh_search_effect_count: 0,
    replay_fresh_test_process_count: 0,
    replay_fresh_approval_count: 0,
    replay_fresh_mutation_count: 0,
    replay_terminal_result_equal: true,
    replay_terminal_frame_byte_identical: true,
    replay_worker_instances: workerInstances,
  };
}

async function proveBranch(roots, temporaryRoot) {
  const workspace = await createWorkspace(roots, join(temporaryRoot, "workspace"));
  const environment = await createEnvironment(roots, workspace);
  let parent = await environment.controller.initialize("branch", "methods", {
    initialArgsBytes: roots.initialArgsBytes,
  });
  parent = await advanceOne(environment, "branch", "methods", parent);
  parent = await advanceOne(environment, "branch", "methods", parent);
  parent = await advanceFuel(environment.controller, roots.host, "branch", "methods", parent);
  if (bindingId(environment, parent) !== "router-adequacy-decision-fixture.v1") {
    throw new Error("branch_parent_not_post_listing_decision");
  }

  const parentBytes = Buffer.from(parent.frameBytes);
  await environment.controller.forkBranch("branch", "methods", "router-test");
  const parentRequest = parent.frame.pendingEffect;
  const methodsAction = actionResult(roots, parentRequest, {
    action: "read_file",
    arguments: { slot: "methods_source", path: "src/methods.mjs" },
  });
  const routerAction = actionResult(roots, parentRequest, {
    action: "read_file",
    arguments: { slot: "router_test", path: "test/router.test.mjs" },
  });
  let methods = await environment.controller.advance("branch", "methods", { effectResult: methodsAction });
  let routerTest = await environment.controller.advance("branch", "router-test", { effectResult: routerAction });
  methods = await advanceFuel(environment.controller, roots.host, "branch", "methods", methods);
  routerTest = await advanceFuel(environment.controller, roots.host, "branch", "router-test", routerTest);
  if (bindingId(environment, methods) !== "repository-workspace-adequacy.read.v2" ||
      bindingId(environment, routerTest) !== "repository-workspace-adequacy.read.v2") {
    throw new Error("branch_read_requests_missing");
  }

  const methodsContext = cloneContext(environment.context);
  const routerContext = cloneContext(environment.context);
  const methodsRead = await resolvePending(environment, methods, methodsContext);
  const routerHeadBeforeCross = Buffer.from(routerTest.frameBytes);
  let crossingRejected = false;
  try {
    await environment.controller.advance("branch", "router-test", { effectResult: methodsRead.result });
  } catch {
    crossingRejected = true;
  }
  const routerHeadAfterCross = await environment.controller.readCurrentFrame("branch", "router-test");
  if (!crossingRejected || !routerHeadBeforeCross.equals(routerHeadAfterCross.frameBytes)) {
    throw new Error("branch_result_crossing_not_rejected");
  }

  const routerRead = await resolvePending(environment, routerTest, routerContext);
  methods = await environment.controller.advance("branch", "methods", {
    effectResult: methodsRead.result,
    effectMetadata: effectMetadata(methodsRead),
  });
  routerTest = await environment.controller.advance("branch", "router-test", {
    effectResult: routerRead.result,
    effectMetadata: effectMetadata(routerRead),
  });
  methods = await advanceFuel(environment.controller, roots.host, "branch", "methods", methods);
  routerTest = await advanceFuel(environment.controller, roots.host, "branch", "router-test", routerTest);
  const methodsTurn = decisionTurn(roots, methods);
  const routerTurn = decisionTurn(roots, routerTest);
  const methodsSlots = methodsTurn.context.documents.map((document) => document.slot);
  const routerSlots = routerTurn.context.documents.map((document) => document.slot);
  const distinct = !Buffer.from(methods.frameBytes).equals(routerTest.frameBytes);
  const parentUnchanged = parentBytes.equals(parent.frameBytes);
  if (!distinct || !parentUnchanged || !methodsSlots.includes("methods_source") ||
      methodsSlots.includes("router_test") || !routerSlots.includes("router_test") ||
      routerSlots.includes("methods_source")) {
    throw new Error("branch_proof_failed");
  }
  return {
    branching: true,
    branch_parent_unchanged: true,
    branch_children_distinct: true,
    branch_memories_distinct: true,
    branch_result_crossing_rejected: true,
    branch_independent_continuation: true,
  };
}

async function proveMigration(roots, temporaryRoot) {
  const workspaceA = await createWorkspace(roots, join(temporaryRoot, "workspace-a"));
  const source = await createEnvironment(roots, workspaceA);
  let current = await source.controller.initialize("migration-source", "main", {
    initialArgsBytes: roots.initialArgsBytes,
  });
  while (!(source.context.preMutationTestFailed === true &&
      (source.context.searches ?? 0) === 1 &&
      (source.context.mutationsApplied ?? 0) === 0 &&
      bindingId(source, current) === "router-adequacy-decision-fixture.v1")) {
    current = await advanceOne(source, "migration-source", "main", current);
  }
  const bundle = await source.controller.exportBranch("migration-source", "main");

  const workspaceB = await createWorkspace(roots, join(temporaryRoot, "workspace-b"));
  let receiverPreflights = 0;
  const imported = await roots.host.RunControllerV1.importBranch({
    bundle,
    runId: "migration-target",
    branchId: "main",
    blockStore: new roots.host.MemoryBlockStore(),
    headStore: new roots.host.MemoryBranchHeadStore(),
    workerFactory: () => new roots.host.ApplicationWorker({ maximumMemoryBytes: WORKER_MEMORY_BYTES }),
    preflight: async (manifest) => {
      receiverPreflights += 1;
      return applicationPreflight(roots)(manifest);
    },
  });
  const context = await receiverContext(roots, workspaceB);
  context.readSlots = new Set(SLOT_NAMES);
  context.listings = 1;
  context.fileReads = 9;
  context.searches = 1;
  const workspaceAdapter = await import(pathToFileURL(join(
    roots.capabilitiesRoot,
    "packages/repository-workspace-adequacy/adapter.mjs",
  )));
  const receiverTest = await workspaceAdapter.resolve(context, {
    requestId: "migration-receiver-test",
    idempotencyKey: "migration-receiver-test",
    target: {
      descriptorFingerprint: "desc.repository-test.v2",
      actuatorRef: "actuator.repository-test.v2",
      actuationClass: "repository",
    },
    responseSchema: { statuses: ["ok", "rejected", "failed"] },
    payload: { operation: "test", suite: "default" },
  });
  if (receiverTest.status !== "ok" || receiverTest.payload.passed !== false) {
    throw new Error("migration_receiver_workspace_preflight_failed");
  }
  const target = environmentForImported(roots, imported.controller, context);
  current = await imported.controller.readCurrentFrame("migration-target", "main");
  const completed = await completeFromCurrent(target, "migration-target", "main", current, false);
  if (completed.terminal.frame.status !== roots.host.FrameStatus.completed || receiverPreflights !== 1 ||
      context.mutationsApplied !== 4 || context.lastTestPassed !== true ||
      context.lastTestMutationCount !== 4) {
    throw new Error("migration_proof_failed");
  }
  return {
    migration: true,
    migration_receiver_preflight: true,
    migration_terminal_result_valid: true,
    migration_secrets_transferred: false,
    migration_approval_transferred: false,
    migration_workspace_path_transferred_as_state: false,
  };
}

async function loadRoots(options) {
  const agentRoot = resolve(options.agentRoot ?? process.cwd());
  const hostRoot = resolve(options.worldHostRoot ?? process.env.AGENT_WORLD_HOST_ROOT ?? join(agentRoot, "../world-host"));
  const capabilitiesRoot = resolve(options.capabilitiesRoot ?? process.env.AGENT_WORLD_CAPABILITIES_ROOT ?? join(agentRoot, "../world-capabilities"));
  const artifactRoot = resolve(options.artifactRoot ?? join(agentRoot, "adequacy/router-policy-v1/zig-out/router-policy-adequacy"));
  const host = await import(pathToFileURL(join(hostRoot, "src/v1/index.mjs")));
  const capabilities = await import(pathToFileURL(join(capabilitiesRoot, "src/v1/index.mjs")));
  return {
    agentRoot,
    capabilitiesRoot,
    host,
    capabilities,
    wasmBytes: await readFile(join(artifactRoot, "router-policy-adequacy.world.wasm")),
    initialArgsBytes: await readFile(join(artifactRoot, "router-policy-adequacy.initial-args.bin")),
  };
}

async function createWorkspace(roots, destination) {
  await cp(join(roots.agentRoot, "fixtures/router-policy-v1"), destination, {
    recursive: true,
    errorOnExist: true,
  });
  const temporaryHome = `${destination}-home`;
  await mkdir(temporaryHome);
  return { root: destination, rootReal: await realpath(destination), temporaryHome };
}

async function createEnvironment(roots, workspace, { faultInjector = async () => {} } = {}) {
  const controller = await roots.host.RunControllerV1.create({
    wasmBytes: roots.wasmBytes,
    blockStore: new roots.host.MemoryBlockStore(),
    headStore: new roots.host.MemoryBranchHeadStore(),
    workerFactory: () => new roots.host.ApplicationWorker({ maximumMemoryBytes: WORKER_MEMORY_BYTES }),
    preflight: applicationPreflight(roots),
    faultInjector,
  });
  return environmentForImported(roots, controller, await receiverContext(roots, workspace));
}

function environmentForImported(roots, controller, context) {
  const bindings = [
    roots.capabilities.routerAdequacyDecisionFixtureBinding(),
    ...roots.capabilities.repositoryWorkspaceAdequacyBindings(),
  ];
  return {
    roots,
    controller,
    router: new roots.capabilities.CapabilityRouterV1({ bindings }),
    context,
  };
}

async function receiverContext(roots, workspace) {
  return {
    applicationId: roots.capabilities.ADEQUACY_APPLICATION_ID,
    workspaceRoot: workspace.root,
    workspaceRootReal: workspace.rootReal,
    temporaryHome: workspace.temporaryHome,
    bunExecutable: process.execPath,
    fixtureInitialManifestMatched: true,
    fixturePlan: await deterministicFixturePlan(roots.capabilitiesRoot),
    policy: { repositoryAdequacy: true, routerAdequacyDecisionFixture: true },
  };
}

function applicationPreflight(roots) {
  return async (manifest) => ({
    blockers: hex(manifest.applicationId) === roots.capabilities.ADEQUACY_APPLICATION_ID
      ? []
      : ["application_identity_mismatch"],
  });
}

async function completeRun(environment, runId, branchId, initialArgsBytes, retainResults) {
  const current = await environment.controller.initialize(runId, branchId, { initialArgsBytes });
  return completeFromCurrent(environment, runId, branchId, current, retainResults);
}

async function completeFromCurrent(environment, runId, branchId, initial, retainResults) {
  let current = initial;
  const results = [];
  while (current.frame.status === environment.roots.host.FrameStatus.needsEffect ||
      current.frame.status === environment.roots.host.FrameStatus.yieldedFuel) {
    if (current.frame.status === environment.roots.host.FrameStatus.yieldedFuel) {
      current = await advanceFuel(environment.controller, environment.roots.host, runId, branchId, current);
      continue;
    }
    const resolved = await resolvePending(environment, current);
    const metadata = effectMetadata(resolved);
    if (retainResults) results.push({ bytes: Buffer.from(resolved.result.encodedBytes), metadata });
    current = await environment.controller.advance(runId, branchId, {
      effectResult: resolved.result,
      effectMetadata: metadata,
    });
  }
  if (current.frame.status !== environment.roots.host.FrameStatus.completed) {
    throw new Error(`lifecycle_terminal_status:${current.frame.status}`);
  }
  return { terminal: current, results };
}

async function advanceOne(environment, runId, branchId, current) {
  current = await advanceFuel(environment.controller, environment.roots.host, runId, branchId, current);
  if (current.frame.status !== environment.roots.host.FrameStatus.needsEffect) return current;
  const resolved = await resolvePending(environment, current);
  current = await environment.controller.advance(runId, branchId, {
    effectResult: resolved.result,
    effectMetadata: effectMetadata(resolved),
  });
  return advanceFuel(environment.controller, environment.roots.host, runId, branchId, current);
}

async function advanceFuel(controller, host, runId, branchId, initial) {
  let current = initial;
  let prior = null;
  let repeats = 0;
  while (current.frame.status === host.FrameStatus.yieldedFuel) {
    const state = sha256(current.frame.stateBytes);
    repeats = state === prior ? repeats + 1 : 1;
    prior = state;
    if (repeats >= 10) throw new Error(`lifecycle_fuel_stall:${state}`);
    current = await controller.advance(runId, branchId);
  }
  return current;
}

async function resolvePending(environment, current, context = environment.context) {
  const request = current.frame.pendingEffect;
  const inspected = environment.router.inspect(request.encodedBytes);
  if (inspected.bindingId === "repository-workspace-adequacy.replace.v2") {
    const proposal = environment.roots.capabilities.decodeRouterAdequacyReplaceRequest(request.payloadBytes);
    const adapter = await import(pathToFileURL(join(
      environment.roots.capabilitiesRoot,
      "packages/repository-workspace-adequacy/adapter.mjs",
    )));
    const proposalDigest = adapter.proposalDigest({ operation: "replace", ...proposal });
    context.fixtureRequestDigest = proposalDigest;
    context.approval = {
      approved: true,
      requestId: hex(request.requestId),
      proposalDigest,
      mode: "adequacy-fixture-auto",
    };
  }
  return environment.router.resolve(context, request.encodedBytes);
}

function bindingId(environment, current) {
  if (current.frame.pendingEffect === null) return null;
  return environment.router.inspect(current.frame.pendingEffect.encodedBytes).bindingId;
}

function isReplacement(environment, current) {
  return bindingId(environment, current) === "repository-workspace-adequacy.replace.v2";
}

function actionResult(roots, request, action) {
  return roots.host.createEffectResult({
    requestId: request.requestId,
    status: roots.host.EffectStatus.ok,
    resultSchemaId: request.resultSchemaId,
    resultBytes: roots.capabilities.encodeRouterAdequacyAction(action),
  }, roots.host.DEFAULT_ADMISSION_LIMITS);
}

function decisionTurn(roots, current) {
  if (current.frame.status !== roots.host.FrameStatus.needsEffect) throw new Error("decision_turn_frame_required");
  return roots.capabilities.decodeRouterAdequacyDecisionTurn(current.frame.pendingEffect.payloadBytes);
}

function effectMetadata(resolved) {
  return {
    handlerId: resolved.handlerIdentity,
    handlerConfigurationId: resolved.handlerConfigurationIdentity,
    recoveryClass: resolved.recoveryClass,
  };
}

function cloneContext(context) {
  return {
    ...context,
    policy: { ...context.policy },
    readSlots: new Set(context.readSlots ?? []),
    changedPaths: new Set(context.changedPaths ?? []),
    approval: undefined,
  };
}

async function deterministicFixturePlan(capabilitiesRoot) {
  const solutionRoot = join(capabilitiesRoot, "packages/router-adequacy-decision-fixture/solution");
  const entries = [
    ["methods_source", "src/methods.mjs", "methods.txt"],
    ["errors_source", "src/errors.mjs", "errors.txt"],
    ["router_source", "src/router.mjs", "router.txt"],
    ["index_source", "src/index.mjs", "index.txt"],
  ];
  return Promise.all(entries.map(async ([slot, path, file]) => ({
    slot,
    path,
    replacementDigest: sha256(await readFile(join(solutionRoot, file))),
  })));
}

function hex(value) { return Buffer.from(value).toString("hex"); }
function sha256(value) { return createHash("sha256").update(value).digest("hex"); }
