const std = @import("std");

pub fn build(b: *std.Build) void {
    const target = b.standardTargetOptions(.{});
    const optimize = b.standardOptimizeOption(.{});
    const agent_dependency = b.dependency("agent", .{
        .target = target,
        .optimize = optimize,
    });
    const consumer = b.createModule(.{
        .root_source_file = b.path("main.zig"),
        .target = target,
        .optimize = optimize,
    });
    consumer.addImport("agent", agent_dependency.module("agent"));
    consumer.addImport("boundary", agent_dependency.module("boundary"));
    const tests = b.addTest(.{ .root_module = consumer });
    const check = b.step("check", "Compile a clean-room Agent consumer");
    check.dependOn(&b.addRunArtifact(tests).step);
}
