const std = @import("std");
// A fixture selection changes execution, not its compiler/module graph.
const Executable = struct {
    artifact: *std.Build.Step.Compile,
    fixture: ?[]const u8 = null,

    fn select(executable: Executable, name: []const u8) Executable {
        std.debug.assert(executable.fixture == null);
        return .{ .artifact = executable.artifact, .fixture = name };
    }
    fn addArgument(executable: Executable, run: *std.Build.Step.Run) void {
        run.addArtifactArg2(executable.artifact, .{});
        if (executable.fixture) |name| run.setEnvironmentVariable("AGENT4_FIXTURE", name);
    }
    fn getEmittedBin(executable: Executable) std.Build.LazyPath {
        // Callers that invoke the raw path must not lose a fixture selection.
        std.debug.assert(executable.fixture == null);
        return executable.artifact.getEmittedBin();
    }
};

const Graph = struct {
    b: *std.Build,
    optimize: std.lang.Optimize,
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
                .{ .name = "boundary_data", .module = g.data },
                .{ .name = "agent_contracts", .module = g.contracts },
                .{ .name = "contracts", .module = g.contracts },
            },
        });
    }
    fn helper(g: Graph, name: []const u8) *std.Build.Module {
        return g.module(g.b.fmt("src/{s}.zig", .{name}));
    }
    fn testModule(g: Graph, step: *std.Build.Step, module_value: *std.Build.Module) void {
        const tests = g.b.addTest(.{
            .root_module = module_value,
            .use_llvm = if (g.b.graph.host.result.os.tag == .linux and g.b.graph.host.result.cpu.arch == .x86_64) false else null,
        });
        tests.step.dependOn(g.gate);
        step.dependOn(&g.b.addRunArtifact(tests).step);
    }
    fn emitter(g: Graph, name: []const u8, module_value: *std.Build.Module) Executable {
        const executable = g.b.addExecutable(.{
            .name = name,
            .root_module = module_value,
            .use_llvm = if (g.b.graph.host.result.os.tag == .linux and g.b.graph.host.result.cpu.arch == .x86_64) false else null,
        });
        executable.step.dependOn(g.gate);
        return .{ .artifact = executable };
    }
    fn runArtifact(g: Graph, executable: Executable) *std.Build.Step.Run {
        const run = g.b.addRunArtifact(executable.artifact);
        if (executable.fixture) |name| {
            run.setEnvironmentVariable("AGENT4_FIXTURE", name);
            run.step.name = g.b.fmt("run fixture {s}", .{name});
        }
        return run;
    }
    fn emit(g: Graph, step: *std.Build.Step, executable: Executable, args: []const []const u8, name: []const u8) void {
        const run = g.runArtifact(executable);
        run.addArgs(args);
        step.dependOn(&g.b.addInstallFileWithDir(run.captureStdOut(.{}), .prefix, g.b.fmt("agent4/{s}", .{name})).step);
    }
};

