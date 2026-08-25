#!/usr/bin/env bun
import { createHash } from "node:crypto";
import { existsSync, lstatSync, readlinkSync, realpathSync, statSync } from "node:fs";
import { chmod, cp, mkdir, mkdtemp, readFile, readdir, realpath, rename, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";

import { runSpecialized } from "./specialized.mjs";
import { readBpi1EffectCatalog } from "./bpi1_effects.mjs";
import { compileKernel, encodeResumeAuxiliary, executeKernelCommand } from "./kernel_client.mjs";
import { runtimeDependencyDigest } from "./dependency_digest.mjs";
import { readRuntimeDependencyLock } from "./runtime_dependency_lock.mjs";
const FIXED_KERNEL_RELEASE_VERSION = "1.6.0";
const WORLD_HOST_INTERPRETED_RUNTIME_PATHS = Object.freeze([
  "src/v1/errors.mjs",
  "src/v1/protocol.mjs"
]);

const GENERIC_FILES = Object.freeze([
  "drive.mjs",
  "kernel_client.mjs",
  "bpi1_effects.mjs",
  "effect_resolver.mjs",
  "proof_limits.mjs"
]);
const PROOF_SUPPORT_FILES = Object.freeze(["runtime_dependency_lock.mjs"]);
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
  "read_file", "search_text", "run_tests", "replace_file", "final admission",
  "repositoryRepair", "repository_repair", "repository-repair",
  "src/v1/index.mjs", "RunController", "run_controller",
  "ApplicationWorker", "application_worker"
]);

