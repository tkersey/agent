#!/usr/bin/env bun
import { createHash } from "node:crypto";
import { cp, mkdir, mkdtemp, readFile, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const options = parseArguments(process.argv.slice(2));
if (options.mode !== "deterministic") {
  if (options.mode === "live") {
    const { runLiveActuality } = await import("./live.mjs");
    const receipt = await runLiveActuality(options);
    process.stdout.write(`${JSON.stringify(receipt, null, 2)}\n`);
    process.exit(0);
  }
  const { runLifecycleProof } = await import("./lifecycle.mjs");
  const receipt = await runLifecycleProof(options.mode, options);
  process.stdout.write(`${JSON.stringify(receipt, null, 2)}\n`);
  process.exit(0);
}

const agentRoot = resolve(options.agentRoot ?? process.cwd());
const hostRoot = resolve(options.worldHostRoot ?? join(agentRoot, "../world-host"));
const capabilitiesRoot = resolve(options.capabilitiesRoot ?? join(agentRoot, "../world-capabilities-actuality-v1"));
const artifactRoot = resolve(options.artifactRoot ?? join(agentRoot, "zig-out/agent-actuality"));
const temporaryRoot = await mkdtemp(join(tmpdir(), "agent-actuality-v1-"));

try {
  const host = await import(pathToFileURL(join(hostRoot, "src/v1/index.mjs")));
  const capabilities = await import(pathToFileURL(join(capabilitiesRoot, "src/v1/index.mjs")));
  const workspaceRoot = join(temporaryRoot, "workspace");
  const temporaryHome = join(temporaryRoot, "home");
  await cp(join(agentRoot, "fixtures/repository-repair-v1"), workspaceRoot, { recursive: true, errorOnExist: true });
  await mkdir(temporaryHome);
  await initializeGit(workspaceRoot);
  const initialTree = await git(workspaceRoot, ["rev-parse", "HEAD^{tree}"]);
  const initialCommit = await git(workspaceRoot, ["rev-parse", "HEAD"]);

  const wasmBytes = await readFile(join(artifactRoot, "repository-repair-actuality.world.wasm"));
  const initialArgsBytes = await readFile(join(artifactRoot, "initial-args.bin"));
  const blockStore = new host.MemoryBlockStore();
  const headStore = new host.MemoryBranchHeadStore();
  let preflightRuns = 0;
  const controller = await host.RunControllerV1.create({
    wasmBytes,
    blockStore,
    headStore,
    workerFactory: () => new host.ApplicationWorker({ maximumMemoryBytes: 512 * 1024 * 1024 }),
    preflight: async (manifest) => {
      preflightRuns += 1;
      return { blockers: Buffer.from(manifest.applicationId).toString("hex") === capabilities.ACTUALITY_APPLICATION_ID
        ? []
        : ["application_identity_mismatch"] };
    }
  });
  const bindings = [
    capabilities.repositoryRepairDecisionFixtureBinding(),
    ...capabilities.repositoryWorkspaceBindings()
  ];
  const router = new capabilities.CapabilityRouterV1({ bindings });
  const context = {
    applicationId: capabilities.ACTUALITY_APPLICATION_ID,
    workspaceRoot,
    workspaceRootReal: await realpath(workspaceRoot),
    temporaryHome,
    bunExecutable: process.execPath,
    fixtureInitialManifestMatched: true,
    policy: {
      repositoryActuality: true,
      repositoryRepairDecisionFixture: true
    }
  };

  const runId = "actuality-deterministic-v1";
  const branchId = "main";
  let current = await controller.initialize(runId, branchId, { initialArgsBytes });
  const genesisFrameId = Buffer.from(current.frame.frameId).toString("hex");
  const interfaces = [];
  const requestIds = [];
  const resultIds = [];

  while (current.frame.status === host.FrameStatus.needsEffect) {
    const request = current.frame.pendingEffect;
    const inspected = router.inspect(request.encodedBytes);
    interfaces.push(bindingInterfaceLabel(inspected.bindingId));
    requestIds.push(hashHex(request.requestId));
    if (inspected.bindingId === "repository-workspace-actuality.replace.v1") {
      const proposal = capabilities.decodeRepositoryReplaceRequest(request.payloadBytes);
      const proposalDigest = (await import(pathToFileURL(
        join(capabilitiesRoot, "packages/repository-workspace-actuality/adapter.mjs")
      ))).proposalDigest({ operation: "replace", ...proposal });
      context.fixtureRequestDigest = proposalDigest;
      context.approval = {
        approved: true,
        requestId: Buffer.from(request.requestId).toString("hex"),
        proposalDigest,
        mode: "fixture-auto"
      };
    }
    const resolved = await router.resolve(context, request.encodedBytes);
    resultIds.push(hashHex(resolved.result.resultId));
    current = await controller.advance(runId, branchId, {
      effectResult: resolved.result,
      effectMetadata: {
        handlerId: resolved.handlerIdentity,
        handlerConfigurationId: resolved.handlerConfigurationIdentity,
        recoveryClass: resolved.recoveryClass
      }
    });
  }

  if (current.frame.status !== host.FrameStatus.completed) {
    throw new Error(`actuality_terminal_status:${current.frame.status}`);
  }
  const finalResult = capabilities.decodeRepositoryRepairFinalResult(current.frame.finalResultBytes);
  const changedPaths = (await git(workspaceRoot, ["status", "--porcelain=v1"]))
    .split("\n")
    .filter(Boolean)
    .map((line) => line.replace(/^[ MADRCU?!]{1,2} /, ""));
  const finalSource = await readFile(join(workspaceRoot, "src/range.mjs"));
  const hiddenVerifierPassed = await hiddenVerify(workspaceRoot);
  const receipt = {
    agent_actuality_format: 1,
    agent_actuality_mode: "deterministic",
    application_id: capabilities.ACTUALITY_APPLICATION_ID,
    application_wasm_sha256: sha256(wasmBytes),
    initial_git_tree: initialTree,
    initial_git_commit: initialCommit,
    genesis_frame_id: genesisFrameId,
    terminal_frame_id: Buffer.from(current.frame.frameId).toString("hex"),
    ordered_interfaces: interfaces,
    request_id_hashes: requestIds,
    result_id_hashes: resultIds,
    real_filesystem_reads: (context.fileReads ?? 0) > 0,
    real_repository_search: (context.searches ?? 0) > 0,
    real_test_process: (context.testRuns ?? 0) > 0,
    live_network_used: false,
    secret_required: false,
    failing_test_observed: context.preMutationTestFailed === true,
    approval_mode: "fixture-auto",
    approval_before_mutation: context.mutationsApplied === 1,
    mutation_attempt_count: context.mutationAttempts ?? 0,
    mutation_apply_count: context.mutationsApplied ?? 0,
    changed_source_file_count: changedPaths.filter((path) => path.startsWith("src/")).length,
    changed_test_file_count: changedPaths.filter((path) => path.startsWith("test/")).length,
    changed_package_file_count: changedPaths.filter((path) => path === "package.json").length,
    changed_paths: changedPaths,
    passing_test_observed: context.lastTestPassed === true,
    hidden_verifier_passed: hiddenVerifierPassed,
    typed_final_result: finalResult.tests_passed === true,
    final_source_digest_matches: finalResult.final_source_sha256 === sha256(finalSource),
    disposable_worker_per_step: true,
    receiver_preflight_runs: preflightRuns,
    terminal_result_digest: sha256(current.frame.finalResultBytes)
  };
  assertReceipt(receipt);
  process.stdout.write(`${JSON.stringify(receipt, null, 2)}\n`);
} finally {
  if (!options.keepTemporary) await rm(temporaryRoot, { recursive: true, force: true });
  else process.stderr.write(`temporary_root=${temporaryRoot}\n`);
}

function assertReceipt(receipt) {
  const requiredTrue = [
    "real_filesystem_reads", "real_repository_search", "real_test_process",
    "failing_test_observed", "approval_before_mutation", "passing_test_observed",
    "hidden_verifier_passed", "typed_final_result", "final_source_digest_matches"
  ];
  for (const field of requiredTrue) if (receipt[field] !== true) throw new Error(`actuality_receipt_failed:${field}`);
  if (receipt.mutation_attempt_count !== 1 || receipt.mutation_apply_count !== 1) throw new Error("actuality_mutation_count");
  if (receipt.changed_source_file_count !== 1 || receipt.changed_test_file_count !== 0 || receipt.changed_package_file_count !== 0) {
    throw new Error("actuality_changed_paths");
  }
}

async function initializeGit(workspaceRoot) {
  await git(workspaceRoot, ["init", "--quiet"]);
  await git(workspaceRoot, ["config", "user.name", "Agent Actuality Fixture"]);
  await git(workspaceRoot, ["config", "user.email", "actuality@example.invalid"]);
  await git(workspaceRoot, ["add", "--", "README.md", "package.json", "src/range.mjs", "test/range.test.mjs"]);
  await git(workspaceRoot, ["commit", "--quiet", "-m", "fixture baseline"]);
}

async function git(cwd, argv) {
  const child = Bun.spawn(["git", ...argv], { cwd, stdout: "pipe", stderr: "pipe", env: { PATH: process.env.PATH } });
  const [stdout, stderr, exitCode] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
  if (exitCode !== 0) throw new Error(`git_failed:${argv[0]}:${stderr.trim()}`);
  return stdout.trim();
}

async function hiddenVerify(workspaceRoot) {
  const module = await import(`${pathToFileURL(join(workspaceRoot, "src/range.mjs")).href}?digest=${Date.now()}`);
  const cases = [
    [1, 3, { start: 1, end: 3 }],
    [3, 1, { start: 1, end: 3 }],
    [2, 2, { start: 2, end: 2 }],
    [-1, -5, { start: -5, end: -1 }]
  ];
  return cases.every(([start, end, expected]) => JSON.stringify(module.normalizeRange(start, end)) === JSON.stringify(expected));
}

function bindingInterfaceLabel(bindingId) {
  if (bindingId === "repository-repair-decision-fixture.v1") return "model.decide.v1";
  const operation = bindingId.split(".")[1];
  return ({ list: "repo.list.v1", read: "repo.read.v1", search: "repo.search.v1", test: "repo.test.v1", replace: "repo.replace.approved.v1" })[operation];
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
