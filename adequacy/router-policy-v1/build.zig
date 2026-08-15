const std = @import("std");

const wasm_memory_pages: u32 = 4096;

pub fn build(b: *std.Build) void {
    const host_target = b.graph.host;
    const wasm_stack_size_bytes = b.option(
        u64,
        "wasm-stack-bytes",
        "Diagnostic WASM stack override; released artifact remains bounded to 128 MiB",
    ) orelse 128 * 1024 * 1024;
    const wasm_optimize = b.option(
        std.builtin.OptimizeMode,
        "wasm-optimize",
        "Diagnostic WASM optimization mode",
    ) orelse .ReleaseFast;
    const wasm_target = b.resolveTargetQuery(.{
        .cpu_arch = .wasm32,
        .os_tag = .freestanding,
        .abi = .none,
    });

    const host_agent_dependency = b.dependency("agent", .{ .target = host_target, .optimize = .ReleaseSafe });
    const host_world_dependency = b.dependency("world", .{ .target = host_target, .optimize = .ReleaseSafe });
    const host_agent = host_agent_dependency.module("agent");
    const host_boundary = host_agent_dependency.module("boundary");
    const host_world = host_world_dependency.module("world");

    const host_application = applicationModule(b, host_target, .ReleaseSafe, host_agent, host_boundary, host_world);
    const host_definition = b.createModule(.{
        .root_source_file = b.path("src/definition.zig"),
        .target = host_target,
        .optimize = .ReleaseSafe,
        .imports = &.{
            .{ .name = "agent", .module = host_agent },
            .{ .name = "boundary", .module = host_boundary },
        },
    });
    const tests = b.addTest(.{ .root_module = host_application });
    tests.stack_size = wasm_stack_size_bytes;
    const run_tests = b.addRunArtifact(tests);

    const epistemics_tests = b.addTest(.{
        .root_module = b.createModule(.{
            .root_source_file = b.path("src/epistemics_test.zig"),
            .target = host_target,
            .optimize = .ReleaseSafe,
            .imports = &.{
                .{ .name = "boundary", .module = host_boundary },
                .{ .name = "router_policy_definition", .module = host_definition },
            },
        }),
    });
    // Zig's test runner nests the generated reducer beneath its own dispatch
    // frames; this is a host-test allowance, not the packaged WASM stack.
    epistemics_tests.stack_size = 512 * 1024 * 1024;
    const run_epistemics_tests = b.addRunArtifact(epistemics_tests);

    const wasm_agent_dependency = b.dependency("agent", .{ .target = wasm_target, .optimize = wasm_optimize });
    const wasm_world_dependency = b.dependency("world", .{ .target = wasm_target, .optimize = wasm_optimize });
    const wasm_application = applicationModule(
        b,
        wasm_target,
        wasm_optimize,
        wasm_agent_dependency.module("agent"),
        wasm_agent_dependency.module("boundary"),
        wasm_world_dependency.module("world"),
    );
    const wasm = b.addExecutable(.{
        .name = "router-policy-adequacy.world",
        .root_module = b.createModule(.{
            .root_source_file = b.path("src/wasm_main.zig"),
            .target = wasm_target,
            .optimize = wasm_optimize,
            .imports = &.{
                .{ .name = "world", .module = wasm_world_dependency.module("world") },
                .{ .name = "router_policy_application", .module = wasm_application },
            },
        }),
    });
    wasm.entry = .disabled;
    wasm.rdynamic = true;
    wasm.export_memory = true;
    wasm.stack_size = wasm_stack_size_bytes;
    wasm.initial_memory = @as(u64, wasm_memory_pages) * 64 * 1024;
    wasm.max_memory = @as(u64, wasm_memory_pages) * 64 * 1024;

    // Zig/LLD emits sparse typed constants as padded active data. Split only
    // long zero runs while preserving every original address: generated data
    // contains absolute pointers and therefore must never be relocated.
    const pack_wasm = b.addSystemCommand(&.{ "node", "../../tools/adequacy/sparse-wasm-data.mjs" });
    pack_wasm.addFileArg(wasm.getEmittedBin());
    const packed_wasm = pack_wasm.addOutputFileArg("router-policy-adequacy.world.wasm");

    const manifest_emitter = b.addExecutable(.{
        .name = "router-policy-adequacy-manifest",
        .root_module = b.createModule(.{
            .root_source_file = host_world_dependency.path("src/application_manifest_emit_v1.zig"),
            .target = host_target,
            .optimize = .ReleaseSafe,
            .imports = &.{.{ .name = "world_application", .module = host_application }},
        }),
    });
    const run_manifest = b.addRunArtifact(manifest_emitter);
    const manifest = run_manifest.addOutputFileArg("router-policy-adequacy.manifest.bin");
    const manifest_text = run_manifest.addOutputFileArg("router-policy-adequacy.manifest.txt");

    const artifact_check = b.addSystemCommand(&.{"node"});
    artifact_check.addFileArg(wasm_world_dependency.path("scripts/world_application_v1_artifact_check.mjs"));
    artifact_check.addFileArg(packed_wasm);
    artifact_check.addFileArg(manifest);
    artifact_check.addArg("4096");
    artifact_check.addArg("4096");

    const contract_json = addContractEmitter(b, "emit-router-policy-decision-contract-json", false, host_agent, host_boundary);
    const contract_json_output = b.addRunArtifact(contract_json).captureStdOut(.{
        .basename = "router-policy-adequacy.decision-contract.json",
    });
    const contract_binary = addContractEmitter(b, "emit-router-policy-decision-contract-binary", true, host_agent, host_boundary);
    const contract_binary_output = b.addRunArtifact(contract_binary).captureStdOut(.{
        .basename = "router-policy-adequacy.decision-contract.bin",
    });

    const initial_args_module = b.createModule(.{
        .root_source_file = b.path("src/emit_initial_args.zig"),
        .target = host_target,
        .optimize = .ReleaseSafe,
        .imports = &.{
            .{ .name = "agent", .module = host_agent },
            .{ .name = "boundary", .module = host_boundary },
        },
    });
    const initial_args = b.addExecutable(.{ .name = "emit-router-policy-initial-args", .root_module = initial_args_module });
    const initial_args_output = b.addRunArtifact(initial_args).captureStdOut(.{
        .basename = "router-policy-adequacy.initial-args.bin",
    });

    const type_measurements = b.addExecutable(.{
        .name = "emit-router-policy-type-measurements",
        .root_module = b.createModule(.{
            .root_source_file = b.path("src/emit_type_measurements.zig"),
            .target = host_target,
            .optimize = .ReleaseSafe,
            .imports = &.{.{ .name = "router_policy_definition", .module = host_definition }},
        }),
    });
    const type_measurements_output = b.addRunArtifact(type_measurements).captureStdOut(.{
        .basename = "router-policy-adequacy.type-measurements.txt",
    });

    const install_wasm = b.addInstallFile(packed_wasm, "router-policy-adequacy/router-policy-adequacy.world.wasm");
    install_wasm.step.dependOn(&artifact_check.step);
    const install_manifest = b.addInstallFile(manifest, "router-policy-adequacy/router-policy-adequacy.manifest.bin");
    install_manifest.step.dependOn(&artifact_check.step);
    const install_manifest_text = b.addInstallFile(manifest_text, "router-policy-adequacy/router-policy-adequacy.manifest.txt");
    install_manifest_text.step.dependOn(&artifact_check.step);
    const install_contract_json = b.addInstallFile(contract_json_output, "router-policy-adequacy/router-policy-adequacy.decision-contract.json");
    const install_contract_binary = b.addInstallFile(contract_binary_output, "router-policy-adequacy/router-policy-adequacy.decision-contract.bin");
    const install_initial_args = b.addInstallFile(initial_args_output, "router-policy-adequacy/router-policy-adequacy.initial-args.bin");
    const install_type_measurements = b.addInstallFile(type_measurements_output, "router-policy-adequacy/router-policy-adequacy.type-measurements.txt");

    const check = b.step("check", "Compile, test, and package the router-policy adequacy application");
    check.dependOn(&run_tests.step);
    check.dependOn(&run_epistemics_tests.step);
    check.dependOn(&artifact_check.step);
    check.dependOn(&contract_json.step);
    check.dependOn(&contract_binary.step);
    check.dependOn(&initial_args.step);
    check.dependOn(&type_measurements.step);

    b.getInstallStep().dependOn(&install_wasm.step);
    b.getInstallStep().dependOn(&install_manifest.step);
    b.getInstallStep().dependOn(&install_manifest_text.step);
    b.getInstallStep().dependOn(&install_contract_json.step);
    b.getInstallStep().dependOn(&install_contract_binary.step);
    b.getInstallStep().dependOn(&install_initial_args.step);
    b.getInstallStep().dependOn(&install_type_measurements.step);
}

