const std = @import("std");
const world_build = @import("world");

pub const ActualityApplication = @import("actuality/application.zig").Application;

pub fn build(b: *std.Build) void {
    const target = b.standardTargetOptions(.{});
    const optimize = b.standardOptimizeOption(.{});
    const boundary_archive = b.option([]const u8, "boundary-archive", "Local Boundary v1.6.1 archive for offline proof");
    const boundary_kernel_wasm = b.option([]const u8, "boundary-kernel-wasm", "Exact local Boundary v1.6.0 fixed-kernel WASM override");
    const world_archive = b.option([]const u8, "world-archive", "Local World v3.1.4 archive for offline proof");
    const world_host_archive = b.option([]const u8, "world-host-archive", "Local world-host v1.0.1 runtime archive");
    const world_capabilities_archive = b.option([]const u8, "world-capabilities-archive", "Local lock-pinned world-capabilities archive");
    const world_capabilities_root = b.option([]const u8, "world-capabilities-root", "Local world-capabilities v2.3.3 source or extracted release root for development proofs");
    const world_host_root = b.option([]const u8, "world-host-root", "Local world-host v1.0.1 source root for adequacy development");
    const interpretation_source_snapshot = b.option(
        bool,
        "interpretation-source-snapshot",
        "Internal: execute the interpretation proof inside an authenticated Agent source snapshot",
    ) orelse false;
    const agent_source_head = b.option(
        []const u8,
        "agent-source-head",
        "Internal authenticated Agent source commit for a snapshot proof",
    );
    const agent_source_archive_sha256 = b.option(
        []const u8,
        "agent-source-archive-sha256",
        "Internal authenticated Agent source archive digest for a snapshot proof",
    );
    const agent_source_tree = b.option(
        []const u8,
        "agent-source-tree",
        "Internal authenticated Agent Git tree for a snapshot proof",
    );
    const interpretation_kernel_wasm_override = b.option(
        []const u8,
        "interpretation-kernel-wasm",
        "Internal preverified fixed-kernel artifact for a source snapshot proof",
    );
    const interpretation_unrelated_bpi1_override = b.option(
        []const u8,
        "interpretation-unrelated-bpi1",
        "Internal preverified unrelated BPI1 for a source snapshot proof",
    );
    const interpretation_unrelated_mv2p1_override = b.option(
        []const u8,
        "interpretation-unrelated-mv2p1",
        "Internal preverified unrelated MV2P1 for a source snapshot proof",
    );
    const any_source_binding = agent_source_head != null or
        agent_source_archive_sha256 != null or agent_source_tree != null;
    const complete_source_binding = agent_source_head != null and
        agent_source_archive_sha256 != null and agent_source_tree != null;
    const any_preverified_boundary_input = interpretation_kernel_wasm_override != null or
        interpretation_unrelated_bpi1_override != null or
        interpretation_unrelated_mv2p1_override != null;
    const complete_preverified_boundary_inputs =
        interpretation_kernel_wasm_override != null and
        interpretation_unrelated_bpi1_override != null and
        interpretation_unrelated_mv2p1_override != null;
    if ((interpretation_source_snapshot and !complete_source_binding) or
        (!interpretation_source_snapshot and any_source_binding) or
        (interpretation_source_snapshot and !complete_preverified_boundary_inputs) or
        (!interpretation_source_snapshot and any_preverified_boundary_input))
    {
        std.process.fatal(
            "internal interpretation snapshot mode requires complete source and Boundary input bindings",
            .{},
        );
    }

    const boundary_dependency = b.dependency("boundary", .{
        .target = target,
        .optimize = optimize,
    });

    const agent_module = b.addModule("agent", .{
        .root_source_file = b.path("src/root.zig"),
        .target = target,
        .optimize = optimize,
    });
    const boundary_module = boundary_dependency.module("boundary");
    agent_module.addImport("boundary", boundary_module);
    const shared_boundary_module = b.addModule("boundary", .{
        .root_source_file = b.path("src/boundary_package.zig"),
        .target = target,
        .optimize = optimize,
    });
    shared_boundary_module.addImport("agent_boundary_upstream", boundary_module);

    const actuality_application = world_build.addApplicationWasm(b, .{
        .name = "repository-repair-actuality",
        .root_source_file = b.path("build.zig"),
        .application_decl = "ActualityApplication",
        .stack_size_bytes = @import("actuality/application.zig").wasm_stack_size_bytes,
        .memory = .{
            .initial_pages = 4096,
            .maximum_pages = 4096,
        },
        .install_human_readable_manifest = true,
    });
    const install_actuality_wasm = b.addInstallFile(
        actuality_application.wasm.getEmittedBin(),
        "agent-actuality/repository-repair-actuality.world.wasm",
    );
    install_actuality_wasm.step.dependOn(actuality_application.check_step);
    const install_actuality_manifest = b.addInstallFile(
        actuality_application.manifest,
        "agent-actuality/repository-repair-actuality.manifest.bin",
    );
    install_actuality_manifest.step.dependOn(actuality_application.check_step);
    b.getInstallStep().dependOn(&install_actuality_wasm.step);
    b.getInstallStep().dependOn(&install_actuality_manifest.step);

    const contract_actuality = b.createModule(.{
        .root_source_file = b.path("examples/repository_repair_actuality.zig"),
        .target = b.graph.host,
        .optimize = .ReleaseSafe,
    });
    contract_actuality.addImport("agent", agent_module);
    contract_actuality.addImport("boundary", boundary_module);
    contract_actuality.addImport(
        "repository_repair_definition",
        b.createModule(.{
            .root_source_file = b.path("actuality/repository_repair_definition.zig"),
            .target = b.graph.host,
            .optimize = .ReleaseSafe,
        }),
    );
    const contract_emitter_module = b.createModule(.{
        .root_source_file = b.path("actuality/emit_decision_contract.zig"),
        .target = b.graph.host,
        .optimize = .ReleaseSafe,
    });
    contract_emitter_module.addImport("agent", agent_module);
    contract_emitter_module.addImport("repository_repair_actuality", contract_actuality);
    const contract_emitter = b.addExecutable(.{
        .name = "emit-repository-repair-decision-contract",
        .root_module = contract_emitter_module,
    });
    const contract_output = b.addRunArtifact(contract_emitter).captureStdOut(.{
        .basename = "repository-repair-decision-contract.json",
    });
    const install_contract = b.addInstallFile(
        contract_output,
        "agent-actuality/repository-repair-decision-contract.json",
    );
    b.getInstallStep().dependOn(&install_contract.step);

    const contract_binary_emitter_module = b.createModule(.{
        .root_source_file = b.path("actuality/emit_decision_contract_binary.zig"),
        .target = b.graph.host,
        .optimize = .ReleaseSafe,
    });
    contract_binary_emitter_module.addImport("agent", agent_module);
    contract_binary_emitter_module.addImport("repository_repair_actuality", contract_actuality);
    const contract_binary_emitter = b.addExecutable(.{
        .name = "emit-repository-repair-decision-contract-binary",
        .root_module = contract_binary_emitter_module,
    });
    const contract_binary_output = b.addRunArtifact(contract_binary_emitter).captureStdOut(.{
        .basename = "repository-repair-decision-contract.bin",
    });
    const install_contract_binary = b.addInstallFile(
        contract_binary_output,
        "agent-actuality/repository-repair-decision-contract.bin",
    );
    b.getInstallStep().dependOn(&install_contract_binary.step);

    const contract_digest_emitter_module = b.createModule(.{
        .root_source_file = b.path("actuality/emit_decision_contract_digest.zig"),
        .target = b.graph.host,
        .optimize = .ReleaseSafe,
    });
    contract_digest_emitter_module.addImport("agent", agent_module);
    contract_digest_emitter_module.addImport("repository_repair_actuality", contract_actuality);
    const contract_digest_emitter = b.addExecutable(.{
        .name = "emit-repository-repair-decision-contract-digest",
        .root_module = contract_digest_emitter_module,
    });
    const contract_digest_output = b.addRunArtifact(contract_digest_emitter).captureStdOut(.{
        .basename = "repository-repair-decision-contract.sha256",
    });
    const install_contract_digest = b.addInstallFile(
        contract_digest_output,
        "agent-actuality/repository-repair-decision-contract.sha256",
    );
    b.getInstallStep().dependOn(&install_contract_digest.step);

    const first_request_module = b.createModule(.{
        .root_source_file = b.path("actuality/emit_first_decision_request.zig"),
        .target = b.graph.host,
        .optimize = .ReleaseSafe,
    });
    first_request_module.addImport("agent", agent_module);
    first_request_module.addImport("boundary", boundary_module);
    first_request_module.addImport("repository_repair_actuality", contract_actuality);
    const first_request_emitter = b.addExecutable(.{
        .name = "emit-repository-repair-first-decision-request",
        .root_module = first_request_module,
    });
    const run_first_request = b.addRunArtifact(first_request_emitter);
    const first_request_output = run_first_request.captureStdOut(.{
        .basename = "repository-repair-first-decision-request.bin",
    });
    const emit_first_request = b.step(
        "emit-agent-actuality-first-request",
        "Emit the first canonical repository-repair decision request",
    );
    emit_first_request.dependOn(&run_first_request.step);
    const install_first_request = b.addInstallFile(
        first_request_output,
        "agent-actuality/repository-repair-first-decision-request.bin",
    );
    b.getInstallStep().dependOn(&install_first_request.step);

    const initial_args_module = b.createModule(.{
        .root_source_file = b.path("actuality/emit_initial_args.zig"),
        .target = b.graph.host,
        .optimize = .ReleaseSafe,
    });
    initial_args_module.addImport("agent", agent_module);
    initial_args_module.addImport("boundary", boundary_module);
    initial_args_module.addImport("repository_repair_actuality", contract_actuality);
    const initial_args_emitter = b.addExecutable(.{
        .name = "emit-repository-repair-initial-args",
        .root_module = initial_args_module,
    });
    const initial_args_output = b.addRunArtifact(initial_args_emitter).captureStdOut(.{
        .basename = "initial-args.bin",
    });
    const install_initial_args = b.addInstallFile(
        initial_args_output,
        "agent-actuality/initial-args.bin",
    );
    b.getInstallStep().dependOn(&install_initial_args.step);

    const interpretation_actuality = b.createModule(.{
        .root_source_file = b.path("examples/repository_repair_actuality.zig"),
        .target = b.graph.host,
        .optimize = .Debug,
    });
    interpretation_actuality.addImport("agent", agent_module);
    interpretation_actuality.addImport("boundary", boundary_module);
    interpretation_actuality.addImport(
        "repository_repair_definition",
        b.createModule(.{
            .root_source_file = b.path("actuality/repository_repair_definition.zig"),
            .target = b.graph.host,
            .optimize = .Debug,
        }),
    );
    const interpretation_artifact_module = b.createModule(.{
        .root_source_file = b.path("interpretation/emit_repository_repair_artifact.zig"),
        .target = b.graph.host,
        .optimize = .Debug,
    });
    interpretation_artifact_module.addImport(
        "repository_repair_actuality",
        interpretation_actuality,
    );
    const interpretation_artifact_emitter = b.addExecutable(.{
        .name = "emit-repository-repair-agent-artifact",
        .root_module = interpretation_artifact_module,
    });
    const run_interpretation_bpi1 = b.addRunArtifact(
        interpretation_artifact_emitter,
    );
    run_interpretation_bpi1.addArg("bpi1");
    const interpretation_bpi1_output = run_interpretation_bpi1.captureStdOut(
        .{ .basename = "repository-repair.agent.bpi1" },
    );

    const run_interpretation_mv2p1 = b.addRunArtifact(
        interpretation_artifact_emitter,
    );
    run_interpretation_mv2p1.addArg("mv2p1");
    const interpretation_mv2p1_output = run_interpretation_mv2p1.captureStdOut(
        .{ .basename = "repository-repair.agent.mv2p1" },
    );

    const acquire_boundary_assets = b.addSystemCommand(&.{"node"});
    acquire_boundary_assets.addFileArg(
        b.path("tools/interpretation/acquire_kernel.mjs"),
    );
    acquire_boundary_assets.addArg(b.graph.zig_exe);
    acquire_boundary_assets.addDirectoryArg(boundary_dependency.path("."));
    if (boundary_kernel_wasm) |path| {
        acquire_boundary_assets.addFileArg(.{ .cwd_relative = b.pathFromRoot(path) });
    } else {
        acquire_boundary_assets.addArg("-");
    }
    const acquired_interpretation_kernel_wasm = acquire_boundary_assets.addOutputFileArg(
        "boundary-machine-v2-kernel-v1.wasm",
    );
    const acquired_unrelated_bpi1 = acquire_boundary_assets.addOutputFileArg(
        "one-effect.boundary-program-image",
    );
    const acquired_unrelated_mv2p1 = acquire_boundary_assets.addOutputFileArg(
        "one-effect.machine-v2-profile",
    );
    const interpretation_kernel_wasm: std.Build.LazyPath =
        if (interpretation_kernel_wasm_override) |path|
            .{ .cwd_relative = b.pathFromRoot(path) }
        else
            acquired_interpretation_kernel_wasm;
    const unrelated_bpi1: std.Build.LazyPath =
        if (interpretation_unrelated_bpi1_override) |path|
            .{ .cwd_relative = b.pathFromRoot(path) }
        else
            acquired_unrelated_bpi1;
    const unrelated_mv2p1: std.Build.LazyPath =
        if (interpretation_unrelated_mv2p1_override) |path|
            .{ .cwd_relative = b.pathFromRoot(path) }
        else
            acquired_unrelated_mv2p1;

    const interpretation_assets = b.step(
        "emit-agent-interpretation-v1-assets",
        "Emit the canonical repository-repair interpretation inputs",
    );
    const install_interpretation_bpi1 = b.addInstallFile(
        interpretation_bpi1_output,
        "agent-interpretation-v1/repository-repair.agent.bpi1",
    );
    const install_interpretation_mv2p1 = b.addInstallFile(
        interpretation_mv2p1_output,
        "agent-interpretation-v1/repository-repair.agent.mv2p1",
    );
    const install_interpretation_initial_args = b.addInstallFile(
        initial_args_output,
        "agent-interpretation-v1/repository-repair.initial-args.bin",
    );
    const install_interpretation_contract = b.addInstallFile(
        contract_binary_output,
        "agent-interpretation-v1/repository-repair.decision-contract.bin",
    );
    const install_interpretation_manifest = b.addInstallFile(
        actuality_application.manifest,
        "agent-interpretation-v1/repository-repair-actuality.manifest.bin",
    );
    const install_interpretation_kernel = b.addInstallFile(
        interpretation_kernel_wasm,
        "agent-interpretation-v1/boundary-machine-v2-kernel-v1.wasm",
    );
    for ([_]*std.Build.Step{
        &install_interpretation_bpi1.step,
        &install_interpretation_mv2p1.step,
        &install_interpretation_initial_args.step,
        &install_interpretation_contract.step,
        &install_interpretation_manifest.step,
        &install_interpretation_kernel.step,
    }) |step| interpretation_assets.dependOn(step);

    const interpretation_hashes = [_]struct {
        input: std.Build.LazyPath,
        basename: []const u8,
        destination: []const u8,
    }{
        .{
            .input = interpretation_bpi1_output,
            .basename = "repository-repair.agent.bpi1.sha256",
            .destination = "agent-interpretation-v1/repository-repair.agent.bpi1.sha256",
        },
        .{
            .input = interpretation_mv2p1_output,
            .basename = "repository-repair.agent.mv2p1.sha256",
            .destination = "agent-interpretation-v1/repository-repair.agent.mv2p1.sha256",
        },
        .{
            .input = initial_args_output,
            .basename = "repository-repair.initial-args.bin.sha256",
            .destination = "agent-interpretation-v1/repository-repair.initial-args.bin.sha256",
        },
        .{
            .input = contract_binary_output,
            .basename = "repository-repair.decision-contract.bin.sha256",
            .destination = "agent-interpretation-v1/repository-repair.decision-contract.bin.sha256",
        },
        .{
            .input = actuality_application.manifest,
            .basename = "repository-repair-actuality.manifest.bin.sha256",
            .destination = "agent-interpretation-v1/repository-repair-actuality.manifest.bin.sha256",
        },
        .{
            .input = interpretation_kernel_wasm,
            .basename = "boundary-machine-v2-kernel-v1.wasm.sha256",
            .destination = "agent-interpretation-v1/boundary-machine-v2-kernel-v1.wasm.sha256",
        },
    };
    for (interpretation_hashes) |hash| {
        const output = sha256File(b, hash.input, hash.basename);
        const installation = b.addInstallFile(output, hash.destination);
        interpretation_assets.dependOn(&installation.step);
    }

    const interpretation_runtime_lock = b.path("interpretation/runtime-dependencies.lock.json");
    const acquire_interpretation_runtime = b.addSystemCommand(&.{"bun"});
    if (world_host_root != null or world_capabilities_root != null) {
        acquire_interpretation_runtime.has_side_effects = true;
    }
    acquire_interpretation_runtime.addFileArg(
        b.path("tools/interpretation/acquire_runtime_dependencies.mjs"),
    );
    acquire_interpretation_runtime.addArg("--lock");
    acquire_interpretation_runtime.addFileArg(interpretation_runtime_lock);
    if (world_host_root) |path| {
        acquire_interpretation_runtime.addArg("--world-host-root");
        acquire_interpretation_runtime.addDirectoryArg(.{ .cwd_relative = b.pathFromRoot(path) });
    }
    if (world_capabilities_root) |path| {
        acquire_interpretation_runtime.addArg("--world-capabilities-root");
        acquire_interpretation_runtime.addDirectoryArg(.{ .cwd_relative = b.pathFromRoot(path) });
    }
    if (world_host_archive) |path| {
        acquire_interpretation_runtime.addArg("--world-host-archive");
        acquire_interpretation_runtime.addFileArg(.{ .cwd_relative = b.pathFromRoot(path) });
    }
    if (world_capabilities_archive) |path| {
        acquire_interpretation_runtime.addArg("--world-capabilities-archive");
        acquire_interpretation_runtime.addFileArg(.{ .cwd_relative = b.pathFromRoot(path) });
    }
    acquire_interpretation_runtime.addArg("--output");
    const interpretation_runtime = acquire_interpretation_runtime.addOutputDirectoryArg(
        "runtime-dependencies-v1",
    );

    const interpretation_proof_command = b.addSystemCommand(&.{"bun"});
    interpretation_proof_command.has_side_effects = true;
    interpretation_proof_command.addFileArg(
        b.path("tools/interpretation/proof.mjs"),
    );
    interpretation_proof_command.addArgs(&.{
        "--agent-root",
        b.pathFromRoot("."),
        "--artifact-root",
        b.getInstallPath(.prefix, "agent-interpretation-v1"),
        "--application-wasm",
    });
    interpretation_proof_command.addFileArg(
        actuality_application.wasm.getEmittedBin(),
    );
    interpretation_proof_command.addArg("--kernel-wasm");
    interpretation_proof_command.addFileArg(interpretation_kernel_wasm);
    interpretation_proof_command.addArg("--unrelated-bpi1");
    interpretation_proof_command.addFileArg(unrelated_bpi1);
    interpretation_proof_command.addArg("--unrelated-mv2p1");
    interpretation_proof_command.addFileArg(unrelated_mv2p1);
    interpretation_proof_command.addArgs(&.{
        "--fixture-root",
        b.pathFromRoot("fixtures/repository-repair-v1"),
        "--world-host-root",
    });
    interpretation_proof_command.addDirectoryArg(
        interpretation_runtime.path(b, "world-host"),
    );
    interpretation_proof_command.addArg("--capabilities-root");
    interpretation_proof_command.addDirectoryArg(
        interpretation_runtime.path(b, "world-capabilities"),
    );
    interpretation_proof_command.addArg("--runtime-lock");
    interpretation_proof_command.addFileArg(interpretation_runtime_lock);
    interpretation_proof_command.addArgs(&.{
        "--interpretation-tools-root",
        b.pathFromRoot("tools/interpretation"),
        "--environment-module",
        b.pathFromRoot("tools/interpretation/repository_repair_environment.mjs"),
    });
    if (agent_source_head) |head| {
        interpretation_proof_command.addArgs(&.{ "--agent-source-head", head });
        interpretation_proof_command.addArgs(&.{
            "--agent-source-archive-sha256",
            agent_source_archive_sha256.?,
        });
        interpretation_proof_command.addArgs(&.{
            "--agent-source-tree",
            agent_source_tree.?,
        });
    }
    interpretation_proof_command.addArg("--receipt-output");
    const direct_interpretation_receipt = interpretation_proof_command.addOutputFileArg(
        "agent-interpretation-v1-receipt.json",
    );
    interpretation_proof_command.step.dependOn(interpretation_assets);
    const install_direct_interpretation_receipt = b.addInstallFile(
        direct_interpretation_receipt,
        "agent-interpretation-v1/agent-interpretation-v1-receipt.json",
    );
    const interpretation_proof = b.step(
        "check-agent-interpretation-v1",
        "Prove fixed-kernel execution and specialized equivalence",
    );
    if (interpretation_source_snapshot) {
        interpretation_proof.dependOn(
            &install_direct_interpretation_receipt.step,
        );
    } else {
        const snapshot_proof = b.addSystemCommand(&.{"node"});
        snapshot_proof.has_side_effects = true;
        snapshot_proof.addFileArg(
            b.path("tools/interpretation/check_from_source_snapshot.mjs"),
        );
        snapshot_proof.addArg("--agent-root");
        snapshot_proof.addDirectoryArg(b.path("."));
        snapshot_proof.addArgs(&.{ "--zig", b.graph.zig_exe });
        snapshot_proof.addArgs(&.{
            "--global-cache-dir",
            b.graph.global_cache_root.path orelse ".",
        });
        snapshot_proof.addArg("--interpretation-kernel-wasm");
        snapshot_proof.addFileArg(interpretation_kernel_wasm);
        snapshot_proof.addArg("--interpretation-unrelated-bpi1");
        snapshot_proof.addFileArg(unrelated_bpi1);
        snapshot_proof.addArg("--interpretation-unrelated-mv2p1");
        snapshot_proof.addFileArg(unrelated_mv2p1);
        if (boundary_archive) |path| {
            snapshot_proof.addArg("--boundary-archive");
            snapshot_proof.addFileArg(.{ .cwd_relative = b.pathFromRoot(path) });
        }
        if (boundary_kernel_wasm) |path| {
            snapshot_proof.addArg("--boundary-kernel-wasm");
            snapshot_proof.addFileArg(.{ .cwd_relative = b.pathFromRoot(path) });
        }
        if (world_archive) |path| {
            snapshot_proof.addArg("--world-archive");
            snapshot_proof.addFileArg(.{ .cwd_relative = b.pathFromRoot(path) });
        }
        if (world_host_archive) |path| {
            snapshot_proof.addArg("--world-host-archive");
            snapshot_proof.addFileArg(.{ .cwd_relative = b.pathFromRoot(path) });
        }
        if (world_capabilities_archive) |path| {
            snapshot_proof.addArg("--world-capabilities-archive");
            snapshot_proof.addFileArg(.{ .cwd_relative = b.pathFromRoot(path) });
        }
        if (world_host_root) |path| {
            snapshot_proof.addArg("--world-host-root");
            snapshot_proof.addDirectoryArg(.{ .cwd_relative = b.pathFromRoot(path) });
        }
        if (world_capabilities_root) |path| {
            snapshot_proof.addArg("--world-capabilities-root");
            snapshot_proof.addDirectoryArg(.{ .cwd_relative = b.pathFromRoot(path) });
        }
        snapshot_proof.addArg("--receipt-output");
        const snapshot_receipt = snapshot_proof.addOutputFileArg(
            "agent-interpretation-v1-receipt.json",
        );
        const install_snapshot_receipt = b.addInstallFile(
            snapshot_receipt,
            "agent-interpretation-v1/agent-interpretation-v1-receipt.json",
        );
        interpretation_proof.dependOn(&install_snapshot_receipt.step);
    }

    const tests = b.addTest(.{ .root_module = agent_module });
    const run_tests = b.addRunArtifact(tests);

    const check = b.step("check", "Compile and test the agent package");
    const semantic_check = b.step(
        "check-agent-semantic",
        "Run the public compiler, World packaging, parity, and malformed-input proof",
    );
    semantic_check.dependOn(&run_tests.step);

    const no_runtime_gate = b.addSystemCommand(&.{
        "sh",
        "tools/check_agent_no_runtime.sh",
    });
    const no_runtime = b.step(
        "check-agent-no-runtime",
        "Reject runtime agent interpreters, registries, and integrations",
    );
    no_runtime.dependOn(&no_runtime_gate.step);
    semantic_check.dependOn(no_runtime);

    const actuality_world = b.step(
        "check-agent-actuality-world",
        "Compile the exact World v3.1.4 repository-repair application",
    );
    actuality_world.dependOn(actuality_application.check_step);
    semantic_check.dependOn(actuality_world);
    const actuality_wasm = b.step(
        "check-agent-actuality-wasm",
        "Prove the repository-repair application WASM is import-free and bounded",
    );
    const actuality_wasm_size_gate = b.addSystemCommand(&.{
        "node",
        "tools/check_actuality_wasm_v2.mjs",
    });
    actuality_wasm_size_gate.addFileArg(actuality_application.wasm.getEmittedBin());
    actuality_wasm_size_gate.step.dependOn(actuality_application.check_step);
    actuality_wasm.dependOn(&actuality_wasm_size_gate.step);
    semantic_check.dependOn(actuality_wasm);

    const actuality_runtime_gates = [_]struct {
        name: []const u8,
        description: []const u8,
        mode: []const u8,
    }{
        .{
            .name = "check-agent-actuality-deterministic",
            .description = "Repair the real fixture repository through deterministic capabilities",
            .mode = "deterministic",
        },
        .{
            .name = "check-agent-actuality-retry",
            .description = "Reuse the persisted mutation result and reproduce byte-identical child Frame bytes",
            .mode = "retry",
        },
        .{
            .name = "check-agent-actuality-replay",
            .description = "Replay the completed actuality run with zero fresh external effects",
            .mode = "replay",
        },
        .{
            .name = "check-agent-actuality-branch",
            .description = "Produce two distinct valid children from one decision Frame",
            .mode = "branch",
        },
        .{
            .name = "check-agent-actuality-migrate",
            .description = "Export and continue the actuality run under fresh receiver policy",
            .mode = "migrate",
        },
    };
    const actuality_lifecycle = b.step(
        "check-agent-actuality-lifecycle",
        "Prove retry, replay, branching, and migration for the actuality application",
    );
    const actuality_release = b.step(
        "check-agent-actuality-release",
        "Run every network-free Agent Actuality v1 proof",
    );
    for (actuality_runtime_gates) |gate| {
        const command = b.addSystemCommand(&.{
            "bun",
            "tools/actuality/run.mjs",
            "--mode",
            gate.mode,
        });
        command.addArg("--world-host-root");
        command.addDirectoryArg(interpretation_runtime.path(b, "world-host"));
        command.addArg("--capabilities-root");
        command.addDirectoryArg(interpretation_runtime.path(b, "world-capabilities"));
        command.step.dependOn(&install_actuality_wasm.step);
        command.step.dependOn(&install_actuality_manifest.step);
        command.step.dependOn(&install_initial_args.step);
        const step = b.step(gate.name, gate.description);
        step.dependOn(&command.step);
        actuality_release.dependOn(step);
        if (!std.mem.eql(u8, gate.mode, "deterministic")) {
            actuality_lifecycle.dependOn(step);
        }
    }
    const actuality_live_command = b.addSystemCommand(&.{
        "bun",
        "tools/actuality/run.mjs",
        "--mode",
        "live",
    });
    actuality_live_command.step.dependOn(&install_actuality_wasm.step);
    actuality_live_command.step.dependOn(&install_actuality_manifest.step);
    actuality_live_command.step.dependOn(&install_initial_args.step);
    actuality_live_command.step.dependOn(&install_contract_binary.step);
    const actuality_live = b.step(
        "check-agent-actuality-live",
        "Run the explicit OpenAI plus interactive-approval actuality proof",
    );
    actuality_live.dependOn(&actuality_live_command.step);

    const actuality_negative_command = b.addSystemCommand(&.{
        "bun",
        "--cwd",
        "test",
        "test",
        "actuality_live_failure.test.mjs",
    });
    const actuality_negative = b.step(
        "check-agent-actuality-negative",
        "Prove live capability failures emit redacted attempt receipts and fail closed",
    );
    actuality_negative.dependOn(&actuality_negative_command.step);
    actuality_release.dependOn(actuality_negative);
    semantic_check.dependOn(actuality_negative);

    const actuality_live_receipt_command = b.addSystemCommand(&.{
        "bun",
        "tools/actuality/verify-live-receipt.mjs",
    });
    if (b.args) |args| actuality_live_receipt_command.addArgs(args);
    const actuality_live_receipt = b.step(
        "check-agent-actuality-v1-live-receipt",
        "Verify a live receipt against exact release archives and application WASM",
    );
    actuality_live_receipt.dependOn(&actuality_live_receipt_command.step);
    const actuality_live_receipt_test_command = b.addSystemCommand(&.{
        "bun",
        "--cwd",
        "test",
        "test",
        "actuality_live_receipt.test.mjs",
    });
    const actuality_live_receipt_test = b.step(
        "check-agent-actuality-live-receipt-negative",
        "Reject forged or incomplete live actuality receipts",
    );
    actuality_live_receipt_test.dependOn(&actuality_live_receipt_test_command.step);
    semantic_check.dependOn(actuality_live_receipt_test);
    const actuality_v1 = b.step(
        "check-agent-actuality-v1",
        "Run network-free Actuality proof and verify the exact released live receipt",
    );
    actuality_v1.dependOn(actuality_release);
    actuality_v1.dependOn(actuality_live_receipt);

    const external_consumer_gate = b.addSystemCommand(&.{
        "sh",
        "tools/check_external_consumer.sh",
    });
    const external_consumer = b.step(
        "check-agent-external-consumer",
        "Build one custom Agent from an archive in an empty directory",
    );
    external_consumer.dependOn(&external_consumer_gate.step);
    semantic_check.dependOn(external_consumer);

    const reference_stack_test_command = b.addSystemCommand(&.{
        "bun",
        "test",
        "./test/reference_stack.test.mjs",
    });
    const reference_stack_lock = b.step(
        "check-agent-reference-stack-lock",
        "Validate the exact public reference-stack lock",
    );
    reference_stack_lock.dependOn(&reference_stack_test_command.step);
    semantic_check.dependOn(reference_stack_lock);

    const format_check = b.addSystemCommand(&.{
        b.graph.zig_exe,
        "fmt",
        "--check",
        "build.zig",
        "src",
        "test",
        "examples",
    });
    const lint = b.step("lint", "Check Zig source formatting");
    lint.dependOn(&format_check.step);
    const path_check = b.addSystemCommand(&.{ "sh", "tools/check_zig_paths.sh" });
    lint.dependOn(&path_check.step);

    const compile_fail = b.step(
        "compile-fail",
        "Run AgentDefinition and RuntimeStrategy rejection witnesses",
    );
    for ([_]struct { path: []const u8, message: []const u8 }{
        .{ .path = "test/compile_fail/missing_action_descriptor.zig", .message = "agent action algebra must contain exactly one descriptor per Action variant" },
        .{ .path = "test/compile_fail/duplicate_action_descriptor.zig", .message = "agent Action variant has duplicate descriptors" },
        .{ .path = "test/compile_fail/effect_payload_mismatch.zig", .message = "agent effect action payload differs from EffectSite.Payload" },
        .{ .path = "test/compile_fail/observation_payload_mismatch.zig", .message = "agent observation payload differs from EffectSite.Resume" },
        .{ .path = "test/compile_fail/final_payload_mismatch.zig", .message = "agent final action payload differs from Definition.Result" },
        .{ .path = "test/compile_fail/empty_instructions.zig", .message = "agent definition instructions must not be empty" },
        .{ .path = "test/compile_fail/decision_result_too_small.zig", .message = "agent Action schema exceeds decision.maximum_result_bytes" },
        .{ .path = "test/compile_fail/zero_turn_budget.zig", .message = "agent maximum_turns must be positive" },
        .{ .path = "test/compile_fail/effect_without_history.zig", .message = "agent v2 Definition no longer accepts .history; choose an EpistemicStrategy" },
        .{ .path = "test/compile_fail/forged_runtime_strategy.zig", .message = "agent compile requires a RuntimeStrategy structural contract" },
        .{ .path = "test/compile_fail/open_action.zig", .message = "agent Action must be exhaustive" },
        .{ .path = "test/compile_fail/nonexistent_action_variant.zig", .message = "agent Action has no variant named 'missing'" },
        .{ .path = "test/compile_fail/fail_payload_mismatch.zig", .message = "agent fail action payload differs from Definition.Failure" },
        .{ .path = "test/compile_fail/missing_final_action.zig", .message = "agent action algebra requires a final action" },
        .{ .path = "test/compile_fail/duplicate_stable_action_name.zig", .message = "agent action stable name is duplicated" },
        .{ .path = "test/compile_fail/action_metadata_class_wrong_type.zig", .message = "agent action metadata .class must have type agent.action.Class" },
        .{ .path = "test/compile_fail/oversized_instructions.zig", .message = "agent definition instructions exceed maximum_instructions_bytes" },
        .{ .path = "test/compile_fail/zero_decision_budget.zig", .message = "agent maximum_decisions must be positive" },
        .{ .path = "test/compile_fail/invalid_history_limit.zig", .message = "agent.epistemics.verbatim maximum_observations exceeds u32" },
        .{ .path = "test/compile_fail/nonportable_goal.zig", .message = "agent Goal must be Boundary-portable" },
        .{ .path = "test/compile_fail/nonportable_action.zig", .message = "agent Action must be Boundary-portable" },
        .{ .path = "test/compile_fail/nonportable_observation.zig", .message = "agent Observation must be Boundary-portable" },
        .{ .path = "test/compile_fail/nonportable_result.zig", .message = "agent Result must be Boundary-portable" },
        .{ .path = "test/compile_fail/strategy_omits_action_variant.zig", .message = "agent RuntimeStrategy action coverage must contain every Action variant" },
        .{ .path = "test/compile_fail/strategy_decision_request_nonportable.zig", .message = "agent RuntimeStrategy DecisionLocalType must be Boundary-portable" },
        .{ .path = "test/compile_fail/strategy_runtime_callback.zig", .message = "agent RuntimeStrategy config cannot contain runtime callbacks or pointers" },
        .{ .path = "test/compile_fail/strategy_effectful_decision_local.zig", .message = "agent custom RuntimeStrategy emitDecisionLocal must be effect-free" },
        .{ .path = "test/compile_fail/strategy_terminal_decision_local.zig", .message = "agent custom RuntimeStrategy emitDecisionLocal must not alter compiler-owned control topology" },
        .{ .path = "test/compile_fail/strategy_branching_decision_local.zig", .message = "agent custom RuntimeStrategy emitDecisionLocal must not alter compiler-owned control topology" },
        .{ .path = "test/compile_fail/epistemics_effectful_initial.zig", .message = "agent EpistemicStrategy emitInitial must be effect-free" },
        .{ .path = "test/compile_fail/epistemics_effectful_action_admission.zig", .message = "agent custom EpistemicStrategy emitActionAllowed must be effect-free" },
        .{ .path = "test/compile_fail/epistemics_specialized_admission_without_fallback.zig", .message = "agent specialized action admission requires emitActionAllowed fallback" },
        .{ .path = "test/compile_fail/epistemics_terminal_initial.zig", .message = "agent custom EpistemicStrategy emitInitial must not terminate the Agent program" },
        .{ .path = "test/compile_fail/flow_text_compare_nontext.zig", .message = "agent.Flow textCompare requires Text values" },
        .{ .path = "test/compile_fail/epistemics_zero_lowering_complexity.zig", .message = "agent custom EpistemicStrategy lowering_complexity must be positive" },
        .{ .path = "test/compile_fail/final_policy_missing_observation.zig", .message = "agent v2 Definition no longer accepts .final_policy; final admission belongs to EpistemicStrategy" },
        .{ .path = "test/compile_fail/final_policy_non_boolean_field.zig", .message = "agent v2 Definition no longer accepts .final_policy; final admission belongs to EpistemicStrategy" },
    }) |witness| {
        addExpectedCompileFailure(
            b,
            compile_fail,
            witness.path,
            witness.message,
            agent_module,
            boundary_module,
        );
    }
    semantic_check.dependOn(compile_fail);

    addFocusedTest(
        b,
        "check-agent-definition",
        "Validate AgentDefinition admission",
        "test/definition.zig",
        agent_module,
        boundary_module,
        target,
        optimize,
        semantic_check,
    );
    addSharedBoundaryTest(
        b,
        "check-agent-shared-boundary",
        "Prove downstream consumers share Agent's exact Boundary module",
        "test/shared_boundary.zig",
        agent_module,
        shared_boundary_module,
        target,
        optimize,
        semantic_check,
    );
    addFocusedTest(
        b,
        "check-agent-action-algebra",
        "Validate exhaustive typed Action closure",
        "test/action_algebra.zig",
        agent_module,
        boundary_module,
        target,
        optimize,
        semantic_check,
    );
    addFocusedTest(
        b,
        "check-agent-flow",
        "Validate structured Flow lowering to Boundary Control IR",
        "test/flow.zig",
        agent_module,
        boundary_module,
        target,
        optimize,
        semantic_check,
    );
    addFocusedTest(
        b,
        "check-agent-compiler",
        "Compile AgentDefinition plus RuntimeStrategy into Boundary",
        "test/compiler.zig",
        agent_module,
        boundary_module,
        target,
        optimize,
        semantic_check,
    );
    addFocusedTest(
        b,
        "check-agent-strategy-react",
        "Validate ReAct specialization",
        "test/compiler.zig",
        agent_module,
        boundary_module,
        target,
        optimize,
        semantic_check,
    );
    addFocusedTest(
        b,
        "check-agent-final-policy",
        "Prove final completion after the required typed observation",
        "test/final_policy.zig",
        agent_module,
        boundary_module,
        target,
        optimize,
        semantic_check,
    );
    addFocusedTest(
        b,
        "check-agent-final-policy-negative",
        "Reject final completion before the required typed observation",
        "test/final_policy_negative.zig",
        agent_module,
        boundary_module,
        target,
        optimize,
        semantic_check,
    );
    addFocusedTest(
        b,
        "check-agent-action-admission",
        "Reject inadmissible typed actions before effect emission",
        "test/action_admission.zig",
        agent_module,
        boundary_module,
        target,
        optimize,
        semantic_check,
    );
    addFocusedTest(
        b,
        "check-agent-void-effect-action",
        "Lower void Action payloads as ordinary Boundary unit effects",
        "test/void_effect_action.zig",
        agent_module,
        boundary_module,
        target,
        optimize,
        semantic_check,
    );
    _ = addActualityDefinitionTest(
        b,
        "check-agent-actuality-definition",
        "Compile the typed repository repair AgentDefinition",
        "test/actuality_definition.zig",
        agent_module,
        boundary_module,
        target,
        optimize,
        semantic_check,
    );
    const working_set_check = addActualityDefinitionTest(
        b,
        "check-agent-epistemics-working-set",
        "Prove repository working-set replacement and stale-data laws",
        "test/epistemics_working_set.zig",
        agent_module,
        boundary_module,
        target,
        optimize,
        semantic_check,
    );
    const long_trace_check = b.step(
        "check-agent-epistemic-long-trace",
        "Fold 32 repository effects without structural Memory growth",
    );
    long_trace_check.dependOn(working_set_check);
    semantic_check.dependOn(long_trace_check);
    _ = addActualityDefinitionTest(
        b,
        "check-agent-decision-contract",
        "Project the exact Action algebra into deterministic strict JSON",
        "test/decision_contract.zig",
        agent_module,
        boundary_module,
        target,
        optimize,
        semantic_check,
    );
    _ = addActualityDefinitionTest(
        b,
        "check-agent-decision-contract-negative",
        "Prove the projected JSON contract closes every Action object",
        "test/decision_contract.zig",
        agent_module,
        boundary_module,
        target,
        optimize,
        semantic_check,
    );
    addFocusedTest(
        b,
        "check-agent-strategy-reflective",
        "Validate Reflective ReAct specialization",
        "test/strategy_reflective.zig",
        agent_module,
        boundary_module,
        target,
        optimize,
        semantic_check,
    );
    addFocusedTest(
        b,
        "check-agent-custom-strategy",
        "Validate downstream compile-time strategy specialization",
        "test/custom_strategy.zig",
        agent_module,
        boundary_module,
        target,
        optimize,
        semantic_check,
    );
    addFocusedTest(
        b,
        "check-agent-budgets",
        "Validate turn, decision, effect, child, and history budgets",
        "test/budgets.zig",
        agent_module,
        boundary_module,
        target,
        optimize,
        semantic_check,
    );
    addFocusedTest(
        b,
        "check-agent-malformed",
        "Reject malformed decision bytes without Agent state mutation",
        "test/malformed.zig",
        agent_module,
        boundary_module,
        target,
        optimize,
        semantic_check,
    );
    _ = addSpecializationTest(
        b,
        "check-agent-specialization-matrix",
        "Compile two definitions by two strategies into four Machines",
        "test/specialization_matrix.zig",
        agent_module,
        boundary_module,
        target,
        optimize,
        semantic_check,
    );
    _ = addSpecializationTest(
        b,
        "check-agent-manifests",
        "Validate deterministic Agent manifests and identities",
        "test/specialization_matrix.zig",
        agent_module,
        boundary_module,
        target,
        optimize,
        semantic_check,
    );
    _ = addSpecializationTest(
        b,
        "check-agent-lifecycle-native",
        "Run typed Research and Coding lifecycles across all strategies",
        "test/specialization_matrix.zig",
        agent_module,
        boundary_module,
        target,
        optimize,
        semantic_check,
    );

    const world_conformance_gate = b.addSystemCommand(&.{
        "node",
        "tools/check_world_conformance.mjs",
        "--zig",
    });
    world_conformance_gate.addArg(b.graph.zig_exe);
    const world_conformance = b.step(
        "check-agent-world-conformance",
        "Close four Agent Machines with exact released World v3.1.4",
    );
    world_conformance.dependOn(&world_conformance_gate.step);
    const hosted_lifecycle = b.step(
        "check-agent-lifecycle",
        "Drive Research and Coding World applications through public world-host v1.0.1",
    );
    hosted_lifecycle.dependOn(&world_conformance_gate.step);
    const release_externality = b.step(
        "check-agent-1-externality",
        "Prove the clean-room Agent, World, host, and Effect v1 release lifecycle",
    );
    const release_externality_gate = b.addSystemCommand(&.{
        "node",
        "tools/check_world_conformance.mjs",
        "--zig",
    });
    release_externality_gate.addArg(b.graph.zig_exe);
    release_externality_gate.addArg("--agent-v1-release");
    release_externality.dependOn(&release_externality_gate.step);
    const reference_stack_command = b.addSystemCommand(&.{
        "bun",
        "tools/check_reference_stack.mjs",
        "--artifact-root",
    });
    reference_stack_command.addArg(b.getInstallPath(.prefix, "agent-actuality"));
    reference_stack_command.addArgs(&.{
        "--receipt-path",
        b.getInstallPath(.prefix, "agent-actuality/reference-stack-receipt.json"),
    });
    reference_stack_command.step.dependOn(&install_actuality_wasm.step);
    reference_stack_command.step.dependOn(&install_actuality_manifest.step);
    reference_stack_command.step.dependOn(&install_initial_args.step);
    const reference_stack = b.step(
        "check-agent-reference-stack",
        "Run the anonymously acquired public host/capability lifecycle and Actuality proof",
    );
    reference_stack.dependOn(&reference_stack_command.step);

    const offline_reference_stack_command = b.addSystemCommand(&.{
        "bun",
        "tools/check_reference_stack.mjs",
        "--offline",
        "--artifact-root",
    });
    offline_reference_stack_command.addArg(b.getInstallPath(.prefix, "agent-actuality"));
    offline_reference_stack_command.addArgs(&.{
        "--receipt-path",
        b.getInstallPath(.prefix, "agent-actuality/reference-stack-receipt.json"),
    });
    if (world_host_archive) |path| offline_reference_stack_command.addArgs(&.{ "--world-host-archive", path });
    if (world_capabilities_archive) |path| offline_reference_stack_command.addArgs(&.{ "--world-capabilities-archive", path });
    offline_reference_stack_command.step.dependOn(&install_actuality_wasm.step);
    offline_reference_stack_command.step.dependOn(&install_actuality_manifest.step);
    offline_reference_stack_command.step.dependOn(&install_initial_args.step);
    const offline_reference_stack = b.step(
        "check-agent-reference-stack-offline",
        "Run the public reference-stack proof from checksum-matching local archives",
    );
    offline_reference_stack.dependOn(&offline_reference_stack_command.step);

    const hermetic_command = b.addSystemCommand(&.{
        "node",
        "tools/check_agent_hermetic.mjs",
        "--zig",
    });
    hermetic_command.addArg(b.graph.zig_exe);
    if (boundary_archive) |path| hermetic_command.addArgs(&.{ "--boundary-archive", path });
    if (world_archive) |path| hermetic_command.addArgs(&.{ "--world-archive", path });
    const hermetic = b.step(
        "check-agent-hermetic",
        "Acquire exact public compiler archives, then run the compiler proof with network disabled",
    );
    hermetic.dependOn(&hermetic_command.step);
    const boundary_equivalence_check = addSpecializationTest(
        b,
        "check-agent-boundary-equivalence",
        "Compare ReAct with an isolated direct Boundary Control IR reference",
        "test/boundary_equivalence.zig",
        agent_module,
        boundary_module,
        target,
        optimize,
        semantic_check,
    );
    const performance_check = b.step(
        "check-agent-performance",
        "Check the authenticated Agent v2 resource regression gates",
    );
    performance_check.dependOn(boundary_equivalence_check);
    const performance_gate = b.addSystemCommand(&.{
        "node",
        "tools/check_agent_performance.mjs",
    });
    performance_check.dependOn(&performance_gate.step);
    semantic_check.dependOn(performance_check);

    const host_boundary_dependency = b.dependency("boundary", .{
        .target = b.graph.host,
        .optimize = .ReleaseSafe,
    });
    const host_agent = b.createModule(.{
        .root_source_file = b.path("src/root.zig"),
        .target = b.graph.host,
        .optimize = .ReleaseSafe,
    });
    host_agent.addImport("boundary", host_boundary_dependency.module("boundary"));
    const native_witness = b.createModule(.{
        .root_source_file = b.path("test/machine_native_wasm.zig"),
        .target = b.graph.host,
        .optimize = .ReleaseSafe,
    });
    native_witness.addImport("agent", host_agent);
    native_witness.addImport("boundary", host_boundary_dependency.module("boundary"));
    const native_runner = b.createModule(.{
        .root_source_file = b.path("test/run_machine_native.zig"),
        .target = b.graph.host,
        .optimize = .ReleaseSafe,
    });
    native_runner.addImport("witness", native_witness);
    const native_executable = b.addExecutable(.{
        .name = "agent-machine-native-parity",
        .root_module = native_runner,
    });
    const native_output = b.addRunArtifact(native_executable).captureStdOut(.{
        .basename = "agent-machine-native-parity.bin",
    });

    const wasm_target = b.resolveTargetQuery(.{
        .cpu_arch = .wasm32,
        .os_tag = .freestanding,
        .abi = .none,
    });
    const wasm_boundary_dependency = b.dependency("boundary", .{
        .target = wasm_target,
        .optimize = .ReleaseSmall,
    });
    const wasm_agent = b.createModule(.{
        .root_source_file = b.path("src/root.zig"),
        .target = wasm_target,
        .optimize = .ReleaseSmall,
    });
    wasm_agent.addImport("boundary", wasm_boundary_dependency.module("boundary"));
    const wasm_witness = b.createModule(.{
        .root_source_file = b.path("test/machine_native_wasm.zig"),
        .target = wasm_target,
        .optimize = .ReleaseSmall,
    });
    wasm_witness.addImport("agent", wasm_agent);
    wasm_witness.addImport("boundary", wasm_boundary_dependency.module("boundary"));
    const wasm_executable = b.addExecutable(.{
        .name = "agent-machine-wasm-parity",
        .root_module = wasm_witness,
    });
    wasm_executable.entry = .disabled;
    wasm_executable.rdynamic = true;
    wasm_executable.export_memory = true;
    const run_wasm = b.addSystemCommand(&.{"node"});
    run_wasm.addFileArg(b.path("test/run_machine_wasm.mjs"));
    run_wasm.addFileArg(wasm_executable.getEmittedBin());
    const wasm_output = run_wasm.captureStdOut(.{
        .basename = "agent-machine-wasm-parity.bin",
    });
    const compare_parity = b.addSystemCommand(&.{ "cmp", "-s" });
    compare_parity.addFileArg(native_output);
    compare_parity.addFileArg(wasm_output);
    const machine_native_wasm = b.step(
        "check-agent-machine-native-wasm",
        "Check byte-identical native and wasm32 Agent Machine observations",
    );
    machine_native_wasm.dependOn(&compare_parity.step);
    semantic_check.dependOn(machine_native_wasm);
    no_runtime.dependOn(&run_wasm.step);

    const release = b.step(
        "check-agent-release",
        "Run the Agent v2 ENF release-owner semantic proof",
    );
    const release_receipt = b.addSystemCommand(&.{
        "node",
        "tools/check_agent_release.mjs",
    });
    release_receipt.addArg(b.getInstallPath(.prefix, ""));
    release_receipt.addArg(b.graph.zig_exe);
    release_receipt.step.dependOn(semantic_check);
    release_receipt.step.dependOn(lint);
    release_receipt.step.dependOn(hermetic);
    release_receipt.step.dependOn(reference_stack);
    release_receipt.step.dependOn(actuality_wasm);
    release_receipt.step.dependOn(&install_contract.step);
    release_receipt.step.dependOn(&install_contract_binary.step);
    const release_receipt_output = release_receipt.captureStdOut(.{
        .basename = "completion-receipt.txt",
    });
    const install_release_receipt = b.addInstallFile(
        release_receipt_output,
        "agent-v2/completion-receipt.txt",
    );
    release.dependOn(&install_release_receipt.step);

    const adequacy_fixture_command = b.addSystemCommand(&.{
        "bun",
        "tools/adequacy/fixture-proof.mjs",
    });
    const adequacy_fixture = b.step(
        "check-agent-adequacy-fixture",
        "Prove the controlled router fixture fails initially and passes its reviewed visible and hidden solution",
    );
    adequacy_fixture.dependOn(&adequacy_fixture_command.step);

    const adequacy_compile_command = b.addSystemCommand(&.{
        b.graph.zig_exe,
        "build",
        "check",
        "--summary",
        "all",
    });
    adequacy_compile_command.setCwd(b.path("adequacy/router-policy-v1"));
    const adequacy_compile = b.step(
        "check-agent-adequacy-compile",
        "Compile the router-policy working set against the exact released dependency tuple",
    );
    adequacy_compile.dependOn(&adequacy_compile_command.step);
    const adequacy_epistemics = b.step(
        "check-agent-adequacy-epistemics",
        "Run the bounded working-set epistemics tests",
    );
    adequacy_epistemics.dependOn(adequacy_compile);
    const adequacy_native_wasm = b.step(
        "check-agent-adequacy-native-wasm",
        "Prove native and WASM manifest identity for the adequacy application",
    );
    adequacy_native_wasm.dependOn(adequacy_compile);

    const adequacy_modes = [_]struct {
        name: []const u8,
        mode: []const u8,
        description: []const u8,
    }{
        .{ .name = "check-agent-adequacy-deterministic", .mode = "deterministic", .description = "Run the exact 47-effect deterministic adequacy witness" },
        .{ .name = "check-agent-adequacy-retry", .mode = "retry", .description = "Prove lost-output retry at router replacement three" },
        .{ .name = "check-agent-adequacy-replay", .mode = "replay", .description = "Replay the adequacy trace with zero fresh effects" },
        .{ .name = "check-agent-adequacy-branch", .mode = "branch", .description = "Prove isolated pre-read adequacy branches" },
        .{ .name = "check-agent-adequacy-migrate", .mode = "migrate", .description = "Migrate the pre-mutation adequacy state under fresh receiver policy" },
        .{ .name = "check-agent-adequacy-measure", .mode = "measure", .description = "Measure the exact adequacy artifact and deterministic trace" },
    };
    for (adequacy_modes) |gate| {
        const command = b.addSystemCommand(&.{
            "bun",
            "tools/adequacy/run.mjs",
            "--mode",
            gate.mode,
            "--artifact-root",
            "adequacy/router-policy-v1/zig-out/router-policy-adequacy",
        });
        if (world_capabilities_root) |path| command.addArgs(&.{ "--capabilities-root", path });
        if (world_host_root) |path| command.addArgs(&.{ "--world-host-root", path });
        command.step.dependOn(adequacy_compile);
        const step = b.step(gate.name, gate.description);
        step.dependOn(&command.step);
    }

    const adequacy_live_command = b.addSystemCommand(&.{
        "bun",
        "tools/adequacy/run.mjs",
        "--mode",
        "live",
        "--artifact-root",
        "adequacy/router-policy-v1/zig-out/router-policy-adequacy",
    });
    if (world_capabilities_root) |path| adequacy_live_command.addArgs(&.{ "--capabilities-root", path });
    if (world_host_root) |path| adequacy_live_command.addArgs(&.{ "--world-host-root", path });
    adequacy_live_command.step.dependOn(adequacy_compile);
    const adequacy_live = b.step(
        "check-agent-adequacy-live",
        "Run the explicit OpenAI plus four receiver-verified replacement adequacy witness",
    );
    adequacy_live.dependOn(&adequacy_live_command.step);

    const adequacy_lock_command = b.addSystemCommand(&.{
        "bun",
        "tools/adequacy/check-lock.mjs",
        "--acquire",
        "true",
    });
    adequacy_lock_command.step.dependOn(adequacy_compile);
    const adequacy_lock = b.step(
        "check-agent-adequacy-lock",
        "Authenticate the successor release tuple and adequacy artifacts",
    );
    adequacy_lock.dependOn(&adequacy_lock_command.step);

    const adequacy_reference_command = b.addSystemCommand(&.{
        "bun",
        "tools/adequacy/reference-stack.mjs",
    });
    adequacy_reference_command.step.dependOn(adequacy_compile);
    const adequacy_reference = b.step(
        "check-agent-adequacy-reference-stack",
        "Acquire the public host and capabilities anonymously and run the complete deterministic lifecycle",
    );
    adequacy_reference.dependOn(&adequacy_reference_command.step);

    const adequacy_offline_command = b.addSystemCommand(&.{
        "bun",
        "tools/adequacy/reference-stack.mjs",
        "--offline",
        "true",
    });
    if (world_host_archive) |path| adequacy_offline_command.addArgs(&.{ "--world-host-archive", path });
    if (world_capabilities_archive) |path| adequacy_offline_command.addArgs(&.{ "--world-capabilities-archive", path });
    adequacy_offline_command.step.dependOn(adequacy_compile);
    const adequacy_offline = b.step(
        "check-agent-adequacy-reference-stack-offline",
        "Run the complete deterministic lifecycle from caller-supplied authenticated runtime archives",
    );
    adequacy_offline.dependOn(&adequacy_offline_command.step);

    const adequacy_release_command = b.addSystemCommand(&.{
        "bun",
        "tools/adequacy/build-release.mjs",
    });
    adequacy_release_command.step.dependOn(adequacy_compile);
    const adequacy_release = b.step(
        "check-agent-adequacy-release",
        "Validate the successor receipts and build the conformance release assets",
    );
    adequacy_release.dependOn(&adequacy_release_command.step);

    check.dependOn(semantic_check);
    check.dependOn(interpretation_proof);
    check.dependOn(lint);
}

