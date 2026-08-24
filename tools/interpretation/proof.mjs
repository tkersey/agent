#!/usr/bin/env bun
import { createHash } from "node:crypto";
import { cp, mkdir, mkdtemp, readFile, readdir, realpath, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, relative, resolve } from "node:path";

import { runSpecialized } from "./specialized.mjs";
import { compileKernel, encodeResumeAuxiliary, executeKernelCommand } from "./kernel_client.mjs";
import { runtimeDependencyDigest } from "./dependency_digest.mjs";

const EXPECTED_RUNTIME_DEPENDENCIES = Object.freeze({
  worldHost: "dfb59aaa8c2288ae85c69a31cfd7a400d9f2f27f26e0098f973442cb273977f2",
  worldCapabilities: "f38cdb293819098b19cfcc03f65ba61f1257abf73ffef0c7e70a0e5468c3d230"
});

const GENERIC_FILES = Object.freeze([
  "drive.mjs",
  "kernel_client.mjs",
  "bpi1_effects.mjs",
  "effect_resolver.mjs",
  "proof_limits.mjs"
]);
const ARTIFACT_FILES = Object.freeze([
  "repository-repair.agent.bpi1",
  "repository-repair.agent.bpi1.sha256",
  "repository-repair.agent.mv2p1",
  "repository-repair.agent.mv2p1.sha256",
  "repository-repair.initial-args.bin",
  "repository-repair.initial-args.bin.sha256",
  "repository-repair.decision-contract.bin",
  "repository-repair.decision-contract.bin.sha256",
  "repository-repair-actuality.manifest.bin",
  "repository-repair-actuality.manifest.bin.sha256",
  "boundary-machine-v2-kernel-v1.wasm",
  "boundary-machine-v2-kernel-v1.wasm.sha256"
]);
const FORBIDDEN_DRIVER_LITERALS = Object.freeze([
  "AgentDefinition", "RuntimeStrategy", "EpistemicStrategy", "list_repository",
  "read_file", "search_text", "run_tests", "replace_file", "final admission"
]);

