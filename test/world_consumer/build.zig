const std = @import("std");

const application_memory_bytes: u64 = 80 * 1024 * 1024;

pub fn build(b: *std.Build) void {
    const optimize: std.builtin.OptimizeMode = .ReleaseSmall;
    const wasm_target = b.resolveTargetQuery(.{
        .cpu_arch = .wasm32,
        .os_tag = .freestanding,
        .abi = .none,
    });
    const agent_dependency = b.dependency("agent", .{
        .target = wasm_target,
        .optimize = optimize,
    });
    const world_dependency = b.dependency("world", .{
        .target = wasm_target,
        .optimize = optimize,
    });
    const agent_module = agent_dependency.module("agent");
    const boundary_module = agent_dependency.module("boundary");
    const world_module = world_dependency.module("world");

    const research_react = addApplication(
        b,
        "research-react",
        "research_application.zig",
        wasm_target,
        optimize,
        agent_module,
        boundary_module,
        world_module,
    );
    addDerivedApplication(
        b,
        "research-reflective",
        "research_reflective_application.zig",
        wasm_target,
        optimize,
        agent_module,
        boundary_module,
        world_module,
        research_react,
    );
    const coding_reflective = addApplication(
        b,
        "coding-reflective",
        "coding_application.zig",
        wasm_target,
        optimize,
        agent_module,
        boundary_module,
        world_module,
    );
    addDerivedApplication(
        b,
        "coding-react",
        "coding_react_application.zig",
        wasm_target,
        optimize,
        agent_module,
        boundary_module,
        world_module,
        coding_reflective,
    );

    const research_example = b.createModule(.{
        .root_source_file = agent_dependency.path("examples/research_agent.zig"),
        .target = wasm_target,
        .optimize = optimize,
        .imports = &.{
            .{ .name = "agent", .module = agent_module },
            .{ .name = "boundary", .module = boundary_module },
        },
    });
    const direct_reference = b.createModule(.{
        .root_source_file = agent_dependency.path("test/boundary_equivalence.zig"),
        .target = wasm_target,
        .optimize = optimize,
        .imports = &.{
            .{ .name = "agent", .module = agent_module },
            .{ .name = "boundary", .module = boundary_module },
            .{ .name = "research_agent", .module = research_example },
        },
    });
    const direct_application = b.createModule(.{
        .root_source_file = b.path("research_direct_application.zig"),
        .target = wasm_target,
        .optimize = optimize,
        .imports = &.{
            .{ .name = "base_application", .module = research_react },
            .{ .name = "direct_reference", .module = direct_reference },
            .{ .name = "world", .module = world_module },
        },
    });
    installApplication(
        b,
        "research-direct",
        wasm_target,
        optimize,
        world_module,
        direct_application,
    );
}

fn addApplication(
    b: *std.Build,
    name: []const u8,
    source_path: []const u8,
    target: std.Build.ResolvedTarget,
    optimize: std.builtin.OptimizeMode,
    agent_module: *std.Build.Module,
    boundary_module: *std.Build.Module,
    world_module: *std.Build.Module,
) *std.Build.Module {
    const application = b.createModule(.{
        .root_source_file = b.path(source_path),
        .target = target,
        .optimize = optimize,
        .imports = &.{
            .{ .name = "agent", .module = agent_module },
            .{ .name = "boundary", .module = boundary_module },
            .{ .name = "world", .module = world_module },
        },
    });
    installApplication(b, name, target, optimize, world_module, application);
    return application;
}

fn addDerivedApplication(
    b: *std.Build,
    name: []const u8,
    source_path: []const u8,
    target: std.Build.ResolvedTarget,
    optimize: std.builtin.OptimizeMode,
    agent_module: *std.Build.Module,
    boundary_module: *std.Build.Module,
    world_module: *std.Build.Module,
    base_application: *std.Build.Module,
) void {
    const application = b.createModule(.{
        .root_source_file = b.path(source_path),
        .target = target,
        .optimize = optimize,
        .imports = &.{
            .{ .name = "agent", .module = agent_module },
            .{ .name = "boundary", .module = boundary_module },
            .{ .name = "world", .module = world_module },
            .{ .name = "base_application", .module = base_application },
        },
    });
    installApplication(b, name, target, optimize, world_module, application);
}

fn installApplication(
    b: *std.Build,
    name: []const u8,
    target: std.Build.ResolvedTarget,
    optimize: std.builtin.OptimizeMode,
    world_module: *std.Build.Module,
    application: *std.Build.Module,
) void {
    const executable = b.addExecutable(.{
        .name = b.fmt("{s}.world", .{name}),
        .root_module = b.createModule(.{
            .root_source_file = b.path("wasm_main.zig"),
            .target = target,
            .optimize = optimize,
            .imports = &.{
                .{ .name = "agent_world_application", .module = application },
                .{ .name = "world", .module = world_module },
            },
        }),
    });
    executable.entry = .disabled;
    executable.rdynamic = true;
    executable.export_memory = true;
    executable.stack_size = 2 * 1024 * 1024;
    executable.initial_memory = application_memory_bytes;
    executable.max_memory = application_memory_bytes;
    const install = b.addInstallFile(
        executable.getEmittedBin(),
        b.fmt("world-apps/{s}.world.wasm", .{name}),
    );
    b.getInstallStep().dependOn(&install.step);
}
