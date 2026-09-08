const std = @import("std");
const Graph = struct {
    b: *std.Build,
    optimize: std.builtin.OptimizeMode,
    agent: *std.Build.Module,
    boundary: *std.Build.Module,
    data: *std.Build.Module,
    contracts: *std.Build.Module,
    gate: *std.Build.Step,

    fn module(g: Graph, path: []const u8) *std.Build.Module {
        return g.b.createModule(.{
            .root_source_file = g.b.path(path),
            .target = g.b.graph.host,
            .optimize = g.optimize,
            .imports = &.{
                .{ .name = "agent", .module = g.agent },
                .{ .name = "boundary", .module = g.boundary },
                .{ .name = "boundary_data_v2", .module = g.data },
                .{ .name = "agent_contracts", .module = g.contracts },
                .{ .name = "contracts", .module = g.contracts },
            },
        });
    }
    fn helper(g: Graph, name: []const u8) *std.Build.Module {
        return g.module(g.b.fmt("src/{s}.zig", .{name}));
    }
    fn testModule(g: Graph, step: *std.Build.Step, module_value: *std.Build.Module) void {
        const tests = g.b.addTest(.{ .root_module = module_value });
        tests.step.dependOn(g.gate);
        step.dependOn(&g.b.addRunArtifact(tests).step);
    }
    fn emitter(g: Graph, name: []const u8, module_value: *std.Build.Module) *std.Build.Step.Compile {
        const executable = g.b.addExecutable(.{ .name = name, .root_module = module_value });
        executable.step.dependOn(g.gate);
        return executable;
    }
    fn emit(g: Graph, step: *std.Build.Step, executable: *std.Build.Step.Compile, args: []const []const u8, name: []const u8) void {
        const run = g.b.addRunArtifact(executable);
        run.addArgs(args);
        step.dependOn(&g.b.addInstallFileWithDir(run.captureStdOut(.{}), .prefix, g.b.fmt("agent4/{s}", .{name})).step);
    }
};