export async function proveAgentInterpretation(options) {
  const temporaryRoot = await mkdtemp(join(tmpdir(), "agent-interpretation-v1-"));
  try {
    await verifyArtifactSidecars(options);
    const dependencyBindings = await bindRuntimeDependencies(options);
    const specializedRoot = join(temporaryRoot, "specialized-workspace");
    const runtimeRoot = join(temporaryRoot, "clean-room");
    const interpretedRoot = join(runtimeRoot, "workspace");
    await mkdir(runtimeRoot);
    await cp(options.fixtureRoot, specializedRoot, { recursive: true, errorOnExist: true });
    await cp(options.fixtureRoot, interpretedRoot, { recursive: true, errorOnExist: true });
    await Promise.all([initializeGit(specializedRoot), initializeGit(interpretedRoot)]);
    const initialSpecializedTree = await git(specializedRoot, ["rev-parse", "HEAD^{tree}"]);
    const initialInterpretedTree = await git(interpretedRoot, ["rev-parse", "HEAD^{tree}"]);
    if (initialSpecializedTree !== initialInterpretedTree) throw new Error("initial_git_tree_mismatch");
    const specializedHome = join(temporaryRoot, "specialized-home");
    const interpretedHome = join(runtimeRoot, "home");
    await Promise.all([mkdir(specializedHome), mkdir(interpretedHome)]);

    const specialized = await runSpecialized({
      worldHostRoot: options.worldHostRoot,
      capabilitiesRoot: options.capabilitiesRoot,
      environmentModule: options.environmentModule,
      applicationWasm: options.applicationWasm,
      artifactRoot: options.artifactRoot,
      workspaceRoot: specializedRoot,
      temporaryHome: specializedHome,
      bunExecutable: options.bunExecutable
    });

    const runtime = await prepareCleanRoom(runtimeRoot, interpretedRoot, options);
    const cleanInventory = await assertCleanRoom(runtimeRoot, runtime);
    const interpretedOutput = join(runtimeRoot, "interpreted-result.json");
    const sandboxProfile = await cleanRoomSandboxProfile(options, runtimeRoot);
    const sandboxEnvironment = {
      HOME: interpretedHome,
      TMPDIR: interpretedHome,
      PATH: dirname(options.bunExecutable),
      NO_COLOR: "1",
      LC_ALL: "C"
    };
    const sandboxDenials = await proveSandboxReadDenials(
      options,
      sandboxProfile,
      sandboxEnvironment
    );
    const child = Bun.spawn([
      "/usr/bin/sandbox-exec", "-p", sandboxProfile,
      options.bunExecutable, runtime.drive,
      "--bpi1", join(runtime.artifacts, "repository-repair.agent.bpi1"),
      "--mv2p1", join(runtime.artifacts, "repository-repair.agent.mv2p1"),
      "--initial-args", join(runtime.artifacts, "repository-repair.initial-args.bin"),
      "--decision-contract", join(runtime.artifacts, "repository-repair.decision-contract.bin"),
      "--manifest", join(runtime.artifacts, "repository-repair-actuality.manifest.bin"),
      "--kernel", join(runtime.artifacts, "boundary-machine-v2-kernel-v1.wasm"),
      "--world-host-root", options.worldHostRoot,
      "--capabilities-root", options.capabilitiesRoot,
      "--environment-module", runtime.environment,
      "--workspace-root", interpretedRoot,
      "--temporary-home", interpretedHome,
      "--bun-executable", options.bunExecutable,
      "--output", interpretedOutput
    ], {
      cwd: runtimeRoot,
      stdout: "pipe",
      stderr: "pipe",
      env: sandboxEnvironment
    });
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited
    ]);
    if (exitCode !== 0) throw new Error(`clean_room_execution_failed:${exitCode}:${stderr.trim()}:${stdout.trim()}`);
    const interpreted = decodeInterpretedResult(JSON.parse(await readFile(interpretedOutput, "utf8")));
    await verifyRuntimeDependenciesUnchanged(options, dependencyBindings);
    compareExecution(specialized, interpreted);

    const specializedGit = await inspectFinalGit(specializedRoot);
    const interpretedGit = await inspectFinalGit(interpretedRoot);
    if (specializedGit.tree !== interpretedGit.tree ||
        JSON.stringify(specializedGit.changedPaths) !== JSON.stringify(interpretedGit.changedPaths) ||
        !specialized.finalSourceBytes.equals(interpreted.finalSourceBytes)) {
      throw new Error("final_repository_mismatch");
    }
    assertRepositoryResult(specializedGit, specialized, interpreted);

    const negatives = await runNegativeGates(
      options,
      interpreted,
      runtimeRoot,
      runtime,
      sandboxDenials
    );
    const bpi1 = await readFile(join(options.artifactRoot, "repository-repair.agent.bpi1"));
    const mv2p1 = await readFile(join(options.artifactRoot, "repository-repair.agent.mv2p1"));
    const contract = await readFile(join(options.artifactRoot, "repository-repair.decision-contract.bin"));
    const receipt = {
      format: "agent-interpretation-v1",
      agent_commit: await git(options.agentRoot, ["rev-parse", "HEAD"]),
      agent_version: "2.7.0",
      boundary_version: "1.6.0",
      kernel_wasm_sha256: options.kernelSha256,
      kernel_import_count: 0,
      world_host_runtime_sha256: dependencyBindings.worldHost.sha256,
      world_capabilities_runtime_sha256: dependencyBindings.worldCapabilities.sha256,
      bpi1_sha256: sha256(bpi1),
      mv2p1_sha256: sha256(mv2p1),
      program_transition_digest: bpi1.subarray(32, 64).toString("hex"),
      machine_v2_contract_digest: mv2p1.subarray(96, 128).toString("hex"),
      application_id: interpreted.applicationId,
      decision_contract_digest: contract.subarray(-32).toString("hex"),
      effect_count: new Set(interpreted.trace.map((entry) => entry.effectIdentity)).size,
      model_decision_count: interpreted.trace.filter((entry) => entry.effectIdentity === "model.decide.v1").length,
      repository_effect_count: interpreted.trace.filter((entry) => entry.effectIdentity !== "model.decide.v1").length,
      yield_boundary_count: interpreted.yieldBoundaries.length,
      state_comparison_count: interpreted.trace.length,
      payload_comparison_count: interpreted.trace.length,
      request_identity_comparison_count: interpreted.trace.length,
      response_comparison_count: interpreted.trace.length,
      specialized_terminal_result_sha256: specialized.terminalResultSha256,
      interpreted_terminal_result_sha256: interpreted.terminalResultSha256,
      specialized_final_git_tree: specializedGit.tree,
      interpreted_final_git_tree: interpretedGit.tree,
      clean_room_agent_source_absent: true,
      application_specific_wasm_absent: true,
      hidden_verifier_passed: specialized.hiddenVerifierPassed && interpreted.hiddenVerifierPassed,
      specialized_interpreted_equivalent: true,
      clean_room_inventory: cleanInventory,
      negative_gates: negatives
    };
    await writeFile(options.receiptOutput, `${JSON.stringify(receipt, null, 2)}\n`);
    return receipt;
  } finally {
    if (!options.keepTemporary) await rm(temporaryRoot, { recursive: true, force: true });
    else process.stderr.write(`temporary_root=${temporaryRoot}\n`);
  }
}

