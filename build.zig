const std = @import("std");

const TestSpec = struct {
    name: []const u8,
    description: []const u8,
    path: []const u8,
};

pub fn build(b: *std.Build) void {
    const target = b.standardTargetOptions(.{});
    const optimize = b.standardOptimizeOption(.{});
    const world_process_root = b.option(
        []const u8,
        "world-process-root",
        "Exact released World Process-host runtime root for integration proof",
    );

    const boundary_dependency = b.dependency("boundary", .{
        .target = target,
        .optimize = optimize,
    });
    const boundary_module = boundary_dependency.module("boundary");
    const agent_module = b.addModule("agent", .{
        .root_source_file = b.path("src/root.zig"),
        .target = target,
        .optimize = optimize,
    });
    agent_module.addImport("boundary", boundary_module);
    const semantic = b.step(
        "check-agent-semantic",
        "Run the canonical Agent 3 compiler and portable-runtime proofs",
    );
    const root_tests = b.addTest(.{ .root_module = agent_module });
    const run_root_tests = b.addRunArtifact(root_tests);
    semantic.dependOn(&run_root_tests.step);
    inline for ([_]TestSpec{
        .{ .name = "check-agent-flow", .description = "Validate Flow lowering", .path = "test/flow.zig" },
        .{ .name = "check-agent-system-api", .description = "Validate the canonical complete-system API", .path = "test/system.zig" },
        .{ .name = "check-agent-local-action", .description = "Prove image-owned local actions", .path = "test/local_action.zig" },
        .{ .name = "check-agent-repository-system", .description = "Compile the complete repository system", .path = "actuality/repository_repair_system_v1.zig" },
    }) |spec| {
        _ = addFocusedTest(
            b,
            spec,
            agent_module,
            boundary_module,
            target,
            optimize,
            semantic,
        );
    }

    addOpenLifetimeTests(b, agent_module, boundary_module, target, semantic);

    const compile_fail = b.step(
        "compile-fail",
        "Run Agent 3 source-admission rejection witnesses",
    );
    addExpectedCompileFailure(
        b,
        compile_fail,
        "test/compile_fail/system_unknown_field.zig",
        "agent.system unknown source field 'host_agent_loop'",
        agent_module,
        boundary_module,
    );
    addExpectedCompileFailure(
        b,
        compile_fail,
        "test/compile_fail/system_missing_descriptor.zig",
        "agent system requires exactly one descriptor per Action variant",
        agent_module,
        boundary_module,
    );
    addExpectedCompileFailure(
        b,
        compile_fail,
        "test/compile_fail/system_duplicate_action_name.zig",
        "agent system model-visible action name is duplicated",
        agent_module,
        boundary_module,
    );
    addExpectedCompileFailure(
        b,
        compile_fail,
        "test/compile_fail/system_dangling_skill_action.zig",
        "agent skill references an unknown model-visible action",
        agent_module,
        boundary_module,
    );
    addExpectedCompileFailure(
        b,
        compile_fail,
        "test/compile_fail/system_effect_payload_mismatch.zig",
        "agent system Action payload differs from its effect payload",
        agent_module,
        boundary_module,
    );
    addExpectedCompileFailure(
        b,
        compile_fail,
        "test/compile_fail/model_unknown_parameter.zig",
        "agent model parameters contain unsupported field 'provider_magic'",
        agent_module,
        boundary_module,
    );
    addExpectedCompileFailure(
        b,
        compile_fail,
        "test/compile_fail/model_unknown_field.zig",
        "agent.model unknown source field 'paramters'",
        agent_module,
        boundary_module,
    );
    addExpectedCompileFailure(
        b,
        compile_fail,
        "test/compile_fail/system_invalid_action_name.zig",
        "agent system model-visible action name must match [A-Za-z0-9_-]{1,64}",
        agent_module,
        boundary_module,
    );
    addExpectedCompileFailure(
        b,
        compile_fail,
        "test/compile_fail/model_noncanonical_temperature.zig",
        "agent model temperature must be a canonical decimal from 0 through 2",
        agent_module,
        boundary_module,
    );
    addExpectedCompileFailure(
        b,
        compile_fail,
        "test/compile_fail/system_actionless.zig",
        "agent system requires at least one Action variant",
        agent_module,
        boundary_module,
    );
    addExpectedCompileFailure(
        b,
        compile_fail,
        "test/compile_fail/system_forged_strategy.zig",
        "agent system strategy must be one staged Agent 3 strategy",
        agent_module,
        boundary_module,
    );
    addExpectedCompileFailure(
        b,
        compile_fail,
        "test/compile_fail/system_zero_response_bytes.zig",
        "Agent 3 ReAct response_bytes must be positive",
        agent_module,
        boundary_module,
    );
    addExpectedCompileFailure(
        b,
        compile_fail,
        "test/compile_fail/system_forged_model.zig",
        "agent system model must be constructed by agent.model",
        agent_module,
        boundary_module,
    );
    addExpectedCompileFailure(
        b,
        compile_fail,
        "test/compile_fail/system_reserved_model_effect.zig",
        "agent system external action identity is reserved for the model protocol",
        agent_module,
        boundary_module,
    );
    semantic.dependOn(compile_fail);

    const repository_module = b.createModule(.{
        .root_source_file = b.path("actuality/repository_repair_system_v1.zig"),
        .target = b.graph.host,
        .optimize = .ReleaseSafe,
    });
    repository_module.addImport("agent", agent_module);
    repository_module.addImport("boundary", boundary_module);
    const emitter_module = b.createModule(.{
        .root_source_file = b.path("actuality/emit_repository_system_v1.zig"),
        .target = b.graph.host,
        .optimize = .Debug,
    });
    emitter_module.addImport("agent", agent_module);
    emitter_module.addImport("boundary", boundary_module);
    emitter_module.addImport("repository_system", repository_module);
    const emitter = b.addExecutable(.{
        .name = "emit-agent-repository-system-v1",
        .root_module = emitter_module,
    });
    const modes = .{
        .{ "bpi1", "repository-system.bpi1" },
        .{ "initial", "repository-system-initial.bin" },
        .{ "expected-final", "repository-system-final.bin" },
        .{ "source-map", "repository-system.source-map.json" },
    };
    var outputs: [modes.len]std.Build.LazyPath = undefined;
    const emit_repository = b.step(
        "emit-agent-repository-system-v1",
        "Emit ordinary BPI1 and InitialArgs",
    );
    inline for (modes, 0..) |mode, index| {
        const run = b.addRunArtifact(emitter);
        run.addArg(mode[0]);
        outputs[index] = run.captureStdOut(.{ .basename = mode[1] });
        emit_repository.dependOn(&run.step);
    }
    const ablation_emitter_module = b.createModule(.{
        .root_source_file = b.path("actuality/emit_repository_system_ablation_v1.zig"),
        .target = b.graph.host,
        .optimize = .Debug,
    });
    const economy_agent_module = b.createModule(.{
        .root_source_file = b.path("src/economy_tooling_root.zig"),
        .target = b.graph.host,
        .optimize = .Debug,
    });
    economy_agent_module.addImport("boundary", boundary_module);
    const repository_economy_module = b.createModule(.{
        .root_source_file = b.path("actuality/repository_repair_system_v1.zig"),
        .target = b.graph.host,
        .optimize = .ReleaseSafe,
    });
    repository_economy_module.addImport("agent", economy_agent_module);
    repository_economy_module.addImport("boundary", boundary_module);
    ablation_emitter_module.addImport("agent", economy_agent_module);
    ablation_emitter_module.addImport("boundary", boundary_module);
    ablation_emitter_module.addImport(
        "repository_system",
        repository_economy_module,
    );
    const ablation_emitter = b.addExecutable(.{
        .name = "emit-agent-repository-system-ablation-v1",
        .root_module = ablation_emitter_module,
    });
    const emit_repository_ablation = b.step(
        "emit-agent-repository-system-ablation-v1",
        "Emit the repository system with Action argument decoding ablated",
    );
    inline for (.{
        .{ "bpi1", "repository-system-no-action-decode.bpi1" },
        .{ "source-map", "repository-system-no-action-decode.source-map.json" },
    }) |mode| {
        const run_ablation_emitter = b.addRunArtifact(ablation_emitter);
        run_ablation_emitter.addArg(mode[0]);
        _ = run_ablation_emitter.captureStdOut(.{ .basename = mode[1] });
        emit_repository_ablation.dependOn(&run_ablation_emitter.step);
    }
    const scaling_emitter_module = b.createModule(.{
        .root_source_file = b.path("actuality/emit_economy_scaling_v1.zig"),
        .target = b.graph.host,
        .optimize = .Debug,
    });
    scaling_emitter_module.addImport("agent", economy_agent_module);
    scaling_emitter_module.addImport("boundary", boundary_module);
    const scaling_emitter = b.addExecutable(.{
        .name = "emit-agent-economy-scaling-v1",
        .root_module = scaling_emitter_module,
    });
    const scaling_modes = .{
        "prompt-1k",
        "prompt-8k",
        "prompt-16k",
        "skill-base",
        "skill-4k",
        "tool-base",
        "tool-extra",
        "model-fixed-no-tools",
        "model-dynamic-goal",
        "six-tools-no-decode",
        "six-tools-decode",
    };
    var scaling_outputs: [scaling_modes.len]std.Build.LazyPath = undefined;
    inline for (scaling_modes, 0..) |mode, index| {
        const run = b.addRunArtifact(scaling_emitter);
        run.addArg(mode);
        scaling_outputs[index] = run.captureStdOut(.{
            .basename = b.fmt("{s}.bpi1", .{mode}),
        });
    }
    const economy_check_command = b.addSystemCommand(&.{
        "node",
        "tools/check_agent_system_economy_v1.mjs",
    });
    for (scaling_outputs) |output| economy_check_command.addFileArg(output);
    economy_check_command.addFileInput(
        b.path("tools/check_agent_system_economy_v1.mjs"),
    );
    const economy_check = b.step(
        "check-agent-system-economy-v1",
        "Validate Agent image, execution, and marginal economy gates",
    );
    economy_check.dependOn(&economy_check_command.step);
    const process_state_census_test = b.addSystemCommand(&.{
        "node",
        "test/process_state_census.test.mjs",
    });
    process_state_census_test.addFileArg(outputs[0]);
    process_state_census_test.addFileArg(outputs[3]);
    process_state_census_test.addFileInput(
        b.path("test/process_state_census.test.mjs"),
    );
    process_state_census_test.addFileInput(
        b.path("system_closure_v1/process_state_census.mjs"),
    );
    const process_state_census_step = b.step(
        "check-agent-process-state-census",
        "Validate source-independent Process State census accounting.",
    );
    process_state_census_step.dependOn(&process_state_census_test.step);
    const repository_admission_files = b.addWriteFiles();
    const repository_admission_source = repository_admission_files.addCopyFile(
        b.path("test/repository_admission.zig"),
        "repository_admission.zig",
    );
    _ = repository_admission_files.addCopyFile(
        outputs[0],
        "repository-system.bpi1",
    );
    _ = repository_admission_files.addCopyFile(
        outputs[1],
        "repository-system-initial.bin",
    );
    const repository_admission_module = b.createModule(.{
        .root_source_file = repository_admission_source,
        .target = target,
        .optimize = .ReleaseFast,
    });
    repository_admission_module.addImport("boundary", boundary_module);
    const repository_admission_tests = b.addTest(.{
        .root_module = repository_admission_module,
    });
    const run_repository_admission_tests = b.addRunArtifact(
        repository_admission_tests,
    );
    const repository_admission_proof_executable = b.addExecutable(.{
        .name = "emit-agent-native-admission-proof-v1",
        .root_module = repository_admission_module,
    });
    const run_repository_admission_proof = b.addRunArtifact(
        repository_admission_proof_executable,
    );
    const repository_admission_proof = run_repository_admission_proof.captureStdOut(.{
        .basename = "native-admission-proof.json",
    });
    const repository_admission_step = b.step(
        "check-agent-repository-admission",
        "Reject stale mutation and false completion from current portable State",
    );
    repository_admission_step.dependOn(&run_repository_admission_tests.step);
    repository_admission_step.dependOn(&run_repository_admission_proof.step);

    const world_check = b.step(
        "check-agent-repository-system-world",
        "Execute the source-free closure distribution through released World",
    );
    world_check.dependOn(repository_admission_step);

    const closure_check = b.step(
        "check-agent-system-closure-v1",
        "Run deterministic Agent System Closure v1 checks",
    );
    closure_check.dependOn(semantic);
    closure_check.dependOn(process_state_census_step);
    const model_protocol_adapter_test = b.addSystemCommand(&.{
        "node",
        "--test",
        "system_closure_v1/model_protocol_adapter.test.mjs",
    });
    model_protocol_adapter_test.addFileInput(
        b.path("system_closure_v1/model_protocol_adapter.test.mjs"),
    );
    model_protocol_adapter_test.addFileInput(
        b.path("system_closure_v1/model_protocol_adapter.mjs"),
    );
    closure_check.dependOn(&model_protocol_adapter_test.step);
    inline for (.{
        "system_closure_v1/run.mjs",
        "system_closure_v1/runtime.mjs",
        "system_closure_v1/model_protocol_adapter.mjs",
        "system_closure_v1/process_state_census.mjs",
        "system_closure_v1/fixture_model_server.mjs",
        "system_closure_v1/repository_environment.mjs",
    }) |runtime_path| {
        const syntax = b.addSystemCommand(&.{ "node", "--check", runtime_path });
        syntax.addFileInput(b.path(runtime_path));
        closure_check.dependOn(&syntax.step);
    }
    if (world_process_root != null) closure_check.dependOn(world_check);
    const emit_closure = b.step(
        "emit-agent-system-closure-v1",
        "Emit the Agent System Closure v1 distribution and receipt",
    );
    const package_closure = b.addSystemCommand(&.{ "node", "tools/emit_agent_system_closure_v1.mjs" });
    package_closure.has_side_effects = true;
    package_closure.addFileInput(b.path("tools/emit_agent_system_closure_v1.mjs"));
    package_closure.addArg("--agent-root");
    package_closure.addDirectoryArg(b.path("."));
    package_closure.addArg("--boundary-root");
    package_closure.addDirectoryArg(boundary_dependency.path("."));
    package_closure.addArg("--image");
    package_closure.addFileArg(outputs[0]);
    package_closure.addArg("--initial-args");
    package_closure.addFileArg(outputs[1]);
    package_closure.addArg("--source-map");
    package_closure.addFileArg(outputs[3]);
    package_closure.addArg("--archive");
    const closure_archive = package_closure.addOutputFileArg(
        "agent-v3.0.0-system-closure-v1.tar.gz",
    );
    package_closure.addArg("--checksum");
    const closure_checksum = package_closure.addOutputFileArg(
        "agent-v3.0.0-system-closure-v1.tar.gz.sha256",
    );
    package_closure.addArg("--receipt");
    const closure_receipt = package_closure.addOutputFileArg(
        "agent-v3.0.0-system-closure-v1-receipt.json",
    );
    for ([_][]const u8{
        "LICENSE",
        "system_closure_v1/README.md",
        "system_closure_v1/run.mjs",
        "system_closure_v1/runtime.mjs",
        "system_closure_v1/model_protocol_adapter.mjs",
        "system_closure_v1/process_state_census.mjs",
        "system_closure_v1/fixture_model_server.mjs",
        "system_closure_v1/repository_environment.mjs",
        "system_closure_v1/fixture-proof.json",
        "system_closure_v1/admission-proof.json",
        "economy/semantic-closure-corrected-process.json",
        "fixtures/repository-repair-v1/README.md",
        "fixtures/repository-repair-v1/package.json",
        "fixtures/repository-repair-v1/src/range.mjs",
        "fixtures/repository-repair-v1/test/range.test.mjs",
    }) |path| package_closure.addFileInput(b.path(path));
    const install_closure_archive = b.addInstallFile(
        closure_archive,
        "agent-v3.0.0-system-closure-v1.tar.gz",
    );
    const install_closure_checksum = b.addInstallFile(
        closure_checksum,
        "agent-v3.0.0-system-closure-v1.tar.gz.sha256",
    );
    const install_closure_receipt = b.addInstallFile(
        closure_receipt,
        "agent-v3.0.0-system-closure-v1-receipt.json",
    );
    emit_closure.dependOn(&install_closure_archive.step);
    emit_closure.dependOn(&install_closure_checksum.step);
    emit_closure.dependOn(&install_closure_receipt.step);

    const check_distribution = b.addSystemCommand(&.{
        "node",
        "tools/check_agent_system_closure_distribution.mjs",
    });
    check_distribution.addArg("--archive");
    check_distribution.addFileArg(closure_archive);
    check_distribution.addArg("--checksum");
    check_distribution.addFileArg(closure_checksum);
    check_distribution.addArg("--receipt");
    check_distribution.addFileArg(closure_receipt);
    check_distribution.addFileInput(
        b.path("tools/check_agent_system_closure_distribution.mjs"),
    );
    emit_closure.dependOn(&check_distribution.step);

    if (world_process_root) |root| {
        const runtime_binding_test = b.addSystemCommand(&.{
            "node",
            "test/runtime_checkpoint_binding.test.mjs",
        });
        runtime_binding_test.addFileInput(
            b.path("test/runtime_checkpoint_binding.test.mjs"),
        );
        runtime_binding_test.addFileArg(
            b.path("system_closure_v1/runtime.mjs"),
        );
        runtime_binding_test.addArg(root);
        runtime_binding_test.addFileArg(outputs[0]);
        runtime_binding_test.addFileArg(outputs[1]);
        runtime_binding_test.addDirectoryArg(
            b.path("fixtures/repository-repair-v1"),
        );
        world_check.dependOn(&runtime_binding_test.step);
        const run = b.addSystemCommand(&.{
            "node",
            "tools/check_agent_system_closure_distribution.mjs",
        });
        run.addArg("--archive");
        run.addFileArg(closure_archive);
        run.addArg("--checksum");
        run.addFileArg(closure_checksum);
        run.addArg("--receipt");
        run.addFileArg(closure_receipt);
        run.addArgs(&.{ "--world-root", root });
        run.addFileInput(b.path("tools/check_agent_system_closure_distribution.mjs"));
        world_check.dependOn(&run.step);
        const admission_specs = .{
            .{ "transfers", "" },
            .{ "negative", "pre-baseline-replacement" },
            .{ "negative", "disallowed-read-role" },
            .{ "negative", "premature-completion" },
        };
        var admission_outputs: [admission_specs.len]std.Build.LazyPath = undefined;
        inline for (admission_specs, 0..) |spec, index| {
            const shard = b.addSystemCommand(&.{
                "node",
                "tools/check_agent_system_admission_negatives.mjs",
            });
            shard.addArgs(&.{ "--world-root", root, "--image" });
            shard.addFileArg(outputs[0]);
            shard.addArg("--initial");
            shard.addFileArg(outputs[1]);
            shard.addArgs(&.{ "--mode", spec[0] });
            if (spec[1].len != 0) shard.addArgs(&.{ "--case", spec[1] });
            shard.addFileInput(
                b.path("tools/check_agent_system_admission_negatives.mjs"),
            );
            admission_outputs[index] = shard.captureStdOut(.{
                .basename = b.fmt("admission-{d}.json", .{index}),
            });
        }
        const merge_admission = b.addSystemCommand(&.{
            "node",
            "tools/merge_agent_system_admission_proofs.mjs",
        });
        for (admission_outputs) |output| merge_admission.addFileArg(output);
        merge_admission.addFileArg(repository_admission_proof);
        merge_admission.addFileArg(
            b.path("system_closure_v1/fixture-proof.json"),
        );
        merge_admission.addFileInput(
            b.path("tools/merge_agent_system_admission_proofs.mjs"),
        );
        world_check.dependOn(&merge_admission.step);
    } else {
        const missing = b.addSystemCommand(&.{
            "sh",
            "-c",
            "printf '%s\\n' 'check-agent-repository-system-world requires -Dworld-process-root=/absolute/path' >&2; exit 1",
        });
        world_check.dependOn(&missing.step);
    }

    const format = b.addSystemCommand(&.{
        b.graph.zig_exe,
        "fmt",
        "--check",
        "build.zig",
        "src",
        "test",
        "actuality/repository_repair_system_v1.zig",
        "actuality/emit_repository_system_v1.zig",
        "actuality/emit_repository_system_ablation_v1.zig",
        "actuality/emit_economy_scaling_v1.zig",
    });
    const paths = b.addSystemCommand(&.{ "sh", "tools/check_zig_paths.sh" });
    const lint = b.step("lint", "Check Zig formatting and source inventory");
    lint.dependOn(&format.step);
    lint.dependOn(&paths.step);

    const check = b.step("check", "Compile and test Agent 3");
    check.dependOn(closure_check);
    check.dependOn(economy_check);
    check.dependOn(repository_admission_step);
    check.dependOn(lint);
}

