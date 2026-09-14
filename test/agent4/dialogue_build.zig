const std = @import("std");

pub fn build(b: *std.Build) void {
    const optimize = b.standardOptimizeOption(.{});
    const data = b.createModule(.{
        .root_source_file = b.path("../../.agent4/inputs/boundary/src/v2/data/root.zig"),
        .target = b.graph.host,
        .optimize = optimize,
    });
    const boundary = b.createModule(.{
        .root_source_file = b.path("../../.agent4/inputs/boundary/src/v2/root.zig"),
        .target = b.graph.host,
        .optimize = optimize,
        .imports = &.{.{ .name = "boundary_data_v2", .module = data }},
    });
    const dialogue = b.createModule(.{
        .root_source_file = b.path("../../src/dialogue.zig"),
        .target = b.graph.host,
        .optimize = optimize,
        .imports = &.{.{ .name = "boundary", .module = boundary }},
    });
    const interaction = b.createModule(.{
        .root_source_file = b.path("../../src/interaction.zig"),
        .target = b.graph.host,
        .optimize = optimize,
        .imports = &.{.{ .name = "boundary", .module = boundary }},
    });
    b.getInstallStep().dependOn(&b.addRunArtifact(b.addTest(.{ .root_module = interaction })).step);
    const probe = b.createModule(.{
        .root_source_file = b.path("dialogue_probe.zig"),
        .target = b.graph.host,
        .optimize = optimize,
        .imports = &.{
            .{ .name = "boundary", .module = boundary },
            .{ .name = "dialogue", .module = dialogue },
            .{ .name = "interaction", .module = interaction },
        },
    });
    const tests = b.addTest(.{ .root_module = probe });
    b.getInstallStep().dependOn(&b.addRunArtifact(tests).step);
    const emitter = b.addExecutable(.{ .name = "dialogue-probe", .root_module = probe });
    b.installArtifact(emitter);
    for ([_][]const u8{ "twice", "dispose_owned", "exchange" }) |mode| {
        const run = b.addRunArtifact(emitter);
        run.addArg(mode);
        b.getInstallStep().dependOn(&b.addInstallFileWithDir(
            run.captureStdOut(.{}),
            .prefix,
            b.fmt("{s}.bpi2", .{mode}),
        ).step);
    }
}