async function proveSandboxReadDenials(options, sandboxProfile, environment) {
  const denied = {};
  for (const [name, path] of [
    ["agent_source", join(options.agentRoot, "build.zig")],
    ["application_wasm", options.applicationWasm]
  ]) {
    const script = `await Bun.file(${JSON.stringify(resolve(path))}).arrayBuffer();`;
    const child = Bun.spawn([
      "/usr/bin/sandbox-exec",
      "-p",
      sandboxProfile,
      options.bunExecutable,
      "--eval",
      script
    ], { stdout: "pipe", stderr: "pipe", env: environment });
    const [, , exitCode] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited
    ]);
    denied[name] = exitCode !== 0;
  }
  if (Object.values(denied).some((value) => value !== true)) {
    throw new Error(`clean_room_sandbox_read_allowed:${JSON.stringify(denied)}`);
  }
  return Object.freeze(denied);
}

async function cleanRoomSandboxProfile(options, runtimeRoot) {
  const declaredReadable = [
    "/System",
    "/usr",
    "/bin",
    "/sbin",
    "/dev",
    "/private/etc",
    "/private/var/db/timezone",
    "/opt/homebrew",
    runtimeRoot,
    options.worldHostRoot,
    options.capabilitiesRoot
  ];
  const readable = [...new Set([
    ...declaredReadable,
    ...await Promise.all(declaredReadable.map((path) => realpath(path)))
  ])];
  const writable = [...new Set([
    runtimeRoot,
    await realpath(runtimeRoot),
    "/dev",
    await realpath("/dev")
  ])];
  const readDeny = denyOutside("file-read*", readable);
  const writeDeny = denyOutside("file-write*", writable);
  return `(version 1)
    (allow default)
    (deny network*)
    ${readDeny}
    ${writeDeny}`;
}

function denyOutside(operation, admittedPaths) {
  const paths = [...new Set(admittedPaths.map((path) => resolve(path)))];
  const ancestors = new Set(["/"]);
  for (const path of paths) {
    let current = dirname(path);
    while (current !== "/") {
      ancestors.add(current);
      current = dirname(current);
    }
  }
  const admitted = [
    ...paths.map((path) => `(subpath ${JSON.stringify(path)})`),
    ...[...ancestors].map((path) => `(literal ${JSON.stringify(path)})`)
  ];
  return `(deny ${operation} (require-all ${admitted.map((rule) => `(require-not ${rule})`).join(" ")}))`;
}

async function bindRuntimeDependencies(options) {
  const worldHost = await runtimeDependencyDigest(options.worldHostRoot, ["src/v1"]);
  const worldCapabilities = await runtimeDependencyDigest(options.capabilitiesRoot, [
    "src/v1",
    "packages/repository-repair-decision-fixture",
    "packages/repository-workspace-actuality"
  ]);
  if (worldHost.sha256 !== EXPECTED_RUNTIME_DEPENDENCIES.worldHost ||
      worldCapabilities.sha256 !== EXPECTED_RUNTIME_DEPENDENCIES.worldCapabilities) {
    throw new Error(`runtime_dependency_digest_mismatch:${worldHost.sha256}:${worldCapabilities.sha256}`);
  }
  return Object.freeze({ worldHost, worldCapabilities });
}

