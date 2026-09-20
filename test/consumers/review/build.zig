const std = @import("std");

pub fn build(b: *std.Build) void {
    const optimize = b.standardOptimizeOption(.{});
    const boundary_path = b.option([]const u8, "boundary-source", "Immutable Boundary source");
    const dependency = if (boundary_path) |immutable_source|
        b.dependency("agent", .{ .target = b.graph.host, .optimize = optimize, .@"boundary-source" = immutable_source })
    else
        b.dependency("agent", .{ .target = b.graph.host, .optimize = optimize });
    const root = b.createModule(.{
        .root_source_file = b.path("main.zig"),
        .target = b.graph.host,
        .optimize = optimize,
        .imports = &.{
            .{ .name = "agent", .module = dependency.module("agent") },
            .{ .name = "boundary", .module = dependency.module("boundary") },
        },
    });
    const emitter = b.addExecutable(.{ .name = "review-emitter", .root_module = root });
    b.installArtifact(emitter);
    const tests = b.addTest(.{ .root_module = root });
    b.getInstallStep().dependOn(&b.addRunArtifact(tests).step);
    for ([_][]const u8{ "mid_review", "clarify_first", "human", "model", "rule", "react" }) |mode| {
        for ([_][]const u8{ "bpi3", "args" }) |format| {
            const run = b.addRunArtifact(emitter);
            run.addArgs(&.{ mode, format });
            b.getInstallStep().dependOn(&b.addInstallFileWithDir(run.captureStdOut(.{}), .prefix, b.fmt("{s}.{s}", .{ mode, format })).step);
        }
    }
}
