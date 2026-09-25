const std = @import("std");

pub fn build(b: *std.Build) void {
    const optimize = b.standardOptimizeOption(.{});
    const data = b.createModule(.{
        .root_source_file = b.path("../../.agent4/inputs/boundary/src/data/root.zig"),
        .target = b.graph.host,
        .optimize = optimize,
    });
    const boundary = b.createModule(.{
        .root_source_file = b.path("../../.agent4/inputs/boundary/src/root.zig"),
        .target = b.graph.host,
        .optimize = optimize,
        .imports = &.{.{ .name = "boundary_data", .module = data }},
    });
    const admission = b.createModule(.{
        .root_source_file = b.path("../../src/admission.zig"),
        .target = b.graph.host,
        .optimize = optimize,
        .imports = &.{.{ .name = "boundary", .module = boundary }},
    });
    const tests = b.addTest(.{ .root_module = b.createModule(.{
        .root_source_file = b.path("admission.zig"),
        .target = b.graph.host,
        .optimize = optimize,
        .imports = &.{
            .{ .name = "boundary", .module = boundary },
            .{ .name = "admission", .module = admission },
        },
    }) });
    b.getInstallStep().dependOn(&b.addRunArtifact(tests).step);
}
