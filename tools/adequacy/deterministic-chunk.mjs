#!/usr/bin/env bun
import { createHash } from "node:crypto";
import { cp, mkdir, readFile, realpath, rename, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { currentHeadStore } from "./current-head-store.mjs";

const options = parseArguments(process.argv.slice(2));
if (options.mode !== "deterministic") throw new Error("deterministic_chunk_mode_required");
if (!options.chunkRoot) throw new Error("deterministic_chunk_root_required");

const agentRoot = resolve(options.agentRoot ?? process.cwd());
const hostRoot = resolve(options.worldHostRoot ?? process.env.AGENT_WORLD_HOST_ROOT ?? join(agentRoot, "../world-host"));
const capabilitiesRoot = resolve(options.capabilitiesRoot ?? process.env.AGENT_WORLD_CAPABILITIES_ROOT ?? join(agentRoot, "../world-capabilities"));
const artifactRoot = resolve(options.artifactRoot ?? join(agentRoot, "adequacy/router-policy-v1/zig-out/router-policy-adequacy"));
const temporaryRoot = resolve(options.chunkRoot);
const chunkLimit = Number(options.chunkLimit ?? 5000);
if (!Number.isSafeInteger(chunkLimit) || chunkLimit <= 0) throw new Error("deterministic_chunk_limit_invalid");

{
  const host = await import(pathToFileURL(join(hostRoot, "src/v1/index.mjs")));
  const capabilities = await import(pathToFileURL(join(capabilitiesRoot, "src/v1/index.mjs")));
  const workspaceRoot = join(temporaryRoot, "workspace");
  const temporaryHome = join(temporaryRoot, "home");
  const pristineRoot = join(temporaryRoot, "pristine");
  const checkpointPath = join(temporaryRoot, "checkpoint.json");
  let checkpoint = await readCheckpoint(checkpointPath);
  if (checkpoint === null) {
    await cp(join(agentRoot, "fixtures/router-policy-v1"), workspaceRoot, { recursive: true, errorOnExist: true });
    await cp(join(agentRoot, "fixtures/router-policy-v1"), pristineRoot, { recursive: true, errorOnExist: true });
    await mkdir(temporaryHome);
    await initializeGit(workspaceRoot);
    checkpoint = {
      initialTree: await git(workspaceRoot, ["rev-parse", "HEAD^{tree}"]),
      initialCommit: await git(workspaceRoot, ["rev-parse", "HEAD"]),
      preflightRuns: 0,
      firstFrameBytes: null,
      firstDecisionPayloadBytes: null,
      peakFrameBytes: 0,
      peakMachineStateBytes: 0,
      peakDecisionPayloadBytes: 0,
      genesisFrameId: null,
      interfaces: [],
      requestIds: [],
      resultIds: [],
      fuelYieldCount: 0,
      stalledFuelStateSha256: null,
      stalledFuelStateRepeats: 0,
      coldStepNanoseconds: null,
      warmStepNanosecondsTotal: 0,
      warmStepCount: 0,
      context: null
    };
  }

  const wasmBytes = await readFile(join(artifactRoot, "router-policy-adequacy.world.wasm"));
  const initialArgsBytes = await readFile(join(artifactRoot, "router-policy-adequacy.initial-args.bin"));
  const blockStore = new host.DirectoryBlockStore(join(temporaryRoot, "host-store-a"));
  const headStore = currentHeadStore(host, join(temporaryRoot, "host-store-a"));
  let preflightRuns = checkpoint.preflightRuns;
  const controller = await host.RunControllerV1.create({
    wasmBytes,
    blockStore,
    headStore,
    workerFactory: () => new host.ApplicationWorker({ maximumMemoryBytes: 256 * 1024 * 1024 }),
    preflight: async (manifest) => {
      preflightRuns += 1;
      return { blockers: Buffer.from(manifest.applicationId).toString("hex") === capabilities.ADEQUACY_APPLICATION_ID
        ? []
        : ["application_identity_mismatch"] };
    }
  });
  const bindings = [
    capabilities.routerAdequacyDecisionFixtureBinding(),
    ...capabilities.repositoryWorkspaceAdequacyBindings()
  ];
  const router = new capabilities.CapabilityRouterV1({ bindings });
  const context = checkpoint.context === null ? {
    applicationId: capabilities.ADEQUACY_APPLICATION_ID,
    workspaceRoot,
    workspaceRootReal: await realpath(workspaceRoot),
    temporaryHome,
    bunExecutable: process.execPath,
    fixtureInitialManifestMatched: true,
    fixturePlan: await deterministicFixturePlan(capabilitiesRoot),
    policy: {
      repositoryAdequacy: true,
      routerAdequacyDecisionFixture: true
    }
  } : restoreContext(checkpoint.context);

  const runId = "adequacy-deterministic-v1";
  const branchId = "main";
  let current = await controller.readCurrentFrame(runId, branchId);
  if (current === null) {
    const initializeStarted = performance.now();
    current = await controller.initialize(runId, branchId, { initialArgsBytes });
    checkpoint.coldStepNanoseconds = Math.round((performance.now() - initializeStarted) * 1_000_000);
    checkpoint.firstFrameBytes = current.frameBytes.length;
    checkpoint.firstDecisionPayloadBytes = decisionPayloadBytes(current.frame, router);
    checkpoint.peakFrameBytes = current.frameBytes.length;
    checkpoint.peakMachineStateBytes = current.frame.stateBytes.length;
    checkpoint.peakDecisionPayloadBytes = checkpoint.firstDecisionPayloadBytes;
    checkpoint.genesisFrameId = Buffer.from(current.frame.frameId).toString("hex");
  }
  const interfaces = checkpoint.interfaces;
  const requestIds = checkpoint.requestIds;
  const resultIds = checkpoint.resultIds;
  let fuelYieldCount = checkpoint.fuelYieldCount;
  let chunkSteps = 0;

  while (current.frame.status === host.FrameStatus.needsEffect ||
      current.frame.status === host.FrameStatus.yieldedFuel) {
    if (current.frame.status === host.FrameStatus.yieldedFuel) {
      const stateSha256 = sha256(current.frame.stateBytes);
      if (checkpoint.stalledFuelStateSha256 === stateSha256) {
        checkpoint.stalledFuelStateRepeats = (checkpoint.stalledFuelStateRepeats ?? 0) + 1;
      } else {
        checkpoint.stalledFuelStateSha256 = stateSha256;
        checkpoint.stalledFuelStateRepeats = 1;
      }
      if (checkpoint.stalledFuelStateRepeats >= 10) {
        throw new Error(
          `adequacy_fuel_stall:${stateSha256}:state_bytes=${current.frame.stateBytes.length}:effects=${interfaces.length}`
        );
      }
      fuelYieldCount += 1;
      if (fuelYieldCount % 25 === 0) Bun.gc(true);
      if (fuelYieldCount % 1000 === 0) {
        process.stderr.write(`adequacy_progress effects=${interfaces.length} fuel_yields=${fuelYieldCount}\n`);
      }
      const advanceStarted = performance.now();
      current = await controller.advance(runId, branchId);
      recordStep(checkpoint, current, router, performance.now() - advanceStarted);
      chunkSteps += 1;
      if (chunkSteps >= chunkLimit && current.frame.status === host.FrameStatus.yieldedFuel) {
        await persistCheckpoint(checkpointPath, checkpoint, context, preflightRuns, fuelYieldCount);
        process.exit(75);
      }
      continue;
    }
    const request = current.frame.pendingEffect;
    const inspected = router.inspect(request.encodedBytes);
    interfaces.push(bindingInterfaceLabel(inspected.bindingId));
    process.stderr.write(`adequacy_progress effects=${interfaces.length}/47 interface=${interfaces.at(-1)} fuel_yields=${fuelYieldCount}\n`);
    requestIds.push(hashHex(request.requestId));
    if (inspected.bindingId === "repository-workspace-adequacy.replace.v2") {
      const proposal = capabilities.decodeRouterAdequacyReplaceRequest(request.payloadBytes);
      const proposalDigest = (await import(pathToFileURL(
        join(capabilitiesRoot, "packages/repository-workspace-adequacy/adapter.mjs")
      ))).proposalDigest({ operation: "replace", ...proposal });
      context.fixtureRequestDigest = proposalDigest;
      context.approval = {
        approved: true,
        requestId: Buffer.from(request.requestId).toString("hex"),
        proposalDigest,
        mode: "adequacy-fixture-auto"
      };
    }
    const resolved = await router.resolve(context, request.encodedBytes);
    resultIds.push(hashHex(resolved.result.resultId));
    const advanceStarted = performance.now();
    current = await controller.advance(runId, branchId, {
      effectResult: resolved.result,
      effectMetadata: {
        handlerId: resolved.handlerIdentity,
        handlerConfigurationId: resolved.handlerConfigurationIdentity,
        recoveryClass: resolved.recoveryClass
      }
    });
    recordStep(checkpoint, current, router, performance.now() - advanceStarted);
    chunkSteps += 1;
  }

  if (current.frame.status !== host.FrameStatus.completed) {
    const failureBytes = current.frame.failure ?? null;
    const failure = failureBytes === null
      ? ""
      : `:${Buffer.from(failureBytes).toString("hex")}`;
    throw new Error(`actuality_terminal_status:${current.frame.status}${failure}:interfaces=${interfaces.join(",")}`);
  }
  const finalResult = capabilities.decodeRouterAdequacyFinalResult(current.frame.finalResultBytes);
  const changedPaths = (await git(workspaceRoot, ["status", "--porcelain=v1"]))
    .split("\n")
    .filter(Boolean)
    .map((line) => line.replace(/^[ MADRCU?!]{1,2} /, ""));
  const { verify } = await import("./hidden-verifier.mjs");
  const hiddenVerifierPassed = (await verify(workspaceRoot, pristineRoot)).passed;
  const receipt = {
    agent_adequacy_format: 1,
    agent_adequacy_mode: "deterministic",
    application_id: capabilities.ADEQUACY_APPLICATION_ID,
    application_wasm_sha256: sha256(wasmBytes),
    initial_git_tree: checkpoint.initialTree,
    initial_git_commit: checkpoint.initialCommit,
    genesis_frame_id: checkpoint.genesisFrameId,
    terminal_frame_id: Buffer.from(current.frame.frameId).toString("hex"),
    ordered_interfaces: interfaces,
    model_effect_count: interfaces.filter((label) => label === "model.decide.v1").length,
    non_model_effect_count: interfaces.filter((label) => label !== "model.decide.v1").length,
    external_effect_count: interfaces.length,
    listing_count: context.listings ?? 0,
    read_count: context.fileReads ?? 0,
    search_count: context.searches ?? 0,
    test_count: context.testRuns ?? 0,
    replacement_request_count: context.mutationAttempts ?? 0,
    request_id_hashes: requestIds,
    result_id_hashes: resultIds,
    real_filesystem_reads: (context.fileReads ?? 0) > 0,
    real_repository_search: (context.searches ?? 0) > 0,
    real_test_process: (context.testRuns ?? 0) > 0,
    live_network_used: false,
    secret_required: false,
    failing_test_observed: context.preMutationTestFailed === true,
    approval_mode: "adequacy-fixture-auto",
    approval_before_mutation: context.mutationsApplied === 4,
    mutation_attempt_count: context.mutationAttempts ?? 0,
    mutation_apply_count: context.mutationsApplied ?? 0,
    changed_source_file_count: changedPaths.filter((path) => path.startsWith("src/")).length,
    changed_test_file_count: changedPaths.filter((path) => path.startsWith("test/")).length,
    changed_package_file_count: changedPaths.filter((path) => path === "package.json").length,
    changed_paths: changedPaths,
    passing_test_observed: context.lastTestPassed === true && context.lastTestMutationCount === 4,
    hidden_verifier_passed: hiddenVerifierPassed,
    typed_final_result: finalResult.tests_passed === true && finalResult.mutation_count === 4,
    disposable_worker_per_step: true,
    receiver_preflight_runs: preflightRuns,
    terminal_result_digest: sha256(current.frame.finalResultBytes),
    measurements: {
      applicationWasmBytes: wasmBytes.length,
      firstFrameBytes: checkpoint.firstFrameBytes,
      peakFrameBytes: checkpoint.peakFrameBytes,
      peakMachineStateBytes: checkpoint.peakMachineStateBytes,
      firstDecisionPayloadBytes: checkpoint.firstDecisionPayloadBytes,
      peakDecisionPayloadBytes: checkpoint.peakDecisionPayloadBytes,
      coldStepNanoseconds: checkpoint.coldStepNanoseconds,
      warmStepNanoseconds: checkpoint.warmStepCount === 0
        ? 0
        : Math.round(checkpoint.warmStepNanosecondsTotal / checkpoint.warmStepCount),
      stepCount: checkpoint.warmStepCount + 1,
      fuelYieldCount,
    }
  };
  assertReceipt(receipt);
  process.stdout.write(`${JSON.stringify(receipt, null, 2)}\n`);
}

function assertReceipt(receipt) {
  const requiredTrue = [
    "real_filesystem_reads", "real_repository_search", "real_test_process",
    "failing_test_observed", "approval_before_mutation", "passing_test_observed",
    "hidden_verifier_passed", "typed_final_result"
  ];
  for (const field of requiredTrue) if (receipt[field] !== true) throw new Error(`actuality_receipt_failed:${field}`);
  if (receipt.model_effect_count !== 24 || receipt.non_model_effect_count !== 23) throw new Error("adequacy_effect_partition");
  if (receipt.listing_count !== 1 || receipt.read_count !== 12 || receipt.search_count !== 1 || receipt.test_count !== 5) {
    throw new Error("adequacy_tool_counts");
  }
  if (receipt.ordered_interfaces.length !== 47) throw new Error("adequacy_effect_count");
  if (receipt.mutation_attempt_count !== 4 || receipt.mutation_apply_count !== 4) throw new Error("adequacy_mutation_count");
  if (receipt.changed_source_file_count !== 4 || receipt.changed_test_file_count !== 0 || receipt.changed_package_file_count !== 0) {
    throw new Error("adequacy_changed_paths");
  }
}

async function readCheckpoint(path) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

async function persistCheckpoint(path, checkpoint, context, preflightRuns, fuelYieldCount) {
  checkpoint.preflightRuns = preflightRuns;
  checkpoint.fuelYieldCount = fuelYieldCount;
  checkpoint.context = serializeContext(context);
  const temporary = `${path}.tmp`;
  await writeFile(temporary, `${JSON.stringify(checkpoint)}\n`, "utf8");
  await rename(temporary, path);
}

function serializeContext(context) {
  return {
    ...context,
    readSlots: [...(context.readSlots ?? [])],
    changedPaths: [...(context.changedPaths ?? [])]
  };
}

function restoreContext(context) {
  return {
    ...context,
    readSlots: new Set(context.readSlots ?? []),
    changedPaths: new Set(context.changedPaths ?? [])
  };
}

function recordStep(checkpoint, current, router, milliseconds) {
  checkpoint.warmStepNanosecondsTotal += Math.round(milliseconds * 1_000_000);
  checkpoint.warmStepCount += 1;
  checkpoint.peakFrameBytes = Math.max(checkpoint.peakFrameBytes, current.frameBytes.length);
  checkpoint.peakMachineStateBytes = Math.max(checkpoint.peakMachineStateBytes, current.frame.stateBytes.length);
  checkpoint.peakDecisionPayloadBytes = Math.max(
    checkpoint.peakDecisionPayloadBytes,
    decisionPayloadBytes(current.frame, router)
  );
}

function decisionPayloadBytes(frame, router) {
  if (frame.pendingEffect === null) return 0;
  const pending = router.inspect(frame.pendingEffect.encodedBytes);
  return pending.bindingId === "router-adequacy-decision-fixture.v1"
    ? frame.pendingEffect.payloadBytes.length
    : 0;
}

async function initializeGit(workspaceRoot) {
  await git(workspaceRoot, ["init", "--quiet"]);
  await git(workspaceRoot, ["config", "user.name", "Agent Adequacy Fixture"]);
  await git(workspaceRoot, ["config", "user.email", "adequacy@example.invalid"]);
  await git(workspaceRoot, ["add", "--all"]);
  await git(workspaceRoot, ["commit", "--quiet", "-m", "fixture baseline"]);
}

async function git(cwd, argv) {
  const child = Bun.spawn(["git", ...argv], { cwd, stdout: "pipe", stderr: "pipe", env: { PATH: process.env.PATH } });
  const [stdout, stderr, exitCode] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
  if (exitCode !== 0) throw new Error(`git_failed:${argv[0]}:${stderr.trim()}`);
  return stdout.trim();
}

function bindingInterfaceLabel(bindingId) {
  if (bindingId === "router-adequacy-decision-fixture.v1") return "model.decide.v1";
  const operation = bindingId.split(".")[1];
  if (operation === "list") return "repo.list.v2";
  if (operation === "read") return "repo.read.v2";
  if (operation === "search") return "repo.search.v2";
  if (operation === "test") return "repo.test.v2";
  if (operation === "replace") return "repo.replace.approved.v2";
  throw new Error(`unknown_binding:${bindingId}`);
}

async function deterministicFixturePlan(capabilitiesRoot) {
  const solutionRoot = join(capabilitiesRoot, "packages/router-adequacy-decision-fixture/solution");
  return [
    ["methods_source", "src/methods.mjs", "methods.txt"],
    ["errors_source", "src/errors.mjs", "errors.txt"],
    ["router_source", "src/router.mjs", "router.txt"],
    ["index_source", "src/index.mjs", "index.txt"]
  ].map(async ([slot, path, file]) => ({
    slot,
    path,
    replacementDigest: sha256(await readFile(join(solutionRoot, file)))
  })).reduce(async (result, entry) => [...await result, await entry], Promise.resolve([]));
}

function hashHex(value) { return sha256(Buffer.from(value)); }
function sha256(value) { return createHash("sha256").update(value).digest("hex"); }

function parseArguments(argv) {
  const result = { mode: "deterministic", keepTemporary: false };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--keep-temporary") result.keepTemporary = true;
    else if (argument.startsWith("--") && index + 1 < argv.length) {
      const name = argument.slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
      result[name] = argv[index += 1];
    } else throw new Error(`unknown_argument:${argument}`);
  }
  return result;
}