pub fn build(b: *std.Build) void {
    const optimize = b.standardOptimizeOption(.{});
    const target = b.standardTargetOptions(.{});
    const source = b.option([]const u8, "boundary-v2-source", "Authenticated immutable Boundary source copy");
    const runtime = b.option([]const u8, "world-runtime", "Authenticated immutable World runtime directory");
    const measure_economy = b.option(bool, "measure-economy", "Collect timings on an operator-confirmed idle host") orelse false;
    const world_source = b.option([]const u8, "world-source", "Immutable World source for native agreement") orelse b.pathFromRoot(".agent4/inputs/world");
    const data = if (source) |root| b.createModule(.{
        .root_source_file = .{ .cwd_relative = b.pathJoin(&.{ root, "src/v2/data/root.zig" }) },
        .target = target,
        .optimize = optimize,
    }) else b.dependency("boundary", .{ .target = target, .optimize = optimize }).module("boundary_data_v2");
    const boundary = if (source) |root| b.createModule(.{
        .root_source_file = .{ .cwd_relative = b.pathJoin(&.{ root, "src/v2/root.zig" }) },
        .target = target,
        .optimize = optimize,
        .imports = &.{.{ .name = "boundary_data_v2", .module = data }},
    }) else b.dependency("boundary", .{ .target = target, .optimize = optimize }).module("boundary");
    b.modules.put(b.allocator, b.dupe("boundary"), boundary) catch @panic("out of memory");
    b.modules.put(b.allocator, b.dupe("boundary_data_v2"), data) catch @panic("out of memory");
    const contracts = b.addModule("agent_contracts", .{
        .root_source_file = b.path("src/contracts.zig"),
        .target = target,
        .optimize = optimize,
        .imports = &.{.{ .name = "boundary_data_v2", .module = data }},
    });
    const agent = b.addModule("agent", .{
        .root_source_file = b.path("src/agent4.zig"),
        .target = target,
        .optimize = optimize,
        .imports = &.{ .{ .name = "boundary", .module = boundary }, .{ .name = "boundary_data_v2", .module = data }, .{ .name = "agent_contracts", .module = contracts } },
    });
    const source_guard = b.addSystemCommand(&.{ "node", "tools/agent4/dependencies.mjs", "verify", "--authoring-only" });
    addBoundary(b, source_guard, source, target, optimize);
    source_guard.has_side_effects = true;
    _ = source_guard.captureStdOut(.{});
    const g: Graph = .{ .b = b, .optimize = optimize, .agent = agent, .boundary = boundary, .data = data, .contracts = contracts, .gate = &source_guard.step };
    const check = b.step("agent4-authoring-tests", "Authoring test implementation");
    const aggregate = b.step("check-agent4", "Check authoring and pure contracts without World");
    const lint = b.step("lint", "Check formatting and the Zig source inventory");
    const format_check = b.addSystemCommand(&.{ b.graph.zig_exe, "fmt", "--check", "build.zig", "build_agent4.zig", "src", "test/agent4", "test/consumers" });
    const paths = b.addSystemCommand(&.{ "sh", "tools/check_zig_paths.sh" });
    lint.dependOn(&format_check.step);
    lint.dependOn(&paths.step);
    check.dependOn(lint);
    for ([_][]const u8{ "facade", "values", "approval_probe", "catalogs", "descriptor_contracts", "callable" }) |name|
        g.testModule(check, g.module(b.fmt("test/agent4/{s}.zig", .{name})));
    g.testModule(check, g.module("src/model_invocation_tests.zig"));
    g.testModule(check, g.module("src/conversation.zig"));
    g.testModule(check, g.module("src/react.zig"));
    g.testModule(check, g.module("src/value_equality.zig"));
    const negatives = b.addSystemCommand(&.{ "node", "tools/agent4/negative.mjs" });
    if (source) |path| negatives.addArgs(&.{ path, "source" }) else {
        negatives.addDirectoryArg(b.dependency("boundary", .{ .target = target, .optimize = optimize }).path("."));
        negatives.addArg("package");
    }
    negatives.addArg(b.graph.zig_exe);
    negatives.has_side_effects = true;
    negatives.step.dependOn(&source_guard.step);
    check.dependOn(&negatives.step);
    const admitted = g.module("test/agent4/admission.zig");
    admitted.addImport("admission", g.helper("admission"));
    g.testModule(check, admitted);
    const dialogue = g.module("test/agent4/dialogue_probe.zig");
    dialogue.addImport("dialogue", g.helper("dialogue"));
    dialogue.addImport("interaction", g.helper("interaction"));
    g.testModule(check, dialogue);

    const emit = b.step("agent4-images", "Compile the consumer images");
    const distribution = b.step("emit-agent4", "Emit compiled examples and the source-independent use archive");
    const dialogue_exe = g.emitter("agent4-dialogue", dialogue);
    for ([_][]const u8{ "twice", "dispose_owned", "exchange" }) |mode|
        g.emit(emit, dialogue_exe, &.{mode}, b.fmt("dialogue/{s}.bpi2", .{mode}));
    const multi = g.module("test/agent4/multi_probe.zig");
    multi.addImport("deliberation", g.helper("deliberation"));
    const multi_exe = g.emitter("agent4-multi", multi);
    for ([_][]const u8{ "multi", "cleanup", "dispose" }) |mode|
        g.emit(emit, multi_exe, &.{mode}, b.fmt("multi/{s}.bpi2", .{mode}));
    emit.dependOn(&b.addInstallArtifact(multi_exe, .{}).step);
    const approval_exe = g.emitter("agent4-approval", g.module("test/agent4/approval_probe.zig"));
    g.emit(emit, approval_exe, &.{}, "approval/approval.bpi2");
    g.emit(emit, approval_exe, &.{"evidence"}, "approval/approval-evidence.bpi2");
    g.emit(emit, approval_exe, &.{"scoped"}, "approval/approval-scoped.bpi2");
    const review = g.module("test/consumers/review/main.zig");
    g.testModule(check, review);
    const review_exe = g.emitter("agent4-review", review);
    for ([_][]const u8{ "mid_review", "clarify_first", "human", "model", "rule", "react" }) |mode| {
        for ([_][]const u8{ "bpi2", "args" }) |format|
            g.emit(emit, review_exe, &.{ mode, format }, b.fmt("review/{s}.{s}", .{ mode, format }));
    }
    const document_exe = g.emitter("agent4-document", g.module("test/consumers/document/main.zig"));
    g.emit(emit, document_exe, &.{}, "document/document.bpi2");
    g.emit(emit, document_exe, &.{"args"}, "document/document.args");
    const inventory = b.addSystemCommand(&.{ "node", "tools/agent4/emit_inventory.mjs", b.getInstallPath(.prefix, "agent4") });
    inventory.has_side_effects = true;
    inventory.step.dependOn(emit);
    const package = b.addSystemCommand(&.{ "node", "tools/agent4/package.mjs", "--images-dir", b.getInstallPath(.prefix, "agent4"), "--output-dir", b.getInstallPath(.prefix, "agent4-release"), "--version", "4.0.0-dev.0" });
    if (runtime) |runtime_path| package.addArgs(&.{ "--world-runtime", runtime_path });
    package.has_side_effects = true;
    package.step.dependOn(&inventory.step);
    distribution.dependOn(&package.step);
    check.dependOn(distribution);

    const integration = b.step("check-agent4-integration", "Execute consumer proofs under unchanged World");
    const economy = b.step("check-agent4-economy", "Measure direct/facade and retained-state economy");
    if (runtime) |runtime_path| {
        const world = b.createModule(.{
            .root_source_file = .{ .cwd_relative = b.pathJoin(&.{ world_source, "src/root.zig" }) },
            .target = b.graph.host,
            .optimize = optimize,
            .imports = &.{.{ .name = "boundary_data_v2", .module = data }},
        });
        const runtime_guard = b.addSystemCommand(&.{ "node", "tools/agent4/dependencies.mjs", "verify", "--world-runtime", runtime_path, "--world-source", world_source });
        addBoundary(b, runtime_guard, source, target, optimize);
        runtime_guard.has_side_effects = true;
        _ = runtime_guard.captureStdOut(.{});
        const runtime_work = b.step("agent4-runtime-tests", "Native and embedding test implementation");
        var native_graph = g;
        native_graph.gate = &runtime_guard.step;
        const native_module = b.createModule(.{
            .root_source_file = b.path("test/agent4/native.zig"),
            .target = b.graph.host,
            .optimize = optimize,
            .imports = &.{ .{ .name = "world", .module = world }, .{ .name = "boundary_data_v2", .module = data } },
        });
        const native_exe = native_graph.emitter("agent4-native", native_module);
        for ([_][]const u8{ "decision_scopes", "model_admission", "model_custody", "observation", "approval_equality", "callable_runtime" }) |name| {
            const native = g.module(b.fmt("test/agent4/{s}.zig", .{name}));
            native.addImport("world", world);
            native.addImport("equality", g.helper("value_equality"));
            native_graph.testModule(runtime_work, native);
        }
        const run = b.addSystemCommand(&.{ "node", "tools/agent4/check.mjs", "integration", "--world-runtime", runtime_path, "--fixtures", b.getInstallPath(.prefix, "agent4"), "--world-source", world_source });
        run.addArg("--native");
        run.addFileArg(native_exe.getEmittedBin());
        addBoundary(b, run, source, target, optimize);
        run.has_side_effects = true;
        run.step.dependOn(emit);
        run.step.dependOn(&runtime_guard.step);
        runtime_work.dependOn(&run.step);
        const runtime_post = b.addSystemCommand(&.{ "node", "tools/agent4/dependencies.mjs", "verify", "--world-runtime", runtime_path, "--world-source", world_source });
        addBoundary(b, runtime_post, source, target, optimize);
        runtime_post.has_side_effects = true;
        _ = runtime_post.captureStdOut(.{});
        runtime_post.step.dependOn(runtime_work);
        integration.dependOn(&runtime_post.step);
        const economy_exe = g.emitter("economy-probe", g.module("test/agent4/economy.zig"));
        const economy_emit = b.addRunArtifact(economy_exe);
        economy_emit.addArgs(&.{ "emit", b.getInstallPath(.prefix, "agent4/economy") });
        const measure = b.addSystemCommand(&.{ "node", "tools/agent4/economy.mjs", "--world-runtime", runtime_path, "--fixtures", b.getInstallPath(.prefix, "agent4/economy"), "--output", b.getInstallPath(.prefix, "agent4/economy-results"), "--probe" });
        const installed_probe = b.addInstallArtifact(economy_exe, .{});
        measure.addArg(b.getInstallPath(.bin, "economy-probe"));
        measure.step.dependOn(&installed_probe.step);
        if (measure_economy) measure.addArgs(&.{ "--measure", "--uncontended" });
        measure.has_side_effects = true;
        measure.step.dependOn(emit);
        measure.step.dependOn(&economy_emit.step);
        economy.dependOn(&measure.step);
    } else {
        const missing = b.addFail("provide -Dworld-runtime=/absolute/authenticated/world-runtime");
        integration.dependOn(&missing.step);
        economy.dependOn(&missing.step);
    }
    const pure = b.addSystemCommand(&.{ "node", "tools/agent4/check.mjs", "authoring" });
    addBoundary(b, pure, source, target, optimize);
    pure.has_side_effects = true;
    pure.step.dependOn(&source_guard.step);
    check.dependOn(&pure.step);
    const installation = b.addSystemCommand(&.{ "node", "test/agent4/installations.mjs", "--output", b.pathFromRoot(".agent4/out/installation-authoring.json") });
    installation.has_side_effects = true;
    installation.step.dependOn(&source_guard.step);
    check.dependOn(&installation.step);
    const post = b.addSystemCommand(&.{ "node", "tools/agent4/dependencies.mjs", "verify", "--authoring-only" });
    addBoundary(b, post, source, target, optimize);
    post.has_side_effects = true;
    _ = post.captureStdOut(.{});
    post.step.dependOn(check);
    aggregate.dependOn(&post.step);
    b.step("check", "Check Agent 4 authoring").dependOn(aggregate);
    b.default_step = aggregate;
}

fn addBoundary(b: *std.Build, run: *std.Build.Step.Run, source: ?[]const u8, target: std.Build.ResolvedTarget, optimize: std.builtin.OptimizeMode) void {
    if (source) |path| run.addArgs(&.{ "--boundary-source", path }) else {
        run.addArg("--boundary-package");
        run.addDirectoryArg(b.dependency("boundary", .{ .target = target, .optimize = optimize }).path("."));
    }
}