async function verifyRuntimeDependenciesUnchanged(options, expected) {
  const current = await bindRuntimeDependencies(options);
  if (current.worldHost.sha256 !== expected.worldHost.sha256 ||
      current.worldCapabilities.sha256 !== expected.worldCapabilities.sha256) {
    throw new Error("runtime_dependency_changed_during_proof");
  }
}

async function verifyArtifactSidecars(options) {
  for (const name of [
    "repository-repair.agent.bpi1",
    "repository-repair.agent.mv2p1",
    "repository-repair.initial-args.bin",
    "repository-repair.decision-contract.bin",
    "repository-repair-actuality.manifest.bin",
    "boundary-machine-v2-kernel-v1.wasm"
  ]) {
    const root = name === "boundary-machine-v2-kernel-v1.wasm"
      ? dirname(options.kernelWasm)
      : options.artifactRoot;
    const bytes = await readFile(join(root, name));
    const recorded = (await readFile(join(options.artifactRoot, `${name}.sha256`), "utf8")).trim();
    if (recorded !== sha256(bytes)) throw new Error(`artifact_sidecar_mismatch:${name}`);
  }
}

async function prepareCleanRoom(runtimeRoot, interpretedRoot, options) {
  const artifacts = join(runtimeRoot, "artifacts");
  const runner = join(runtimeRoot, "runner");
  await Promise.all([mkdir(artifacts), mkdir(runner)]);
  for (const name of ARTIFACT_FILES) {
    const source = name === "boundary-machine-v2-kernel-v1.wasm"
      ? options.kernelWasm
      : join(options.artifactRoot, name);
    await cp(source, join(artifacts, name), { errorOnExist: true });
  }
  for (const name of GENERIC_FILES) {
    await cp(join(options.interpretationToolsRoot, name), join(runner, name), { errorOnExist: true });
  }
  const environment = join(runner, "repository_repair_environment.mjs");
  await cp(options.environmentModule, environment, { errorOnExist: true });
  return Object.freeze({ artifacts, runner, drive: join(runner, "drive.mjs"), environment, interpretedRoot });
}

async function assertCleanRoom(runtimeRoot, runtime) {
  const inventory = await recursiveFiles(runtimeRoot);
  for (const path of inventory) {
    if (path.endsWith(".zig") || (path.endsWith(".wasm") && basename(path) !== "boundary-machine-v2-kernel-v1.wasm")) {
      throw new Error(`clean_room_forbidden_file:${path}`);
    }
  }
  for (const name of GENERIC_FILES) {
    const source = await readFile(join(runtime.runner, name), "utf8");
    for (const literal of FORBIDDEN_DRIVER_LITERALS) {
      if (source.includes(literal)) throw new Error(`generic_driver_smuggling:${name}:${literal}`);
    }
  }
  for (const name of ARTIFACT_FILES) {
    if (!inventory.includes(`artifacts/${name}`)) throw new Error(`clean_room_missing:${name}`);
  }
  return Object.freeze(inventory);
}