export async function proveAgentInterpretation(options) {
  const sourceBinding = await bindAgentSource(
    options.agentRoot,
    options.agentSourceHead,
    options.agentSourceArchiveSha256
  );
  const temporaryRoot = await mkdtemp(join(tmpdir(), "agent-interpretation-v1-"));
  try {
    await verifyArtifactSidecars(options);
    const inputBinding = await bindProofInputs(options);
    const dependencyBindings = await bindRuntimeDependencies(options);
    const snapshotOptions = await snapshotProofInputs(
      temporaryRoot,
      options,
      dependencyBindings
    );
    if (await bindProofInputs(snapshotOptions) !== inputBinding) {
      throw new Error("proof_inputs_changed_during_snapshot");
    }
    await verifyRuntimeDependenciesUnchanged(snapshotOptions, dependencyBindings);
    const specializedRoot = join(temporaryRoot, "specialized-workspace");
    const runtimeRoot = join(temporaryRoot, "clean-room");
    const interpretedRoot = join(runtimeRoot, "workspace");
    await mkdir(runtimeRoot);
    await cp(snapshotOptions.fixtureRoot, specializedRoot, { recursive: true, errorOnExist: true });
    await cp(snapshotOptions.fixtureRoot, interpretedRoot, { recursive: true, errorOnExist: true });
    await Promise.all([initializeGit(specializedRoot), initializeGit(interpretedRoot)]);
    const initialSpecializedTree = await git(specializedRoot, ["rev-parse", "HEAD^{tree}"]);
    const initialInterpretedTree = await git(interpretedRoot, ["rev-parse", "HEAD^{tree}"]);
    if (initialSpecializedTree !== initialInterpretedTree) throw new Error("initial_git_tree_mismatch");
    const specializedHome = join(temporaryRoot, "specialized-home");
    const interpretedHome = join(runtimeRoot, "home");
    await Promise.all([mkdir(specializedHome), mkdir(interpretedHome)]);

    const specialized = await runSpecialized({
      worldHostRoot: snapshotOptions.worldHostRoot,
      capabilitiesRoot: snapshotOptions.capabilitiesRoot,
      environmentModule: snapshotOptions.environmentModule,
      applicationWasm: snapshotOptions.applicationWasm,
      artifactRoot: snapshotOptions.artifactRoot,
      workspaceRoot: specializedRoot,
      temporaryHome: specializedHome,
      bunExecutable: options.bunExecutable
    });

    const runtime = await prepareCleanRoom(
      runtimeRoot,
      interpretedRoot,
      snapshotOptions,
      dependencyBindings
    );
    const admittedCanary = join(runtimeRoot, "sandbox-admitted-canary");
    await writeFile(admittedCanary, "sandbox admitted\n", { flag: "wx" });
    const cleanInventory = await assertCleanRoom(runtimeRoot, runtime);
    const interpretedOutput = join(runtimeRoot, "interpreted-result.json");
    const sandboxProfile = process.platform === "darwin"
      ? await cleanRoomSandboxProfile(options, runtimeRoot)
      : "";
    const sandboxEnvironment = {
      HOME: interpretedHome,
      TMPDIR: interpretedHome,
      PATH: dirname(options.bunExecutable),
      NO_COLOR: "1",
      LC_ALL: "C"
    };
    const outsideCanary = join(temporaryRoot, "outside-clean-room-canary");
    await writeFile(outsideCanary, "outside clean room\n", { flag: "wx" });
    const sandboxDenials = await proveSandboxReadDenials(
      options,
      sandboxProfile,
      sandboxEnvironment,
      runtimeRoot,
      admittedCanary,
      outsideCanary
    );
    const child = Bun.spawn(sandboxInvocation(options, sandboxProfile, runtimeRoot, [
      options.bunExecutable, runtime.drive,
      "--bpi1", join(runtime.artifacts, "repository-repair.agent.bpi1"),
      "--mv2p1", join(runtime.artifacts, "repository-repair.agent.mv2p1"),
      "--initial-args", join(runtime.artifacts, "repository-repair.initial-args.bin"),
      "--decision-contract", join(runtime.artifacts, "repository-repair.decision-contract.bin"),
      "--manifest", join(runtime.artifacts, "repository-repair-actuality.manifest.bin"),
      "--kernel", join(runtime.artifacts, "boundary-machine-v2-kernel-v1.wasm"),
      "--world-host-root", runtime.worldHostRoot,
      "--capabilities-root", runtime.capabilitiesRoot,
      "--environment-module", runtime.environment,
      "--workspace-root", interpretedRoot,
      "--temporary-home", interpretedHome,
      "--bun-executable", options.bunExecutable,
      "--output", interpretedOutput
    ]), {
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
    await assertPostExecutionInventory(
      runtimeRoot,
      runtime,
      cleanInventory,
      interpretedOutput
    );
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
      snapshotOptions,
      interpreted,
      runtimeRoot,
      runtime,
      sandboxDenials,
      inputBinding
    );
    const bpi1 = await readFile(join(snapshotOptions.artifactRoot, "repository-repair.agent.bpi1"));
    const mv2p1 = await readFile(join(snapshotOptions.artifactRoot, "repository-repair.agent.mv2p1"));
    const contract = await readFile(join(snapshotOptions.artifactRoot, "repository-repair.decision-contract.bin"));
    const unrelatedBpi1 = await readFile(snapshotOptions.unrelatedBpi1);
    const unrelatedMv2p1 = await readFile(snapshotOptions.unrelatedMv2p1);
    const receipt = {
      format: "agent-interpretation-v1",
      agent_commit: sourceBinding.head,
      agent_source_archive_sha256: sourceBinding.sourceArchiveSha256,
      agent_version: sourceBinding.version,
      boundary_version: FIXED_KERNEL_RELEASE_VERSION,
      boundary_compiler_version: sourceBinding.boundaryVersion,
      boundary_source_commit: sourceBinding.boundarySourceCommit,
      boundary_package_hash: sourceBinding.boundaryPackageHash,
      world_version: sourceBinding.worldVersion,
      world_source_commit: sourceBinding.worldSourceCommit,
      world_package_hash: sourceBinding.worldPackageHash,
      kernel_wasm_sha256: options.kernelSha256,
      kernel_import_count: 0,
      world_host_runtime_sha256: dependencyBindings.worldHost.sha256,
      world_capabilities_runtime_sha256: dependencyBindings.worldCapabilities.sha256,
      bpi1_sha256: sha256(bpi1),
      mv2p1_sha256: sha256(mv2p1),
      unrelated_bpi1_sha256: sha256(unrelatedBpi1),
      unrelated_mv2p1_sha256: sha256(unrelatedMv2p1),
      program_transition_digest: bpi1.subarray(32, 64).toString("hex"),
      machine_v2_contract_digest: mv2p1.subarray(96, 128).toString("hex"),
      application_id: interpreted.applicationId,
      decision_contract_digest: contract.subarray(-32).toString("hex"),
      effect_count: interpreted.effectCount,
      effect_catalog_count: interpreted.effectCatalogCount,
      observed_effect_identity_count: new Set(
        interpreted.trace.map((entry) => entry.effectIdentity)
      ).size,
      model_decision_count: interpreted.trace.filter((entry) => entry.effectIdentity === "model.decide.v1").length,
      repository_effect_count: interpreted.trace.filter((entry) => entry.effectIdentity !== "model.decide.v1").length,
      yield_boundary_count: interpreted.yieldBoundaries.length,
      state_comparison_count: interpreted.trace.length,
      interface_identity_comparison_count: interpreted.trace.length,
      payload_comparison_count: interpreted.trace.length,
      request_identity_comparison_count: interpreted.trace.length,
      response_comparison_count: interpreted.trace.length,
      specialized_file_read_count: specialized.context.fileReads,
      interpreted_file_read_count: interpreted.context.fileReads,
      specialized_search_count: specialized.context.searches,
      interpreted_search_count: interpreted.context.searches,
      specialized_test_run_count: specialized.context.testRuns,
      interpreted_test_run_count: interpreted.context.testRuns,
      specialized_pre_mutation_test_failed: specialized.context.preMutationTestFailed,
      interpreted_pre_mutation_test_failed: interpreted.context.preMutationTestFailed,
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
    await assertAgentSourceUnchanged(options.agentRoot, sourceBinding);
    await verifyArtifactSidecars(options);
    if (await bindProofInputs(options) !== inputBinding) {
      throw new Error("proof_inputs_changed_during_execution");
    }
    await verifyRuntimeDependenciesUnchanged(options, dependencyBindings);
    await writeFile(options.receiptOutput, `${JSON.stringify(receipt, null, 2)}\n`);
    return receipt;
  } finally {
    if (!options.keepTemporary) {
      await makeTreeWritable(temporaryRoot);
      await rm(temporaryRoot, { recursive: true, force: true });
    }
    else process.stderr.write(`temporary_root=${temporaryRoot}\n`);
  }
}

async function makeTreeWritable(root) {
  await chmod(root, 0o700);
  const entries = await readdir(root, { withFileTypes: true });
  for (const entry of entries) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) await makeTreeWritable(path);
    else if (entry.isFile()) await chmod(path, 0o600);
  }
}

