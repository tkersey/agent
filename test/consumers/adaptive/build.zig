//! The real downstream API, selecting the single supported application.
const std = @import("std");
const agent_build = @import("agent");

pub fn build(b: *std.Build) void {
    const target = b.standardTargetOptions(.{});
    const optimize = b.standardOptimizeOption(.{});
    const world = b.option(std.Build.LazyPath, "world-source", "Authenticated World source") orelse @panic("provide -Dworld-source");
    const sqlite = b.option(std.Build.LazyPath, "sqlite-source", "Authenticated SQLite source") orelse @panic("provide -Dsqlite-source");
    const dependency = b.dependency("agent", .{ .target = target, .optimize = optimize, .@"world-source" = world, .@"sqlite-source" = sqlite });
    _ = agent_build.addNativeSystem(b, dependency, .{
        .name = "adaptive-agent",
        .application = .{ .source = .{
            .definition = dependency.path("examples/adaptive-agent/definition.zig"),
            .types = dependency.path("examples/adaptive-agent/types.zig"),
        } },
        .environment = dependency.path("examples/adaptive-agent/environment.zig"),
    });
}
