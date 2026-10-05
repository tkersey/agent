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
        const tests = g.b.addTest(.{ .root_module = module_value });
        tests.step.dependOn(g.gate);
        step.dependOn(&g.b.addRunArtifact(tests).step);
    }
    fn emitter(g: Graph, name: []const u8, module_value: *std.Build.Module) Executable {
        const executable = g.b.addExecutable(.{ .name = name, .root_module = module_value });
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
    const browser_tools_path = b.option(std.Build.LazyPath, "browser-tools", "Directory containing the locked Playwright browser tools");
    const measure_economy = b.option(bool, "measure-economy", "Collect timings on an operator-confirmed idle host") orelse false;
    const world_source = b.option(std.Build.LazyPath, "world-source", "Immutable World source for native agreement") orelse b.path(".agent4/inputs/world");
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
    const g: Graph = .{ .b = b, .optimize = optimize, .agent = agent, .boundary = boundary, .data = data, .contracts = contracts, .gate = &source_guard.step };
    const fixture_driver = g.emitter("agent4-fixtures", g.module("test/fixture_driver.zig"));
    const application_driver = g.emitter("agent4-applications", g.module("test/application_driver.zig"));
    const check = b.step("agent4-authoring-tests", "Authoring test implementation");
    const aggregate = b.step("check-agent4", "Check authoring and pure contracts without World");
    const mobility = b.step("check-mobility-authoring", "Check typed mobility contracts and protected admission");
    const mobility_protocol = b.step("check-mobility-protocol", "Check canonical mobility records and Ed25519 bindings");
    const protocol_tests = nodeCommand(b);
    protocol_tests.addArgs(&.{ "node", "--test", "test/agent4/mobility_protocol.test.mjs" });
    mobility_protocol.dependOn(&protocol_tests.step);
    check.dependOn(mobility_protocol);
    const mobility_model = b.step("check-mobility-model", "Explore the bounded single-transfer custody model and timeout counterexample");
    const model_run = b.addSystemCommand(&.{ "uv", "run", "--no-project", "test/agent4/mobility_model.py" });
    mobility_model.dependOn(&model_run.step);
    const model_properties = nodeCommand(b);
    model_properties.addArgs(&.{ "node", "--test", "test/agent4/mobility_model.test.mjs" });
    mobility_model.dependOn(&model_properties.step);
    g.testModule(mobility, g.module("test/agent4/mobility_ensure.zig"));
    const lint = b.step("lint", "Check formatting and the Zig source inventory");
    const format_check = b.addRunFile(.zig_exe);
    format_check.addArgs(&.{ "fmt", "--check", "build.zig", "build_agent4.zig", "src", "test/agent4", "test/consumers", "test/fixture_driver.zig", "test/application_driver.zig", "test/authoring_tests.zig" });
    const paths = b.addSystemCommand(&.{ "sh", "tools/check_zig_paths.sh" });
    lint.dependOn(&format_check.step);
    lint.dependOn(&paths.step);
    check.dependOn(lint);
    g.testModule(check, g.module("test/authoring_tests.zig"));
    const zig17 = b.step("check-zig17", "Check private descriptor admission and compiler/output selection");
    const catalog_tests = b.addTest(.{ .root_module = g.module("test/agent4/catalogs.zig") });
    catalog_tests.step.dependOn(g.gate);
    const catalog_run = b.addRunArtifact(catalog_tests);
    zig17.dependOn(&catalog_run.step);
    const zig17_node = nodeCommand(b);
    zig17_node.addArgs(&.{ "node", "--test", "test/agent4/zig17.test.mjs" });
    zig17.dependOn(&zig17_node.step);
    check.dependOn(&zig17_node.step);
    const participants = b.step("check-participants", "Check compiled internal participant admission");
    g.testModule(participants, g.module("test/agent4/participant.zig"));
    g.testModule(participants, g.module("test/agent4/composed_owners.zig"));
    const composed_images = b.step("composed-owner-images", "Emit admitted composed-owner cleanup");
    const composed_emitter = fixture_driver.select("composed-owners");
    g.emit(composed_images, composed_emitter, &.{}, "composed-owners.bpi3");
    check.dependOn(composed_images);
    const selection_images = b.step("selection-images", "Emit checked recursive numerical selection");
    const selection_check = b.step("check-selection", "Check generic selection construction and admission");
    g.testModule(selection_check, g.module("test/agent4/selection.zig"));
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
    const parser_batches = nodeCommand(b);
    parser_batches.addArgs(&.{ "node", "test/agent4/parser_realm_batches.test.mjs" });
    parser_batches.has_side_effects = true;
    const parser_executor = nodeCommand(b);
    parser_executor.addArgs(&.{ "node", "test/agent4/parser_executor.test.mjs" });
    const parser_state_capacity = nodeCommand(b);
    parser_state_capacity.addArgs(&.{ "node", "test/agent4/parser_state_capacity.test.mjs" });
    const parser_protocol = nodeCommand(b);
    parser_protocol.addArgs(&.{ "node", "test/agent4/parser_protocol.test.mjs" });
    parser_executor.step.dependOn(&parser_protocol.step);
    parser_executor.step.dependOn(&parser_batches.step);
    parser_executor.step.dependOn(&parser_state_capacity.step);
    b.step("check-parser-executor", "Check incremental parser candidates in the qualified executor")
        .dependOn(&parser_executor.step);
    const heldout_executor = nodeCommand(b);
    heldout_executor.addArgs(&.{ "node", "test/agent4/parser_evaluation.test.mjs" });
    b.step("check-parser-evaluation", "Check immutable held-out input evaluation and subject bindings")
        .dependOn(&heldout_executor.step);
    const eof_executor = nodeCommand(b);
    eof_executor.addArgs(&.{ "node", "test/agent4/parser_eof_executor.mjs" });
    b.step("check-parser-eof-executor", "Check selected EOF policies against real candidate execution")
        .dependOn(&eof_executor.step);
    const recursive_tests = b.addTest(.{
        .root_module = g.module("test/agent4/recursive_participant.zig"),
        .filters = &.{"recursive participant"},
    });
    recursive_tests.step.dependOn(g.gate);
    participants.dependOn(&b.addRunArtifact(recursive_tests).step);
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
    g.testModule(mobility, admitted);
    const dialogue = g.module("test/agent4/dialogue_probe.zig");
    dialogue.addImport("interaction", g.helper("interaction"));
    g.testModule(check, dialogue);
    const inquiry = g.module("test/agent4/inquiry_probe.zig");
    const inquiry_check = b.step("check-inquiry-probe", "Check retained inquiry custody");
    g.testModule(inquiry_check, inquiry);
    const inquiry_broker = g.module("test/agent4/inquiry_broker_probe.zig");
    g.testModule(inquiry_check, inquiry_broker);
    const inquiry_app = g.module("test/consumers/inquiry/main.zig");
    const inquiry_app_check = b.step("check-inquiry-application", "Check the model-directed repair application");
    g.testModule(inquiry_app_check, inquiry_app);

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
    const mobile_repository_check = b.step("check-mobile-repository", "Check the authored mobile repository application");
    const mobile_repository_native = b.step("check-mobile-repository-native", "Compare native and WASM repository application continuations");
    const mobile_repository_mutants = b.step("check-mobile-repository-mutants", "Detect explicit repository and custody mutants in isolated source copies");
    const mobile_repository_comparison = b.step("check-mobile-repository-comparison", "Check matched mobile and stationary proxy workloads");
    const mobile_repository_measure = b.step("measure-mobile-repository", "Collect thirty paired application measurements per declared cell");
    const mobile_repository_attribution = b.step("measure-mobile-repository-attribution", "Measure browser verification and publication recovery separately");
    const mobile_repository_objects = nodeCommand(b);
    mobile_repository_objects.addArgs(&.{ "node", "--test", "test/agent4/repository_snapshot.test.mjs" });
    mobile_repository_objects.has_side_effects = true;
    mobile_repository_check.dependOn(&mobile_repository_objects.step);
    const mobile_repository_zig = b.step("check-mobile-repository-zig", "Qualify the bounded native Zig repository check profile");
    const mobile_repository_zig_test = nodeCommand(b);
    mobile_repository_zig_test.step.dependOn(&source_guard.step);
    if (source) |root| mobile_repository_zig_test.addDirectoryArg2(root, .{ .prefix = "AGENT_PROFILE_BOUNDARY_SOURCE=", .make_absolute = true }) else mobile_repository_zig_test.step.dependOn(&b.addFail("provide -Dboundary-source for repository profile qualification").step);
    mobile_repository_zig_test.addDirectoryArg2(world_source, .{ .prefix = "AGENT_PROFILE_WORLD_SOURCE=", .make_absolute = true });
    if (runtime == null) mobile_repository_zig_test.step.dependOn(&b.addFail("provide -Dworld-runtime to authenticate World profile source").step);
    mobile_repository_zig_test.has_side_effects = true;
    mobile_repository_zig.dependOn(&mobile_repository_zig_test.step);
    const repository_runner = b.step("repository-check-runner", "Install the macOS Zig check resource launcher and loader restriction");
    const publication_gate = b.step("repository-publication-gate", "Install the process-owned managed Git publication gate");
    const publication_check = b.step("check-repository-publication-gate", "Qualify publication exclusion across parent death");
    const publication_test = nodeCommand(b);
    const repository_package_check = b.step("check-mobile-repository-package", "Qualify the extracted full application with browser Workers and native checks");
    const repository_approval_check = b.step("check-repository-approval", "Check authenticated protected publication across two custodians and browsers");
    const repository_approval_test = nodeCommand(b);
    repository_approval_test.has_side_effects = true;
    repository_approval_check.dependOn(&repository_approval_test.step);
    publication_test.has_side_effects = true;
    publication_check.dependOn(&publication_test.step);
    if (b.graph.host.result.os.tag == .macos) {
        const gate_exe = b.addExecutable(.{ .name = "agent-publication-gate", .root_module = b.createModule(.{
            .root_source_file = b.path("runtime/repository_publication_gate.zig"),
            .target = b.graph.host,
            .optimize = .safe,
            .link_libc = true,
        }) });
        emit.dependOn(&b.addInstallFileWithDir(gate_exe.getEmittedBin(), .prefix, "agent4/native/agent-publication-gate").step);
        publication_gate.dependOn(&b.addInstallFileWithDir(gate_exe.getEmittedBin(), .prefix, "repository-publication/agent-publication-gate").step);
        publication_test.addFileArg2(gate_exe.getEmittedBin(), .{ .prefix = "AGENT_PUBLICATION_GATE=", .make_absolute = true });
        repository_approval_test.addFileArg2(gate_exe.getEmittedBin(), .{ .prefix = "AGENT_PUBLICATION_GATE=", .make_absolute = true });
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
        repository_approval_test.addFileArg2(limit_exe.getEmittedBin(), .{ .prefix = "AGENT_CHECK_LIMIT=", .make_absolute = true });
        repository_approval_test.addFileArg2(process_lock.getEmittedBin(), .{ .prefix = "AGENT_CHECK_LOCK=", .make_absolute = true });
        mobile_repository_zig_test.addFileArg2(limit_exe.getEmittedBin(), .{ .prefix = "AGENT_CHECK_LIMIT=", .make_absolute = true });
        mobile_repository_zig_test.addFileArg2(process_lock.getEmittedBin(), .{ .prefix = "AGENT_CHECK_LOCK=", .make_absolute = true });
    }
    mobile_repository_zig_test.addArgs(&.{ "node", "--test", "test/agent4/repository_zig_sandbox.test.mjs" });
    publication_test.addArgs(&.{ "node", "--test", "test/agent4/repository_publication_gate.test.mjs", "test/agent4/repository_publication_journal.test.mjs", "test/agent4/repository_publication_binding.test.mjs", "test/agent4/repository_check_binding.test.mjs" });
    const mobile_repository_emitter = g.emitter("mobile-repository-emitter", g.module("test/consumers/mobile_repository/main.zig"));
    const repository_approval_images = b.step("repository-approval-images", "Emit the shared managed publication approval composition");
    repository_approval_test.step.dependOn(repository_approval_images);
    repository_approval_test.step.dependOn(mobile_repository_images);
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
    const repository_application = b.step("check-repository-application", "Repair actual repository fixtures through the compiled application");
    const repository_images = b.step("repository-application-images", "Emit repository repair and its portable schemas");
    const repository_app = application_driver.select("repository-application");
    g.emit(repository_images, repository_app, &.{}, "repository/repair.bpi3");
    for ([_][]const u8{ "task-schema", "result-schema", "failure-schema" }) |mode|
        g.emit(repository_images, repository_app, &.{mode}, b.fmt("repository/{s}.bin", .{mode}));
    emit.dependOn(repository_images);
    repository_application.dependOn(repository_images);
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
    inquiry_app_check.dependOn(inquiry_app_images);
    emit.dependOn(inquiry_app_images);
    g.emit(emit, inquiry_broker_exe, &.{}, "inquiry/broker.bpi3");
    g.emit(inquiry_check, inquiry_broker_exe, &.{}, "inquiry/broker.bpi3");
    for ([_][]const u8{ "owned", "composition", "followup", "typed" }) |mode| {
        g.emit(emit, inquiry_exe, &.{mode}, b.fmt("inquiry/{s}.bpi3", .{mode}));
        g.emit(inquiry_check, inquiry_exe, &.{mode}, b.fmt("inquiry/{s}.bpi3", .{mode}));
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
    const clarification_economy = application_driver.select("clarification-scaling");
    const clarification_images = b.step("clarification-images", "Emit shared clarification scaling evidence");
    g.emit(clarification_images, clarification_economy, &.{}, "clarification/scaling.json");
    emit.dependOn(clarification_images);
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

    const integration = b.step("check-agent4-integration", "Execute consumer proofs under the selected World");
    const parser_repair = b.step("check-parser-repair", "Repair malformed candidate observations through participants");
    const parser_repeated = b.step("check-parser-repeated", "Check repeated parser custody and stale task replies");
    const parser_circular = b.step("check-parser-circular", "Bound unsupported circular participant demands without invented evidence");
    const parser_intent = b.step("check-parser-intent", "Check EOF clarification through fresh World states");
    const composed_runtime = b.step("check-composed-owners-runtime", "Restore composed owners through cleanup");
    const parser_source_free = b.step("check-parser-source-free", "Link and execute parser objects with source access denied");
    const parser_consumers = b.step("check-parser-consumers", "Swap checked parser consumers around one unchanged producer");
    const parser_comparison = b.step("check-parser-comparison", "Compare parser ReAct, recursive and complete-candidate strategies");
    const parser_selection = b.step("check-parser-selection", "Execute two recursively assessed parser constructions");
    const selection_runtime = b.step("check-selection-runtime", "Check recursive assessment and completion isolation");
    const compiled_tools_check = b.step("check-compiled-tools", "Execute one compiled text tool in standalone and Agent callers");
    const mobility_continuation = b.step("check-mobility-continuation", "Check explicit relocation, retained ownership, refusal and cancellation");
    const mobility_native = b.step("check-mobility-native", "Compare native and WASM canonical mobility outcomes at every boundary");
    const mobility_journal = b.step("check-mobility-journal", "Check durable custody, signed decisions and process-crash recovery");
    const mobility_integration = b.step("check-mobility-integration", "Check real custody, placement, privacy and grants through the reference host");
    const mobility_approval = b.step("check-mobility-approval", "Check exact live evidence and approved fixture mutation across custody moves");
    g.testModule(mobility_approval, g.module("test/agent4/approval_probe.zig"));
    const mobility_durable_browser = b.step("check-mobility-browser", "Check source-free browser execution through durable custody and a separate mTLS process");
    const mobility_economy = b.step("check-mobility-economy", "Check matched mobility workload results, cache traffic and resident memory bounds");
    const mobility_all = b.step("check-mobility", "Check all mobility authoring, runtime, custody, browser and economy lanes");
    for ([_]*std.Build.Step{ mobility, mobility_protocol, mobility_model, mobility_continuation, mobility_native, mobility_journal, mobility_integration, mobility_approval, mobility_durable_browser, mobility_economy }) |step| mobility_all.dependOn(step);
    const components_check = b.step("check-component-tools", "Reuse three effectful objects in Agent and two standalone Programs");
    const component_objects = g.emitter("agent4-component-objects", g.module("test/agent4/component_objects.zig"));
    const component_link = g.emitter("agent4-component-link", g.module("test/agent4/component_link.zig"));
    const component_tools = b.step("build-component-tools", "Build the independent component emitter and client linker without World");
    component_tools.dependOn(&b.addInstallArtifact(component_objects.artifact, .{}).step);
    component_tools.dependOn(&b.addInstallArtifact(component_link.artifact, .{}).step);
    const browser_check = b.step("check-compiled-tool-browser", "Transfer the compiled Agent tool through real browser Workers and a file server");
    const native_checks = b.step("check-native", "Check native Agent semantics against the selected World");
    const repository_delivery = b.step("check-repository-delivery", "Check repository replacement through real file I/O and fresh kernels");
    const economy = b.step("check-agent4-economy", "Measure direct/facade and retained-state economy");
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
        mobile_repository_zig_test.step.dependOn(&runtime_guard.step);
        _ = runtime_guard.captureStdOut(.{});
        const mobile_repository_run = nodeCommand(b);
        mobile_repository_run.addArgs(&.{ "node", "test/agent4/mobile_repository_continuation.mjs" });
        mobile_repository_run.addDirectoryArg2(runtime_path, .{ .make_absolute = true });
        mobile_repository_run.addDirectoryArg2(b.graph.path(.install_prefix, "agent4/mobile-repository"), .{ .make_absolute = true });
        mobile_repository_run.step.dependOn(mobile_repository_images);
        mobile_repository_run.step.dependOn(&runtime_guard.step);
        mobile_repository_run.has_side_effects = true;
        mobile_repository_check.dependOn(&mobile_repository_run.step);
        const repository_mutants_run = nodeCommand(b);
        repository_mutants_run.addDirectoryArg2(runtime_path, .{ .prefix = "AGENT_MOBILITY_RUNTIME=", .make_absolute = true });
        repository_mutants_run.addFileArg2(b.graph.path(.install_prefix, "repository-publication/agent-publication-gate"), .{ .prefix = "AGENT_PUBLICATION_GATE=", .make_absolute = true });
        repository_mutants_run.addArgs(&.{ "node", "test/agent4/mobile_repository_mutants.mjs" });
        repository_mutants_run.step.dependOn(mobile_repository_images);
        repository_mutants_run.step.dependOn(repository_approval_images);
        repository_mutants_run.step.dependOn(mobility_images);
        repository_mutants_run.step.dependOn(publication_gate);
        repository_mutants_run.step.dependOn(&runtime_guard.step);
        repository_mutants_run.has_side_effects = true;
        mobile_repository_mutants.dependOn(&repository_mutants_run.step);
        for ([_]bool{ false, true }) |measure| {
            const comparison_run = nodeCommand(b);
            comparison_run.addDirectoryArg2(runtime_path, .{ .prefix = "AGENT_MOBILITY_RUNTIME=", .make_absolute = true });
            comparison_run.addFileArg2(b.graph.path(.install_prefix, "repository-publication/agent-publication-gate"), .{ .prefix = "AGENT_PUBLICATION_GATE=", .make_absolute = true });
            if (measure) {
                comparison_run.addArgs(&.{ "node", "test/agent4/mobile_repository_measure.mjs" });
                const report = comparison_run.addOutputFileArg2("mobile-repository-comparison.json", .{ .make_absolute = true });
                mobile_repository_measure.dependOn(&b.addInstallFileWithDir(report, .prefix, "agent4/mobile-repository-comparison.json").step);
            } else {
                comparison_run.addArgs(&.{ "node", "--test", "test/agent4/repository_comparison.test.mjs" });
                mobile_repository_comparison.dependOn(&comparison_run.step);
            }
            comparison_run.step.dependOn(mobile_repository_images);
            comparison_run.step.dependOn(repository_approval_images);
            comparison_run.step.dependOn(publication_gate);
            comparison_run.step.dependOn(&runtime_guard.step);
            comparison_run.has_side_effects = true;
        }
        repository_approval_test.addDirectoryArg2(runtime_path, .{ .prefix = "AGENT_MOBILITY_RUNTIME=", .make_absolute = true });
        const attribution_run = nodeCommand(b);
        attribution_run.addDirectoryArg2(runtime_path, .{ .prefix = "AGENT_MOBILITY_RUNTIME=", .make_absolute = true });
        attribution_run.addFileArg2(b.graph.path(.install_prefix, "repository-publication/agent-publication-gate"), .{ .prefix = "AGENT_PUBLICATION_GATE=", .make_absolute = true });
        if (browser_tools_path) |browser_tools| {
            attribution_run.addDirectoryArg2(browser_tools, .{ .prefix = "AGENT_MOBILITY_BROWSER_TOOLS=", .make_absolute = true });
        } else attribution_run.step.dependOn(&b.addFail("provide -Dbrowser-tools for browser attribution").step);
        attribution_run.addArgs(&.{ "node", "test/agent4/mobile_repository_attribution.mjs" });
        const attribution_report = attribution_run.addOutputFileArg2("mobile-repository-attribution.json", .{ .make_absolute = true });
        attribution_run.step.dependOn(mobile_repository_images);
        attribution_run.step.dependOn(repository_approval_images);
        attribution_run.step.dependOn(publication_gate);
        attribution_run.step.dependOn(&runtime_guard.step);
        attribution_run.has_side_effects = true;
        mobile_repository_attribution.dependOn(&b.addInstallFileWithDir(attribution_report, .prefix, "agent4/mobile-repository-attribution.json").step);
        if (browser_tools_path) |browser_tools| {
            repository_approval_test.addDirectoryArg2(browser_tools, .{ .prefix = "AGENT_MOBILITY_BROWSER_TOOLS=", .make_absolute = true });
        } else repository_approval_check.dependOn(&b.addFail("provide -Dbrowser-tools=/absolute/locked-playwright-tools").step);
        repository_approval_test.addArgs(&.{ "node", "--test", "test/agent4/repository_publication_approval.test.mjs", "test/agent4/mobility_task_catalogue.test.mjs" });
        repository_approval_test.step.dependOn(&runtime_guard.step);
        const repository_package_test = nodeCommand(b);
        repository_package_test.addDirectoryArg2(runtime_path, .{ .prefix = "AGENT_MOBILITY_RUNTIME=", .make_absolute = true });
        if (browser_tools_path) |browser_tools| {
            repository_package_test.addDirectoryArg2(browser_tools, .{ .prefix = "AGENT_MOBILITY_BROWSER_TOOLS=", .make_absolute = true });
        } else repository_package_check.dependOn(&b.addFail("provide -Dbrowser-tools=/absolute/locked-playwright-tools").step);
        repository_package_test.addArgs(&.{ "node", "--test", "--test-concurrency=1", "test/agent4/mobile_repository_package.test.mjs", "test/agent4/mobile_repository_deployment.test.mjs" });
        repository_package_test.step.dependOn(&package.step);
        repository_package_test.step.dependOn(&runtime_guard.step);
        repository_package_test.has_side_effects = true;
        repository_package_check.dependOn(&repository_package_test.step);
        var previous_economy: ?*std.Build.Step = null;
        for ([_][]const u8{ "manual", "fixed", "ensure", "stationary" }) |mode| {
            const sample = nodeCommand(b);
            sample.addDirectoryArg2(runtime_path, .{ .prefix = "AGENT_MOBILITY_RUNTIME=", .make_absolute = true });
            sample.addArgs(&.{ "node", "test/agent4/mobility_measure.mjs", "--sample" });
            sample.addArg(mode);
            sample.addArgs(&.{ "warm", "16" });
            sample.step.dependOn(mobility_images);
            sample.step.dependOn(&runtime_guard.step);
            if (previous_economy) |previous| sample.step.dependOn(previous);
            previous_economy = &sample.step;
            mobility_economy.dependOn(&sample.step);
        }
        const intent_run = nodeCommand(b);
        intent_run.addArgs(&.{ "node", "test/agent4/parser_intent_runtime.mjs" });
        intent_run.addDirectoryArg2(runtime_path, .{ .make_absolute = true });
        intent_run.step.dependOn(parser_episode);
        intent_run.step.dependOn(&runtime_guard.step);
        parser_intent.dependOn(&intent_run.step);
        const composed_run = nodeCommand(b);
        composed_run.addArgs(&.{ "node", "test/agent4/composed_owners.mjs" });
        composed_run.addDirectoryArg2(runtime_path, .{ .make_absolute = true });
        composed_run.step.dependOn(composed_images);
        composed_run.step.dependOn(&runtime_guard.step);
        composed_runtime.dependOn(&composed_run.step);
        for ([_][]const u8{ "first", "last", "unavailable" }) |policy| {
            const selection_case = nodeCommand(b);
            selection_case.addArgs(&.{ "node", "test/agent4/parser_selection.mjs" });
            selection_case.addDirectoryArg2(runtime_path, .{ .make_absolute = true });
            selection_case.addArg(policy);
            selection_case.step.dependOn(parser_episode);
            selection_case.step.dependOn(&runtime_guard.step);
            parser_selection.dependOn(&selection_case.step);
        }
        for ([_][]const u8{ "react", "recursive", "complete" }) |strategy| {
            for ([_][]const u8{ "easy", "repair", "unresolved", "stale" }) |scenario| {
                const comparison = nodeCommand(b);
                comparison.addArgs(&.{ "node", "test/agent4/parser_comparison.mjs" });
                comparison.addDirectoryArg2(runtime_path, .{ .make_absolute = true });
                comparison.addArg(strategy);
                comparison.addArg(scenario);
                comparison.step.dependOn(parser_episode);
                comparison.step.dependOn(&runtime_guard.step);
                parser_comparison.dependOn(&comparison.step);
            }
        }
        for ([_][]const u8{ "recursive", "alternate" }) |strategy| {
            const consumer_case = nodeCommand(b);
            consumer_case.addArgs(&.{ "node", "test/agent4/parser_comparison.mjs" });
            consumer_case.addDirectoryArg2(runtime_path, .{ .make_absolute = true });
            consumer_case.addArg(strategy);
            consumer_case.addArg("consumer");
            consumer_case.step.dependOn(parser_episode);
            consumer_case.step.dependOn(&runtime_guard.step);
            parser_consumers.dependOn(&consumer_case.step);
        }
        const repair_run = nodeCommand(b);
        repair_run.addArgs(&.{ "node", "test/agent4/parser_construction.mjs" });
        repair_run.addFileArg2(runtime_path.path(b, "src/embedding/index.mjs"), .{ .make_absolute = true });
        repair_run.addFileArg2(runtime_path.path(b, "world-kernel.wasm"), .{ .make_absolute = true });
        repair_run.addArgs(&.{ "", "", "", "chromium", "malformed-repair" });
        repair_run.step.dependOn(parser_episode);
        repair_run.step.dependOn(&runtime_guard.step);
        parser_repair.dependOn(&repair_run.step);
        const repeated_run = nodeCommand(b);
        repeated_run.addArgs(&.{ "node", "test/agent4/parser_repeated.mjs" });
        repeated_run.addDirectoryArg2(runtime_path, .{ .make_absolute = true });
        repeated_run.step.dependOn(parser_episode);
        repeated_run.step.dependOn(&runtime_guard.step);
        parser_repeated.dependOn(&repeated_run.step);
        const circular_run = nodeCommand(b);
        circular_run.addArgs(&.{ "node", "test/agent4/parser_circular.mjs" });
        circular_run.addDirectoryArg2(runtime_path, .{ .make_absolute = true });
        circular_run.step.dependOn(parser_episode);
        circular_run.step.dependOn(&runtime_guard.step);
        parser_circular.dependOn(&circular_run.step);
        const selection_run = nodeCommand(b);
        selection_run.addArgs(&.{ "node", "test/agent4/recursive_selection.mjs" });
        selection_run.addDirectoryArg2(runtime_path, .{ .make_absolute = true });
        selection_run.step.dependOn(selection_images);
        selection_run.step.dependOn(&runtime_guard.step);
        selection_runtime.dependOn(&selection_run.step);
        const text_check = nodeCommand(b);
        text_check.addArgs(&.{ "node", "test/agent4/text_tool_runtime.mjs" });
        text_object.addArgument(text_check);
        text_check.addFileArg2(text_link.getEmittedBin(), .{});
        text_check.addDirectoryArg2(runtime_path, .{ .make_absolute = true });
        text_check.step.dependOn(&runtime_guard.step);
        text_check.has_side_effects = true;
        compiled_tools_check.dependOn(&text_check.step);
        const mobility_run = nodeCommand(b);
        mobility_run.addArgs(&.{ "node", "test/agent4/mobility_continuation.mjs" });
        mobility_run.addDirectoryArg2(runtime_path, .{ .make_absolute = true });
        mobility_run.step.dependOn(mobility_images);
        mobility_run.step.dependOn(&runtime_guard.step);
        mobility_run.has_side_effects = true;
        mobility_continuation.dependOn(&mobility_run.step);
        const ensure_run = nodeCommand(b);
        ensure_run.addArgs(&.{ "node", "test/agent4/mobility_ensure.mjs" });
        ensure_run.addDirectoryArg2(runtime_path, .{ .make_absolute = true });
        ensure_run.step.dependOn(mobility_images);
        ensure_run.step.dependOn(&runtime_guard.step);
        ensure_run.has_side_effects = true;
        mobility_continuation.dependOn(&ensure_run.step);
        const journal_run = nodeCommand(b);
        journal_run.addDirectoryArg2(runtime_path, .{ .prefix = "AGENT_MOBILITY_RUNTIME=", .make_absolute = true });
        journal_run.addArgs(&.{ "node", "--test", "test/agent4/mobility_journal.test.mjs" });
        const approval_run = nodeCommand(b);
        approval_run.addDirectoryArg2(runtime_path, .{ .prefix = "AGENT_MOBILITY_RUNTIME=", .make_absolute = true });
        approval_run.addArgs(&.{ "node", "--test", "test/agent4/mobility_approval.test.mjs" });
        approval_run.step.dependOn(mobility_approval_images);
        approval_run.step.dependOn(&runtime_guard.step);
        mobility_approval.dependOn(&approval_run.step);
        journal_run.step.dependOn(mobility_images);
        journal_run.step.dependOn(&runtime_guard.step);
        journal_run.has_side_effects = true;
        mobility_journal.dependOn(&journal_run.step);
        const host_run = nodeCommand(b);
        host_run.addDirectoryArg2(runtime_path, .{ .prefix = "AGENT_MOBILITY_RUNTIME=", .make_absolute = true });
        host_run.addArgs(&.{ "node", "--test", "test/agent4/mobility_host.test.mjs", "test/agent4/mobility_deployment.test.mjs", "test/agent4/mobility_browser_bridge.test.mjs", "test/agent4/mobility_sessions.test.mjs" });
        host_run.step.dependOn(mobility_images);
        host_run.step.dependOn(&runtime_guard.step);
        host_run.has_side_effects = true;
        mobility_integration.dependOn(&host_run.step);
        const transport_run = nodeCommand(b);
        transport_run.addDirectoryArg2(runtime_path, .{ .prefix = "AGENT_MOBILITY_RUNTIME=", .make_absolute = true });
        transport_run.addArgs(&.{ "node", "--test", "test/agent4/mobility_transport.test.mjs" });
        transport_run.step.dependOn(mobility_images);
        transport_run.step.dependOn(&runtime_guard.step);
        transport_run.has_side_effects = true;
        mobility_integration.dependOn(&transport_run.step);
        const component_check = nodeCommand(b);
        component_check.addArgs(&.{ "node", "test/agent4/component_runtime.mjs" });
        component_check.addFileArg2(component_objects.getEmittedBin(), .{});
        component_check.addFileArg2(component_link.getEmittedBin(), .{});
        component_check.addDirectoryArg2(runtime_path, .{ .make_absolute = true });
        component_check.step.dependOn(&runtime_guard.step);
        component_check.has_side_effects = true;
        components_check.dependOn(&component_check.step);
        if (browser_tools_path) |browser_tools| {
            const durable_browser_run = nodeCommand(b);
            durable_browser_run.addDirectoryArg2(runtime_path, .{ .prefix = "AGENT_MOBILITY_RUNTIME=", .make_absolute = true });
            durable_browser_run.addDirectoryArg2(browser_tools, .{ .prefix = "AGENT_MOBILITY_BROWSER_TOOLS=", .make_absolute = true });
            durable_browser_run.addArgs(&.{ "node", "--test", "test/agent4/mobility_durable_browser.test.mjs", "test/agent4/mobility_reference_browser.test.mjs" });
            durable_browser_run.step.dependOn(mobility_images);
            durable_browser_run.step.dependOn(&runtime_guard.step);
            durable_browser_run.has_side_effects = true;
            mobility_durable_browser.dependOn(&durable_browser_run.step);
            const browser = nodeCommand(b);
            browser.addArgs(&.{ "node", "test/agent4/text_browser.mjs" });
            text_object.addArgument(browser);
            browser.addFileArg2(text_link.getEmittedBin(), .{});
            browser.addDirectoryArg2(runtime_path, .{ .make_absolute = true });
            browser.addDirectoryArg2(browser_tools, .{ .make_absolute = true });
            browser.step.dependOn(&runtime_guard.step);
            browser.has_side_effects = true;
            browser_check.dependOn(&browser.step);
        } else {
            const missing_browser = b.addFail("provide -Dbrowser-tools=/absolute/locked-playwright-tools");
            browser_check.dependOn(&missing_browser.step);
            mobility_durable_browser.dependOn(&missing_browser.step);
        }
        const runtime_work = b.step("agent4-runtime-tests", "Native and embedding test implementation");
        runtime_work.dependOn(parser_intent);
        runtime_work.dependOn(parser_circular);
        runtime_work.dependOn(parser_repeated);
        runtime_work.dependOn(parser_repair);
        runtime_work.dependOn(selection_runtime);
        runtime_work.dependOn(parser_selection);
        runtime_work.dependOn(parser_comparison);
        runtime_work.dependOn(parser_consumers);
        runtime_work.dependOn(composed_runtime);
        const repository_emitter_module = g.module("test/agent4/repository_replacement_emit.zig");
        repository_emitter_module.addImport("repository_app", g.module("test/consumers/repository/application.zig"));
        const repository_emitter = g.emitter("repository-replacement", repository_emitter_module);
        const repository_run = nodeCommand(b);
        repository_run.addArgs(&.{ "node", "test/agent4/repository_delivery_runtime.mjs" });
        repository_run.addFileArg2(repository_emitter.getEmittedBin(), .{});
        repository_run.addDirectoryArg2(runtime_path, .{ .make_absolute = true });
        repository_run.step.dependOn(&runtime_guard.step);
        repository_run.has_side_effects = true;
        const repository_files = nodeCommand(b);
        repository_files.addArgs(&.{ "node", "--test", "test/agent4/repository_delivery.test.mjs", "test/agent4/repository.test.mjs", "test/agent4/repository_executor.test.mjs" });
        repository_delivery.dependOn(&repository_run.step);
        repository_delivery.dependOn(&repository_files.step);
        runtime_work.dependOn(repository_delivery);
        const repository_real = nodeCommand(b);
        repository_real.addArgs(&.{ "node", "test/agent4/repository_runtime.mjs" });
        repository_real.addDirectoryArg2(runtime_path, .{ .make_absolute = true });
        repository_real.addDirectoryArg2(b.graph.path(.install_prefix, "agent4/repository"), .{ .make_absolute = true });
        repository_real.step.dependOn(repository_images);
        repository_real.step.dependOn(&runtime_guard.step);
        repository_real.has_side_effects = true;
        repository_application.dependOn(&repository_real.step);
        runtime_work.dependOn(repository_application);
        runtime_work.dependOn(&text_check.step);
        runtime_work.dependOn(&component_check.step);
        runtime_work.dependOn(native_checks);
        // The portable kernel/custody checks do not require this external OS
        // profile. Explicit repair-application checks still require execution.
        const inquiry_host = b.graph.host.result.os.tag == .macos;
        const inquiry_executor = nodeCommand(b);
        inquiry_executor.addArgs(&.{ "node", "test/agent4/inquiry_executor.test.mjs" });
        inquiry_executor.step.dependOn(&runtime_guard.step);
        inquiry_app_check.dependOn(&inquiry_executor.step);
        if (inquiry_host) runtime_work.dependOn(&inquiry_executor.step);
        var native_graph = g;
        native_graph.gate = &runtime_guard.step;
        const native_module = b.createModule(.{
            .root_source_file = b.path("test/agent4/native.zig"),
            .target = b.graph.host,
            .optimize = optimize,
            .imports = &.{ .{ .name = "world", .module = world }, .{ .name = "boundary_data", .module = data } },
        });
        const native_exe = native_graph.emitter("agent4-native", native_module);
        const repository_native_run = nodeCommand(b);
        repository_native_run.addArgs(&.{ "node", "test/agent4/mobile_repository_continuation.mjs" });
        repository_native_run.addDirectoryArg2(runtime_path, .{ .make_absolute = true });
        repository_native_run.addDirectoryArg2(b.graph.path(.install_prefix, "agent4/mobile-repository"), .{ .make_absolute = true });
        repository_native_run.addFileArg2(native_exe.getEmittedBin(), .{});
        repository_native_run.step.dependOn(mobile_repository_images);
        repository_native_run.has_side_effects = true;
        mobile_repository_native.dependOn(&repository_native_run.step);
        const repository_native_workflow = nodeCommand(b);
        repository_native_workflow.addDirectoryArg2(runtime_path, .{ .prefix = "AGENT_MOBILITY_RUNTIME=", .make_absolute = true });
        repository_native_workflow.addFileArg2(native_exe.getEmittedBin(), .{ .prefix = "AGENT_MOBILE_NATIVE=", .make_absolute = true });
        repository_native_workflow.addFileArg2(b.graph.path(.install_prefix, "repository-publication/agent-publication-gate"), .{ .prefix = "AGENT_PUBLICATION_GATE=", .make_absolute = true });
        repository_native_workflow.addArgs(&.{ "node", "--test", "--test-name-pattern=complete mobile application mode|session propose then publish|cancellation at full-application|lost publication reply", "test/agent4/repository_publication_approval.test.mjs" });
        repository_native_workflow.step.dependOn(mobile_repository_images);
        repository_native_workflow.step.dependOn(repository_approval_images);
        repository_native_workflow.step.dependOn(publication_gate);
        repository_native_workflow.has_side_effects = true;
        mobile_repository_native.dependOn(&repository_native_workflow.step);
        const mobility_native_run = nodeCommand(b);
        mobility_native_run.addArgs(&.{ "node", "test/agent4/mobility_continuation.mjs" });
        mobility_native_run.addDirectoryArg2(runtime_path, .{ .make_absolute = true });
        mobility_native_run.addFileArg2(native_exe.getEmittedBin(), .{});
        mobility_native_run.step.dependOn(mobility_images);
        mobility_native_run.step.dependOn(&runtime_guard.step);
        mobility_native.dependOn(&mobility_native_run.step);
        if (inquiry_host) {
            const source_free = nodeCommand(b);
            source_free.addArgs(&.{ "node", "test/agent4/parser_source_free.mjs" });
            source_free.addDirectoryArg2(runtime_path, .{ .make_absolute = true });
            source_free.addFileArg2(native_exe.getEmittedBin(), .{});
            source_free.addDirectoryArg2(b.graph.path(.install_prefix, ""), .{ .make_absolute = true });
            source_free.addFileArg2(parser_link_only.getEmittedBin(), .{ .make_absolute = true });
            source_free.step.dependOn(distribution);
            source_free.step.dependOn(&runtime_guard.step);
            parser_source_free.dependOn(&source_free.step);
            runtime_work.dependOn(parser_source_free);
        } else parser_source_free.dependOn(&b.addFail("source-denial witness requires macOS sandbox-exec").step);
        const inquiry_app_run = nodeCommand(b);
        inquiry_app_run.addArgs(&.{ "node", "test/agent4/inquiry_application_runtime.mjs" });
        inquiry_app_run.addDirectoryArg2(runtime_path, .{ .make_absolute = true });
        inquiry_app_run.addDirectoryArg2(b.graph.path(.install_prefix, "agent4/inquiry"), .{ .make_absolute = true });
        const inquiry_cli = nodeCommand(b);
        inquiry_cli.addDirectoryArg2(b.graph.path(.install_prefix, "agent4/inquiry"), .{ .prefix = "AGENT4_INQUIRY_IMAGES=", .make_absolute = true });
        inquiry_cli.addDirectoryArg2(runtime_path, .{ .prefix = "AGENT4_WORLD_RUNTIME=", .make_absolute = true });
        inquiry_cli.addArgs(&.{ "node", "--test", "test/agent4/inquiry_cli.test.mjs" });
        inquiry_cli.has_side_effects = true;
        inquiry_cli.step.dependOn(distribution);
        inquiry_cli.step.dependOn(&runtime_guard.step);
        b.step("check-inquiry-cli", "Check opt-in inquiry dispatch and checkpoint recovery").dependOn(&inquiry_cli.step);
        inquiry_app_run.addFileArg2(native_exe.getEmittedBin(), .{});
        inquiry_app_run.addFileArg2(multi_exe.getEmittedBin(), .{});
        inquiry_app_run.has_side_effects = true;
        inquiry_app_run.step.dependOn(inquiry_app_images);
        inquiry_app_run.step.dependOn(&runtime_guard.step);
        inquiry_app_check.dependOn(&inquiry_app_run.step);
        if (inquiry_host) runtime_work.dependOn(&inquiry_app_run.step);
        const inquiry_cases = nodeCommand(b);
        inquiry_cases.addArgs(&.{ "node", "test/agent4/inquiry_cases_runtime.mjs" });
        inquiry_cases.addDirectoryArg2(runtime_path, .{ .make_absolute = true });
        inquiry_cases.addDirectoryArg2(b.graph.path(.install_prefix, "agent4/inquiry"), .{ .make_absolute = true });
        inquiry_cases.addFileArg2(native_exe.getEmittedBin(), .{});
        inquiry_cases.addFileArg2(multi_exe.getEmittedBin(), .{});
        inquiry_cases.has_side_effects = true;
        inquiry_cases.step.dependOn(inquiry_app_images);
        inquiry_cases.step.dependOn(&runtime_guard.step);
        inquiry_app_check.dependOn(&inquiry_cases.step);
        if (inquiry_host) runtime_work.dependOn(&inquiry_cases.step);
        const comparison = nodeCommand(b);
        comparison.addArgs(&.{ "node", "test/agent4/inquiry_cases_runtime.mjs" });
        comparison.addDirectoryArg2(runtime_path, .{ .make_absolute = true });
        comparison.addDirectoryArg2(b.graph.path(.install_prefix, "agent4/inquiry"), .{ .make_absolute = true });
        comparison.addFileArg2(native_exe.getEmittedBin(), .{});
        comparison.addFileArg2(multi_exe.getEmittedBin(), .{});
        comparison.addArg("--comparison-only");
        comparison.has_side_effects = true;
        comparison.step.dependOn(inquiry_app_images);
        comparison.step.dependOn(&runtime_guard.step);
        b.step("check-inquiry-comparison", "Compare inquiry and ReAct on the same repair tasks").dependOn(&comparison.step);
        const inquiry_repeated = nodeCommand(b);
        inquiry_repeated.addArgs(&.{ "node", "test/agent4/inquiry_repeated_runtime.mjs" });
        inquiry_repeated.addDirectoryArg2(runtime_path, .{ .make_absolute = true });
        inquiry_repeated.addDirectoryArg2(b.graph.path(.install_prefix, "agent4/inquiry"), .{ .make_absolute = true });
        inquiry_repeated.addFileArg2(native_exe.getEmittedBin(), .{});
        inquiry_repeated.addFileArg2(multi_exe.getEmittedBin(), .{});
        inquiry_repeated.has_side_effects = true;
        inquiry_repeated.step.dependOn(inquiry_app_images);
        inquiry_repeated.step.dependOn(&runtime_guard.step);
        inquiry_app_check.dependOn(&inquiry_repeated.step);
        if (inquiry_host) runtime_work.dependOn(&inquiry_repeated.step);
        const broker_run = nodeCommand(b);
        broker_run.addArgs(&.{ "node", "test/agent4/inquiry_broker_runtime.mjs" });
        broker_run.addDirectoryArg2(runtime_path, .{ .make_absolute = true });
        broker_run.addFileArg2(b.graph.path(.install_prefix, "agent4/inquiry/broker.bpi3"), .{ .make_absolute = true });
        broker_run.addFileArg2(native_exe.getEmittedBin(), .{});
        broker_run.addFileArg2(multi_exe.getEmittedBin(), .{});
        broker_run.step.dependOn(&runtime_guard.step);
        g.emit(&broker_run.step, inquiry_broker_exe, &.{}, "inquiry/broker.bpi3");
        inquiry_check.dependOn(&broker_run.step);
        runtime_work.dependOn(&broker_run.step);
        for ([_][]const u8{ "owned", "composition", "followup", "typed" }) |mode| {
            const inquiry_run = nodeCommand(b);
            inquiry_run.addArgs(&.{ "node", "test/agent4/inquiry_runtime.mjs" });
            inquiry_run.addDirectoryArg2(runtime_path, .{ .make_absolute = true });
            inquiry_run.addFileArg2(b.graph.path(.install_prefix, b.fmt("agent4/inquiry/{s}.bpi3", .{mode})), .{ .make_absolute = true });
            inquiry_run.addFileArg2(native_exe.getEmittedBin(), .{});
            inquiry_run.addFileArg2(multi_exe.getEmittedBin(), .{});
            inquiry_run.step.dependOn(&runtime_guard.step);
            g.emit(&inquiry_run.step, inquiry_exe, &.{mode}, b.fmt("inquiry/{s}.bpi3", .{mode}));
            inquiry_check.dependOn(&inquiry_run.step);
            runtime_work.dependOn(&inquiry_run.step);
        }
        // These roots share exact module identities; compile their retained
        // tests together instead of rebuilding the same compiler eleven times.
        const native_suite = g.module("test/agent4/native_tests.zig");
        native_suite.addImport("world", world);
        native_suite.addImport("document", g.module("test/consumers/document/consequence.zig"));
        native_graph.testModule(native_checks, native_suite);
        // Repository policy modules have distinct import roots and retain their
        // focused runners rather than changing their nominal type identities.
        for ([_][]const u8{ "repository_working_set", "repository_replacement" }) |name| {
            const native = g.module(b.fmt("test/agent4/{s}.zig", .{name}));
            native.addImport("world", world);
            const working_set = std.mem.eql(u8, name, "repository_working_set");
            native.addImport(if (working_set) "repository" else "repository_replace", g.module(if (working_set) "test/consumers/repository/working_set.zig" else "test/consumers/repository/replacement.zig"));
            const tests = b.addTest(.{ .root_module = native });
            tests.step.dependOn(native_graph.gate);
            const run_policy = b.addRunArtifact(tests);
            native_checks.dependOn(&run_policy.step);
            b.step(if (working_set) "check-repository-working-set" else "check-repository-replacement", if (working_set) "Check staged repository memory and evidence rules" else "Check live repository replacement approval")
                .dependOn(&run_policy.step);
        }
        const run = nodeCommand(b);
        run.addFileArg2(multi_exe.getEmittedBin(), .{ .prefix = "AGENT4_MULTI_INSPECTOR=", .make_absolute = true });
        run.addArgs(&.{ "node", "tools/agent4/check.mjs", "integration", "--world-runtime" });
        run.addDirectoryArg2(runtime_path, .{ .make_absolute = true });
        run.addArg("--fixtures");
        run.addDirectoryArg2(b.graph.path(.install_prefix, "agent4"), .{ .make_absolute = true });
        run.addArg("--world-source");
        run.addDirectoryArg2(world_source, .{ .make_absolute = true });
        if (world_archive) |archive| {
            run.addArg("--world-archive");
            run.addFileArg2(archive, .{ .make_absolute = true });
        }
        run.addArg("--native");
        run.addFileArg2(native_exe.getEmittedBin(), .{});
        addBoundary(b, run, source, target, optimize);
        run.has_side_effects = true;
        run.step.dependOn(distribution);
        run.step.dependOn(&runtime_guard.step);
        runtime_work.dependOn(&run.step);
        const runtime_post = nodeCommand(b);
        runtime_post.addArgs(&.{ "node", "tools/agent4/dependencies.mjs", "verify", "--world-runtime" });
        runtime_post.addFileInput(b.path("conformance/agent4/dependencies.lock.json"));
        runtime_post.addDirectoryArg2(runtime_path, .{ .make_absolute = true });
        runtime_post.addArg("--world-source");
        runtime_post.addDirectoryArg2(world_source, .{ .make_absolute = true });
        if (world_archive) |archive| {
            runtime_post.addArg("--world-archive");
            runtime_post.addFileArg2(archive, .{ .make_absolute = true });
        }
        addBoundary(b, runtime_post, source, target, optimize);
        runtime_post.has_side_effects = true;
        _ = runtime_post.captureStdOut(.{});
        runtime_post.step.dependOn(runtime_work);
        integration.dependOn(&runtime_post.step);
        const economy_module = g.module("test/agent4/economy.zig");
        economy_module.addImport("document", g.module("test/consumers/document/main.zig"));
        economy_module.addImport("review", g.module("test/consumers/review/main.zig"));
        economy_module.addImport("inquiry", inquiry_app);
        g.testModule(economy, economy_module);
        const economy_exe = g.emitter("economy-probe", economy_module);
        const economy_emit = g.runArtifact(economy_exe);
        economy_emit.addArg("emit");
        economy_emit.addDirectoryArg2(b.graph.path(.install_prefix, "agent4/economy"), .{ .make_absolute = true });
        const measure = nodeCommand(b);
        measure.addFileArg2(b.graph.path(.install_bin, "agent4-multi"), .{ .prefix = "AGENT4_MULTI_INSPECTOR=", .make_absolute = true });
        measure.addArgs(&.{ "node", "tools/agent4/economy.mjs", "--world-runtime" });
        measure.addDirectoryArg2(runtime_path, .{ .make_absolute = true });
        measure.addArg("--fixtures");
        measure.addDirectoryArg2(b.graph.path(.install_prefix, "agent4/economy"), .{ .make_absolute = true });
        measure.addArg("--output");
        measure.addDirectoryArg2(b.graph.path(.install_prefix, "agent4/economy-results"), .{ .make_absolute = true });
        measure.addArg("--probe");
        const installed_probe = b.addInstallArtifact(economy_exe.artifact, .{});
        b.step("build-economy-probe", "Build the authenticated existing-workload economy probe")
            .dependOn(&installed_probe.step);
        measure.addFileArg2(b.graph.path(.install_bin, "economy-probe"), .{ .make_absolute = true });
        {
            measure.addArg("--world-source");
            measure.addDirectoryArg2(world_source, .{ .make_absolute = true });
        }
        if (world_archive) |archive| {
            measure.addArg("--world-archive");
            measure.addFileArg2(archive, .{ .make_absolute = true });
        }
        measure.addArg("--native");
        measure.addFileArg2(native_exe.getEmittedBin(), .{});
        addBoundary(b, measure, source, target, optimize);
        measure.step.dependOn(&installed_probe.step);
        measure.step.dependOn(&installed_multi.step);
        if (measure_economy) measure.addArgs(&.{ "--measure", "--uncontended" });
        measure.has_side_effects = true;
        // Focused economy reruns need these inputs, not the entire authoring corpus.
        measure.step.dependOn(multi_images);
        measure.step.dependOn(clarification_images);
        measure.step.dependOn(inquiry_app_images);
        measure.step.dependOn(&economy_emit.step);
        economy.dependOn(&measure.step);
    } else {
        const missing = b.addFail("provide -Dworld-runtime=/absolute/authenticated/world-runtime");
        mobile_repository_check.dependOn(&missing.step);
        mobile_repository_native.dependOn(&missing.step);
        mobile_repository_mutants.dependOn(&missing.step);
        mobile_repository_comparison.dependOn(&missing.step);
        mobile_repository_measure.dependOn(&missing.step);
        mobile_repository_attribution.dependOn(&missing.step);
        repository_approval_check.dependOn(&missing.step);
        compiled_tools_check.dependOn(&missing.step);
        mobility_continuation.dependOn(&missing.step);
        mobility_native.dependOn(&missing.step);
        mobility_journal.dependOn(&missing.step);
        mobility_integration.dependOn(&missing.step);
        mobility_approval.dependOn(&missing.step);
        mobility_durable_browser.dependOn(&missing.step);
        mobility_economy.dependOn(&missing.step);
        components_check.dependOn(&missing.step);
        browser_check.dependOn(&missing.step);
        native_checks.dependOn(&missing.step);
        repository_delivery.dependOn(&missing.step);
        repository_application.dependOn(&missing.step);
        integration.dependOn(&missing.step);
        parser_intent.dependOn(&missing.step);
        parser_circular.dependOn(&missing.step);
        selection_runtime.dependOn(&missing.step);
        parser_selection.dependOn(&missing.step);
        parser_comparison.dependOn(&missing.step);
        parser_consumers.dependOn(&missing.step);
        parser_source_free.dependOn(&missing.step);
        composed_runtime.dependOn(&missing.step);
        economy.dependOn(&missing.step);
    }
    const pure = nodeCommand(b);
    pure.addArgs(&.{ "node", "tools/agent4/check.mjs", "authoring" });
    addBoundary(b, pure, source, target, optimize);
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