pub fn build(b: *std.Build) void {
    comptime {
        if (!std.mem.eql(u8, @import("builtin").zig_version_string, "0.17.0"))
            @compileError("Zig 0.17.0 is required");
    }
    const optimize = b.standardOptimizeOption(.{});
    const target = b.standardTargetOptions(.{});
    const source = b.option(std.Build.LazyPath, "boundary-source", "Authenticated immutable Boundary source copy");
    const runtime = b.option(std.Build.LazyPath, "world-runtime", "Authenticated immutable World runtime directory");
    const world_source = b.option(std.Build.LazyPath, "world-source", "Immutable World source for native agreement") orelse b.path(".agent4/inputs/world");
    const sqlite_source = b.option(std.Build.LazyPath, "sqlite-source", "Authenticated optional native SQLite source") orelse b.path(".agent4/inputs/sqlite");
    // The dependency verifier derives the sibling archive from the selected
    // lock. Only forward an explicit override; never duplicate its commit here.
    const world_archive = b.option(std.Build.LazyPath, "world-archive", "Authenticated immutable World source archive");
    const data = if (source) |root| b.createModule(.{
        .root_source_file = root.path(b, "src/data/root.zig"),
        .target = b.graph.host,
        .optimize = optimize,
    }) else b.dependency("boundary", .{ .target = b.graph.host, .optimize = optimize }).module("boundary_data");
    const boundary = if (source) |root| b.createModule(.{
        .root_source_file = root.path(b, "src/root.zig"),
        .target = b.graph.host,
        .optimize = optimize,
        .imports = &.{.{ .name = "boundary_data", .module = data }},
    }) else b.dependency("boundary", .{ .target = b.graph.host, .optimize = optimize }).module("boundary");
    const contracts = b.createModule(.{
        .root_source_file = b.path("src/contracts.zig"),
        .target = b.graph.host,
        .optimize = optimize,
        .imports = &.{.{ .name = "boundary_data", .module = data }},
    });
    const agent = b.createModule(.{
        .root_source_file = b.path("src/agent4.zig"),
        .target = b.graph.host,
        .optimize = optimize,
        .imports = &.{ .{ .name = "boundary", .module = boundary }, .{ .name = "boundary_data", .module = data }, .{ .name = "agent_contracts", .module = contracts } },
    });
    const source_guard = nodeCommand(b);
    source_guard.addArgs(&.{ "node", "tools/agent4/dependencies.mjs", "verify", "--authoring-only" });
    // Side effects keep authentication live; this input also wakes watchers.
    source_guard.addFileInput(b.path("conformance/agent4/dependencies.lock.json"));
    addBoundary(b, source_guard, source, target, optimize);
    source_guard.has_side_effects = true;
    source_guard.setCwd(b.path("."));
    _ = source_guard.captureStdOut(.{});
    // Module consumers do not select this package's artifact steps. Carry the
    // authentication prerequisite in their module graph, without runtime code.
    const admission_files = b.addWriteFiles();
    admission_files.step.dependOn(&source_guard.step);
    const admission = b.createModule(.{
        .root_source_file = admission_files.add("agent4_dependency_admission.zig", ""),
    });
    agent.addImport("_agent4_dependency_admission", admission);
    contracts.addImport("_agent4_dependency_admission", admission);
    if (source != null) {
        // These override modules are constructed by Agent, not upstream modules.
        boundary.addImport("_agent4_dependency_admission", admission);
        data.addImport("_agent4_dependency_admission", admission);
    }
    // Emitters and native checks use the host graph above. Exported modules
    // independently honor a consumer's requested target.
    const public_data = if (target.query.isNative()) data else if (source) |root| b.createModule(.{
        .root_source_file = root.path(b, "src/data/root.zig"),
        .target = target,
        .optimize = optimize,
    }) else b.dependency("boundary", .{ .target = target, .optimize = optimize }).module("boundary_data");
    const public_boundary = if (target.query.isNative()) boundary else if (source) |root| b.createModule(.{
        .root_source_file = root.path(b, "src/root.zig"),
        .target = target,
        .optimize = optimize,
        .imports = &.{.{ .name = "boundary_data", .module = public_data }},
    }) else b.dependency("boundary", .{ .target = target, .optimize = optimize }).module("boundary");
    const public_contracts = if (target.query.isNative()) contracts else b.createModule(.{
        .root_source_file = b.path("src/contracts.zig"),
        .target = target,
        .optimize = optimize,
        .imports = &.{.{ .name = "boundary_data", .module = public_data }},
    });
    const public_agent = if (target.query.isNative()) agent else b.createModule(.{
        .root_source_file = b.path("src/agent4.zig"),
        .target = target,
        .optimize = optimize,
        .imports = &.{ .{ .name = "boundary", .module = public_boundary }, .{ .name = "boundary_data", .module = public_data }, .{ .name = "agent_contracts", .module = public_contracts } },
    });
    if (!target.query.isNative()) {
        public_agent.addImport("_agent4_dependency_admission", admission);
        public_contracts.addImport("_agent4_dependency_admission", admission);
        if (source != null) {
            public_boundary.addImport("_agent4_dependency_admission", admission);
            public_data.addImport("_agent4_dependency_admission", admission);
        }
    }
    b.modules.put(b.allocator, b.dupe("boundary"), public_boundary) catch @panic("out of memory");
    b.modules.put(b.allocator, b.dupe("boundary_data"), public_data) catch @panic("out of memory");
    b.modules.put(b.allocator, b.dupe("agent_contracts"), public_contracts) catch @panic("out of memory");
    b.modules.put(b.allocator, b.dupe("agent"), public_agent) catch @panic("out of memory");
    b.modules.put(b.allocator, b.dupe("agent_host_authoring"), agent) catch @panic("out of memory");
    b.modules.put(b.allocator, b.dupe("boundary_host_authoring"), boundary) catch @panic("out of memory");
    b.modules.put(b.allocator, b.dupe("boundary_data_host"), data) catch @panic("out of memory");
    b.modules.put(b.allocator, b.dupe("agent_contracts_host"), contracts) catch @panic("out of memory");
    const g: Graph = .{ .b = b, .optimize = optimize, .agent = agent, .boundary = boundary, .data = data, .contracts = contracts, .gate = &source_guard.step };
    const fixture_driver = g.emitter("agent4-fixtures", g.module("test/fixture_driver.zig"));
    // Native examples share the already compiled fixture owner. Downstream
    // applications use the same asset writer through addNativeSystem.
    fixture_driver.artifact.root_module.addImport("native_asset_writer", g.module("tools/native/emit.zig"));
    inline for (.{ .{ "native-minimal", "native_minimal" }, .{ "repository-agent", "repository_agent" } }) |item| {
        const types = g.module("examples/" ++ item[0] ++ "/types.zig");
        const definition = g.module("examples/" ++ item[0] ++ "/definition.zig");
        definition.addImport("application_types", types);
        fixture_driver.artifact.root_module.addImport(item[1] ++ "_types", types);
        fixture_driver.artifact.root_module.addImport(item[1] ++ "_definition", definition);
    }
    const application_driver = g.emitter("agent4-applications", g.module("test/application_driver.zig"));
    const check = b.step("agent4-authoring-tests", "Authoring test implementation");
    const aggregate = b.step("check-agent4", "Check authoring and pure contracts without World");
    const mobility_protocol = b.step("check-mobility-protocol", "Check canonical mobility records and Ed25519 bindings");
    const protocol_tests = nodeCommand(b);
    protocol_tests.addArgs(&.{ "node", "--test", "test/agent4/mobility_protocol.test.mjs" });
    mobility_protocol.dependOn(&protocol_tests.step);
    check.dependOn(mobility_protocol);
    const binding_tests = nodeCommand(b);
    binding_tests.addArgs(&.{ "node", "--test", "test/agent4/repository_publication_binding.test.mjs", "test/agent4/repository_publication_journal.test.mjs", "test/agent4/mobile_repository_qualification.test.mjs", "test/agent4/dependencies.test.mjs", "test/agent4/setup.test.mjs" });
    check.dependOn(&binding_tests.step);

    const lint = b.step("lint", "Check formatting and the Zig source inventory");
    const format_check = b.addRunFile(.zig_exe);
    format_check.addArgs(&.{ "fmt", "--check", "build.zig", "build_agent4.zig", "build_native.zig", "src", "runtime/native", "tools/native", "examples/native-minimal", "examples/repository-agent", "test/agent4", "test/consumers", "test/fixture_driver.zig", "test/application_driver.zig", "test/authoring_tests.zig" });
    const paths = b.addSystemCommand(&.{ "sh", "tools/check_zig_paths.sh" });
    lint.dependOn(&format_check.step);
    lint.dependOn(&paths.step);
    check.dependOn(lint);
    g.testModule(check, g.module("test/authoring_tests.zig"));
    const zig17_node = nodeCommand(b);
    zig17_node.addArgs(&.{ "node", "--test", "test/agent4/zig17.test.mjs" });
    check.dependOn(&zig17_node.step);
    const composed_images = b.step("composed-owner-images", "Emit admitted composed-owner cleanup");
    const composed_emitter = fixture_driver.select("composed-owners");
    g.emit(composed_images, composed_emitter, &.{}, "composed-owners.bpi3");
    check.dependOn(composed_images);
    const selection_images = b.step("selection-images", "Emit checked recursive numerical selection");
    const selection_emitter = fixture_driver.select("recursive-selection");
    const selection_producer = g.runArtifact(selection_emitter);
    selection_producer.addArg("producer");
    const selection_object = selection_producer.captureStdOut(.{});
    selection_images.dependOn(&b.addInstallFileWithDir(selection_object, .prefix, "agent4/selection/producer.bmo1").step);
    for ([_][]const u8{ "link", "pure", "invalid" }) |mode| {
        const linked = g.runArtifact(selection_emitter);
        linked.addArg(mode);
        linked.addFileArg2(selection_object, .{});
        selection_images.dependOn(&b.addInstallFileWithDir(linked.captureStdOut(.{}), .prefix, b.fmt("agent4/selection/{s}.bpi3", .{mode})).step);
    }
    check.dependOn(selection_images);
    const selection_negative = nodeCommand(b);
    selection_negative.addArgs(&.{ "node", "test/agent4/selection_negative.mjs" });
    selection_emitter.addArgument(selection_negative);
    selection_negative.addFileArg2(selection_object, .{});
    selection_images.dependOn(&selection_negative.step);
    const parser_tools = b.step("check-parser-tools", "Check typed parser tool bindings");
    check.dependOn(parser_tools);
    const parser_delivery = b.step("parser-delivery-images", "Emit protected parser delivery");
    const delivery_emitter = fixture_driver.select("parser-delivery");
    for ([_][]const u8{ "program", "input-schema", "result-schema" }) |mode|
        g.emit(parser_delivery, delivery_emitter, &.{mode}, b.fmt("parser-delivery/{s}.bin", .{mode}));
    check.dependOn(parser_delivery);
    const parser_proposals = b.step("parser-proposal-images", "Emit checked parser model proposals");
    const proposal_emitter = fixture_driver.select("parser-proposals");
    for ([_][]const u8{ "program", "input", "result-schema", "fragment", "experiment", "constraint", "unresolved", "unknown", "unoffered" }) |mode|
        g.emit(parser_proposals, proposal_emitter, &.{mode}, b.fmt("parser-proposals/{s}.bin", .{mode}));
    check.dependOn(parser_proposals);
    const parser_episode = b.step("parser-construction-images", "Emit consumer-directed parser construction");
    const parser_app = application_driver.select("parser-construction");
    g.emit(parser_episode, parser_app, &.{"react"}, "parser-construction/react.bpi3");
    const parser_link_module = g.module("tools/agent4/link_parser.zig");
    parser_link_module.addImport("parser_application", g.module("test/consumers/incremental-parser/main.zig"));
    const parser_link_only = g.emitter("link-parser", parser_link_module);
    parser_episode.dependOn(&b.addInstallArtifact(parser_link_only.artifact, .{}).step);
    const disposition_negative = nodeCommand(b);
    disposition_negative.addArgs(&.{ "node", "test/agent4/parser_disposition_negative.mjs" });
    parser_app.addArgument(disposition_negative);
    parser_episode.dependOn(&disposition_negative.step);
    const parser_producer = g.runArtifact(parser_app);
    parser_producer.addArg("producer");
    const parser_producer_bytes = parser_producer.captureStdOut(.{});
    const parser_consumer = g.runArtifact(parser_app);
    parser_consumer.addArg("consumer");
    const parser_consumer_bytes = parser_consumer.captureStdOut(.{});
    const parser_reference = g.runArtifact(parser_app);
    parser_reference.addArg("reference");
    const parser_reference_bytes = parser_reference.captureStdOut(.{});
    const parser_link = g.runArtifact(parser_app);
    parser_link.addArg("link");
    parser_link.addFileArg2(parser_producer_bytes, .{});
    parser_link.addFileArg2(parser_consumer_bytes, .{});
    parser_link.addFileArg2(parser_reference_bytes, .{});
    parser_episode.dependOn(&b.addInstallFileWithDir(parser_reference_bytes, .prefix, "agent4/parser-construction/reference.bmo1").step);
    parser_episode.dependOn(&b.addInstallFileWithDir(parser_producer_bytes, .prefix, "agent4/parser-construction/producer.bmo1").step);
    parser_episode.dependOn(&b.addInstallFileWithDir(parser_consumer_bytes, .prefix, "agent4/parser-construction/consumer.bmo1").step);
    parser_episode.dependOn(&b.addInstallFileWithDir(parser_link.captureStdOut(.{}), .prefix, "agent4/parser-construction/program.bpi3").step);
    for ([_][]const u8{ "first", "last" }) |policy| {
        const selected_link = g.runArtifact(parser_app);
        selected_link.addArg(b.fmt("link-select-{s}", .{policy}));
        selected_link.addFileArg2(parser_producer_bytes, .{});
        selected_link.addFileArg2(parser_consumer_bytes, .{});
        selected_link.addFileArg2(parser_reference_bytes, .{});
        parser_episode.dependOn(&b.addInstallFileWithDir(selected_link.captureStdOut(.{}), .prefix, b.fmt("agent4/parser-construction/select-{s}.bpi3", .{policy})).step);
    }
    const complete_link = g.runArtifact(parser_app);
    complete_link.addArg("link-complete");
    complete_link.addFileArg2(parser_producer_bytes, .{});
    complete_link.addFileArg2(parser_consumer_bytes, .{});
    complete_link.addFileArg2(parser_reference_bytes, .{});
    parser_episode.dependOn(&b.addInstallFileWithDir(complete_link.captureStdOut(.{}), .prefix, "agent4/parser-construction/complete.bpi3").step);
    const retained_link = g.runArtifact(parser_app);
    retained_link.addArg("link-retained");
    retained_link.addFileArg2(parser_producer_bytes, .{});
    retained_link.addFileArg2(parser_consumer_bytes, .{});
    retained_link.addFileArg2(parser_reference_bytes, .{});
    parser_episode.dependOn(&b.addInstallFileWithDir(retained_link.captureStdOut(.{}), .prefix, "agent4/parser-construction/retained.bpi3").step);
    const parser_alternate_consumer = g.runArtifact(parser_app);
    parser_alternate_consumer.addArg("consumer-alt");
    const parser_alternate_consumer_bytes = parser_alternate_consumer.captureStdOut(.{});
    const parser_alternate_link = g.runArtifact(parser_app);
    parser_alternate_link.addArg("link");
    parser_alternate_link.addFileArg2(parser_producer_bytes, .{});
    parser_alternate_link.addFileArg2(parser_alternate_consumer_bytes, .{});
    parser_alternate_link.addFileArg2(parser_reference_bytes, .{});
    parser_episode.dependOn(&b.addInstallFileWithDir(parser_alternate_consumer_bytes, .prefix, "agent4/parser-construction/consumer-alt.bmo1").step);
    parser_episode.dependOn(&b.addInstallFileWithDir(parser_alternate_link.captureStdOut(.{}), .prefix, "agent4/parser-construction/alternate.bpi3").step);
    // The consumer-swap witness keeps its historical producer bytes immutable.
    // Normal parser images above continue using the current emitted producer.
    for ([_]struct { consumer: std.Build.LazyPath, name: []const u8 }{
        .{ .consumer = parser_consumer_bytes, .name = "consumer-fixed" },
        .{ .consumer = parser_alternate_consumer_bytes, .name = "consumer-alt-fixed" },
    }) |witness| {
        const linked = g.runArtifact(parser_app);
        linked.addArg("link");
        linked.addFileArg2(b.path("conformance/agent4/parser-producer-v2.bmo1"), .{});
        linked.addFileArg2(witness.consumer, .{});
        linked.addFileArg2(parser_reference_bytes, .{});
        parser_episode.dependOn(&b.addInstallFileWithDir(linked.captureStdOut(.{}), .prefix, b.fmt("agent4/parser-construction/{s}.bpi3", .{witness.name})).step);
    }
    const circular_consumer = g.runArtifact(parser_app);
    circular_consumer.addArg("consumer-circular");
    const circular_link = g.runArtifact(parser_app);
    circular_link.addArg("link");
    circular_link.addFileArg2(parser_producer_bytes, .{});
    circular_link.addFileArg2(circular_consumer.captureStdOut(.{}), .{});
    circular_link.addFileArg2(parser_reference_bytes, .{});
    parser_episode.dependOn(&b.addInstallFileWithDir(circular_link.captureStdOut(.{}), .prefix, "agent4/parser-construction/circular.bpi3").step);
    const forged_consumer = g.runArtifact(parser_app);
    forged_consumer.addArg("consumer-forged");
    const forged_link = g.runArtifact(parser_app);
    forged_link.addArg("link");
    forged_link.addFileArg2(parser_producer_bytes, .{});
    forged_link.addFileArg2(forged_consumer.captureStdOut(.{}), .{});
    forged_link.addFileArg2(parser_reference_bytes, .{});
    parser_episode.dependOn(&b.addInstallFileWithDir(forged_link.captureStdOut(.{}), .prefix, "agent4/parser-construction/forged.bpi3").step);
    for ([_][]const u8{ "model-template", "input-schema", "result-schema", "model-schema", "model-reply-schema" }) |mode|
        g.emit(parser_episode, parser_app, &.{mode}, b.fmt("parser-construction/{s}.bin", .{mode}));
    check.dependOn(parser_episode);
    const parser_schema = fixture_driver.select("parser-schema");
    g.emit(parser_tools, parser_schema, &.{"program"}, "parser/program.bpi3");
    for ([_][]const u8{ "reference-request", "reference-reply", "execution-request", "execution-reply" }) |mode|
        g.emit(parser_tools, parser_schema, &.{mode}, b.fmt("parser/{s}.bin", .{mode}));
    const parser_oracle = nodeCommand(b);
    parser_oracle.addArgs(&.{ "node", "--test", "test/agent4/parser_oracle.test.mjs", "test/agent4/parser_disposition.test.mjs" });
    check.dependOn(&parser_oracle.step);
    g.testModule(check, g.module("src/test_root.zig"));
    const negatives = nodeCommand(b);
    negatives.addArgs(&.{ "node", "tools/agent4/negative.mjs" });
    if (source) |path| {
        negatives.addDirectoryArg2(path, .{ .make_absolute = true });
        negatives.addArg("source");
    } else {
        negatives.addDirectoryArg2(b.dependency("boundary", .{ .target = target, .optimize = optimize }).path("."), .{});
        negatives.addArg("package");
    }
    negatives.addFileArg2(.zig_exe, .{ .make_absolute = true });
    negatives.has_side_effects = true;
    negatives.step.dependOn(&source_guard.step);
    check.dependOn(&negatives.step);
    const admitted = g.module("test/agent4/admission.zig");
    admitted.addImport("admission", g.helper("admission"));
    g.testModule(check, admitted);
    const dialogue = g.module("test/agent4/dialogue_probe.zig");
    dialogue.addImport("interaction", g.helper("interaction"));
    g.testModule(check, dialogue);

    const emit = b.step("agent4-images", "Compile the consumer images");
    emit.dependOn(parser_episode);
    const participant_images = b.step("participant-images", "Emit and link the internal model participant");
    const participant_exe = fixture_driver.select("agent-participant");
    const participant_object = g.runArtifact(participant_exe);
    participant_object.addArg("object");
    const participant_bytes = participant_object.captureStdOut(.{});
    const participant_link = g.runArtifact(participant_exe);
    participant_link.addArg("link");
    participant_link.addFileArg2(participant_bytes, .{});
    participant_images.dependOn(&b.addInstallFileWithDir(participant_bytes, .prefix, "agent4/participant/producer.bmo1").step);
    participant_images.dependOn(&b.addInstallFileWithDir(participant_link.captureStdOut(.{}), .prefix, "agent4/participant/program.bpi3").step);
    for ([_][]const u8{ "input", "reply", "expected" }) |mode|
        g.emit(participant_images, participant_exe, &.{mode}, b.fmt("participant/{s}.bin", .{mode}));
    emit.dependOn(participant_images);
    const recursive_images = b.step("recursive-participant-images", "Emit reciprocal task participants");
    const recursive_exe = fixture_driver.select("agent-recursive-participant");
    const producer_run = g.runArtifact(recursive_exe);
    producer_run.addArg("producer");
    const producer_bytes = producer_run.captureStdOut(.{});
    const consumer_run = g.runArtifact(recursive_exe);
    consumer_run.addArg("consumer");
    const consumer_bytes = consumer_run.captureStdOut(.{});
    const recursive_link = g.runArtifact(recursive_exe);
    recursive_link.addArg("link");
    recursive_link.addFileArg2(producer_bytes, .{});
    recursive_link.addFileArg2(consumer_bytes, .{});
    recursive_images.dependOn(&b.addInstallFileWithDir(producer_bytes, .prefix, "agent4/recursive/producer.bmo1").step);
    recursive_images.dependOn(&b.addInstallFileWithDir(consumer_bytes, .prefix, "agent4/recursive/consumer.bmo1").step);
    recursive_images.dependOn(&b.addInstallFileWithDir(recursive_link.captureStdOut(.{}), .prefix, "agent4/recursive/program.bpi3").step);
    const alternate_run = g.runArtifact(recursive_exe);
    alternate_run.addArg("consumer-alt");
    const alternate_bytes = alternate_run.captureStdOut(.{});
    const alternate_link = g.runArtifact(recursive_exe);
    alternate_link.addArg("link");
    alternate_link.addFileArg2(producer_bytes, .{});
    alternate_link.addFileArg2(alternate_bytes, .{});
    recursive_images.dependOn(&b.addInstallFileWithDir(alternate_bytes, .prefix, "agent4/recursive/consumer-alt.bmo1").step);
    recursive_images.dependOn(&b.addInstallFileWithDir(alternate_link.captureStdOut(.{}), .prefix, "agent4/recursive/program-alt.bpi3").step);
    for ([_][]const u8{ "input", "reply" }) |mode|
        g.emit(recursive_images, recursive_exe, &.{mode}, b.fmt("recursive/{s}.bin", .{mode}));
    emit.dependOn(recursive_images);
    const text_object = fixture_driver.select("agent-text-object");
    const mobility_consumer = fixture_driver.select("agent-mobility-consumer");
    const mobile_repository_images = b.step("mobile-repository-images", "Emit the mobile repository application and ordinary contracts");
    const repository_runner = b.step("repository-check-runner", "Install the macOS Zig check resource launcher and loader restriction");
    const publication_gate = b.step("repository-publication-gate", "Install the process-owned managed Git publication gate");
    if (b.graph.host.result.os.tag == .macos) {
        const gate_exe = b.addExecutable(.{ .name = "agent-publication-gate", .root_module = b.createModule(.{
            .root_source_file = b.path("runtime/repository_publication_gate.zig"),
            .target = b.graph.host,
            .optimize = .safe,
            .link_libc = true,
        }) });
        emit.dependOn(&b.addInstallFileWithDir(gate_exe.getEmittedBin(), .prefix, "agent4/native/agent-publication-gate").step);
        publication_gate.dependOn(&b.addInstallFileWithDir(gate_exe.getEmittedBin(), .prefix, "repository-publication/agent-publication-gate").step);
        const limit_exe = b.addExecutable(.{ .name = "agent-check-limit", .root_module = b.createModule(.{
            .root_source_file = b.path("runtime/inquiry_process_limit.zig"),
            .target = b.graph.host,
            .optimize = .safe,
            .link_libc = true,
        }) });
        const process_lock = b.addLibrary(.{ .name = "agent-check-lock", .linkage = .dynamic, .root_module = b.createModule(.{
            .root_source_file = b.path("runtime/inquiry_process_lock.zig"),
            .target = b.graph.host,
            .optimize = .safe,
            .link_libc = true,
        }) });
        emit.dependOn(&b.addInstallFileWithDir(limit_exe.getEmittedBin(), .prefix, "agent4/native/agent-check-limit").step);
        emit.dependOn(&b.addInstallFileWithDir(process_lock.getEmittedBin(), .prefix, "agent4/native/libagent-check-lock.dylib").step);
        repository_runner.dependOn(&b.addInstallFileWithDir(limit_exe.getEmittedBin(), .prefix, "repository-check/agent-check-limit").step);
        repository_runner.dependOn(&b.addInstallFileWithDir(process_lock.getEmittedBin(), .prefix, "repository-check/libagent-check-lock.dylib").step);
    } else {
        const unavailable = b.addFail("repository execution helpers require the qualified macOS host profile");
        publication_gate.dependOn(&unavailable.step);
        repository_runner.dependOn(&unavailable.step);
    }
    const mobile_repository_emitter = g.emitter("mobile-repository-emitter", g.module("test/consumers/mobile_repository/main.zig"));
    const repository_approval_images = b.step("repository-approval-images", "Emit the shared managed publication approval composition");
    const repository_approval_emitter = g.emitter("repository-approval-emitter", g.module("test/consumers/mobile_repository/publication.zig"));
    g.emit(repository_approval_images, repository_approval_emitter, &.{"image"}, "repository-approval/program.bpi3");
    for ([_][]const u8{ "task", "preparation", "result", "check-result", "proposal", "receipt", "delivery", "human", "human-reply", "identifier", "boolean" }) |name|
        g.emit(repository_approval_images, repository_approval_emitter, &.{name}, b.fmt("repository-approval/{s}.schema", .{name}));
    emit.dependOn(mobile_repository_images);
    emit.dependOn(repository_approval_images);
    g.emit(mobile_repository_images, mobile_repository_emitter, &.{"image"}, "mobile-repository/program.bpi3");
    g.emit(mobile_repository_images, mobile_repository_emitter, &.{"session-image"}, "mobile-repository/session.bpi3");
    for ([_][]const u8{ "session", "next-task", "next-task-answer", "task", "report", "snapshot-request", "snapshot", "read", "evidence", "list", "listing", "search", "search-result", "read-window", "read-window-result", "question", "answer", "cleanup", "unit", "model-request", "model-result", "candidate-preparation", "publication-preparation", "review", "review-answer" }) |name|
        g.emit(mobile_repository_images, mobile_repository_emitter, &.{name}, b.fmt("mobile-repository/{s}.schema", .{name}));
    const mobility_images = b.step("mobility-images", "Emit the independent mobility consumer");
    const mobility_approval_images = b.step("mobility-approval-images", "Emit the movable approval and fixture replacement consumer");
    emit.dependOn(mobility_approval_images);
    const mobility_approval_consumer = fixture_driver.select("agent-mobility-approval");
    g.emit(mobility_approval_images, mobility_approval_consumer, &.{"image"}, "mobility-approval/program.bpi3");
    g.emit(mobility_approval_images, mobility_approval_consumer, &.{"identity"}, "mobility-approval/program-id.bin");
    for ([_][]const u8{ "task", "report", "proposal", "read", "delivery", "human", "human-reply", "identifier", "integer", "boolean" }) |name|
        g.emit(mobility_approval_images, mobility_approval_consumer, &.{name}, b.fmt("mobility-approval/{s}.schema", .{name}));
    const mobility_ensure = fixture_driver.select("agent-mobility-ensure");
    for ([_][]const u8{ "loop-image", "loop-identity" }) |name|
        g.emit(mobility_images, mobility_ensure, &.{name}, b.fmt("mobility/{s}.bin", .{name}));
    for ([_][]const u8{ "image", "input", "result" }) |name|
        g.emit(mobility_images, mobility_ensure, &.{name}, b.fmt("mobility/ensure-{s}.bin", .{name}));
    const mobility_image = g.runArtifact(mobility_consumer);
    mobility_image.addArg("image");
    mobility_image.addFileArg2(g.runArtifact(text_object).captureStdOut(.{}), .{});
    mobility_images.dependOn(&b.addInstallFileWithDir(mobility_image.captureStdOut(.{}), .prefix, "agent4/mobility/program.bpi3").step);
    const mobility_identity = g.runArtifact(mobility_consumer);
    mobility_identity.addArg("identity");
    mobility_identity.addFileArg2(g.runArtifact(text_object).captureStdOut(.{}), .{});
    mobility_images.dependOn(&b.addInstallFileWithDir(mobility_identity.captureStdOut(.{}), .prefix, "agent4/mobility/program-id.bin").step);
    for ([_][]const u8{ "fixed-image", "fixed-identity", "yield-image", "yield-identity" }) |mode| {
        const variant = g.runArtifact(mobility_consumer);
        variant.addArg(mode);
        variant.addFileArg2(g.runArtifact(text_object).captureStdOut(.{}), .{});
        mobility_images.dependOn(&b.addInstallFileWithDir(variant.captureStdOut(.{}), .prefix, b.fmt("agent4/mobility/{s}.bin", .{mode})).step);
    }
    emit.dependOn(mobility_images);
    for ([_][]const u8{ "task", "report", "resolve", "resolution", "relocate", "relocation-reply", "read", "text-reply", "subject", "inspection", "integer", "unit" }) |name|
        g.emit(mobility_images, mobility_consumer, &.{b.fmt("{s}-schema", .{name})}, b.fmt("mobility/{s}.schema", .{name}));
    const text_link = g.emitter("agent-text-link", g.module("test/agent4/text_link.zig"));
    const text_object_bytes = g.runArtifact(text_object).captureStdOut(.{});
    emit.dependOn(&b.addInstallFileWithDir(text_object_bytes, .prefix, "agent4/text/tool.bmo1").step);
    for ([_][]const u8{ "standalone", "agent" }) |mode| {
        const linked = g.runArtifact(text_link);
        linked.addArg(mode);
        linked.addFileArg2(text_object_bytes, .{});
        emit.dependOn(&b.addInstallFileWithDir(linked.captureStdOut(.{}), .prefix, b.fmt("agent4/text/{s}.bpi3", .{mode})).step);
    }
    for ([_][]const u8{ "subject-schema", "task-schema", "result-schema", "report-schema", "model-reply" }) |mode|
        g.emit(emit, text_link, &.{mode}, b.fmt("text/{s}.bin", .{mode}));
    const distribution = b.step("emit-agent4", "Emit compiled examples and the source-independent use archive");
    const repository_images = b.step("repository-application-images", "Emit repository repair and its portable schemas");
    const repository_app = application_driver.select("repository-application");
    g.emit(repository_images, repository_app, &.{}, "repository/repair.bpi3");
    for ([_][]const u8{ "task-schema", "result-schema", "failure-schema" }) |mode|
        g.emit(repository_images, repository_app, &.{mode}, b.fmt("repository/{s}.bin", .{mode}));
    emit.dependOn(repository_images);
    const dialogue_exe = g.emitter("agent4-dialogue", dialogue);
    const inquiry_exe = fixture_driver.select("agent4-inquiry-probe");
    const inquiry_broker_exe = fixture_driver.select("agent4-inquiry-broker");
    const inquiry_app_exe = application_driver.select("agent4-inquiry-application");
    const inquiry_app_images = b.step("inquiry-application-images", "Emit the inquiry consumer and schemas");
    g.emit(inquiry_app_images, inquiry_app_exe, &.{}, "inquiry/repair.bpi3");
    g.emit(inquiry_app_images, inquiry_app_exe, &.{"repeat"}, "inquiry/repeated.bpi3");
    g.emit(inquiry_app_images, inquiry_app_exe, &.{"react"}, "inquiry/react.bpi3");
    for ([_][]const u8{ "task-schema", "outcome-schema" }) |mode| {
        g.emit(inquiry_app_images, inquiry_app_exe, &.{mode}, b.fmt("inquiry/{s}.bin", .{mode}));
    }
    emit.dependOn(inquiry_app_images);
    g.emit(emit, inquiry_broker_exe, &.{}, "inquiry/broker.bpi3");
    for ([_][]const u8{ "owned", "composition", "followup", "typed" }) |mode| {
        g.emit(emit, inquiry_exe, &.{mode}, b.fmt("inquiry/{s}.bpi3", .{mode}));
    }
    for ([_][]const u8{ "twice", "dispose_owned", "exchange", "deep_exchange", "wide_exchange", "yield_once" }) |mode|
        g.emit(emit, dialogue_exe, &.{mode}, b.fmt("dialogue/{s}.bpi3", .{mode}));
    const multi = g.module("test/agent4/multi_probe.zig");
    multi.addImport("deliberation", g.helper("deliberation"));
    const multi_exe = g.emitter("agent4-multi", multi);
    const multi_images = b.step("multi-images", "Emit shared multi-shot fixtures");
    emit.dependOn(multi_images);
    for ([_][]const u8{ "multi", "cleanup", "dispose" }) |mode|
        g.emit(multi_images, multi_exe, &.{mode}, b.fmt("multi/{s}.bpi3", .{mode}));
    const installed_multi = b.addInstallArtifact(multi_exe.artifact, .{});
    emit.dependOn(&installed_multi.step);
    b.step("build-inspector", "Build the read-only Program/State inspector").dependOn(&installed_multi.step);
    const approval_exe = fixture_driver.select("agent4-approval");
    g.emit(emit, approval_exe, &.{}, "approval/approval.bpi3");
    g.emit(emit, approval_exe, &.{"evidence"}, "approval/approval-evidence.bpi3");
    g.emit(emit, approval_exe, &.{"scoped"}, "approval/approval-scoped.bpi3");
    g.emit(emit, approval_exe, &.{"scoped_evidence"}, "approval/approval-scoped-evidence.bpi3");
    const review_exe = application_driver.select("agent4-review");
    for ([_][]const u8{ "mid_review", "clarify_first", "human", "model", "rule", "react" }) |mode| {
        for ([_][]const u8{ "bpi3", "args" }) |format|
            g.emit(emit, review_exe, &.{ mode, format }, b.fmt("review/{s}.{s}", .{ mode, format }));
    }
    const document_exe = application_driver.select("agent4-document");
    g.emit(emit, document_exe, &.{}, "document/document.bpi3");
    g.emit(emit, document_exe, &.{"args"}, "document/document.args");
    g.emit(emit, document_exe, &.{"consequence"}, "document/consequence.bpi3");
    g.emit(emit, document_exe, &.{"consequence-args"}, "document/consequence.args");
    g.emit(emit, document_exe, &.{"consequence-clarify-first"}, "document/clarify-first.bpi3");
    const inventory = nodeCommand(b);
    inventory.addArgs(&.{ "node", "tools/agent4/emit_inventory.mjs" });
    inventory.addDirectoryArg2(b.graph.path(.install_prefix, "agent4"), .{ .make_absolute = true });
    inventory.has_side_effects = true;
    inventory.step.dependOn(emit);
    const package = nodeCommand(b);
    package.addArgs(&.{ "node", "tools/agent4/package.mjs", "--images-dir" });
    package.addDirectoryArg2(b.graph.path(.install_prefix, "agent4"), .{ .make_absolute = true });
    package.addArg("--output-dir");
    package.addDirectoryArg2(b.graph.path(.install_prefix, "agent4-release"), .{ .make_absolute = true });
    package.addArgs(&.{ "--version", "4.0.0-dev.0" });
    if (runtime) |runtime_path| {
        package.addArg("--world-runtime");
        package.addDirectoryArg2(runtime_path, .{ .make_absolute = true });
    }
    package.has_side_effects = true;
    package.step.dependOn(&inventory.step);
    distribution.dependOn(&package.step);
    check.dependOn(emit);

    const native_checks = b.step("check-native", "Check native and custody contracts against the selected World");
    const native_consumer = b.step("check-native-consumer", "Build and execute an embedded public World consumer (N0)");
    const native_example = b.step("native-example", "Build the minimal embedded native application");
    const native_host = b.step("check-native-host", "Check the native build, embedded assets and protocol discovery");
    native_checks.dependOn(native_consumer);
    native_checks.dependOn(native_host);
    if (runtime) |runtime_path| {
        const world = b.createModule(.{
            .root_source_file = world_source.path(b, "src/root.zig"),
            .target = b.graph.host,
            .optimize = optimize,
            .imports = &.{.{ .name = "boundary_data", .module = data }},
        });
        const runtime_guard = nodeCommand(b);
        runtime_guard.addArgs(&.{ "node", "tools/agent4/dependencies.mjs", "verify", "--world-runtime" });
        runtime_guard.addFileInput(b.path("conformance/agent4/dependencies.lock.json"));
        runtime_guard.addDirectoryArg2(runtime_path, .{ .make_absolute = true });
        runtime_guard.addArg("--world-source");
        runtime_guard.addDirectoryArg2(world_source, .{ .make_absolute = true });
        if (world_archive) |archive| {
            runtime_guard.addArg("--world-archive");
            runtime_guard.addFileArg2(archive, .{ .make_absolute = true });
        }
        addBoundary(b, runtime_guard, source, target, optimize);
        runtime_guard.has_side_effects = true;
        _ = runtime_guard.captureStdOut(.{});
        var native_graph = g;
        native_graph.gate = &runtime_guard.step;
        const native_guard = nodeCommand(b);
        native_guard.addArgs(&.{ "node", "tools/agent4/native-dependencies.mjs", "verify" });
        native_guard.addDirectoryArg2(sqlite_source, .{ .make_absolute = true });
        native_guard.addFileInput(b.path("conformance/agent4/native-dependencies.lock.json"));
        native_guard.has_side_effects = true;
        _ = native_guard.captureStdOut(.{});
        native_guard.step.dependOn(&runtime_guard.step);
        const native_admission_files = b.addWriteFiles();
        native_admission_files.step.dependOn(&native_guard.step);
        const native_admission = b.createModule(.{ .root_source_file = native_admission_files.add("native_dependency_admission.zig", "") });
        const host_environment = nativeEnvironment(b, b.graph.host, optimize, world, data, contracts, native_admission, sqlite_source, &native_guard.step);
        // Host-default Linux packaging selects musl. Explicit unsupported target
        // requests are rejected by the public helper before creating emitters.
        const default_musl = target.query.isNative() and target.result.os.tag == .linux and target.result.cpu.arch == .x86_64;
        const native_target = if (default_musl) b.resolveTargetQuery(.{ .cpu_arch = .x86_64, .os_tag = .linux, .abi = .musl }) else target;
        const native_data = if (!default_musl) public_data else b.createModule(.{
            .root_source_file = public_data.root_source_file,
            .target = native_target,
            .optimize = optimize,
        });
        const native_contracts = if (!default_musl) public_contracts else b.createModule(.{
            .root_source_file = b.path("src/contracts.zig"),
            .target = native_target,
            .optimize = optimize,
            .imports = &.{.{ .name = "boundary_data", .module = native_data }},
        });
        // Application type files can derive the existing model contract at
        // comptime. Only used runtime functions are linked; the deployed path
        // never invokes the authoring compiler or imports a language loader.
        const native_boundary = if (!default_musl) public_boundary else b.createModule(.{
            .root_source_file = public_boundary.root_source_file,
            .target = native_target,
            .optimize = optimize,
            .imports = &.{.{ .name = "boundary_data", .module = native_data }},
        });
        const native_agent = if (!default_musl) public_agent else b.createModule(.{
            .root_source_file = b.path("src/agent4.zig"),
            .target = native_target,
            .optimize = optimize,
            .imports = &.{ .{ .name = "boundary", .module = native_boundary }, .{ .name = "boundary_data", .module = native_data }, .{ .name = "agent_contracts", .module = native_contracts } },
        });
        const native_world = if (!default_musl and target.query.isNative()) world else b.createModule(.{
            .root_source_file = world_source.path(b, "src/root.zig"),
            .target = native_target,
            .optimize = optimize,
            .imports = &.{.{ .name = "boundary_data", .module = native_data }},
        });
        const public_environment = if (!default_musl and target.query.isNative()) host_environment else nativeEnvironment(b, native_target, optimize, native_world, native_data, native_contracts, native_admission, sqlite_source, &native_guard.step);
        b.addNamedLazyPath("native-sqlite-source", sqlite_source);
        b.modules.put(b.allocator, b.dupe("agent_native"), public_environment) catch @panic("out of memory");
        b.modules.put(b.allocator, b.dupe("agent_native_data"), native_data) catch @panic("out of memory");
        b.modules.put(b.allocator, b.dupe("agent_native_contracts"), native_contracts) catch @panic("out of memory");
        b.modules.put(b.allocator, b.dupe("agent_native_types"), native_agent) catch @panic("out of memory");
        const product_supported = (native_target.result.os.tag == .macos and native_target.result.cpu.arch == .aarch64) or
            (native_target.result.os.tag == .linux and native_target.result.cpu.arch == .x86_64 and native_target.result.abi == .musl);
        if (product_supported) {
            const native_modules: @import("build_native.zig").Modules = .{
                .root = b.path("."),
                .agent = agent,
                .boundary = boundary,
                .data = data,
                .contracts = contracts,
                .native = public_environment,
                .native_data = native_data,
                .native_contracts = native_contracts,
                .native_agent = native_agent,
                .sqlite_source = sqlite_source,
            };
            const minimal_assets = g.runArtifact(fixture_driver.select("native-minimal-assets"));
            const product = @import("build_native.zig").addWithModules(b, native_modules, .{
                .name = "agent-native-example",
                .application = .{ .emitted = .{
                    .image = minimal_assets.addOutputFileArg2("program.bpi3", .{}),
                    .application = minimal_assets.addOutputFileArg2("application.json", .{}),
                    .types = b.path("examples/native-minimal/types.zig"),
                } },
                .environment = b.path("examples/native-minimal/environment.zig"),
            });
            native_example.dependOn(&product.install.step);
            const repository_assets = g.runArtifact(fixture_driver.select("repository-agent-assets"));
            const repository_product = @import("build_native.zig").addWithModules(b, native_modules, .{
                .name = "repository-agent",
                .application = .{ .emitted = .{
                    .image = repository_assets.addOutputFileArg2("program.bpi3", .{}),
                    .application = repository_assets.addOutputFileArg2("application.json", .{}),
                    .types = b.path("examples/repository-agent/types.zig"),
                } },
                .environment = b.path("examples/repository-agent/environment.zig"),
            });
            native_example.dependOn(&repository_product.install.step);
            const repository_peer = nodeCommand(b);
            repository_peer.addArgs(&.{ "node", "test/agent4/native_repository.mjs" });
            repository_peer.addFileArg2(repository_product.executable.getEmittedBin(), .{ .make_absolute = true });
            repository_peer.addFileArg2(repository_product.assets.image, .{ .make_absolute = true });
            repository_peer.addFileArg2(repository_product.assets.application, .{ .make_absolute = true });
            repository_peer.addFileArg2(repository_product.manifest, .{ .make_absolute = true });
            native_checks.dependOn(&repository_peer.step);
            const protocol_peer = nodeCommand(b);
            protocol_peer.addArgs(&.{ "node", "test/agent4/native_host.mjs" });
            protocol_peer.addFileArg2(product.executable.getEmittedBin(), .{ .make_absolute = true });
            protocol_peer.addDirectoryArg2(runtime_path, .{ .make_absolute = true });
            native_host.dependOn(&protocol_peer.step);
            const consumer_module = b.createModule(.{
                .root_source_file = b.path("test/consumers/native/main.zig"),
                .target = b.graph.host,
                .optimize = optimize,
                .imports = &.{ .{ .name = "world", .module = world }, .{ .name = "boundary_data", .module = data }, .{ .name = "agent_native", .module = host_environment }, .{ .name = "agent_contracts", .module = contracts }, .{ .name = "application_types", .module = g.module("examples/native-minimal/types.zig") } },
            });
            consumer_module.addAnonymousImport("image", .{ .root_source_file = product.assets.image });
            const consumer = b.addExecutable(.{ .name = "agent-native-consumer", .root_module = consumer_module });
            consumer.step.dependOn(&runtime_guard.step);
            native_consumer.dependOn(&b.addRunArtifact(consumer).step);
            const https_peer = nodeCommand(b);
            https_peer.addArgs(&.{ "node", "test/agent4/native_https.mjs" });
            https_peer.addFileArg2(consumer.getEmittedBin(), .{ .make_absolute = true });
            native_consumer.dependOn(&https_peer.step);
            native_consumer.dependOn(&b.addInstallArtifact(consumer, .{}).step);
        } else {
            const unsupported = b.addFail("native product supports aarch64-macos and x86_64-linux-musl");
            native_example.dependOn(&unsupported.step);
            native_host.dependOn(&unsupported.step);
            native_consumer.dependOn(&unsupported.step);
        }
        // This pure JS projection does not use Zig or the install prefix.
        // Keep those launch paths out of the generated reference's identity.
        const responses_peer = b.addSystemCommand(&.{ "env", "-u", "NODE_TEST_CONTEXT", "node" });
        responses_peer.addFileArg2(b.path("test/agent4/native_responses.mjs"), .{});
        for ([_][]const u8{ "test/agent4/native-responses-v1.json", "runtime/model.mjs", "runtime/values.mjs" }) |path| responses_peer.addFileInput(b.path(path));
        responses_peer.has_side_effects = true;
        // These roots share exact module identities; compile their retained
        // tests together instead of rebuilding the same compiler eleven times.
        const native_suite = g.module("test/agent4/native_tests.zig");
        native_suite.addImport("world", world);
        native_suite.addImport("agent_native", host_environment);
        native_suite.addAnonymousImport("native_model_reference", .{ .root_source_file = responses_peer.captureStdOut(.{}) });
        native_suite.addImport("document", g.module("test/consumers/document/consequence.zig"));
        native_graph.testModule(native_checks, native_suite);
        // Zig does not collect test declarations from named dependency modules.
        // Run the runtime's own root explicitly; the integration root above
        // independently exercises its public task owner with authored programs.
        const runtime_test_environment = if (native_target.result.cpu.arch == b.graph.host.result.cpu.arch and native_target.result.os.tag == b.graph.host.result.os.tag) public_environment else host_environment;
        native_graph.testModule(native_checks, runtime_test_environment);
        // Repository policy modules have distinct import roots and retain their
        // focused runners rather than changing their nominal type identities.
        for ([_][]const u8{ "repository_working_set", "repository_replacement" }) |name| {
            const native = g.module(b.fmt("test/agent4/{s}.zig", .{name}));
            native.addImport("world", world);
            const working_set = std.mem.eql(u8, name, "repository_working_set");
            native.addImport(if (working_set) "repository" else "repository_replace", g.module(if (working_set) "test/consumers/repository/working_set.zig" else "test/consumers/repository/replacement.zig"));
            const tests = b.addTest(.{
                .root_module = native,
                .use_llvm = if (b.graph.host.result.os.tag == .linux and b.graph.host.result.cpu.arch == .x86_64) false else null,
            });
            tests.step.dependOn(native_graph.gate);
            const run_policy = b.addRunArtifact(tests);
            native_checks.dependOn(&run_policy.step);
            b.step(if (working_set) "check-repository-working-set" else "check-repository-replacement", if (working_set) "Check staged repository memory and evidence rules" else "Check live repository replacement approval")
                .dependOn(&run_policy.step);
        }
        const host_contracts = nodeCommand(b);
        host_contracts.addDirectoryArg2(runtime_path, .{ .prefix = "AGENT_MOBILITY_RUNTIME=", .make_absolute = true });
        host_contracts.addArgs(&.{ "node", "--test", "test/agent4/mobility_journal.test.mjs", "test/agent4/mobility_host.test.mjs", "test/agent4/mobility_transport.test.mjs", "test/agent4/mobility_deployment.test.mjs", "test/agent4/mobility_browser_bridge.test.mjs", "test/agent4/mobility_sessions.test.mjs", "test/agent4/mobility_task_catalogue.test.mjs", "test/agent4/mobile_repository_program.test.mjs" });
        host_contracts.has_side_effects = true;
        host_contracts.step.dependOn(&runtime_guard.step);
        host_contracts.step.dependOn(mobility_images);
        host_contracts.step.dependOn(mobile_repository_images);
        native_checks.dependOn(&host_contracts.step);
    } else {
        const missing = b.addFail("provide -Dworld-runtime=/absolute/authenticated/world-runtime");
        native_checks.dependOn(&missing.step);
        native_consumer.dependOn(&missing.step);
        native_example.dependOn(&missing.step);
        native_host.dependOn(&missing.step);
    }
    const pure = nodeCommand(b);
    pure.addArgs(&.{ "node", "--test", "test/agent4/values.test.mjs", "test/agent4/model.test.mjs" });
    pure.has_side_effects = true;
    pure.step.dependOn(&source_guard.step);
    check.dependOn(&pure.step);
    const accounting = b.addSystemCommand(&.{ "node", "test/agent4/installations.mjs", "--scan-only" });
    accounting.has_side_effects = true;
    b.step("check-source-accounting", "Classify installed authoring imports without consumer compilation").dependOn(&accounting.step);
    const installation = nodeCommand(b);
    installation.addArgs(&.{ "node", "test/agent4/installations.mjs", "--output" });
    installation.addFileArg2(b.path(".agent4/out/installation-authoring.json"), .{ .make_absolute = true });
    installation.has_side_effects = true;
    installation.step.dependOn(&source_guard.step);
    installation.step.dependOn(&accounting.step);
    const installation_check = b.step("check-authoring-installation", "Check only the external public authoring installation");
    installation_check.dependOn(&installation.step);
    const post = nodeCommand(b);
    post.addArgs(&.{ "node", "tools/agent4/dependencies.mjs", "verify", "--authoring-only" });
    post.addFileInput(b.path("conformance/agent4/dependencies.lock.json"));
    addBoundary(b, post, source, target, optimize);
    post.has_side_effects = true;
    _ = post.captureStdOut(.{});
    post.step.dependOn(check);
    b.step("check-authoring-core", "Check authoring contracts without repeating external installation").dependOn(&post.step);
    aggregate.dependOn(&post.step);
    aggregate.dependOn(installation_check);
    b.step("check", "Check Agent 4 authoring").dependOn(aggregate);
    b.default_step = aggregate;
}