fn addFocusedTest(
    b: *std.Build,
    spec: TestSpec,
    agent_module: *std.Build.Module,
    boundary_module: *std.Build.Module,
    target: std.Build.ResolvedTarget,
    optimize: std.builtin.OptimizeMode,
    aggregate: *std.Build.Step,
) *std.Build.Step {
    return addFilteredFocusedTest(
        b,
        spec,
        &.{},
        agent_module,
        boundary_module,
        target,
        optimize,
        aggregate,
    );
}

fn addFilteredFocusedTest(
    b: *std.Build,
    spec: TestSpec,
    filters: []const []const u8,
    agent_module: *std.Build.Module,
    boundary_module: *std.Build.Module,
    target: std.Build.ResolvedTarget,
    optimize: std.builtin.OptimizeMode,
    aggregate: *std.Build.Step,
) *std.Build.Step {
    const module = b.createModule(.{
        .root_source_file = b.path(spec.path),
        .target = target,
        .optimize = optimize,
    });
    module.addImport("agent", agent_module);
    module.addImport("boundary", boundary_module);
    const tests = b.addTest(.{ .root_module = module, .filters = filters });
    const run = b.addRunArtifact(tests);
    const step = b.step(spec.name, spec.description);
    step.dependOn(&run.step);
    aggregate.dependOn(step);
    return step;
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

fn addOpenLifetimeTests(
    b: *std.Build,
    agent_module: *std.Build.Module,
    boundary_module: *std.Build.Module,
    target: std.Build.ResolvedTarget,
    aggregate: *std.Build.Step,
) void {
    const module = b.createModule(.{
        .root_source_file = b.path("test/open_lifetime.zig"),
        .target = target,
        .optimize = .ReleaseFast,
    });
    module.addImport("agent", agent_module);
    module.addImport("boundary", boundary_module);
    const tests = b.addTest(.{
        .root_module = module,
        .test_runner = .{ .path = b.path("test/selective_runner.zig"), .mode = .simple },
    });
    inline for ([_]struct {
        name: []const u8,
        description: []const u8,
        selector: []const u8,
    }{
        .{ .name = "check-agent-open-lifetime", .description = "Prove a no-final canonical State cycle", .selector = "no-final system" },
        .{ .name = "check-agent-model-failures", .description = "Map normalized model failures without dispatch", .selector = "normalized model failures" },
        .{ .name = "check-agent-multiple-calls", .description = "Reject multiple normalized function calls", .selector = "multiple normalized" },
        .{ .name = "check-agent-action-validation", .description = "Reject unknown actions and malformed arguments", .selector = "unknown actions" },
    }) |spec| {
        const run = b.addRunArtifact(tests);
        run.addArg(spec.selector);
        const step = b.step(spec.name, spec.description);
        step.dependOn(&run.step);
        aggregate.dependOn(step);
    }
}