fn applicationModule(
    b: *std.Build,
    target: std.Build.ResolvedTarget,
    optimize: std.builtin.OptimizeMode,
    agent: *std.Build.Module,
    boundary: *std.Build.Module,
    world: *std.Build.Module,
) *std.Build.Module {
    return b.createModule(.{
        .root_source_file = b.path("src/application.zig"),
        .target = target,
        .optimize = optimize,
        .imports = &.{
            .{ .name = "agent", .module = agent },
            .{ .name = "boundary", .module = boundary },
            .{ .name = "world", .module = world },
        },
    });
}

fn addContractEmitter(
    b: *std.Build,
    name: []const u8,
    binary: bool,
    agent: *std.Build.Module,
    boundary: *std.Build.Module,
) *std.Build.Step.Compile {
    const options = b.addOptions();
    options.addOption(bool, "binary", binary);
    const module = b.createModule(.{
        .root_source_file = b.path("src/emit_decision_contract.zig"),
        .target = b.graph.host,
        .optimize = .ReleaseSafe,
        .imports = &.{
            .{ .name = "agent", .module = agent },
            .{ .name = "boundary", .module = boundary },
            .{ .name = "emit_contract_options", .module = options.createModule() },
        },
    });
    return b.addExecutable(.{ .name = name, .root_module = module });
}