fn nativeEnvironment(b: *std.Build, target: std.Build.ResolvedTarget, optimize: std.lang.Optimize, world: *std.Build.Module, data: *std.Build.Module, contracts: *std.Build.Module, admission: *std.Build.Module, sqlite_source: std.Build.LazyPath, gate: *std.Build.Step) *std.Build.Module {
    const options = b.addOptions();
    options.addOption(u32, "sqlite_heap_bytes", @import("build_native.zig").sqlite_heap_bytes);
    options.addOption(u64, "state_bytes", @import("build_native.zig").state_bytes);
    options.addOption(u32, "state_format", @import("build_native.zig").state_format);
    // The exact admitted 0.17 compiler still supplies build-time translate-c.
    // Keep translation bound to that target/compiler tuple; @cImport is gone.
    const translated = b.addTranslateC(.{
        .root_source_file = b.path("runtime/native/native_c.h"),
        .target = target,
        .optimize = optimize,
    });
    translated.addIncludePath(sqlite_source);
    translated.step.dependOn(gate);
    // C has a stable ABI here. Compile the large SQLite translation unit once
    // for this target, rather than again inside every executable and test root.
    const c_module = b.createModule(.{ .target = target, .optimize = optimize, .link_libc = true });
    c_module.addIncludePath(sqlite_source);
    c_module.addCSourceFile(.{ .file = sqlite_source.path(b, "sqlite3.c"), .flags = @import("build_native.zig").sqlite_flags });
    c_module.addCSourceFile(.{ .file = b.path("runtime/native/native_c.c"), .flags = &.{ "-std=c99", "-D_POSIX_C_SOURCE=200809L" } });
    const c_library = b.addLibrary(.{ .name = "agent-native-c", .linkage = .static, .root_module = c_module });
    c_library.step.dependOn(gate);
    const module = b.createModule(.{
        .root_source_file = b.path("runtime/native/root.zig"),
        .target = target,
        .optimize = optimize,
        .link_libc = true,
        .imports = &.{
            .{ .name = "world", .module = world },
            .{ .name = "boundary_data", .module = data },
            .{ .name = "agent_contracts", .module = contracts },
            .{ .name = "_native_dependency_admission", .module = admission },
            .{ .name = "native_c", .module = translated.createModule() },
        },
    });
    module.addOptions("native_options", options);
    module.linkLibrary(c_library);
    return module;
}

