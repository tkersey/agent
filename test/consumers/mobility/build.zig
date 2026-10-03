const std = @import("std");
pub fn build(b: *std.Build) void {
    const optimize = b.standardOptimizeOption(.{});
    const dependency = b.dependency("agent", .{ .target = b.graph.host, .optimize = optimize });
    const root = b.createModule(.{
        .root_source_file = b.path("main.zig"),
        .target = b.graph.host,
        .optimize = optimize,
        .imports = &.{
            .{ .name = "agent", .module = dependency.module("agent") },
            .{ .name = "boundary", .module = dependency.module("boundary") },
        },
    });
    const emitter = b.addExecutable(.{ .name = "mobility-emitter", .root_module = root });
    b.installArtifact(emitter);
    if (b.option([]const u8, "text-object", "Independently emitted text inspection BMO1")) |object| {
        const run = b.addRunArtifact(emitter);
        run.addArgs(&.{ "image", object });
        b.getInstallStep().dependOn(&b.addInstallFile(run.captureStdOut(.{}), "program.bpi3").step);
    }
    for ([_][]const u8{ "task", "report", "resolve", "resolution", "relocate", "relocation-reply", "read", "text-reply", "subject", "inspection", "integer", "unit" }) |name| {
        const run = b.addRunArtifact(emitter);
        run.addArg(b.fmt("{s}-schema", .{name}));
        b.getInstallStep().dependOn(&b.addInstallFile(run.captureStdOut(.{}), b.fmt("{s}.schema", .{name})).step);
    }
}