async function bindAgentSource(agentRoot, expectedHead, expectedArchiveSha256) {
  if (!existsSync(join(agentRoot, ".git"))) {
    if (!/^[0-9a-f]{40}$/.test(expectedHead ?? "") ||
        !/^[0-9a-f]{64}$/.test(expectedArchiveSha256 ?? "")) {
      throw new Error("agent_source_snapshot_binding_missing");
    }
    return Object.freeze({
      head: expectedHead,
      sourceArchiveSha256: expectedArchiveSha256,
      sourceTreeDigest: await digestAgentSourceTree(agentRoot),
      ...await bindAgentIdentity(agentRoot)
    });
  }
  const headBefore = await git(agentRoot, ["rev-parse", "HEAD"]);
  const identity = await bindAgentIdentity(agentRoot);
  const child = Bun.spawn([
    "git",
    "status",
    "--porcelain=v1",
    "--untracked-files=all"
  ], { cwd: agentRoot, stdout: "pipe", stderr: "pipe", env: { PATH: process.env.PATH } });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited
  ]);
  if (exitCode !== 0) throw new Error(`agent_source_status_failed:${stderr.trim()}`);
  const unexpected = stdout.split("\n").filter(Boolean).map((line) => {
    const path = line.slice(3);
    return path.includes(" -> ") ? path.split(" -> ").at(-1) : path;
  }).filter((path) => !path.startsWith("zig-out/"));
  if (unexpected.length !== 0) {
    throw new Error(`agent_source_dirty:${unexpected.join(",")}`);
  }
  const headAfter = await git(agentRoot, ["rev-parse", "HEAD"]);
  if (headBefore !== headAfter) throw new Error("agent_source_head_changed_during_binding");
  return Object.freeze({
    head: headAfter,
    sourceArchiveSha256: null,
    sourceTreeDigest: null,
    ...identity
  });
}

async function assertAgentSourceUnchanged(agentRoot, expected) {
  const current = await bindAgentSource(
    agentRoot,
    expected.head,
    expected.sourceArchiveSha256
  );
  if (JSON.stringify(current) !== JSON.stringify(expected)) {
    throw new Error(`agent_source_binding_changed:${JSON.stringify(expected)}:${JSON.stringify(current)}`);
  }
}

async function digestAgentSourceTree(agentRoot) {
  const files = await recursiveFiles(
    agentRoot,
    new Set([".zig-cache", "zig-out", "zig-pkg"])
  );
  const hasher = createHash("sha256");
  hasher.update("agent-source-snapshot-tree-v1\0");
  for (const path of files) {
    const encoded = Buffer.from(path, "utf8");
    const bytes = await readFile(join(agentRoot, path));
    const lengths = Buffer.alloc(8);
    lengths.writeUInt32LE(encoded.length, 0);
    lengths.writeUInt32LE(bytes.length, 4);
    hasher.update(lengths);
    hasher.update(encoded);
    hasher.update(bytes);
  }
  return hasher.digest("hex");
}