function compareExecution(specialized, interpreted) {
  if (specialized.applicationId !== interpreted.applicationId ||
      specialized.yieldBoundaries.length !== interpreted.yieldBoundaries.length ||
      specialized.trace.length !== interpreted.trace.length ||
      !specialized.terminalResultBytes.equals(interpreted.terminalResultBytes)) {
    throw new Error("execution_trace_shape_mismatch");
  }
  for (let index = 0; index < specialized.yieldBoundaries.length; index += 1) {
    const left = specialized.yieldBoundaries[index];
    const right = interpreted.yieldBoundaries[index];
    if (left.transitionIndex !== right.transitionIndex || !left.state.equals(right.state)) {
      throw new Error(`yield_boundary_mismatch:${index}`);
    }
  }
  const byteFields = ["state", "identity", "payload", "response"];
  for (let index = 0; index < specialized.trace.length; index += 1) {
    const left = specialized.trace[index];
    const right = interpreted.trace[index];
    if (left.effectIdentity !== right.effectIdentity) throw new Error(`effect_identity_mismatch:${index}`);
    for (const field of byteFields) {
      if (!left[field].equals(right[field])) {
        const offset = firstDifference(left[field], right[field]);
        const semantic = field === "response" && left.effectIdentity === "repo.test.v1"
          ? processResponseDifference(left[field], right[field])
          : "";
        throw new Error(`trace_byte_mismatch:${index}:${field}:` +
          `${left[field].length}:${sha256(left[field])}:${right[field].length}:${sha256(right[field])}:` +
          `offset=${offset}:left=${JSON.stringify(left[field].subarray(Math.max(0, offset - 16), offset + 48).toString())}:` +
          `right=${JSON.stringify(right[field].subarray(Math.max(0, offset - 16), offset + 48).toString())}:${semantic}`);
      }
    }
  }
}

async function runNegativeGates(
  options,
  interpreted,
  runtimeRoot,
  runtime,
  sandboxDenials
) {
  const [kernelBytes, bpi1, mv2p1, initialArgs, unrelatedBpi1, unrelatedMv2p1] = await Promise.all([
    readFile(options.kernelWasm),
    readFile(join(options.artifactRoot, "repository-repair.agent.bpi1")),
    readFile(join(options.artifactRoot, "repository-repair.agent.mv2p1")),
    readFile(join(options.artifactRoot, "repository-repair.initial-args.bin")),
    readFile(options.unrelatedBpi1),
    readFile(options.unrelatedMv2p1)
  ]);
  const kernel = await compileKernel(kernelBytes);
  const rejects = async (operation) => {
    try { await operation(); return false; } catch { return true; }
  };
  const corruptedImage = Buffer.from(bpi1);
  corruptedImage[corruptedImage.length - 1] ^= 1;
  const corruptedProfile = Buffer.from(mv2p1);
  corruptedProfile[128] ^= 1;
  const wrongKernel = Buffer.from(kernelBytes);
  wrongKernel[wrongKernel.length - 1] ^= 1;
  const missingPath = join(runtime.artifacts, "repository-repair.agent.bpi1");
  const hiddenPath = `${missingPath}.missing`;
  const missingImageRejected = await rejects(async () => {
    await rename(missingPath, hiddenPath);
    try { await assertCleanRoom(runtimeRoot, runtime); } finally { await rename(hiddenPath, missingPath); }
  });
  const unrelatedValid = (await executeKernelCommand({
    kernel, bpi1: unrelatedBpi1, mv2p1: unrelatedMv2p1, command: 0
  })).outcome === 0;
  const unrelatedCompletionRejected = await rejects(() => executeKernelCommand({
    kernel, bpi1: unrelatedBpi1, mv2p1: unrelatedMv2p1, command: 1, auxiliary: initialArgs
  }));
  const first = interpreted.trace.at(0);
  const mutated = Buffer.from(first.response);
  mutated[mutated.length - 1] ^= 1;
  let mutatedResponseRejected;
  try {
    const resumed = await executeKernelCommand({
      kernel,
      bpi1,
      mv2p1,
      command: 5,
      state: first.state,
      auxiliary: encodeResumeAuxiliary(first.identity, mutated)
    });
    const stepped = await executeKernelCommand({
      kernel,
      bpi1,
      mv2p1,
      command: 4,
      state: resumed.state,
      callerFuel: interpreted.maximumFuelPerStep
    });
    const expected = interpreted.trace.at(1);
    mutatedResponseRejected = stepped.outcome !== 3 || !Buffer.from(stepped.state).equals(expected.state) ||
      !Buffer.from(stepped.value).equals(expected.payload) || !Buffer.from(stepped.metadata).equals(expected.identity);
  } catch {
    mutatedResponseRejected = true;
  }
  const smuggledPath = join(runtime.runner, "smuggled.zig");
  const sourceSmugglingRejected = await rejects(async () => {
    await writeFile(smuggledPath, "const smuggled = true;\n", { flag: "wx" });
    try { await assertCleanRoom(runtimeRoot, runtime); } finally { await rm(smuggledPath); }
  });
  const smuggledWasmPath = join(runtime.runner, "repository-repair-actuality.world.wasm");
  const applicationWasmSmugglingRejected = await rejects(async () => {
    await cp(options.applicationWasm, smuggledWasmPath, { errorOnExist: true });
    try { await assertCleanRoom(runtimeRoot, runtime); } finally { await rm(smuggledWasmPath); }
  });
  const untrackedPath = join(runtime.interpretedRoot, "untracked-negative.txt");
  await writeFile(untrackedPath, "untracked\n", { flag: "wx" });
  const untrackedPathDetected = (await listChangedPaths(runtime.interpretedRoot))
    .includes("untracked-negative.txt");
  await rm(untrackedPath);
  const result = Object.freeze({
    corrupted_bpi1_rejected: await rejects(() => executeKernelCommand({ kernel, bpi1: corruptedImage, mv2p1, command: 0 })),
    corrupted_mv2p1_rejected: await rejects(() => executeKernelCommand({ kernel, bpi1, mv2p1: corruptedProfile, command: 0 })),
    wrong_kernel_rejected: await rejects(() => compileKernel(wrongKernel)),
    missing_bpi1_rejected: missingImageRejected,
    unrelated_pair_validated: unrelatedValid,
    unrelated_completion_rejected: unrelatedCompletionRejected,
    mutated_response_rejected: mutatedResponseRejected,
    source_smuggling_rejected: sourceSmugglingRejected,
    application_specific_wasm_smuggling_rejected: applicationWasmSmugglingRejected,
    untracked_path_detected: untrackedPathDetected,
    sandbox_agent_source_read_rejected: sandboxDenials.agent_source,
    sandbox_application_wasm_read_rejected: sandboxDenials.application_wasm
  });
  if (Object.values(result).some((value) => value !== true)) throw new Error(`negative_gate_failed:${JSON.stringify(result)}`);
  return result;
}

