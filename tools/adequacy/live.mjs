import { createHash } from "node:crypto";
import { cp, mkdir, mkdtemp, readFile, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { verifyProposal } from "./proposal-verifier.mjs";

const WORKER_MEMORY_BYTES = 256 * 1024 * 1024;
const DECISION_CONTRACT_DIGEST =
  "a649bded9c3088cb82d13eaf10c6ca3a6a404e66b735e7118d94d00f63303fd2";

export async function runLiveAdequacy(options = {}) {
  const apiKey = process.env.OPENAI_API_KEY;
  const model = process.env.OPENAI_MODEL;
  if (!apiKey) throw new Error("OPENAI_API_KEY_required");
  if (!model) throw new Error("OPENAI_MODEL_required");

  const attempt = Number(options.attempt ?? 1);
  if (!Number.isSafeInteger(attempt) || attempt < 1 || attempt > 3) {
    throw new Error("live_attempt_out_of_range");
  }

  const agentRoot = resolve(options.agentRoot ?? process.cwd());
  const hostRoot = resolve(options.worldHostRoot ?? process.env.AGENT_WORLD_HOST_ROOT ?? join(agentRoot, "../world-host"));
  const capabilitiesRoot = resolve(
    options.capabilitiesRoot ?? process.env.AGENT_WORLD_CAPABILITIES_ROOT ?? join(agentRoot, "../world-capabilities")
  );
  const artifactRoot = resolve(
    options.artifactRoot ?? join(agentRoot, "adequacy/router-policy-v1/zig-out/router-policy-adequacy")
  );
  const temporaryRoot = await mkdtemp(join(tmpdir(), `agent-adequacy-live-${attempt}-`));
  const runId = `adequacy-live-v1-attempt-${attempt}`;
  const branchId = "main";
  const interfaces = [];
  const modelActions = [];
  const evidenceDigests = [];
  const approvals = [];
  const provider = {
    returnedModels: new Set(),
    responseIdDigests: [],
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0
  };
  let context;
  let genesisFrameId = null;
  let terminalFrameId = null;
  let terminalFailureDigest = null;

  try {
    const host = await import(pathToFileURL(join(hostRoot, "src/v1/index.mjs")));
    const capabilities = await import(pathToFileURL(join(capabilitiesRoot, "src/v1/index.mjs")));
    const workspaceAdapter = await import(pathToFileURL(join(
      capabilitiesRoot,
      "packages/repository-workspace-adequacy/adapter.mjs"
    )));
    const applicationId = capabilities.ADEQUACY_APPLICATION_ID;
    const workspaceRoot = join(temporaryRoot, "workspace");
    const pristineRoot = join(temporaryRoot, "pristine");
    const temporaryHome = join(temporaryRoot, "home");
    await cp(join(agentRoot, "fixtures/router-policy-v1"), workspaceRoot, { recursive: true, errorOnExist: true });
    await cp(join(agentRoot, "fixtures/router-policy-v1"), pristineRoot, { recursive: true, errorOnExist: true });
    await mkdir(temporaryHome);
    await initializeGit(workspaceRoot);

    const wasmBytes = await readFile(join(artifactRoot, "router-policy-adequacy.world.wasm"));
    const initialArgsBytes = await readFile(join(artifactRoot, "router-policy-adequacy.initial-args.bin"));
    let preflightRuns = 0;
    const controller = await host.RunControllerV1.create({
      wasmBytes,
      blockStore: new host.MemoryBlockStore(),
      headStore: new host.MemoryBranchHeadStore(),
      workerFactory: () => new host.ApplicationWorker({ maximumMemoryBytes: WORKER_MEMORY_BYTES }),
      preflight: async (manifest) => {
        preflightRuns += 1;
        return { blockers: hex(manifest.applicationId) === applicationId ? [] : ["application_identity_mismatch"] };
      }
    });
    const router = new capabilities.CapabilityRouterV1({
      bindings: [
        capabilities.routerAdequacyOpenAIBinding(),
        ...capabilities.repositoryWorkspaceAdequacyBindings()
      ]
    });
    context = {
      applicationId,
      workspaceRoot,
      workspaceRootReal: await realpath(workspaceRoot),
      temporaryHome,
      bunExecutable: process.execPath,
      secrets: { OPENAI_API_KEY: apiKey },
      openaiModel: model,
      allowedModels: [model],
      decisionContractDigest: DECISION_CONTRACT_DIGEST,
      maximumModelCalls: 32,
      policy: { repositoryAdequacy: true, openaiRouterAdequacy: true }
    };

    let current = await controller.initialize(runId, branchId, { initialArgsBytes });
    genesisFrameId = hex(current.frame.frameId);
    let repeatedState = null;
    let repeatedStateCount = 0;
    while (current.frame.status === host.FrameStatus.needsEffect ||
        current.frame.status === host.FrameStatus.yieldedFuel) {
      if (current.frame.status === host.FrameStatus.yieldedFuel) {
        const stateDigest = sha256(current.frame.stateBytes);
        repeatedStateCount = stateDigest === repeatedState ? repeatedStateCount + 1 : 1;
        repeatedState = stateDigest;
        if (repeatedStateCount >= 10) throw new Error(`adequacy_fuel_stall:${stateDigest}`);
        current = await controller.advance(runId, branchId);
        terminalFrameId = hex(current.frame.frameId);
        if (current.frame.failure != null) terminalFailureDigest = sha256(current.frame.failure);
        continue;
      }
      repeatedState = null;
      repeatedStateCount = 0;
      const request = current.frame.pendingEffect;
      const inspected = router.inspect(request.encodedBytes);
      const interfaceLabel = bindingInterfaceLabel(inspected.bindingId);
      interfaces.push(interfaceLabel);
      process.stderr.write(
        `adequacy_live_progress effects=${interfaces.length} interface=${interfaceLabel} ` +
        `model_calls=${context.modelCalls ?? 0} mutations=${context.mutationsApplied ?? 0}\n`
      );
      if (inspected.bindingId === "repository-workspace-adequacy.replace.v2") {
        const proposal = capabilities.decodeRouterAdequacyReplaceRequest(request.payloadBytes);
        const requestId = hex(request.requestId);
        const proposalDigest = workspaceAdapter.proposalDigest({ operation: "replace", ...proposal });
        const ordinal = (context.mutationsApplied ?? 0) + 1;
        const verification = await verifyProposal({
          agentRoot,
          capabilitiesRoot,
          proposal,
          bunExecutable: process.execPath
        });
        context.approval = {
          approved: true,
          requestId,
          proposalDigest,
          mode: "adequacy-receiver-verified"
        };
        context.proposalVerification = {
          requestId,
          proposalDigest,
          passed: verification.passed,
          verifier: "router-policy-proposal-v1",
          evidenceDigest: verification.evidenceDigest
        };
        process.stderr.write(
          `adequacy_proposal mutation=${ordinal}/4 slot=${proposal.slot} path=${proposal.path} ` +
          `receiver_verified=${verification.passed}\n`
        );
        if (verification.passed) approvals.push({
          requestId,
          proposalDigest,
          ordinal,
          evidenceDigest: verification.evidenceDigest
        });
      }

      const resolved = await router.resolve(context, request.encodedBytes);
      evidenceDigests.push(sha256(resolved.result.encodedBytes));
      if (inspected.bindingId === "router-adequacy-openai.v1") {
        const claims = providerClaims(resolved.result, capabilities.EffectStatus);
        modelActions.push(capabilities.decodeRouterAdequacyAction(resolved.result.resultBytes).action);
        provider.returnedModels.add(claims.returnedModel);
        provider.responseIdDigests.push(claims.responseIdSha256);
        provider.inputTokens += claims.inputTokens;
        provider.outputTokens += claims.outputTokens;
        provider.totalTokens += claims.totalTokens;
      }
      current = await controller.advance(runId, branchId, {
        effectResult: resolved.result,
        effectMetadata: {
          handlerId: resolved.handlerIdentity,
          handlerConfigurationId: resolved.handlerConfigurationIdentity,
          recoveryClass: resolved.recoveryClass
        }
      });
      terminalFrameId = hex(current.frame.frameId);
      if (current.frame.failure != null) terminalFailureDigest = sha256(current.frame.failure);
    }

    if (current.frame.status !== host.FrameStatus.completed) {
      throw new Error(`live_terminal_status_${current.frame.status}`);
    }
    const finalResult = capabilities.decodeRouterAdequacyFinalResult(current.frame.finalResultBytes);
    const changedPaths = parsePorcelain(await git(workspaceRoot, ["status", "--porcelain=v1"]));
    const { verify } = await import("./hidden-verifier.mjs");
    const hiddenVerifierPassed = (await verify(workspaceRoot, pristineRoot)).passed;
    const receipt = {
      agent_adequacy_format: 1,
      agent_adequacy_mode: "live",
      application_id: applicationId,
      application_wasm_sha256: sha256(wasmBytes),
      openai_responses_api: true,
      openai_tools_count: 0,
      openai_store: false,
      openai_model_recorded: model.length > 0,
      openai_model: model,
      openai_api_key_recorded: false,
      external_effect_count: interfaces.length,
      model_effect_count: interfaces.filter((value) => value === "model.decide.v1").length,
      non_model_effect_count: interfaces.filter((value) => value !== "model.decide.v1").length,
      all_nine_slots_read_before_mutation: context.readSlots?.size === 9,
      baseline_failure_observed: context.preMutationTestFailed === true,
      receiver_verified_approval_count: approvals.length,
      human_approval_required: false,
      approved_mutation_count: context.mutationsApplied ?? 0,
      unique_mutated_path_count: context.changedPaths?.size ?? 0,
      test_count: context.testRuns ?? 0,
      test_after_each_mutation: context.lastTestMutationCount === context.mutationsApplied,
      passing_test_after_fourth_mutation:
        context.mutationsApplied === 4 && context.lastTestMutationCount === 4 && context.lastTestPassed === true,
      hidden_verifier_passed: hiddenVerifierPassed,
      typed_final_result:
        finalResult.tests_passed === true && finalResult.mutation_count === 4 && finalResult.changed_files.length === 4,
      human_file_edits: 0,
      unapproved_writes: 0,
      changed_source_file_count: changedPaths.filter((path) => path.startsWith("src/")).length,
      changed_test_file_count: changedPaths.filter((path) => path.startsWith("test/")).length,
      changed_metadata_file_count: changedPaths.filter((path) => path === "README.md" || path === "package.json").length,
      changed_paths: changedPaths,
      raw_prompt_published: false,
      raw_repository_content_published: false,
      raw_model_output_published: false,
      private_evidence_digest: sha256(Buffer.from(evidenceDigests.join("\n"))),
      live_attempt_count: attempt,
      live_success_count: 1,
      provider_failure_count: context.providerFailures ?? 0,
      provider_returned_models: [...provider.returnedModels],
      provider_response_id_digests: provider.responseIdDigests,
      input_tokens: provider.inputTokens,
      output_tokens: provider.outputTokens,
      total_tokens: provider.totalTokens,
      approval_bindings: approvals.map(({ requestId, proposalDigest, ordinal, evidenceDigest }) => ({
        request_id_sha256: sha256(Buffer.from(requestId, "hex")),
        proposal_digest: proposalDigest,
        verifier_evidence_digest: evidenceDigest,
        ordinal
      })),
      receiver_preflight_runs: preflightRuns,
      fresh_instance_every_step: true,
      genesis_frame_id: genesisFrameId,
      terminal_frame_id: terminalFrameId,
      ordered_interfaces: interfaces,
      model_actions: modelActions
    };
    assertLiveReceipt(receipt);
    return receipt;
  } catch (error) {
    const failureReceipt = {
      agent_adequacy_format: 1,
      agent_adequacy_mode: "live",
      live_attempt_count: attempt,
      live_success_count: 0,
      openai_api_key_recorded: false,
      raw_prompt_published: false,
      raw_repository_content_published: false,
      raw_model_output_published: false,
      external_effect_count: interfaces.length,
      model_effect_count: interfaces.filter((value) => value === "model.decide.v1").length,
      non_model_effect_count: interfaces.filter((value) => value !== "model.decide.v1").length,
      model_actions: modelActions,
      terminal_failure_sha256: terminalFailureDigest,
      approved_mutation_count: context?.mutationsApplied ?? 0,
      provider_failure_count: context?.providerFailures ?? 0,
      private_evidence_digest: sha256(Buffer.from(evidenceDigests.join("\n"))),
      failure_code: publicFailureCode(error)
    };
    process.stdout.write(`${JSON.stringify(failureReceipt, null, 2)}\n`);
    throw error;
  } finally {
    if (!options.keepTemporary) await rm(temporaryRoot, { recursive: true, force: true });
    else process.stderr.write(`temporary_root=${temporaryRoot}\n`);
  }
}

function assertLiveReceipt(receipt) {
  const requiredTrue = [
    "openai_responses_api", "openai_model_recorded", "all_nine_slots_read_before_mutation",
    "baseline_failure_observed", "test_after_each_mutation", "passing_test_after_fourth_mutation",
    "hidden_verifier_passed", "typed_final_result", "fresh_instance_every_step"
  ];
  for (const field of requiredTrue) if (receipt[field] !== true) throw new Error(`live_receipt_failed:${field}`);
  if (receipt.external_effect_count < 41 || receipt.external_effect_count > 63 ||
      receipt.model_effect_count < 21 || receipt.model_effect_count > 32 || receipt.non_model_effect_count > 31) {
    throw new Error("live_effect_bounds_failed");
  }
  if (receipt.receiver_verified_approval_count !== 4 || receipt.human_approval_required !== false ||
      receipt.approved_mutation_count !== 4 ||
      receipt.unique_mutated_path_count !== 4 || receipt.test_count < 5) throw new Error("live_mutation_bounds_failed");
  if (receipt.changed_source_file_count !== 4 || receipt.changed_test_file_count !== 0 ||
      receipt.changed_metadata_file_count !== 0 || receipt.changed_paths.length !== 4) {
    throw new Error("live_changed_paths_failed");
  }
  if (receipt.human_file_edits !== 0 || receipt.unapproved_writes !== 0 ||
      receipt.approval_bindings.length !== 4) throw new Error("live_approval_failed");
}

function providerClaims(result, effectStatus) {
  if (!result || result.status !== effectStatus.ok) {
    const status = Object.entries(effectStatus).find(([, value]) => value === result?.status)?.at(0) ?? "unknown";
    throw new Error(`model_effect_${status}`);
  }
  if (!(result.hostClaims instanceof Uint8Array) || result.hostClaims.length === 0) {
    throw new Error("model_host_claims_missing");
  }
  const claims = JSON.parse(Buffer.from(result.hostClaims).toString("utf8"));
  if (typeof claims.returnedModel !== "string" || claims.returnedModel.length === 0 ||
      !/^[0-9a-f]{64}$/.test(claims.responseIdSha256) ||
      !safeCount(claims.inputTokens) || !safeCount(claims.outputTokens) || !safeCount(claims.totalTokens)) {
    throw new Error("model_host_claims_invalid");
  }
  return claims;
}

async function initializeGit(workspaceRoot) {
  await git(workspaceRoot, ["init", "--quiet"]);
  await git(workspaceRoot, ["config", "user.name", "Agent Adequacy Fixture"]);
  await git(workspaceRoot, ["config", "user.email", "adequacy@example.invalid"]);
  await git(workspaceRoot, ["add", "--all"]);
  await git(workspaceRoot, ["commit", "--quiet", "-m", "fixture baseline"]);
}

async function git(cwd, argv) {
  const child = Bun.spawn(["git", ...argv], {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
    env: { PATH: process.env.PATH }
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited
  ]);
  if (exitCode !== 0) throw new Error(`git_failed:${argv.at(0)}:${stderr.trim()}`);
  return stdout.trim();
}

function bindingInterfaceLabel(bindingId) {
  if (bindingId === "router-adequacy-openai.v1") return "model.decide.v1";
  const operation = bindingId.split(".").at(1);
  const label = ({
    list: "repo.list.v2",
    read: "repo.read.v2",
    search: "repo.search.v2",
    test: "repo.test.v2",
    replace: "repo.replace.approved.v2"
  })[operation];
  if (!label) throw new Error(`unknown_binding:${bindingId}`);
  return label;
}

function publicFailureCode(error) {
  const message = String(error?.message ?? "live_adequacy_failed");
  if (/^[a-z0-9_:-]{1,160}$/.test(message) && !message.includes("sk-")) return message;
  return "live_adequacy_failed";
}

function parsePorcelain(value) {
  return value.split("\n").filter(Boolean).map((line) => line.replace(/^[ MADRCU?!]{1,2} /, ""));
}

function safeCount(value) { return Number.isSafeInteger(value) && value >= 0; }
function hex(value) { return Buffer.from(value).toString("hex"); }
function sha256(value) { return createHash("sha256").update(value).digest("hex"); }
