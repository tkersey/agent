const std = @import("std");

pub fn build(b: *std.Build) void {
    const target = b.standardTargetOptions(.{});
    const optimize = b.standardOptimizeOption(.{});

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

    const tests = b.addTest(.{ .root_module = agent_module });
    const run_tests = b.addRunArtifact(tests);

    const check = b.step("check", "Compile and test the agent package");
    check.dependOn(&run_tests.step);

    const no_runtime_gate = b.addSystemCommand(&.{
        "sh",
        "tools/check_agent_no_runtime.sh",
    });
    const no_runtime = b.step(
        "check-agent-no-runtime",
        "Reject runtime agent interpreters, registries, and integrations",
    );
    no_runtime.dependOn(&no_runtime_gate.step);
    check.dependOn(no_runtime);

    const external_consumer_gate = b.addSystemCommand(&.{
        "sh",
        "tools/check_external_consumer.sh",
    });
    const external_consumer = b.step(
        "check-agent-external-consumer",
        "Build one custom Agent from an archive in an empty directory",
    );
    external_consumer.dependOn(&external_consumer_gate.step);
    check.dependOn(external_consumer);

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
        .{ .path = "test/compile_fail/effect_without_history.zig", .message = "agent effect actions require positive history capacity" },
        .{ .path = "test/compile_fail/forged_runtime_strategy.zig", .message = "agent compile requires a RuntimeStrategy structural contract" },
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
    check.dependOn(compile_fail);

    addFocusedTest(
        b,
        "check-agent-definition",
        "Validate AgentDefinition admission",
        "test/definition.zig",
        agent_module,
        boundary_module,
        target,
        optimize,
        check,
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
        check,
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
        check,
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
        check,
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
        check,
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
        check,
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
        check,
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
        check,
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
        check,
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
        check,
    );
    addSpecializationTest(
        b,
        "check-agent-specialization-matrix",
        "Compile two definitions by two strategies into four Machines",
        "test/specialization_matrix.zig",
        agent_module,
        boundary_module,
        target,
        optimize,
        check,
    );
    addSpecializationTest(
        b,
        "check-agent-manifests",
        "Validate deterministic Agent manifests and identities",
        "test/specialization_matrix.zig",
        agent_module,
        boundary_module,
        target,
        optimize,
        check,
    );
    addSpecializationTest(
        b,
        "check-agent-lifecycle",
        "Run typed Research and Coding lifecycles across all strategies",
        "test/specialization_matrix.zig",
        agent_module,
        boundary_module,
        target,
        optimize,
        check,
    );
    addSpecializationTest(
        b,
        "check-agent-boundary-equivalence",
        "Compare ReAct with an isolated direct Boundary Control IR reference",
        "test/boundary_equivalence.zig",
        agent_module,
        boundary_module,
        target,
        optimize,
        check,
    );

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
    check.dependOn(machine_native_wasm);
    no_runtime.dependOn(&run_wasm.step);
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
) void {
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
