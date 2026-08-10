import { createHash } from "node:crypto";
import { cp, mkdir, mkdtemp, readFile, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { pathToFileURL } from "node:url";

const APPLICATION_ID = "26f5ab2b7e86994e5d3b234bb32447891906276853c094f0ac73def2b99610bb";
const DECISION_CONTRACT_DIGEST = "3e2e4a1bd58b047dc9343964cfdc413174bb50a39d573e340cb963bf29127800";
const WORKER_MEMORY_BYTES = 512 * 1024 * 1024;

export class LiveActualityAttemptError extends Error {
  constructor(receipt) {
    super(`live_actuality_failed:${receipt.failure_code}`);
    this.name = "LiveActualityAttemptError";
    this.receipt = Object.freeze(receipt);
  }
}

class PublicLiveActualityFailure extends Error {
  constructor(code) {
    super(code);
    this.name = "PublicLiveActualityFailure";
    this.code = code;
  }
}

export async function runLiveCommand(options, dependencies = {}) {
  const run = dependencies.run ?? runLiveActuality;
  const write = dependencies.write ?? ((value) => process.stdout.write(value));
  try {
    const receipt = await run(options);
    write(`${JSON.stringify(receipt, null, 2)}\n`);
    return receipt;
  } catch (error) {
    if (error?.receipt) write(`${JSON.stringify(error.receipt, null, 2)}\n`);
    throw error;
  }
}

export async function runLiveActuality(options = {}) {
  const apiKey = process.env.OPENAI_API_KEY;
  const model = process.env.OPENAI_MODEL;
  if (!apiKey) throw new Error("OPENAI_API_KEY_required");
  if (!model) throw new Error("OPENAI_MODEL_required");
  if (!process.stdin.isTTY || !process.stdout.isTTY) throw new Error("interactive_terminal_required");

  const prompt = createInterface({ input: process.stdin, output: process.stderr });
  const confirmation = await prompt.question(
    "This run sends the controlled fixture repository contents to OpenAI.\n" +
    "No personal repository is included.\nContinue? [yes/no] "
  );
  if (confirmation.trim().toLowerCase() !== "yes") {
    prompt.close();
    throw new Error("live_actuality_not_confirmed");
  }

  const agentRoot = resolve(options.agentRoot ?? process.cwd());
  const hostRoot = resolve(options.worldHostRoot ?? join(agentRoot, "../world-host"));
  const capabilitiesRoot = resolve(options.capabilitiesRoot ?? join(agentRoot, "../world-capabilities-actuality-v1"));
  const artifactRoot = resolve(options.artifactRoot ?? join(agentRoot, "zig-out/agent-actuality"));
  const temporaryRoot = await mkdtemp(join(tmpdir(), "agent-actuality-live-"));
  let context;
  let genesisFrameId = null;
  let terminalFrameId = null;
  const interfaces = [];
  const provider = {
    returnedModels: new Set(),
    responseIdDigests: [],
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0
  };
  const evidenceDigests = [];
  try {
    const host = await import(pathToFileURL(join(hostRoot, "src/v1/index.mjs")));
    const capabilities = await import(pathToFileURL(join(capabilitiesRoot, "src/v1/index.mjs")));
    const workspaceAdapter = await import(pathToFileURL(join(
      capabilitiesRoot,
      "packages/repository-workspace-actuality/adapter.mjs"
    )));
    const workspaceRoot = join(temporaryRoot, "workspace");
    const temporaryHome = join(temporaryRoot, "home");
    await cp(join(agentRoot, "fixtures/repository-repair-v1"), workspaceRoot, {
      recursive: true,
      errorOnExist: true
    });
    await mkdir(temporaryHome);
    await initializeGit(workspaceRoot);

    const wasmBytes = await readFile(join(artifactRoot, "repository-repair-actuality.world.wasm"));
    const initialArgsBytes = await readFile(join(artifactRoot, "initial-args.bin"));
    const controller = await host.RunControllerV1.create({
      wasmBytes,
      blockStore: new host.MemoryBlockStore(),
      headStore: new host.MemoryBranchHeadStore(),
      workerFactory: () => new host.ApplicationWorker({ maximumMemoryBytes: WORKER_MEMORY_BYTES }),
      preflight: async (manifest) => ({
        blockers: hex(manifest.applicationId) === APPLICATION_ID ? [] : ["application_identity_mismatch"]
      })
    });
    const router = new capabilities.CapabilityRouterV1({
      bindings: [
        capabilities.repositoryRepairOpenAIBinding(),
        ...capabilities.repositoryWorkspaceBindings()
      ]
    });
    context = {
      applicationId: APPLICATION_ID,
      workspaceRoot,
      workspaceRootReal: await realpath(workspaceRoot),
      temporaryHome,
      bunExecutable: process.execPath,
      fixtureInitialManifestMatched: true,
      secrets: { OPENAI_API_KEY: apiKey },
      openaiModel: model,
      allowedModels: [model],
      decisionContractDigest: DECISION_CONTRACT_DIGEST,
      maximumModelCalls: 16,
      policy: { repositoryActuality: true, openaiRepositoryRepair: true }
    };

    let current = await controller.initialize("actuality-live-v1", "main", { initialArgsBytes });
    genesisFrameId = hex(current.frame.frameId);
    while (current.frame.status === host.FrameStatus.needsEffect) {
      const request = current.frame.pendingEffect;
      const inspected = router.inspect(request.encodedBytes);
      interfaces.push(bindingInterfaceLabel(inspected.bindingId));
      if (inspected.bindingId === "repository-workspace-actuality.replace.v1") {
        const proposal = capabilities.decodeRepositoryReplaceRequest(request.payloadBytes);
        const requestId = hex(request.requestId);
        const proposalDigest = workspaceAdapter.proposalDigest({ operation: "replace", ...proposal });
        const prior = await readFile(join(workspaceRoot, proposal.path), "utf8");
        process.stderr.write(
          `\nApplication: ${APPLICATION_ID}\n` +
          `EffectRequest: ${requestId}\n` +
          `Path: ${proposal.path}\n` +
          `Expected SHA-256: ${proposal.expectedSha256}\n` +
          `Proposed SHA-256: ${sha256(proposal.replacement)}\n` +
          `Rationale: ${proposal.rationale}\n` +
          `Failing test observed: ${context.preMutationTestFailed === true}\n` +
          `${boundedDiff(prior, proposal.replacement)}\n`
        );
        const approval = await prompt.question(`Type approve ${requestId.slice(0, 12)} to mutate: `);
        context.approval = {
          approved: approval.trim() === `approve ${requestId.slice(0, 12)}`,
          requestId,
          proposalDigest,
          mode: "interactive"
        };
      }
      const resolved = await router.resolve(context, request.encodedBytes);
      evidenceDigests.push(sha256(resolved.result.encodedBytes));
      if (inspected.bindingId === "repository-repair-openai.v1") {
        const claims = admitSuccessfulProviderClaims(resolved.result, capabilities.EffectStatus);
        provider.returnedModels.add(claims.returnedModel);
        provider.responseIdDigests.push(claims.responseIdSha256);
        provider.inputTokens += claims.inputTokens;
        provider.outputTokens += claims.outputTokens;
        provider.totalTokens += claims.totalTokens;
      }
      current = await controller.advance("actuality-live-v1", "main", {
        effectResult: resolved.result,
        effectMetadata: {
          handlerId: resolved.handlerIdentity,
          handlerConfigurationId: resolved.handlerConfigurationIdentity,
          recoveryClass: resolved.recoveryClass
        }
      });
      terminalFrameId = hex(current.frame.frameId);
    }
    if (current.frame.status !== host.FrameStatus.completed) {
      throw new PublicLiveActualityFailure(`live_terminal_status_${current.frame.status}`);
    }
    const finalResult = capabilities.decodeRepositoryRepairFinalResult(current.frame.finalResultBytes);
    const changedPaths = parsePorcelain(await git(workspaceRoot, ["status", "--porcelain=v1"]));
    const hiddenVerifierPassed = await hiddenVerify(workspaceRoot);
    const receipt = {
      agent_actuality_format: 1,
      agent_actuality_mode: "live",
      application_id: APPLICATION_ID,
      application_wasm_sha256: sha256(wasmBytes),
      openai_responses_api: true,
      openai_model_requested_present: model.length > 0,
      openai_model_returned_present: provider.returnedModels.size > 0,
      openai_models_returned: [...provider.returnedModels],
      openai_store: false,
      openai_tools_count: 0,
      openai_api_key_recorded: false,
      live_model_call_count: context.modelCalls ?? 0,
      live_model_call_count_positive: (context.modelCalls ?? 0) > 0,
      provider_failure_count: context.providerFailures ?? 0,
      input_tokens: provider.inputTokens,
      output_tokens: provider.outputTokens,
      total_tokens: provider.totalTokens,
      provider_response_id_digests: provider.responseIdDigests,
      controlled_fixture_only: true,
      personal_repository_data_sent: false,
      interactive_approval: context.approval?.approved === true,
      approval_before_mutation: context.mutationsApplied === 1,
      real_filesystem_reads: (context.fileReads ?? 0) > 0,
      real_test_process: (context.testRuns ?? 0) > 0,
      real_mutation: context.mutationsApplied === 1,
      failing_test_observed: context.preMutationTestFailed === true,
      passing_test_observed: context.lastTestPassed === true,
      typed_final_result: finalResult.tests_passed === true,
      hidden_verifier_passed: hiddenVerifierPassed,
      changed_paths: changedPaths,
      genesis_frame_id: genesisFrameId,
      terminal_frame_id: terminalFrameId,
      ordered_interfaces: interfaces,
      public_receipt_contains_raw_prompt: false,
      public_receipt_contains_raw_repository_bytes: false,
      public_receipt_contains_raw_model_output: false,
      private_evidence_digest: sha256(Buffer.from(evidenceDigests.join("\n"))),
      live_attempt_count: 1,
      live_success_count: 1
    };
    assertLiveReceipt(receipt);
    return receipt;
  } catch (error) {
    if (error instanceof LiveActualityAttemptError) throw error;
    throw new LiveActualityAttemptError(failedAttemptReceipt({
      model,
      context,
      genesisFrameId,
      terminalFrameId,
      interfaces,
      provider,
      evidenceDigests,
      failureCode: publicFailureCode(error)
    }));
  } finally {
    prompt.close();
    if (!options.keepTemporary) await rm(temporaryRoot, { recursive: true, force: true });
    else process.stderr.write(`temporary_root=${temporaryRoot}\n`);
  }
}

export function admitSuccessfulProviderClaims(result, effectStatus) {
  if (!result || result.status !== effectStatus.ok) {
    const status = Object.entries(effectStatus).find(([, value]) => value === result?.status)?.at(0) ?? "unknown";
    throw new PublicLiveActualityFailure(`model_effect_${status}`);
  }
  if (!(result.hostClaims instanceof Uint8Array) || result.hostClaims.length === 0) {
    throw new PublicLiveActualityFailure("model_host_claims_missing");
  }
  let claims;
  try {
    claims = JSON.parse(Buffer.from(result.hostClaims).toString("utf8"));
  } catch {
    throw new PublicLiveActualityFailure("model_host_claims_invalid");
  }
  if (!claims || typeof claims !== "object" || Array.isArray(claims) ||
      typeof claims.returnedModel !== "string" || claims.returnedModel.length === 0 ||
      typeof claims.responseIdSha256 !== "string" || !/^[0-9a-f]{64}$/.test(claims.responseIdSha256) ||
      !safeCount(claims.inputTokens) || !safeCount(claims.outputTokens) || !safeCount(claims.totalTokens)) {
    throw new PublicLiveActualityFailure("model_host_claims_invalid");
  }
  return claims;
}

export function failedAttemptReceipt({
  model,
  context,
  genesisFrameId,
  terminalFrameId,
  interfaces,
  provider,
  evidenceDigests,
  failureCode
}) {
  return {
    agent_actuality_format: 1,
    agent_actuality_mode: "live",
    application_id: APPLICATION_ID,
    openai_responses_api: true,
    openai_model_requested_present: typeof model === "string" && model.length > 0,
    openai_store: false,
    openai_tools_count: 0,
    openai_api_key_recorded: false,
    live_model_call_count: context?.modelCalls ?? 0,
    provider_failure_count: context?.providerFailures ?? 0,
    openai_models_returned: [...(provider?.returnedModels ?? [])],
    provider_response_id_digests: [...(provider?.responseIdDigests ?? [])],
    input_tokens: provider?.inputTokens ?? 0,
    output_tokens: provider?.outputTokens ?? 0,
    total_tokens: provider?.totalTokens ?? 0,
    controlled_fixture_only: true,
    personal_repository_data_sent: false,
    genesis_frame_id: genesisFrameId,
    terminal_frame_id: terminalFrameId,
    ordered_interfaces: [...interfaces],
    public_receipt_contains_raw_prompt: false,
    public_receipt_contains_raw_repository_bytes: false,
    public_receipt_contains_raw_model_output: false,
    private_evidence_digest: sha256(Buffer.from((evidenceDigests ?? []).join("\n"))),
    failure_code: failureCode,
    live_attempt_count: 1,
    live_success_count: 0
  };
}

export function publicFailureCode(error) {
  return error instanceof PublicLiveActualityFailure ? error.code : "live_actuality_failed";
}

function safeCount(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

function assertLiveReceipt(receipt) {
  for (const field of [
    "openai_responses_api", "openai_model_requested_present", "openai_model_returned_present",
    "live_model_call_count_positive", "controlled_fixture_only", "interactive_approval",
    "approval_before_mutation", "real_filesystem_reads", "real_test_process", "real_mutation",
    "failing_test_observed", "passing_test_observed", "typed_final_result", "hidden_verifier_passed"
  ]) {
    if (receipt[field] !== true) throw new Error(`live_receipt_failed:${field}`);
  }
  if (receipt.live_model_call_count > 16 || receipt.changed_paths.length !== 1 ||
      receipt.changed_paths.at(0) !== "src/range.mjs") throw new Error("live_receipt_bounds_failed");
}

function boundedDiff(before, after) {
  const left = before.split("\n");
  const right = after.split("\n");
  const lines = ["--- current", "+++ proposed"];
  const maximum = Math.max(left.length, right.length);
  for (let index = 0; index < maximum && lines.length < 80; index += 1) {
    if (left.at(index) === right.at(index)) continue;
    if (left.at(index) !== undefined) lines.push(`- ${left.at(index)}`);
    if (right.at(index) !== undefined) lines.push(`+ ${right.at(index)}`);
  }
  return lines.join("\n").slice(0, 8192);
}

async function initializeGit(workspaceRoot) {
  await git(workspaceRoot, ["init", "--quiet"]);
  await git(workspaceRoot, ["config", "user.name", "Agent Actuality Fixture"]);
  await git(workspaceRoot, ["config", "user.email", "actuality@example.invalid"]);
  await git(workspaceRoot, ["add", "--", "README.md", "package.json", "src/range.mjs", "test/range.test.mjs"]);
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

function parsePorcelain(value) {
  return value.split("\n").filter(Boolean).map((line) => line.replace(/^[ MADRCU?!]{1,2} /, ""));
}

async function hiddenVerify(workspaceRoot) {
  const module = await import(`${pathToFileURL(join(workspaceRoot, "src/range.mjs")).href}?digest=${Date.now()}`);
  const cases = [
    [1, 3, { start: 1, end: 3 }],
    [3, 1, { start: 1, end: 3 }],
    [2, 2, { start: 2, end: 2 }],
    [-1, -5, { start: -5, end: -1 }]
  ];
  return cases.every(([start, end, expected]) =>
    JSON.stringify(module.normalizeRange(start, end)) === JSON.stringify(expected));
}

function bindingInterfaceLabel(bindingId) {
  if (bindingId === "repository-repair-openai.v1") return "model.decide.v1";
  const operation = bindingId.split(".").at(1);
  return ({
    list: "repo.list.v1",
    read: "repo.read.v1",
    search: "repo.search.v1",
    test: "repo.test.v1",
    replace: "repo.replace.approved.v1"
  })[operation];
}

function hex(value) { return Buffer.from(value).toString("hex"); }
function sha256(value) { return createHash("sha256").update(value).digest("hex"); }
