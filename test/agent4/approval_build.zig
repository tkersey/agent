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
    const contracts = b.createModule(.{
        .root_source_file = b.path("../../src/contracts.zig"),
        .target = b.graph.host,
        .optimize = optimize,
        .imports = &.{.{ .name = "boundary_data_v2", .module = data }},
    });
    const agent = b.createModule(.{
        .root_source_file = b.path("../../src/agent4.zig"),
        .target = b.graph.host,
        .optimize = optimize,
        .imports = &.{
            .{ .name = "boundary", .module = boundary },
            .{ .name = "agent_contracts", .module = contracts },
        },
    });
    const probe = b.createModule(.{
        .root_source_file = b.path("approval_probe.zig"),
        .target = b.graph.host,
        .optimize = optimize,
        .imports = &.{
            .{ .name = "boundary", .module = boundary },
            .{ .name = "agent", .module = agent },
        },
    });
    const tests = b.addTest(.{ .root_module = probe });
    b.getInstallStep().dependOn(&b.addRunArtifact(tests).step);
    const equality = b.createModule(.{
        .root_source_file = b.path("../../src/value_equality.zig"),
        .target = b.graph.host,
        .optimize = optimize,
        .imports = &.{.{ .name = "boundary", .module = boundary }},
    });
    const equality_tests = b.addTest(.{ .root_module = equality });
    b.getInstallStep().dependOn(&b.addRunArtifact(equality_tests).step);
    if (b.option(bool, "native-equality", "Run structural equality on unchanged native World") orelse false) {
        const world = b.createModule(.{
            .root_source_file = b.path("../../.agent4/inputs/world/src/root.zig"),
            .target = b.graph.host,
            .optimize = optimize,
            .imports = &.{.{ .name = "boundary_data_v2", .module = data }},
        });
        const native = b.createModule(.{
            .root_source_file = b.path("approval_equality.zig"),
            .target = b.graph.host,
            .optimize = optimize,
            .imports = &.{ .{ .name = "boundary", .module = boundary }, .{ .name = "equality", .module = equality }, .{ .name = "world", .module = world } },
        });
        const comparison = b.addTest(.{ .root_module = native });
        b.getInstallStep().dependOn(&b.addRunArtifact(comparison).step);
    }

    const executable = b.addExecutable(.{ .name = "approval-probe", .root_module = probe });
    b.installArtifact(executable);
    const scoped = b.addRunArtifact(executable);
    scoped.addArg("scoped");
    b.getInstallStep().dependOn(&b.addInstallFileWithDir(
        scoped.captureStdOut(.{}),
        .prefix,
        "approval-scoped.bpi2",
    ).step);
    const with_evidence = b.addRunArtifact(executable);
    with_evidence.addArg("evidence");
    b.getInstallStep().dependOn(&b.addInstallFileWithDir(
        with_evidence.captureStdOut(.{}),
        .prefix,
        "approval-evidence.bpi2",
    ).step);
    const run = b.addRunArtifact(executable);
    b.getInstallStep().dependOn(&b.addInstallFileWithDir(
        run.captureStdOut(.{}),
        .prefix,
        "approval.bpi2",
    ).step);
}
