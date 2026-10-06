const std = @import("std");
const agent_build = @import("agent");

pub fn build(b: *std.Build) void {
    const target = b.standardTargetOptions(.{});
    const optimize = b.standardOptimizeOption(.{ .preferred_optimize_mode = .safe });
    const source = b.option(std.Build.LazyPath, "world-source", "Authenticated locked World source") orelse @panic("provide -Dworld-source");
    const runtime = b.option(std.Build.LazyPath, "world-runtime", "Authenticated locked World runtime") orelse @panic("provide -Dworld-runtime");
    const sqlite = b.option(std.Build.LazyPath, "sqlite-source", "Authenticated native SQLite source") orelse @panic("provide -Dsqlite-source");
    const dependency = b.dependency("agent", .{ .target = target, .optimize = optimize, .@"world-source" = source, .@"world-runtime" = runtime, .@"sqlite-source" = sqlite });
    _ = agent_build.addNativeSystem(b, dependency, .{
        .name = "agent-native-example",
        .application = .{ .source = .{ .definition = b.path("definition.zig"), .types = b.path("types.zig") } },
        .environment = b.path("environment.zig"),
    });
}