function decodeInterpretedResult(value) {
  return Object.freeze({
    ...value,
    maximumFuelPerStep: BigInt(value.maximumFuelPerStep),
    trace: Object.freeze(value.trace.map((entry) => Object.freeze({
      ...entry,
      state: Buffer.from(entry.state, "base64"),
      identity: Buffer.from(entry.identity, "base64"),
      payload: Buffer.from(entry.payload, "base64"),
      response: Buffer.from(entry.response, "base64")
    }))),
    yieldBoundaries: Object.freeze(value.yieldBoundaries.map((entry) => Object.freeze({
      transitionIndex: entry.transitionIndex,
      state: Buffer.from(entry.state, "base64")
    }))),
    terminalResultBytes: Buffer.from(value.terminalResultBytes, "base64"),
    finalSourceBytes: Buffer.from(value.finalSourceBytes, "base64")
  });
}

async function initializeGit(cwd) {
  await git(cwd, ["init", "--quiet"]);
  await git(cwd, ["config", "user.name", "Agent Interpretation Fixture"]);
  await git(cwd, ["config", "user.email", "interpretation@example.invalid"]);
  await git(cwd, ["add", "--", "README.md", "package.json", "src/range.mjs", "test/range.test.mjs"]);
  await git(cwd, ["commit", "--quiet", "-m", "fixture baseline"]);
}

async function inspectFinalGit(cwd) {
  const changedPaths = await listChangedPaths(cwd);
  await git(cwd, ["add", "-A"]);
  return Object.freeze({ tree: await git(cwd, ["write-tree"]), changedPaths });
}

async function listChangedPaths(cwd) {
  const [tracked, untracked] = await Promise.all([
    git(cwd, ["diff", "--name-only", "HEAD"]),
    git(cwd, ["ls-files", "--others", "--exclude-standard"])
  ]);
  return [...new Set([...tracked.split("\n"), ...untracked.split("\n")].filter(Boolean))]
    .sort();
}

