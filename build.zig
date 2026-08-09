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

    const tests = b.addTest(.{ .root_module = agent_module });
    const run_tests = b.addRunArtifact(tests);

    const check = b.step("check", "Compile and test the agent package");
    check.dependOn(&run_tests.step);

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