async function bindAgentIdentity(agentRoot) {
  const [packageSource, manifestSource] = await Promise.all([
    readFile(join(agentRoot, "build.zig.zon"), "utf8"),
    readFile(join(agentRoot, "src/manifest.zig"), "utf8")
  ]);
  const packageVersion = packageSource.match(/^\s*\.version = "([^"]+)",$/m)?.[1];
  const manifestVersion = manifestSource.match(
    /^pub const package_version = "([^"]+)";$/m
  )?.[1];
  if (!/^\d+\.\d+\.\d+$/.test(packageVersion ?? "") || packageVersion !== manifestVersion) {
    throw new Error(`agent_version_binding_invalid:${packageVersion}:${manifestVersion}`);
  }
  const boundary = packageSource.match(
    /\.boundary = \.\{\s*\.url = "https:\/\/github\.com\/tkersey\/boundary\/archive\/([0-9a-f]{40})\.tar\.gz",\s*\.hash = "(boundary-(\d+\.\d+\.\d+)-[^"]+)",\s*\}/s
  );
  if (boundary === null) throw new Error("boundary_dependency_binding_invalid");
  const world = packageSource.match(
    /\.world = \.\{\s*\.url = "https:\/\/github\.com\/tkersey\/world\/archive\/([0-9a-f]{40})\.tar\.gz",\s*\.hash = "(world-(\d+\.\d+\.\d+)-[^"]+)",\s*\}/s
  );
  if (world === null) throw new Error("world_dependency_binding_invalid");
  return Object.freeze({
    version: packageVersion,
    boundarySourceCommit: boundary[1],
    boundaryPackageHash: boundary[2],
    boundaryVersion: boundary[3],
    worldSourceCommit: world[1],
    worldPackageHash: world[2],
    worldVersion: world[3]
  });
}

async function proveSandboxReadDenials(
  options,
  sandboxProfile,
  environment,
  runtimeRoot,
  admittedCanary,
  outsideCanary
) {
  const positive = await runSandboxProbe(
    options,
    sandboxProfile,
    environment,
    runtimeRoot,
    `const value = await Bun.file(${JSON.stringify(resolve(admittedCanary))}).text();` +
    `if (value !== "sandbox admitted\\n") process.exit(24);` +
    `process.stdout.write("SANDBOX_READ_OK\\n");`
  );
  if (positive.exitCode !== 0 || !positive.stdout.includes("SANDBOX_READ_OK")) {
    throw new Error(`clean_room_sandbox_positive_control_failed:${positive.exitCode}:${positive.stderr.trim()}`);
  }
  const denied = {};
  const probes = [
    ["agent_source", join(options.agentRoot, "build.zig")],
    ["application_wasm", options.applicationWasm],
    ["world_host_source", join(options.worldHostRoot, "src/v1/index.mjs")],
    ["world_capabilities_source", join(
      options.capabilitiesRoot,
      "src/v1/actuality/repository_repair_codecs.mjs"
    )],
    ["outside_clean_room", outsideCanary]
  ];
  if (process.platform === "linux") {
    probes.push(["host_proc_root", `/proc/${process.pid}/root${resolve(outsideCanary)}`]);
  }
  for (const [name, path] of probes) {
    const result = await runSandboxProbe(
      options,
      sandboxProfile,
      environment,
      runtimeRoot,
      `try { await Bun.file(${JSON.stringify(resolve(path))}).arrayBuffer();` +
      `process.stdout.write("SANDBOX_READ_ALLOWED\\n"); } catch {` +
      `process.stderr.write("SANDBOX_READ_DENIED\\n"); process.exit(23); }`
    );
    denied[name] = result.exitCode === 23 && result.stderr.includes("SANDBOX_READ_DENIED");
  }
  denied.network = await proveSandboxNetworkDenial(
    options,
    sandboxProfile,
    environment,
    runtimeRoot
  );
  if (Object.values(denied).some((value) => value !== true)) {
    throw new Error(`clean_room_sandbox_read_allowed:${JSON.stringify(denied)}`);
  }
  return Object.freeze({ ...denied, positive_control: true });
}

async function runSandboxProbe(options, profile, environment, runtimeRoot, script) {
  const child = Bun.spawn(sandboxInvocation(options, profile, runtimeRoot, [
    options.bunExecutable,
    "--eval",
    script
  ]), {
    cwd: runtimeRoot,
    stdout: "pipe",
    stderr: "pipe",
    env: environment
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited
  ]);
  return Object.freeze({ stdout, stderr, exitCode });
}

