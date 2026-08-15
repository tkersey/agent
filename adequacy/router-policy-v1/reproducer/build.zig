const std = @import("std");

pub fn build(b: *std.Build) void {
    const agent_dependency = b.dependency("agent", .{
        .target = b.graph.host,
        .optimize = .Debug,
    });
    const reproducer = b.createModule(.{
        .root_source_file = b.path("main.zig"),
        .target = b.graph.host,
        .optimize = .Debug,
        .imports = &.{
            .{ .name = "agent", .module = agent_dependency.module("agent") },
            .{ .name = "boundary", .module = agent_dependency.module("boundary") },
        },
    });
    const compile_reproducer = b.addTest(.{ .root_module = reproducer });
    const reproduce = b.step(
        "reproduce",
        "Reproduce the missing enum-to-u8 comparison in exact Agent v2.0.0 Flow",
    );
    reproduce.dependOn(&compile_reproducer.step);
}