fn addBoundary(b: *std.Build, run: *std.Build.Step.Run, source: ?std.Build.LazyPath, target: std.Build.ResolvedTarget, optimize: std.lang.Optimize) void {
    if (source) |path| {
        run.addArg("--boundary-source");
        run.addDirectoryArg2(path, .{ .make_absolute = true });
    } else {
        run.addArg("--boundary-package");
        run.addDirectoryArg2(b.dependency("boundary", .{ .target = target, .optimize = optimize }).path("."), .{ .make_absolute = true });
    }
}

// Keep nested Node qualifiers on the build's selected toolchain and prefix.
fn nodeCommand(b: *std.Build) *std.Build.Step.Run {
    // Remove the runner context at launch, without caching the caller's PATH
    // or package/cache environment in the configured graph.
    const run = b.addSystemCommand(&.{ "env", "-u", "NODE_TEST_CONTEXT" });
    run.addFileArg2(.zig_exe, .{ .prefix = "AGENT_ZIG_EXE=", .make_absolute = true });
    run.addDirectoryArg2(.zig_lib, .{ .prefix = "ZIG_LIB_DIR=", .make_absolute = true });
    run.addDirectoryArg2(b.graph.path(.install_prefix, ""), .{ .prefix = "AGENT4_BUILD_PREFIX=", .make_absolute = true });
    return run;
}