async function proveSandboxNetworkDenial(options, profile, environment, runtimeRoot) {
  const server = createServer((socket) => {
    socket.end("HTTP/1.1 200 OK\r\nContent-Length: 2\r\nConnection: close\r\n\r\nok");
  });
  await new Promise((resolveListen, rejectListen) => {
    server.once("error", rejectListen);
    server.listen(0, "127.0.0.1", resolveListen);
  });
  try {
    const address = server.address();
    if (address === null || typeof address === "string") throw new Error("sandbox_network_server_address");
    const result = await runSandboxProbe(
      options,
      profile,
      environment,
      runtimeRoot,
      `try { await fetch("http://127.0.0.1:${address.port}");` +
      `process.stdout.write("SANDBOX_NETWORK_ALLOWED\\n"); } catch {` +
      `process.stderr.write("SANDBOX_NETWORK_DENIED\\n"); process.exit(23); }`
    );
    return result.exitCode === 23 && result.stderr.includes("SANDBOX_NETWORK_DENIED");
  } finally {
    await new Promise((resolveClose, rejectClose) => {
      server.close((error) => error ? rejectClose(error) : resolveClose());
    });
  }
}

function sandboxInvocation(options, profile, runtimeRoot, argv) {
  if (process.platform === "darwin") {
    return ["/usr/bin/sandbox-exec", "-p", profile, ...argv];
  }
  if (process.platform === "linux") {
    const bubblewrap = linuxBubblewrapExecutable();
    const systemLinkCandidates = ["/bin", "/sbin", "/lib", "/lib64"]
      .filter(existsSync);
    const systemSymlinks = systemLinkCandidates
      .filter((path) => lstatSync(path).isSymbolicLink())
      .map((path) => Object.freeze({ destination: path, target: readlinkSync(path) }));
    const systemDirectories = [
      "/usr",
      ...systemLinkCandidates.filter((path) => !lstatSync(path).isSymbolicLink()),
      "/nix/store",
      "/run/current-system/sw",
      "/etc/ssl/certs"
    ].filter(existsSync);
    const systemFiles = [
      "/etc/group",
      "/etc/ld.so.cache",
      "/etc/localtime",
      "/etc/nsswitch.conf",
      "/etc/passwd"
    ].filter(existsSync);
    const bunPaths = [realpathSync(options.bunExecutable)].filter((path) =>
      !systemDirectories.some((root) =>
      path === root || path.startsWith(`${root}/`)));
    const mountDirectories = bubblewrapMountDirectories(
      [...systemDirectories, resolve(runtimeRoot)],
      [...systemFiles, ...bunPaths]
    );
    return [
      bubblewrap,
      "--die-with-parent",
      "--new-session",
      "--unshare-net",
      "--unshare-pid",
      ...mountDirectories.flatMap((path) => ["--dir", path]),
      ...systemDirectories.flatMap((path) => ["--ro-bind", path, path]),
      ...systemSymlinks.flatMap(({ target, destination }) => [
        "--symlink", target, destination
      ]),
      ...systemFiles.flatMap((path) => ["--ro-bind", path, path]),
      ...bunPaths.flatMap((path) => ["--ro-bind", path, path]),
      "--bind", resolve(runtimeRoot), resolve(runtimeRoot),
      "--dev", "/dev",
      "--proc", "/proc",
      ...argv
    ];
  }
  throw new Error(`clean_room_platform_unsupported:${process.platform}`);
}

function linuxBubblewrapExecutable() {
  const discovered = Bun.which("bwrap");
  if (discovered === null) throw new Error("linux_clean_room_requires_bwrap");
  const executable = realpathSync(discovered);
  const metadata = statSync(executable);
  if (!metadata.isFile() || metadata.uid !== 0 || (metadata.mode & 0o022) !== 0) {
    throw new Error(`linux_bwrap_not_trusted:${executable}`);
  }
  return executable;
}

function bubblewrapMountDirectories(directoryPaths, filePaths) {
  const directories = new Set();
  for (const seed of [...directoryPaths, ...filePaths.map(dirname)]) {
    let current = seed;
    while (current !== "/") {
      directories.add(current);
      current = dirname(current);
    }
  }
  return [...directories].sort((left, right) =>
    left.split("/").length - right.split("/").length || left.localeCompare(right));
}