fn addSharedBoundaryTest(
    b: *std.Build,
    name: []const u8,
    description: []const u8,
    path: []const u8,
    agent_module: *std.Build.Module,
    shared_boundary_module: *std.Build.Module,
    target: std.Build.ResolvedTarget,
    optimize: std.builtin.OptimizeMode,
    aggregate: *std.Build.Step,
) void {
    const module = b.createModule(.{
        .root_source_file = b.path(path),
        .target = target,
        .optimize = optimize,
    });
    module.addImport("agent", agent_module);
    module.addImport("boundary", shared_boundary_module);
    const tests = b.addTest(.{ .root_module = module });
    const run_tests = b.addRunArtifact(tests);
    const step = b.step(name, description);
    step.dependOn(&run_tests.step);
    aggregate.dependOn(step);
}

fn addExpectedCompileFailure(
    b: *std.Build,
    step: *std.Build.Step,
    path: []const u8,
    expected_error: []const u8,
    agent_module: *std.Build.Module,
    boundary_module: *std.Build.Module,
) void {
    const module = b.createModule(.{
        .root_source_file = b.path(path),
        .target = b.graph.host,
        .optimize = .Debug,
    });
    module.addImport("agent", agent_module);
    module.addImport("boundary", boundary_module);
    const compilation = b.addTest(.{ .root_module = module });
    compilation.expect_errors = .{ .contains = expected_error };
    step.dependOn(&compilation.step);
}

