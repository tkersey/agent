const std = @import("std");

pub fn build(b: *std.Build) void {
    const target = b.standardTargetOptions(.{});
    const optimize = b.standardOptimizeOption(.{});
    const agent_dependency = b.dependency("agent", .{ .target = target, .optimize = optimize });

    const definition = b.createModule(.{
        .root_source_file = b.path("src/definition.zig"),
        .target = target,
        .optimize = optimize,
        .imports = &.{
            .{ .name = "agent", .module = agent_dependency.module("agent") },
            .{ .name = "boundary", .module = agent_dependency.module("boundary") },
        },
    });
    const tests = b.addTest(.{ .root_module = definition });
    tests.stack_size = 256 * 1024 * 1024;
    const run_tests = b.addRunArtifact(tests);

    const check = b.step("check", "Compile and test the router-policy adequacy epistemic strategy");
    check.dependOn(&run_tests.step);
}