async function cleanRoomSandboxProfile(options, runtimeRoot) {
  const bunExecutableReal = await realpath(options.bunExecutable);
  const declaredReadable = [
    "/System",
    "/usr",
    "/bin",
    "/sbin",
    "/dev",
    "/private/etc",
    "/private/var/db/timezone",
    dirname(options.bunExecutable),
    dirname(bunExecutableReal),
    runtimeRoot
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
  const lock = readRuntimeDependencyLock(options.runtimeLock);
  const worldHost = await runtimeDependencyDigest(
    options.worldHostRoot,
    lock.worldHost.runtimePaths
  );
  const worldCapabilities = await runtimeDependencyDigest(
    options.capabilitiesRoot,
    lock.worldCapabilities.runtimePaths
  );
  if (worldHost.sha256 !== lock.worldHost.runtimeSha256 ||
      worldCapabilities.sha256 !== lock.worldCapabilities.runtimeSha256) {
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

async function bindProofInputs(options) {
  const entries = [];
  const add = (label, path) => entries.push(Object.freeze({ label, path }));
  for (const name of ARTIFACT_FILES) {
    add(
      `artifact/${name}`,
      name === "boundary-machine-v2-kernel-v1.wasm"
        ? options.kernelWasm
        : join(options.artifactRoot, name)
    );
  }
  add("application-wasm", options.applicationWasm);
  add("unrelated-bpi1", options.unrelatedBpi1);
  add("unrelated-mv2p1", options.unrelatedMv2p1);
  add("environment-module", options.environmentModule);
  add("runtime-dependency-lock", options.runtimeLock);
  for (const name of [...GENERIC_FILES, ...PROOF_SUPPORT_FILES]) {
    add(`interpretation-tool/${name}`, join(options.interpretationToolsRoot, name));
  }
  for (const relativePath of await recursiveFiles(options.fixtureRoot)) {
    add(`fixture/${relativePath}`, join(options.fixtureRoot, relativePath));
  }
  entries.sort((left, right) => Buffer.compare(Buffer.from(left.label), Buffer.from(right.label)));
  const hasher = createHash("sha256");
  hasher.update("agent-interpretation-proof-inputs-v1\0");
  for (const entry of entries) {
    const [label, bytes] = await Promise.all([
      Promise.resolve(Buffer.from(entry.label, "utf8")),
      readFile(entry.path)
    ]);
    const lengths = Buffer.alloc(8);
    lengths.writeUInt32LE(label.length, 0);
    lengths.writeUInt32LE(bytes.length, 4);
    hasher.update(lengths);
    hasher.update(label);
    hasher.update(bytes);
  }
  return hasher.digest("hex");
}

async function snapshotProofInputs(temporaryRoot, options, dependencyBindings) {
  const root = join(temporaryRoot, "proof-inputs");
  const artifacts = join(root, "artifacts");
  const tools = join(root, "interpretation-tools");
  const fixture = join(root, "fixture");
  const dependencies = join(root, "dependencies");
  const worldHostRoot = join(dependencies, "world-host");
  const capabilitiesRoot = join(dependencies, "world-capabilities");
  await Promise.all([
    mkdir(artifacts, { recursive: true }),
    mkdir(tools, { recursive: true }),
    mkdir(dependencies, { recursive: true })
  ]);
  for (const name of ARTIFACT_FILES) {
    const source = name === "boundary-machine-v2-kernel-v1.wasm"
      ? options.kernelWasm
      : join(options.artifactRoot, name);
    await cp(source, join(artifacts, name), { errorOnExist: true });
  }
  for (const name of [...GENERIC_FILES, ...PROOF_SUPPORT_FILES]) {
    await cp(join(options.interpretationToolsRoot, name), join(tools, name), { errorOnExist: true });
  }
  const environmentModule = join(tools, "environment.mjs");
  const applicationWasm = join(root, "repository-repair-actuality.world.wasm");
  const unrelatedBpi1 = join(root, "unrelated.bpi1");
  const unrelatedMv2p1 = join(root, "unrelated.mv2p1");
  const runtimeLock = join(root, "runtime-dependencies.lock.json");
  await Promise.all([
    cp(options.fixtureRoot, fixture, { recursive: true, errorOnExist: true }),
    cp(options.environmentModule, environmentModule, { errorOnExist: true }),
    cp(options.applicationWasm, applicationWasm, { errorOnExist: true }),
    cp(options.unrelatedBpi1, unrelatedBpi1, { errorOnExist: true }),
    cp(options.unrelatedMv2p1, unrelatedMv2p1, { errorOnExist: true }),
    cp(options.runtimeLock, runtimeLock, { errorOnExist: true }),
    copyRuntimeDependency(
      options.worldHostRoot,
      worldHostRoot,
      dependencyBindings.worldHost.files
    ),
    copyRuntimeDependency(
      options.capabilitiesRoot,
      capabilitiesRoot,
      dependencyBindings.worldCapabilities.files
    )
  ]);
  return Object.freeze({
    ...options,
    artifactRoot: artifacts,
    applicationWasm,
    kernelWasm: join(artifacts, "boundary-machine-v2-kernel-v1.wasm"),
    unrelatedBpi1,
    unrelatedMv2p1,
    runtimeLock,
    fixtureRoot: fixture,
    interpretationToolsRoot: tools,
    environmentModule,
    worldHostRoot,
    capabilitiesRoot
  });
}

async function prepareCleanRoom(
  runtimeRoot,
  interpretedRoot,
  options,
  dependencyBindings
) {
  const artifacts = join(runtimeRoot, "artifacts");
  const runner = join(runtimeRoot, "runner");
  const dependencies = join(runtimeRoot, "dependencies");
  const worldHostRoot = join(dependencies, "world-host");
  const capabilitiesRoot = join(dependencies, "world-capabilities");
  await Promise.all([mkdir(artifacts), mkdir(runner), mkdir(dependencies)]);
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
  await Promise.all([
    copyRuntimeDependency(
      options.worldHostRoot,
      worldHostRoot,
      WORLD_HOST_INTERPRETED_RUNTIME_PATHS
    ),
    copyRuntimeDependency(
      options.capabilitiesRoot,
      capabilitiesRoot,
      dependencyBindings.worldCapabilities.files
    )
  ]);
  return Object.freeze({
    artifacts,
    runner,
    drive: join(runner, "drive.mjs"),
    environment,
    interpretedRoot,
    worldHostRoot,
    capabilitiesRoot
  });
}

async function copyRuntimeDependency(sourceRoot, destinationRoot, files) {
  for (const relativePath of files) {
    const destination = join(destinationRoot, relativePath);
    await mkdir(dirname(destination), { recursive: true });
    await cp(join(sourceRoot, relativePath), destination, { errorOnExist: true });
  }
}

async function assertCleanRoom(runtimeRoot, runtime) {
  const inventory = await recursiveFiles(runtimeRoot);
  for (const forbidden of [
    "dependencies/world-host/src/v1/index.mjs",
    "dependencies/world-host/src/v1/run_controller.mjs",
    "dependencies/world-host/src/v1/application_worker.mjs"
  ]) {
    if (inventory.includes(forbidden)) throw new Error(`clean_room_provider_loop_file:${forbidden}`);
  }
  for (const path of inventory) {
    if (path.endsWith(".zig") ||
        (path.endsWith(".wasm") &&
          path !== "artifacts/boundary-machine-v2-kernel-v1.wasm")) {
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

async function assertPostExecutionInventory(
  runtimeRoot,
  runtime,
  initialInventory,
  interpretedOutput
) {
  const finalInventory = await assertCleanRoom(runtimeRoot, runtime);
  const initial = new Set(initialInventory);
  const admittedOutput = relative(runtimeRoot, interpretedOutput);
  const unexpected = finalInventory.filter((path) =>
    !initial.has(path) &&
    path !== admittedOutput &&
    !path.startsWith("workspace/.git/objects/") &&
    !(path.startsWith("home/Library/Caches/bun/") && path.endsWith(".pile")));
  if (unexpected.length !== 0) {
    throw new Error(`clean_room_post_inventory:${unexpected.join(",")}`);
  }
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
  const byteFields = ["state", "identity", "interfaceId", "payload", "response"];
  for (let index = 0; index < specialized.trace.length; index += 1) {
    const left = specialized.trace[index];
    const right = interpreted.trace[index];
    if (left.frameStatus !== specialized.needsEffectFrameStatus) {
      throw new Error(`specialized_frame_status_mismatch:${index}:${left.frameStatus}`);
    }
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
  sandboxDenials,
  inputBinding
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
  const corruptedRoutingMagic = Buffer.from(bpi1);
  for (let index = 0; index < 8; index += 1) corruptedRoutingMagic[index] |= 0x80;
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
  const driveSource = await readFile(runtime.drive, "utf8");
  const providerLoopImportSmugglingRejected = await rejects(async () => {
    await writeFile(runtime.drive, `${driveSource}\n// src/v1/index.mjs\n`);
    try { await assertCleanRoom(runtimeRoot, runtime); } finally {
      await writeFile(runtime.drive, driveSource);
    }
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
  const unrelatedOriginal = await readFile(options.unrelatedBpi1);
  const unrelatedMutated = Buffer.from(unrelatedOriginal);
  unrelatedMutated[unrelatedMutated.length - 1] ^= 1;
  let proofInputMutationDetected = false;
  try {
    await writeFile(options.unrelatedBpi1, unrelatedMutated);
    proofInputMutationDetected = await bindProofInputs(options) !== inputBinding;
  } finally {
    await writeFile(options.unrelatedBpi1, unrelatedOriginal);
  }
  const result = Object.freeze({
    corrupted_bpi1_rejected: await rejects(() => executeKernelCommand({ kernel, bpi1: corruptedImage, mv2p1, command: 0 })),
    corrupted_bpi1_routing_magic_rejected: await rejects(async () => {
      readBpi1EffectCatalog(corruptedRoutingMagic);
    }),
    corrupted_mv2p1_rejected: await rejects(() => executeKernelCommand({ kernel, bpi1, mv2p1: corruptedProfile, command: 0 })),
    wrong_kernel_rejected: await rejects(() => compileKernel(wrongKernel)),
    missing_bpi1_rejected: missingImageRejected,
    unrelated_pair_validated: unrelatedValid,
    unrelated_completion_rejected: unrelatedCompletionRejected,
    mutated_response_rejected: mutatedResponseRejected,
    source_smuggling_rejected: sourceSmugglingRejected,
    provider_loop_import_smuggling_rejected: providerLoopImportSmugglingRejected,
    application_specific_wasm_smuggling_rejected: applicationWasmSmugglingRejected,
    untracked_path_detected: untrackedPathDetected,
    sandbox_agent_source_read_rejected: sandboxDenials.agent_source,
    sandbox_application_wasm_read_rejected: sandboxDenials.application_wasm,
    sandbox_world_host_source_read_rejected: sandboxDenials.world_host_source,
    sandbox_world_capabilities_source_read_rejected: sandboxDenials.world_capabilities_source,
    sandbox_outside_clean_room_read_rejected: sandboxDenials.outside_clean_room,
    sandbox_positive_control_passed: sandboxDenials.positive_control,
    sandbox_network_read_rejected: sandboxDenials.network,
    ...(process.platform === "linux"
      ? { sandbox_host_proc_root_read_rejected: sandboxDenials.host_proc_root }
      : {}),
    proof_input_mutation_detected: proofInputMutationDetected
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
      interfaceId: Buffer.from(entry.interfaceId, "base64"),
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
      !requiredRepositoryObservations(specialized.context) ||
      !requiredRepositoryObservations(interpreted.context) ||
      !specialized.hiddenVerifierPassed || !interpreted.hiddenVerifierPassed) {
    throw new Error(`repository_result_invalid:${JSON.stringify({
      changedPaths: gitResult.changedPaths,
      specializedMutations: specialized.context.mutationsApplied,
      interpretedMutations: interpreted.context.mutationsApplied,
      specializedFileReads: specialized.context.fileReads,
      interpretedFileReads: interpreted.context.fileReads,
      specializedSearches: specialized.context.searches,
      interpretedSearches: interpreted.context.searches,
      specializedTestRuns: specialized.context.testRuns,
      interpretedTestRuns: interpreted.context.testRuns,
      specializedPreMutationFailed: specialized.context.preMutationTestFailed,
      interpretedPreMutationFailed: interpreted.context.preMutationTestFailed,
      specializedPassed: specialized.context.lastTestPassed,
      interpretedPassed: interpreted.context.lastTestPassed,
      specializedHidden: specialized.hiddenVerifierPassed,
      interpretedHidden: interpreted.hiddenVerifierPassed
    })}`);
  }
}

function requiredRepositoryObservations(context) {
  return Number.isSafeInteger(context.fileReads) && context.fileReads > 0 &&
    Number.isSafeInteger(context.searches) && context.searches > 0 &&
    Number.isSafeInteger(context.testRuns) && context.testRuns >= 2 &&
    context.preMutationTestFailed === true && context.lastTestPassed === true;
}

async function recursiveFiles(root, ignoredDirectories = new Set()) {
  const result = [];
  async function walk(directory) {
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const full = join(directory, entry.name);
      const path = relative(root, full);
      if (entry.isDirectory()) {
        if (!ignoredDirectories.has(path)) await walk(full);
      }
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
    "interpretationToolsRoot", "environmentModule", "runtimeLock", "receiptOutput"
  ]) {
    if (typeof result[key] !== "string") throw new Error(`missing_argument:${key}`);
    result[key] = resolve(result[key]);
  }
  result.bunExecutable = resolve(result.bunExecutable ?? process.execPath);
  for (const [name, pattern] of [
    ["agentSourceHead", /^[0-9a-f]{40}$/],
    ["agentSourceArchiveSha256", /^[0-9a-f]{64}$/]
  ]) {
    if (result[name] !== undefined && !pattern.test(result[name])) {
      throw new Error(`invalid_argument:${name}`);
    }
  }
  if ((result.agentSourceHead === undefined) !==
      (result.agentSourceArchiveSha256 === undefined)) {
    throw new Error("incomplete_agent_source_snapshot_binding");
  }
  result.kernelSha256 = "12973fb655f126c2acd5693a84be47496649d1ab10bf22d565c9b675172e4f27";
  return result;
}

if (import.meta.main) {
  const receipt = await proveAgentInterpretation(parseArguments(process.argv.slice(2)));
  process.stdout.write(`${JSON.stringify(receipt, null, 2)}\n`);
}
