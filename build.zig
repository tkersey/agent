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
    const semantic_check = b.step(
        "check-agent-semantic",
        "Run every Agent v1 semantic and conformance gate",
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
        .{ .path = "test/compile_fail/open_action.zig", .message = "agent Action must be exhaustive" },
        .{ .path = "test/compile_fail/nonexistent_action_variant.zig", .message = "agent Action has no variant named 'missing'" },
        .{ .path = "test/compile_fail/fail_payload_mismatch.zig", .message = "agent fail action payload differs from Definition.Failure" },
        .{ .path = "test/compile_fail/missing_final_action.zig", .message = "agent action algebra requires a final action" },
        .{ .path = "test/compile_fail/duplicate_stable_action_name.zig", .message = "agent action stable name is duplicated" },
        .{ .path = "test/compile_fail/oversized_instructions.zig", .message = "agent definition instructions exceed maximum_instructions_bytes" },
        .{ .path = "test/compile_fail/zero_decision_budget.zig", .message = "agent maximum_decisions must be positive" },
        .{ .path = "test/compile_fail/invalid_history_limit.zig", .message = "agent history maximum_observations exceeds u32" },
        .{ .path = "test/compile_fail/unsupported_history_policy.zig", .message = "agent history overflow policy is unsupported" },
        .{ .path = "test/compile_fail/nonportable_goal.zig", .message = "agent Goal must be Boundary-portable" },
        .{ .path = "test/compile_fail/nonportable_action.zig", .message = "agent Action must be Boundary-portable" },
        .{ .path = "test/compile_fail/nonportable_observation.zig", .message = "agent Observation must be Boundary-portable" },
        .{ .path = "test/compile_fail/nonportable_result.zig", .message = "agent Result must be Boundary-portable" },
        .{ .path = "test/compile_fail/strategy_omits_action_variant.zig", .message = "agent RuntimeStrategy action coverage must contain every Action variant" },
        .{ .path = "test/compile_fail/strategy_decision_request_nonportable.zig", .message = "agent RuntimeStrategy DecisionRequest must be Boundary-portable" },
        .{ .path = "test/compile_fail/strategy_undeclared_effect.zig", .message = "agent RuntimeStrategy Body effect row must equal the closed decision and Action effect row" },
        .{ .path = "test/compile_fail/strategy_runtime_callback.zig", .message = "agent RuntimeStrategy config cannot contain runtime callbacks or pointers" },
        .{ .path = "test/compile_fail/final_policy_missing_observation.zig", .message = "agent final policy Observation has no variant named 'run_tests'" },
        .{ .path = "test/compile_fail/final_policy_non_boolean_field.zig", .message = "agent final policy observation field must be bool" },
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
        "check-agent-void-effect-action",
        "Lower void Action payloads as ordinary Boundary unit effects",
        "test/void_effect_action.zig",
        agent_module,
        boundary_module,
        target,
        optimize,
        semantic_check,
    );
    addActualityDefinitionTest(
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
    addActualityDefinitionTest(
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
    addActualityDefinitionTest(
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
    addSpecializationTest(
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
    addSpecializationTest(
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
    addSpecializationTest(
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
        "Close four Agent Machines with exact released World v3.1.0",
    );
    world_conformance.dependOn(&world_conformance_gate.step);
    const hosted_lifecycle = b.step(
        "check-agent-lifecycle",
        "Drive Research and Coding World applications through exact world-host v1.0.0",
    );
    hosted_lifecycle.dependOn(&world_conformance_gate.step);
    const release_externality = b.step(
        "check-agent-1-externality",
        "Prove the clean-room Agent, World, host, and Effect v1 release lifecycle",
    );
    release_externality.dependOn(&world_conformance_gate.step);
    no_runtime.dependOn(&world_conformance_gate.step);
    semantic_check.dependOn(world_conformance);
    semantic_check.dependOn(hosted_lifecycle);
    semantic_check.dependOn(release_externality);
    addSpecializationTest(
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
    addSpecializationTest(
        b,
        "check-agent-performance",
        "Prove generated and direct Boundary semantics have identical state, topology, and reducer cost",
        "test/boundary_equivalence.zig",
        agent_module,
        boundary_module,
        target,
        optimize,
        semantic_check,
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
    semantic_check.dependOn(machine_native_wasm);
    no_runtime.dependOn(&run_wasm.step);

    const release = b.step(
        "check-agent-release",
        "Run the Agent v1 release-owner semantic proof",
    );
    const release_receipt = b.addSystemCommand(&.{
        "node",
        "tools/check_agent_release.mjs",
    });
    release_receipt.step.dependOn(semantic_check);
    release_receipt.step.dependOn(lint);
    release.dependOn(&release_receipt.step);
    check.dependOn(release);
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
) void {
    const actuality = b.createModule(.{
        .root_source_file = b.path("examples/repository_repair_actuality.zig"),
        .target = target,
        .optimize = optimize,
    });
    actuality.addImport("agent", agent_module);
    actuality.addImport("boundary", boundary_module);

    const module = b.createModule(.{
        .root_source_file = b.path(path),
        .target = target,
        .optimize = optimize,
    });
    module.addImport("agent", agent_module);
    module.addImport("boundary", boundary_module);
    module.addImport("repository_repair_actuality", actuality);
    const tests = b.addTest(.{ .root_module = module });
    const run_tests = b.addRunArtifact(tests);
    const step = b.step(name, description);
    step.dependOn(&run_tests.step);
    aggregate.dependOn(step);
}
