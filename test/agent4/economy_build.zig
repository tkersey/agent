const std = @import("std");

pub fn build(b: *std.Build) void {
    const optimize = b.standardOptimizeOption(.{});
    const boundary_path = b.option([]const u8, "boundary-source", "Frozen Boundary source") orelse
        b.pathFromRoot("../../.agent4/inputs/boundary");
    const economy_path = b.option([]const u8, "economy-source", "Isolated emitter source") orelse
        b.pathFromRoot("economy.zig");
    const data = b.createModule(.{
        .root_source_file = .{ .cwd_relative = b.pathJoin(&.{ boundary_path, "src/v2/data/root.zig" }) },
        .target = b.graph.host,
        .optimize = optimize,
    });
    const boundary = b.createModule(.{
        .root_source_file = .{ .cwd_relative = b.pathJoin(&.{ boundary_path, "src/v2/root.zig" }) },
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
        .root_source_file = .{ .cwd_relative = economy_path },
        .target = b.graph.host,
        .optimize = optimize,
        .imports = &.{
            .{ .name = "boundary", .module = boundary },
            .{ .name = "agent", .module = agent },
        },
    });
    const executable = b.addExecutable(.{ .name = "economy-probe", .root_module = probe });
    b.installArtifact(executable);
    const tests = b.addTest(.{ .root_module = probe });
    b.step("test", "Check matched facade and structural sharing")
        .dependOn(&b.addRunArtifact(tests).step);
}
