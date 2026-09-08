const std = @import("std");

pub fn build(b: *std.Build) void {
    const optimize = b.standardOptimizeOption(.{});
    const boundary_path = b.option([]const u8, "boundary-source", "Frozen Boundary source") orelse
        b.pathFromRoot("../../.agent4/inputs/boundary");
    const data = b.createModule(.{
        .root_source_file = .{ .cwd_relative = b.pathJoin(&.{
            boundary_path, "src/v2/data/root.zig",
        }) },
        .target = b.graph.host,
        .optimize = optimize,
    });
    const boundary = b.createModule(.{
        .root_source_file = .{ .cwd_relative = b.pathJoin(&.{ boundary_path, "src/v2/root.zig" }) },
        .imports = &.{.{ .name = "boundary_data_v2", .module = data }},
        .target = b.graph.host,
        .optimize = optimize,
    });
    const deliberation = b.createModule(.{
        .root_source_file = b.path("../../src/deliberation.zig"),
        .imports = &.{.{ .name = "boundary", .module = boundary }},
        .target = b.graph.host,
        .optimize = optimize,
    });
    const root = b.createModule(.{
        .root_source_file = b.path("multi_probe.zig"),
        .imports = &.{
            .{ .name = "boundary", .module = boundary },
            .{ .name = "deliberation", .module = deliberation },
        },
        .target = b.graph.host,
        .optimize = optimize,
    });
    const executable = b.addExecutable(.{ .name = "multi-probe", .root_module = root });
    b.installArtifact(executable);
}
