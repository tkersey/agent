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
    const source = b.option([]const u8, "boundary-source", "Authenticated immutable Boundary source copy");
    const runtime = b.option([]const u8, "world-runtime", "Authenticated immutable World runtime directory");
    const browser_tools_path = b.option([]const u8, "browser-tools", "Directory containing the locked Playwright browser tools");
    const measure_economy = b.option(bool, "measure-economy", "Collect timings on an operator-confirmed idle host") orelse false;
    const world_source = b.option([]const u8, "world-source", "Immutable World source for native agreement") orelse b.pathFromRoot(".agent4/inputs/world");
    // The dependency verifier derives the sibling archive from the selected
    // lock. Only forward an explicit override; never duplicate its commit here.
    const world_archive = b.option([]const u8, "world-archive", "Authenticated immutable World source archive");
    const data = if (source) |root| b.createModule(.{
        .root_source_file = .{ .cwd_relative = b.pathJoin(&.{ root, "src/v2/data/root.zig" }) },
        .target = target,
        .optimize = optimize,
    }) else b.dependency("boundary", .{ .target = target, .optimize = optimize }).module("boundary_data");
    const boundary = if (source) |root| b.createModule(.{
        .root_source_file = .{ .cwd_relative = b.pathJoin(&.{ root, "src/v2/root.zig" }) },
        .target = target,
        .optimize = optimize,
        .imports = &.{.{ .name = "boundary_data", .module = data }},
    }) else b.dependency("boundary", .{ .target = target, .optimize = optimize }).module("boundary");
    b.modules.put(b.allocator, b.dupe("boundary"), boundary) catch @panic("out of memory");
    b.modules.put(b.allocator, b.dupe("boundary_data"), data) catch @panic("out of memory");
    const contracts = b.addModule("agent_contracts", .{
        .root_source_file = b.path("src/contracts.zig"),
        .target = target,
        .optimize = optimize,
        .imports = &.{.{ .name = "boundary_data", .module = data }},
    });
    const agent = b.addModule("agent", .{
        .root_source_file = b.path("src/agent4.zig"),
        .target = target,
        .optimize = optimize,
        .imports = &.{ .{ .name = "boundary", .module = boundary }, .{ .name = "boundary_data", .module = data }, .{ .name = "agent_contracts", .module = contracts } },
    });
    const source_guard = b.addSystemCommand(&.{ "node", "tools/agent4/dependencies.mjs", "verify", "--authoring-only" });
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
    const g: Graph = .{ .b = b, .optimize = optimize, .agent = agent, .boundary = boundary, .data = data, .contracts = contracts, .gate = &source_guard.step };
    const check = b.step("agent4-authoring-tests", "Authoring test implementation");
    const aggregate = b.step("check-agent4", "Check authoring and pure contracts without World");
    const lint = b.step("lint", "Check formatting and the Zig source inventory");
    const format_check = b.addSystemCommand(&.{ b.graph.zig_exe, "fmt", "--check", "build.zig", "build_agent4.zig", "src", "test/agent4", "test/consumers" });
    const paths = b.addSystemCommand(&.{ "sh", "tools/check_zig_paths.sh" });
    lint.dependOn(&format_check.step);
    lint.dependOn(&paths.step);
    check.dependOn(lint);
    for ([_][]const u8{ "facade", "values", "approval_probe", "catalogs", "descriptor_contracts", "callable", "compiled_tool" }) |name|
        g.testModule(check, g.module(b.fmt("test/agent4/{s}.zig", .{name})));
    const participants = b.step("check-participants", "Check compiled internal participant admission");
    g.testModule(participants, g.module("test/agent4/participant.zig"));
    check.dependOn(participants);
    const parser_tools = b.step("check-parser-tools", "Check typed parser tool bindings");
    g.testModule(parser_tools, g.module("test/agent4/parser_tools.zig"));
    check.dependOn(parser_tools);
    const parser_delivery = b.step("parser-delivery-images", "Emit protected parser delivery");
    const delivery_emitter = g.emitter("parser-delivery", g.module("test/agent4/parser_delivery.zig"));
    for ([_][]const u8{ "program", "input-schema", "result-schema" }) |mode|
        g.emit(parser_delivery, delivery_emitter, &.{mode}, b.fmt("parser-delivery/{s}.bin", .{mode}));
    check.dependOn(parser_delivery);
    const parser_proposals = b.step("parser-proposal-images", "Emit checked parser model proposals");
    const proposal_emitter = g.emitter("parser-proposals", g.module("test/agent4/parser_proposals.zig"));
    for ([_][]const u8{ "program", "input", "result-schema", "fragment", "experiment", "constraint", "unresolved", "unknown", "unoffered" }) |mode|
        g.emit(parser_proposals, proposal_emitter, &.{mode}, b.fmt("parser-proposals/{s}.bin", .{mode}));
    check.dependOn(parser_proposals);
    const parser_episode = b.step("parser-construction-images", "Emit consumer-directed parser construction");
    const parser_app = g.emitter("parser-construction", g.module("test/consumers/incremental-parser/main.zig"));
    const parser_producer = b.addRunArtifact(parser_app);
    parser_producer.addArg("producer");
    const parser_producer_bytes = parser_producer.captureStdOut(.{});
    const parser_consumer = b.addRunArtifact(parser_app);
    parser_consumer.addArg("consumer");
    const parser_consumer_bytes = parser_consumer.captureStdOut(.{});
    const parser_reference = b.addRunArtifact(parser_app);
    parser_reference.addArg("reference");
    const parser_reference_bytes = parser_reference.captureStdOut(.{});
    const parser_link = b.addRunArtifact(parser_app);
    parser_link.addArg("link");
    parser_link.addFileArg(parser_producer_bytes);
    parser_link.addFileArg(parser_consumer_bytes);
    parser_link.addFileArg(parser_reference_bytes);
    parser_episode.dependOn(&b.addInstallFileWithDir(parser_reference_bytes, .prefix, "agent4/parser-construction/reference.bmo1").step);
    parser_episode.dependOn(&b.addInstallFileWithDir(parser_producer_bytes, .prefix, "agent4/parser-construction/producer.bmo1").step);
    parser_episode.dependOn(&b.addInstallFileWithDir(parser_consumer_bytes, .prefix, "agent4/parser-construction/consumer.bmo1").step);
    parser_episode.dependOn(&b.addInstallFileWithDir(parser_link.captureStdOut(.{}), .prefix, "agent4/parser-construction/program.bpi3").step);
    const retained_link = b.addRunArtifact(parser_app);
    retained_link.addArg("link-retained");
    retained_link.addFileArg(parser_producer_bytes);
    retained_link.addFileArg(parser_consumer_bytes);
    retained_link.addFileArg(parser_reference_bytes);
    parser_episode.dependOn(&b.addInstallFileWithDir(retained_link.captureStdOut(.{}), .prefix, "agent4/parser-construction/retained.bpi3").step);
    const abort_link = b.addRunArtifact(parser_app);
    abort_link.addArg("link-abort");
    abort_link.addFileArg(parser_producer_bytes);
    abort_link.addFileArg(parser_consumer_bytes);
    abort_link.addFileArg(parser_reference_bytes);
    // Intended-valid local-disposal witness. Kept explicit while cross-component
    // capture-schema binding is missing; this step currently rejects at linking.
    const parser_abort = b.step("parser-abort-image", "Expose nested local-disposal admission gap (currently rejects)");
    parser_abort.dependOn(&b.addInstallFileWithDir(abort_link.captureStdOut(.{}), .prefix, "agent4/parser-construction/abort.bpi3").step);
    const forged_consumer = b.addRunArtifact(parser_app);
    forged_consumer.addArg("consumer-forged");
    const forged_link = b.addRunArtifact(parser_app);
    forged_link.addArg("link");
    forged_link.addFileArg(parser_producer_bytes);
    forged_link.addFileArg(forged_consumer.captureStdOut(.{}));
    forged_link.addFileArg(parser_reference_bytes);
    parser_episode.dependOn(&b.addInstallFileWithDir(forged_link.captureStdOut(.{}), .prefix, "agent4/parser-construction/forged.bpi3").step);
    for ([_][]const u8{ "model-template", "input-schema", "result-schema", "model-schema", "model-reply-schema" }) |mode|
        g.emit(parser_episode, parser_app, &.{mode}, b.fmt("parser-construction/{s}.bin", .{mode}));
    check.dependOn(parser_episode);
    const parser_schema = g.emitter("parser-schema", g.module("test/agent4/parser_tools.zig"));
    g.emit(parser_tools, parser_schema, &.{"program"}, "parser/program.bpi3");
    for ([_][]const u8{ "reference-request", "reference-reply", "execution-request", "execution-reply" }) |mode|
        g.emit(parser_tools, parser_schema, &.{mode}, b.fmt("parser/{s}.bin", .{mode}));
    const parser_oracle = b.addSystemCommand(&.{ "node", "--test", "test/agent4/parser_oracle.test.mjs" });
    check.dependOn(&parser_oracle.step);
    const parser_executor = b.addSystemCommand(&.{ "node", "test/agent4/parser_executor.test.mjs" });
    const parser_protocol = b.addSystemCommand(&.{ "node", "test/agent4/parser_protocol.test.mjs" });
    parser_executor.step.dependOn(&parser_protocol.step);
    b.step("check-parser-executor", "Check incremental parser candidates in the qualified executor")
        .dependOn(&parser_executor.step);
    const recursive_tests = b.addTest(.{
        .root_module = g.module("test/agent4/recursive_participant.zig"),
        .filters = &.{"recursive participant"},
    });
    recursive_tests.step.dependOn(g.gate);
    participants.dependOn(&b.addRunArtifact(recursive_tests).step);
    g.testModule(check, g.module("src/model_invocation_tests.zig"));
    g.testModule(check, g.module("src/conversation.zig"));
    g.testModule(check, g.module("src/react.zig"));
    g.testModule(check, g.module("src/value_equality.zig"));
    g.testModule(check, g.module("src/clarification.zig"));
    g.testModule(check, g.module("test/consumers/document/consequence.zig"));
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
    const inquiry = g.module("test/agent4/inquiry_probe.zig");
    g.testModule(check, inquiry);
    const inquiry_check = b.step("check-inquiry-probe", "Check retained inquiry custody");
    g.testModule(inquiry_check, inquiry);
    const inquiry_broker = g.module("test/agent4/inquiry_broker_probe.zig");
    g.testModule(check, inquiry_broker);
    g.testModule(inquiry_check, inquiry_broker);
    const inquiry_app = g.module("test/consumers/inquiry/main.zig");
    const inquiry_app_check = b.step("check-inquiry-application", "Check the model-directed repair application");
    g.testModule(inquiry_app_check, inquiry_app);
    g.testModule(check, inquiry_app);

    const emit = b.step("agent4-images", "Compile the consumer images");
    const participant_images = b.step("participant-images", "Emit and link the internal model participant");
    const participant_exe = g.emitter("agent-participant", g.module("test/agent4/participant.zig"));
    const participant_object = b.addRunArtifact(participant_exe);
    participant_object.addArg("object");
    const participant_bytes = participant_object.captureStdOut(.{});
    const participant_link = b.addRunArtifact(participant_exe);
    participant_link.addArg("link");
    participant_link.addFileArg(participant_bytes);
    participant_images.dependOn(&b.addInstallFileWithDir(participant_bytes, .prefix, "agent4/participant/producer.bmo1").step);
    participant_images.dependOn(&b.addInstallFileWithDir(participant_link.captureStdOut(.{}), .prefix, "agent4/participant/program.bpi3").step);
    for ([_][]const u8{ "input", "reply", "expected" }) |mode|
        g.emit(participant_images, participant_exe, &.{mode}, b.fmt("participant/{s}.bin", .{mode}));
    emit.dependOn(participant_images);
    const recursive_images = b.step("recursive-participant-images", "Emit reciprocal task participants");
    const recursive_exe = g.emitter("agent-recursive-participant", g.module("test/agent4/recursive_participant.zig"));
    const producer_run = b.addRunArtifact(recursive_exe);
    producer_run.addArg("producer");
    const producer_bytes = producer_run.captureStdOut(.{});
    const consumer_run = b.addRunArtifact(recursive_exe);
    consumer_run.addArg("consumer");
    const consumer_bytes = consumer_run.captureStdOut(.{});
    const recursive_link = b.addRunArtifact(recursive_exe);
    recursive_link.addArg("link");
    recursive_link.addFileArg(producer_bytes);
    recursive_link.addFileArg(consumer_bytes);
    recursive_images.dependOn(&b.addInstallFileWithDir(producer_bytes, .prefix, "agent4/recursive/producer.bmo1").step);
    recursive_images.dependOn(&b.addInstallFileWithDir(consumer_bytes, .prefix, "agent4/recursive/consumer.bmo1").step);
    recursive_images.dependOn(&b.addInstallFileWithDir(recursive_link.captureStdOut(.{}), .prefix, "agent4/recursive/program.bpi3").step);
    const alternate_run = b.addRunArtifact(recursive_exe);
    alternate_run.addArg("consumer-alt");
    const alternate_bytes = alternate_run.captureStdOut(.{});
    const alternate_link = b.addRunArtifact(recursive_exe);
    alternate_link.addArg("link");
    alternate_link.addFileArg(producer_bytes);
    alternate_link.addFileArg(alternate_bytes);
    recursive_images.dependOn(&b.addInstallFileWithDir(alternate_bytes, .prefix, "agent4/recursive/consumer-alt.bmo1").step);
    recursive_images.dependOn(&b.addInstallFileWithDir(alternate_link.captureStdOut(.{}), .prefix, "agent4/recursive/program-alt.bpi3").step);
    for ([_][]const u8{ "input", "reply" }) |mode|
        g.emit(recursive_images, recursive_exe, &.{mode}, b.fmt("recursive/{s}.bin", .{mode}));
    emit.dependOn(recursive_images);
    const text_object = g.emitter("agent-text-object", g.module("test/agent4/text_object.zig"));
    const text_link = g.emitter("agent-text-link", g.module("test/agent4/text_link.zig"));
    const text_object_bytes = b.addRunArtifact(text_object).captureStdOut(.{});
    emit.dependOn(&b.addInstallFileWithDir(text_object_bytes, .prefix, "agent4/text/tool.bmo1").step);
    for ([_][]const u8{ "standalone", "agent" }) |mode| {
        const linked = b.addRunArtifact(text_link);
        linked.addArg(mode);
        linked.addFileArg(text_object_bytes);
        emit.dependOn(&b.addInstallFileWithDir(linked.captureStdOut(.{}), .prefix, b.fmt("agent4/text/{s}.bpi3", .{mode})).step);
    }
    for ([_][]const u8{ "subject-schema", "task-schema", "result-schema", "report-schema", "model-reply" }) |mode|
        g.emit(emit, text_link, &.{mode}, b.fmt("text/{s}.bin", .{mode}));
    const distribution = b.step("emit-agent4", "Emit compiled examples and the source-independent use archive");
    const repository_application = b.step("check-repository-application", "Repair actual repository fixtures through the compiled application");
    const repository_images = b.step("repository-application-images", "Emit repository repair and its portable schemas");
    const repository_app = g.emitter("repository-application", g.module("test/consumers/repository/main.zig"));
    g.emit(repository_images, repository_app, &.{}, "repository/repair.bpi3");
    for ([_][]const u8{ "task-schema", "result-schema", "failure-schema" }) |mode|
        g.emit(repository_images, repository_app, &.{mode}, b.fmt("repository/{s}.bin", .{mode}));
    emit.dependOn(repository_images);
    repository_application.dependOn(repository_images);
    const dialogue_exe = g.emitter("agent4-dialogue", dialogue);
    const inquiry_exe = g.emitter("agent4-inquiry-probe", inquiry);
    const inquiry_broker_exe = g.emitter("agent4-inquiry-broker", inquiry_broker);
    const inquiry_app_exe = g.emitter("agent4-inquiry-application", inquiry_app);
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
    for ([_][]const u8{ "owned", "composition", "followup" }) |mode| {
        g.emit(emit, inquiry_exe, &.{mode}, b.fmt("inquiry/{s}.bpi3", .{mode}));
        g.emit(inquiry_check, inquiry_exe, &.{mode}, b.fmt("inquiry/{s}.bpi3", .{mode}));
    }
    for ([_][]const u8{ "twice", "dispose_owned", "exchange", "deep_exchange", "wide_exchange", "yield_once" }) |mode|
        g.emit(emit, dialogue_exe, &.{mode}, b.fmt("dialogue/{s}.bpi3", .{mode}));
    const multi = g.module("test/agent4/multi_probe.zig");
    multi.addImport("deliberation", g.helper("deliberation"));
    const multi_exe = g.emitter("agent4-multi", multi);
    for ([_][]const u8{ "multi", "cleanup", "dispose" }) |mode|
        g.emit(emit, multi_exe, &.{mode}, b.fmt("multi/{s}.bpi3", .{mode}));
    const installed_multi = b.addInstallArtifact(multi_exe, .{});
    emit.dependOn(&installed_multi.step);
    b.step("build-inspector", "Build the read-only Program/State inspector").dependOn(&installed_multi.step);
    const approval_exe = g.emitter("agent4-approval", g.module("test/agent4/approval_probe.zig"));
    g.emit(emit, approval_exe, &.{}, "approval/approval.bpi3");
    g.emit(emit, approval_exe, &.{"evidence"}, "approval/approval-evidence.bpi3");
    g.emit(emit, approval_exe, &.{"scoped"}, "approval/approval-scoped.bpi3");
    g.emit(emit, approval_exe, &.{"scoped_evidence"}, "approval/approval-scoped-evidence.bpi3");
    const review = g.module("test/consumers/review/main.zig");
    g.testModule(check, review);
    const review_exe = g.emitter("agent4-review", review);
    for ([_][]const u8{ "mid_review", "clarify_first", "human", "model", "rule", "react" }) |mode| {
        for ([_][]const u8{ "bpi3", "args" }) |format|
            g.emit(emit, review_exe, &.{ mode, format }, b.fmt("review/{s}.{s}", .{ mode, format }));
    }
    const document_exe = g.emitter("agent4-document", g.module("test/consumers/document/main.zig"));
    g.emit(emit, document_exe, &.{}, "document/document.bpi3");
    g.emit(emit, document_exe, &.{"args"}, "document/document.args");
    g.emit(emit, document_exe, &.{"consequence"}, "document/consequence.bpi3");
    g.emit(emit, document_exe, &.{"consequence-args"}, "document/consequence.args");
    g.emit(emit, document_exe, &.{"consequence-clarify-first"}, "document/clarify-first.bpi3");
    const clarification_economy = g.emitter("clarification-scaling", g.module("test/agent4/clarification.zig"));
    g.emit(emit, clarification_economy, &.{}, "clarification/scaling.json");
    const inventory = b.addSystemCommand(&.{ "node", "tools/agent4/emit_inventory.mjs", b.getInstallPath(.prefix, "agent4") });
    inventory.has_side_effects = true;
    inventory.step.dependOn(emit);
    const package = b.addSystemCommand(&.{ "node", "tools/agent4/package.mjs", "--images-dir", b.getInstallPath(.prefix, "agent4"), "--output-dir", b.getInstallPath(.prefix, "agent4-release"), "--version", "4.0.0-dev.0" });
    if (runtime) |runtime_path| package.addArgs(&.{ "--world-runtime", runtime_path });
    package.has_side_effects = true;
    package.step.dependOn(&inventory.step);
    distribution.dependOn(&package.step);
    check.dependOn(emit);

    const integration = b.step("check-agent4-integration", "Execute consumer proofs under the selected World");
    const compiled_tools_check = b.step("check-compiled-tools", "Execute one compiled text tool in standalone and Agent callers");
    const components_check = b.step("check-component-tools", "Reuse three effectful objects in Agent and two standalone Programs");
    const component_objects = g.emitter("agent4-component-objects", g.module("test/agent4/component_objects.zig"));
    const component_link = g.emitter("agent4-component-link", g.module("test/agent4/component_link.zig"));
    const component_tools = b.step("build-component-tools", "Build the independent component emitter and client linker without World");
    component_tools.dependOn(&b.addInstallArtifact(component_objects, .{}).step);
    component_tools.dependOn(&b.addInstallArtifact(component_link, .{}).step);
    const browser_check = b.step("check-compiled-tool-browser", "Transfer the compiled Agent tool through real browser Workers and a file server");
    const native_checks = b.step("check-native", "Check native Agent semantics against the selected World");
    const repository_delivery = b.step("check-repository-delivery", "Check repository replacement through real file I/O and fresh kernels");
    const economy = b.step("check-agent4-economy", "Measure direct/facade and retained-state economy");
    if (runtime) |runtime_path| {
        const world = b.createModule(.{
            .root_source_file = .{ .cwd_relative = b.pathJoin(&.{ world_source, "src/root.zig" }) },
            .target = b.graph.host,
            .optimize = optimize,
            .imports = &.{.{ .name = "boundary_data", .module = data }},
        });
        const runtime_guard = b.addSystemCommand(&.{ "node", "tools/agent4/dependencies.mjs", "verify", "--world-runtime", runtime_path, "--world-source", world_source });
        if (world_archive) |archive| runtime_guard.addArgs(&.{ "--world-archive", archive });
        addBoundary(b, runtime_guard, source, target, optimize);
        runtime_guard.has_side_effects = true;
        _ = runtime_guard.captureStdOut(.{});
        const text_check = b.addSystemCommand(&.{ "node", "test/agent4/text_tool_runtime.mjs" });
        text_check.addFileArg(text_object.getEmittedBin());
        text_check.addFileArg(text_link.getEmittedBin());
        text_check.addArg(runtime_path);
        text_check.step.dependOn(&runtime_guard.step);
        text_check.has_side_effects = true;
        compiled_tools_check.dependOn(&text_check.step);
        const component_check = b.addSystemCommand(&.{ "node", "test/agent4/component_runtime.mjs" });
        component_check.addFileArg(component_objects.getEmittedBin());
        component_check.addFileArg(component_link.getEmittedBin());
        component_check.addArg(runtime_path);
        component_check.step.dependOn(&runtime_guard.step);
        component_check.has_side_effects = true;
        components_check.dependOn(&component_check.step);
        if (browser_tools_path) |browser_tools| {
            const browser = b.addSystemCommand(&.{ "node", "test/agent4/text_browser.mjs" });
            browser.addFileArg(text_object.getEmittedBin());
            browser.addFileArg(text_link.getEmittedBin());
            browser.addArg(runtime_path);
            browser.addArg(browser_tools);
            browser.step.dependOn(&runtime_guard.step);
            browser.has_side_effects = true;
            browser_check.dependOn(&browser.step);
        } else browser_check.dependOn(&b.addFail("provide -Dbrowser-tools=/absolute/locked-playwright-tools").step);
        const runtime_work = b.step("agent4-runtime-tests", "Native and embedding test implementation");
        const repository_emitter_module = g.module("test/agent4/repository_replacement_emit.zig");
        repository_emitter_module.addImport("repository_app", g.module("test/consumers/repository/application.zig"));
        const repository_emitter = g.emitter("repository-replacement", repository_emitter_module);
        const repository_run = b.addSystemCommand(&.{ "node", "test/agent4/repository_delivery_runtime.mjs" });
        repository_run.addFileArg(repository_emitter.getEmittedBin());
        repository_run.addArg(runtime_path);
        repository_run.step.dependOn(&runtime_guard.step);
        repository_run.has_side_effects = true;
        const repository_files = b.addSystemCommand(&.{ "node", "--test", "test/agent4/repository_delivery.test.mjs", "test/agent4/repository.test.mjs", "test/agent4/repository_executor.test.mjs" });
        repository_delivery.dependOn(&repository_run.step);
        repository_delivery.dependOn(&repository_files.step);
        runtime_work.dependOn(repository_delivery);
        const repository_real = b.addSystemCommand(&.{ "node", "test/agent4/repository_runtime.mjs", runtime_path, b.getInstallPath(.prefix, "agent4/repository") });
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
        const inquiry_executor = b.addSystemCommand(&.{ "node", "test/agent4/inquiry_executor.test.mjs" });
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
        const inquiry_app_run = b.addSystemCommand(&.{ "node", "test/agent4/inquiry_application_runtime.mjs", runtime_path, b.getInstallPath(.prefix, "agent4/inquiry") });
        const inquiry_cli = b.addSystemCommand(&.{ "node", "--test", "test/agent4/inquiry_cli.test.mjs" });
        inquiry_cli.setEnvironmentVariable("AGENT4_WORLD_RUNTIME", runtime_path);
        inquiry_cli.setEnvironmentVariable("AGENT4_INQUIRY_IMAGES", b.getInstallPath(.prefix, "agent4/inquiry"));
        inquiry_cli.has_side_effects = true;
        inquiry_cli.step.dependOn(distribution);
        inquiry_cli.step.dependOn(&runtime_guard.step);
        b.step("check-inquiry-cli", "Check opt-in inquiry dispatch and checkpoint recovery").dependOn(&inquiry_cli.step);
        inquiry_app_run.addFileArg(native_exe.getEmittedBin());
        inquiry_app_run.addFileArg(multi_exe.getEmittedBin());
        inquiry_app_run.has_side_effects = true;
        inquiry_app_run.step.dependOn(inquiry_app_images);
        inquiry_app_run.step.dependOn(&runtime_guard.step);
        inquiry_app_check.dependOn(&inquiry_app_run.step);
        if (inquiry_host) runtime_work.dependOn(&inquiry_app_run.step);
        const inquiry_cases = b.addSystemCommand(&.{ "node", "test/agent4/inquiry_cases_runtime.mjs", runtime_path, b.getInstallPath(.prefix, "agent4/inquiry") });
        inquiry_cases.addFileArg(native_exe.getEmittedBin());
        inquiry_cases.addFileArg(multi_exe.getEmittedBin());
        inquiry_cases.has_side_effects = true;
        inquiry_cases.step.dependOn(inquiry_app_images);
        inquiry_cases.step.dependOn(&runtime_guard.step);
        inquiry_app_check.dependOn(&inquiry_cases.step);
        if (inquiry_host) runtime_work.dependOn(&inquiry_cases.step);
        const comparison = b.addSystemCommand(&.{ "node", "test/agent4/inquiry_cases_runtime.mjs", runtime_path, b.getInstallPath(.prefix, "agent4/inquiry") });
        comparison.addFileArg(native_exe.getEmittedBin());
        comparison.addFileArg(multi_exe.getEmittedBin());
        comparison.addArg("--comparison-only");
        comparison.has_side_effects = true;
        comparison.step.dependOn(inquiry_app_images);
        comparison.step.dependOn(&runtime_guard.step);
        b.step("check-inquiry-comparison", "Compare inquiry and ReAct on the same repair tasks").dependOn(&comparison.step);
        const inquiry_repeated = b.addSystemCommand(&.{ "node", "test/agent4/inquiry_repeated_runtime.mjs", runtime_path, b.getInstallPath(.prefix, "agent4/inquiry") });
        inquiry_repeated.addFileArg(native_exe.getEmittedBin());
        inquiry_repeated.addFileArg(multi_exe.getEmittedBin());
        inquiry_repeated.has_side_effects = true;
        inquiry_repeated.step.dependOn(inquiry_app_images);
        inquiry_repeated.step.dependOn(&runtime_guard.step);
        inquiry_app_check.dependOn(&inquiry_repeated.step);
        if (inquiry_host) runtime_work.dependOn(&inquiry_repeated.step);
        const broker_run = b.addSystemCommand(&.{
            "node",                                                  "test/agent4/inquiry_broker_runtime.mjs", runtime_path,
            b.getInstallPath(.prefix, "agent4/inquiry/broker.bpi3"),
        });
        broker_run.addFileArg(native_exe.getEmittedBin());
        broker_run.addFileArg(multi_exe.getEmittedBin());
        broker_run.step.dependOn(&runtime_guard.step);
        g.emit(&broker_run.step, inquiry_broker_exe, &.{}, "inquiry/broker.bpi3");
        inquiry_check.dependOn(&broker_run.step);
        runtime_work.dependOn(&broker_run.step);
        for ([_][]const u8{ "owned", "composition", "followup" }) |mode| {
            const inquiry_run = b.addSystemCommand(&.{
                "node",                                                               "test/agent4/inquiry_runtime.mjs", runtime_path,
                b.getInstallPath(.prefix, b.fmt("agent4/inquiry/{s}.bpi3", .{mode})),
            });
            inquiry_run.addFileArg(native_exe.getEmittedBin());
            inquiry_run.addFileArg(multi_exe.getEmittedBin());
            inquiry_run.step.dependOn(&runtime_guard.step);
            g.emit(&inquiry_run.step, inquiry_exe, &.{mode}, b.fmt("inquiry/{s}.bpi3", .{mode}));
            inquiry_check.dependOn(&inquiry_run.step);
            runtime_work.dependOn(&inquiry_run.step);
        }
        for ([_][]const u8{ "bounded_history", "decision_scopes", "model_admission", "model_custody", "observation", "approval_equality", "callable_runtime", "clarification", "terminology", "repository_working_set", "repository_replacement" }) |name| {
            const native = g.module(b.fmt("test/agent4/{s}.zig", .{name}));
            native.addImport("world", world);
            native.addImport("equality", g.helper("value_equality"));
            if (std.mem.eql(u8, name, "terminology"))
                native.addImport("document", g.module("test/consumers/document/consequence.zig"));
            if (std.mem.startsWith(u8, name, "repository_")) {
                const working_set = std.mem.eql(u8, name, "repository_working_set");
                native.addImport(if (working_set) "repository" else "repository_replace", g.module(if (working_set) "test/consumers/repository/working_set.zig" else "test/consumers/repository/replacement.zig"));
                const tests = b.addTest(.{ .root_module = native });
                tests.step.dependOn(native_graph.gate);
                const run_policy = b.addRunArtifact(tests);
                native_checks.dependOn(&run_policy.step);
                b.step(if (working_set) "check-repository-working-set" else "check-repository-replacement", if (working_set) "Check staged repository memory and evidence rules" else "Check live repository replacement approval")
                    .dependOn(&run_policy.step);
            } else native_graph.testModule(native_checks, native);
        }
        const run = b.addSystemCommand(&.{ "node", "tools/agent4/check.mjs", "integration", "--world-runtime", runtime_path, "--fixtures", b.getInstallPath(.prefix, "agent4"), "--world-source", world_source });
        if (world_archive) |archive| run.addArgs(&.{ "--world-archive", archive });
        run.addArg("--native");
        run.addFileArg(native_exe.getEmittedBin());
        addBoundary(b, run, source, target, optimize);
        run.has_side_effects = true;
        run.step.dependOn(distribution);
        run.step.dependOn(&runtime_guard.step);
        runtime_work.dependOn(&run.step);
        const runtime_post = b.addSystemCommand(&.{ "node", "tools/agent4/dependencies.mjs", "verify", "--world-runtime", runtime_path, "--world-source", world_source });
        if (world_archive) |archive| runtime_post.addArgs(&.{ "--world-archive", archive });
        addBoundary(b, runtime_post, source, target, optimize);
        runtime_post.has_side_effects = true;
        _ = runtime_post.captureStdOut(.{});
        runtime_post.step.dependOn(runtime_work);
        integration.dependOn(&runtime_post.step);
        const economy_module = g.module("test/agent4/economy.zig");
        economy_module.addImport("document", g.module("test/consumers/document/consequence.zig"));
        economy_module.addImport("inquiry", inquiry_app);
        g.testModule(economy, economy_module);
        const economy_exe = g.emitter("economy-probe", economy_module);
        const economy_emit = b.addRunArtifact(economy_exe);
        economy_emit.addArgs(&.{ "emit", b.getInstallPath(.prefix, "agent4/economy") });
        const measure = b.addSystemCommand(&.{ "node", "tools/agent4/economy.mjs", "--world-runtime", runtime_path, "--fixtures", b.getInstallPath(.prefix, "agent4/economy"), "--output", b.getInstallPath(.prefix, "agent4/economy-results"), "--probe" });
        const installed_probe = b.addInstallArtifact(economy_exe, .{});
        measure.addArg(b.getInstallPath(.bin, "economy-probe"));
        measure.addArgs(&.{ "--world-source", world_source });
        if (world_archive) |archive| measure.addArgs(&.{ "--world-archive", archive });
        measure.addArg("--native");
        measure.addFileArg(native_exe.getEmittedBin());
        addBoundary(b, measure, source, target, optimize);
        measure.step.dependOn(&installed_probe.step);
        if (measure_economy) measure.addArgs(&.{ "--measure", "--uncontended" });
        measure.has_side_effects = true;
        measure.step.dependOn(emit);
        measure.step.dependOn(&economy_emit.step);
        economy.dependOn(&measure.step);
    } else {
        const missing = b.addFail("provide -Dworld-runtime=/absolute/authenticated/world-runtime");
        compiled_tools_check.dependOn(&missing.step);
        components_check.dependOn(&missing.step);
        browser_check.dependOn(&missing.step);
        native_checks.dependOn(&missing.step);
        repository_delivery.dependOn(&missing.step);
        repository_application.dependOn(&missing.step);
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