function assertRepositoryResult(gitResult, specialized, interpreted) {
  if (JSON.stringify(gitResult.changedPaths) !== JSON.stringify(["src/range.mjs"]) ||
      specialized.context.mutationsApplied !== 1 || interpreted.context.mutationsApplied !== 1 ||
      specialized.context.lastTestPassed !== true || interpreted.context.lastTestPassed !== true ||
      !specialized.hiddenVerifierPassed || !interpreted.hiddenVerifierPassed) {
    throw new Error(`repository_result_invalid:${JSON.stringify({
      changedPaths: gitResult.changedPaths,
      specializedMutations: specialized.context.mutationsApplied,
      interpretedMutations: interpreted.context.mutationsApplied,
      specializedPassed: specialized.context.lastTestPassed,
      interpretedPassed: interpreted.context.lastTestPassed,
      specializedHidden: specialized.hiddenVerifierPassed,
      interpretedHidden: interpreted.hiddenVerifierPassed
    })}`);
  }
}

async function recursiveFiles(root) {
  const result = [];
  async function walk(directory) {
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const full = join(directory, entry.name);
      if (entry.isDirectory()) await walk(full);
      else if (entry.isFile()) result.push(relative(root, full));
      else throw new Error(`clean_room_non_regular:${relative(root, full)}`);
    }
  }
  await walk(root);
  return result;
}

async function git(cwd, argv) {
  const child = Bun.spawn(["git", ...argv], { cwd, stdout: "pipe", stderr: "pipe", env: { PATH: process.env.PATH } });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited
  ]);
  if (exitCode !== 0) throw new Error(`git_failed:${argv.join(":")}:${stderr.trim()}`);
  return stdout.trim();
}

function sha256(bytes) { return createHash("sha256").update(bytes).digest("hex"); }

function firstDifference(left, right) {
  const limit = Math.min(left.length, right.length);
  for (let index = 0; index < limit; index += 1) if (left[index] !== right[index]) return index;
  return limit;
}

function processResponseDifference(left, right) {
  const decode = (bytes) => {
    let cursor = 5;
    const text = () => {
      const length = bytes.readUInt32LE(cursor);
      cursor += 4;
      const value = bytes.subarray(cursor, cursor + length).toString();
      cursor += length;
      return value;
    };
    return { stdout: text(), stderr: text() };
  };
  const a = decode(left);
  const b = decode(right);
  for (const field of ["stdout", "stderr"]) {
    if (a[field] === b[field]) continue;
    const offset = firstDifference(Buffer.from(a[field]), Buffer.from(b[field]));
    return `${field}:${a[field].length}:${b[field].length}:offset=${offset}:` +
      `left=${JSON.stringify(a[field].slice(Math.max(0, offset - 60), offset + 120))}:` +
      `right=${JSON.stringify(b[field].slice(Math.max(0, offset - 60), offset + 120))}`;
  }
  return "process-fields-equal";
}

function parseArguments(argv) {
  const result = { keepTemporary: false };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--keep-temporary") result.keepTemporary = true;
    else if (argument.startsWith("--") && index + 1 < argv.length) {
      result[argument.slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())] = argv[index += 1];
    } else throw new Error(`unknown_argument:${argument}`);
  }
  for (const key of [
    "agentRoot", "artifactRoot", "applicationWasm", "kernelWasm", "unrelatedBpi1",
    "unrelatedMv2p1", "fixtureRoot", "worldHostRoot", "capabilitiesRoot",
    "interpretationToolsRoot", "environmentModule", "receiptOutput"
  ]) {
    if (typeof result[key] !== "string") throw new Error(`missing_argument:${key}`);
    result[key] = resolve(result[key]);
  }
  result.bunExecutable = resolve(result.bunExecutable ?? process.execPath);
  result.kernelSha256 = "12973fb655f126c2acd5693a84be47496649d1ab10bf22d565c9b675172e4f27";
  return result;
}

if (import.meta.main) {
  const receipt = await proveAgentInterpretation(parseArguments(process.argv.slice(2)));
  process.stdout.write(`${JSON.stringify(receipt, null, 2)}\n`);
}
