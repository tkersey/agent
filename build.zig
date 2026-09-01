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
    const shared_boundary_module = b.addModule("boundary", .{
        .root_source_file = b.path("src/boundary_package.zig"),
        .target = target,
        .optimize = optimize,
    });
    shared_boundary_module.addImport("agent_boundary_upstream", boundary_module);

    const semantic = b.step(
        "check-agent-semantic",
        "Run the canonical Agent 3 compiler and portable-runtime proofs",
    );
    const root_tests = b.addTest(.{ .root_module = agent_module });
    const run_root_tests = b.addRunArtifact(root_tests);
    semantic.dependOn(&run_root_tests.step);
    var previous: *std.Build.Step = &run_root_tests.step;

    inline for ([_]TestSpec{
        .{ .name = "check-agent-definition", .description = "Validate typed source admission", .path = "test/definition.zig" },
        .{ .name = "check-agent-action-algebra", .description = "Validate exhaustive typed Action closure", .path = "test/action_algebra.zig" },
        .{ .name = "check-agent-action-admission", .description = "Reject inadmissible actions before effects", .path = "test/action_admission.zig" },
        .{ .name = "check-agent-flow", .description = "Validate Flow lowering", .path = "test/flow.zig" },
        .{ .name = "check-agent-protocol", .description = "Validate raw model transport", .path = "test/protocol.zig" },
        .{ .name = "check-agent-system-api", .description = "Validate the canonical complete-system API", .path = "test/system.zig" },
        .{ .name = "check-agent-local-action", .description = "Prove image-owned local actions", .path = "test/local_action.zig" },
        .{ .name = "check-agent-json", .description = "Validate strict generated tool schemas", .path = "test/json.zig" },
        .{ .name = "check-agent-request", .description = "Validate complete provider requests", .path = "test/request.zig" },
        .{ .name = "check-agent-staged-json", .description = "Validate in-image JSON and Unicode scanning", .path = "test/staged_json.zig" },
        .{ .name = "check-agent-custom-strategy", .description = "Validate compile-time strategy specialization", .path = "test/custom_strategy.zig" },
        .{ .name = "check-agent-void-effect-action", .description = "Validate typed unit effects", .path = "test/void_effect_action.zig" },
        .{ .name = "check-agent-repository-system", .description = "Compile the complete repository system", .path = "actuality/repository_repair_system_v1.zig" },
    }) |spec| {
        const step = addFocusedTest(
            b,
            spec,
            agent_module,
            boundary_module,
            target,
            optimize,
            semantic,
        );
        step.dependOn(previous);
        previous = step;
    }

    const shared = addSharedBoundaryTest(
        b,
        .{
            .name = "check-agent-shared-boundary",
            .description = "Prove consumers share Agent's Boundary module",
            .path = "test/shared_boundary.zig",
        },
        agent_module,
        shared_boundary_module,
        target,
        optimize,
        semantic,
    );
    shared.dependOn(previous);
    previous = shared;

    const open_lifetime = addFilteredFocusedTest(
        b,
        .{
            .name = "check-agent-open-lifetime",
            .description = "Prove a no-final canonical State cycle",
            .path = "test/open_lifetime.zig",
        },
        &.{ "no-final system", "reordered escaped" },
        agent_module,
        boundary_module,
        target,
        optimize,
        semantic,
    );
    open_lifetime.dependOn(previous);
    const response_a = addFilteredFocusedTest(
        b,
        .{
            .name = "check-agent-response-failures-a",
            .description = "Reject malformed, duplicate, incomplete, error, and refusal responses",
            .path = "test/open_lifetime.zig",
        },
        &.{"raw provider failures A"},
        agent_module,
        boundary_module,
        target,
        optimize,
        semantic,
    );
    response_a.dependOn(previous);
    const response_b = addFilteredFocusedTest(
        b,
        .{
            .name = "check-agent-response-failures-b",
            .description = "Reject unsupported, multiple, unknown, HTTP, and transport failures",
            .path = "test/open_lifetime.zig",
        },
        &.{"raw provider failures B"},
        agent_module,
        boundary_module,
        target,
        optimize,
        semantic,
    );
    response_b.dependOn(previous);

    const compile_fail = b.step(
        "compile-fail",
        "Run Agent 3 source-admission rejection witnesses",
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
        "test/compile_fail/model_noncanonical_temperature.zig",
        "agent model temperature must be a canonical decimal from 0 through 2",
        agent_module,
        boundary_module,
    );
    compile_fail.dependOn(previous);
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

    const world_check = b.step(
        "check-agent-repository-system-world",
        "Execute the source-free closure distribution through released World",
    );

    const closure_check = b.step(
        "check-agent-system-closure-v1",
        "Run deterministic Agent System Closure v1 checks",
    );
    closure_check.dependOn(semantic);
    const model_transport_test = b.addSystemCommand(&.{
        "node",
        "--test",
        "system_closure_v1/model_transport.test.mjs",
    });
    model_transport_test.addFileInput(
        b.path("system_closure_v1/model_transport.test.mjs"),
    );
    model_transport_test.addFileInput(
        b.path("system_closure_v1/model_transport.mjs"),
    );
    closure_check.dependOn(&model_transport_test.step);
    if (world_process_root != null) closure_check.dependOn(world_check);
    const emit_closure = b.step(
        "emit-agent-system-closure-v1",
        "Emit the Agent System Closure v1 distribution and receipt",
    );
    const package_closure = b.addSystemCommand(&.{ "node", "tools/emit_agent_system_closure_v1.mjs" });
    package_closure.addFileInput(b.path("tools/emit_agent_system_closure_v1.mjs"));
    package_closure.addArg("--agent-root");
    package_closure.addDirectoryArg(b.path("."));
    package_closure.addArg("--image");
    package_closure.addFileArg(outputs[0]);
    package_closure.addArg("--initial-args");
    package_closure.addFileArg(outputs[1]);
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
        "system_closure_v1/model_transport.mjs",
        "system_closure_v1/fixture_model_server.mjs",
        "system_closure_v1/repository_environment.mjs",
        "system_closure_v1/fixture-proof.json",
        "system_closure_v1/admission-proof.json",
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
    closure_check.dependOn(&check_distribution.step);

    if (world_process_root) |root| {
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
        const negatives = b.addSystemCommand(&.{
            "node",
            "tools/check_agent_system_admission_negatives.mjs",
        });
        negatives.addArgs(&.{ "--world-root", root, "--image" });
        negatives.addFileArg(outputs[0]);
        negatives.addArg("--initial");
        negatives.addFileArg(outputs[1]);
        negatives.addFileInput(
            b.path("tools/check_agent_system_admission_negatives.mjs"),
        );
        world_check.dependOn(&negatives.step);
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
    });
    const paths = b.addSystemCommand(&.{ "sh", "tools/check_zig_paths.sh" });
    const lint = b.step("lint", "Check Zig formatting and source inventory");
    lint.dependOn(&format.step);
    lint.dependOn(&paths.step);

    const check = b.step("check", "Compile and test Agent 3");
    check.dependOn(semantic);
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

fn addSharedBoundaryTest(
    b: *std.Build,
    spec: TestSpec,
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
    const tests = b.addTest(.{ .root_module = module });
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
