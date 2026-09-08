const std = @import("std");
pub fn build(b: *std.Build) void {
    const optimize = b.standardOptimizeOption(.{});
    const source = b.option([]const u8, "boundary-v2-source", "Immutable Boundary source copy");
    const dependency = if (source) |path| b.dependency("agent", .{ .optimize = optimize, .@"boundary-v2-source" = path }) else b.dependency("agent", .{ .optimize = optimize });
    const module = b.createModule(.{
        .root_source_file = b.path("main.zig"),
        .target = b.graph.host,
        .optimize = optimize,
        .imports = &.{ .{ .name = "agent", .module = dependency.module("agent") }, .{ .name = "boundary", .module = dependency.module("boundary") } },
    });
    const emitter = b.addExecutable(.{ .name = "document-emitter", .root_module = module });
    b.installArtifact(emitter);
    for ([_][]const u8{ "bpi2", "args" }) |format| {
        const run = b.addRunArtifact(emitter);
        run.addArg(format);
        b.getInstallStep().dependOn(&b.addInstallFileWithDir(run.captureStdOut(.{}), .prefix, b.fmt("document.{s}", .{format})).step);
    }
}