fn addSpecializationTest(
    b: *std.Build,
    name: []const u8,
    description: []const u8,
    path: []const u8,
    agent_module: *std.Build.Module,
    boundary_module: *std.Build.Module,
    target: std.Build.ResolvedTarget,
    optimize: std.builtin.OptimizeMode,
    aggregate: *std.Build.Step,
) *std.Build.Step {
    const research = b.createModule(.{
        .root_source_file = b.path("examples/research_agent.zig"),
        .target = target,
        .optimize = optimize,
    });
    research.addImport("agent", agent_module);
    research.addImport("boundary", boundary_module);
    const coding = b.createModule(.{
        .root_source_file = b.path("examples/coding_agent.zig"),
        .target = target,
        .optimize = optimize,
    });
    coding.addImport("agent", agent_module);
    coding.addImport("boundary", boundary_module);

    const module = b.createModule(.{
        .root_source_file = b.path(path),
        .target = target,
        .optimize = optimize,
    });
    module.addImport("agent", agent_module);
    module.addImport("boundary", boundary_module);
    module.addImport("research_agent", research);
    module.addImport("coding_agent", coding);
    const tests = b.addTest(.{ .root_module = module });
    const run_tests = b.addRunArtifact(tests);
    const step = b.step(name, description);
    step.dependOn(&run_tests.step);
    aggregate.dependOn(step);
    return step;
}

fn addFocusedTest(
    b: *std.Build,
    name: []const u8,
    description: []const u8,
    path: []const u8,
    agent_module: *std.Build.Module,
    boundary_module: *std.Build.Module,
    target: std.Build.ResolvedTarget,
    optimize: std.builtin.OptimizeMode,
    aggregate: *std.Build.Step,
) void {
    const module = b.createModule(.{
        .root_source_file = b.path(path),
        .target = target,
        .optimize = optimize,
    });
    module.addImport("agent", agent_module);
    module.addImport("boundary", boundary_module);
    const tests = b.addTest(.{ .root_module = module });
    const run_tests = b.addRunArtifact(tests);
    const step = b.step(name, description);
    step.dependOn(&run_tests.step);
    aggregate.dependOn(step);
}

fn addActualityDefinitionTest(
    b: *std.Build,
    name: []const u8,
    description: []const u8,
    path: []const u8,
    agent_module: *std.Build.Module,
    boundary_module: *std.Build.Module,
    target: std.Build.ResolvedTarget,
    optimize: std.builtin.OptimizeMode,
    aggregate: *std.Build.Step,
) *std.Build.Step {
    const actuality = b.createModule(.{
        .root_source_file = b.path("examples/repository_repair_actuality.zig"),
        .target = target,
        .optimize = optimize,
    });
    actuality.addImport("agent", agent_module);
    actuality.addImport("boundary", boundary_module);
    const actuality_definition = b.createModule(.{
        .root_source_file = b.path("actuality/repository_repair_definition.zig"),
        .target = target,
        .optimize = optimize,
    });
    actuality.addImport("repository_repair_definition", actuality_definition);

    const module = b.createModule(.{
        .root_source_file = b.path(path),
        .target = target,
        .optimize = optimize,
    });
    module.addImport("agent", agent_module);
    module.addImport("boundary", boundary_module);
    module.addImport("repository_repair_actuality", actuality);
    const tests = b.addTest(.{ .root_module = module });
    tests.stack_size = 256 * 1024 * 1024;
    const run_tests = b.addRunArtifact(tests);
    const step = b.step(name, description);
    step.dependOn(&run_tests.step);
    aggregate.dependOn(step);
    return step;
}

fn sha256File(
    b: *std.Build,
    input: std.Build.LazyPath,
    basename: []const u8,
) std.Build.LazyPath {
    const command = b.addSystemCommand(&.{"bun"});
    command.addFileArg(b.path("tools/sha256_file.mjs"));
    command.addFileArg(input);
    return command.captureStdOut(.{ .basename = basename });
}
