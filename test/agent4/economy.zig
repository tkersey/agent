//! Consumer economy probes. No runtime evaluator or upstream instrumentation.
const std = @import("std");
const boundary = @import("boundary");
const agent = @import("agent");
const source = boundary.computation;
const data = boundary.data_v2;
const Id = source.Id;
const edited_source_value: u32 = 7;
const shared_prompt = "one immutable shared instruction";

fn direct(b: *source.Builder) !source.Module {
    const integer = try b.scalar(u32);
    return minimalBody(b, try b.effect(.{
        .identity = "example.facade.read.v1",
        .payload = integer,
        .result = integer,
    }));
}

fn minimalBody(b: *source.Builder, effect: Id) !source.Module {
    const integer = try b.scalar(u32);
    const unit = try b.scalar(void);
    const entry = try b.declare(&.{integer}, integer, &.{effect}, &.{});
    try b.define(entry, try b.term(.{ .perform = .{
        .effect = effect,
        .payload = try b.reference(b.parameter(entry, 0)),
    } }));
    return b.module(entry, unit);
}

const Minimal = struct {
    pub fn emit(c: agent.Context) !source.Module {
        const integer = try c.schema(u32);
        return minimalBody(c.builder, try c.external("example.facade.read.v1", integer, integer, .read));
    }
};
const MinimalSystem = agent.system(.{
    .InitialArgs = u32,
    .Result = u32,
    .Failure = void,
    .application = Minimal,
});

fn sharing(b: *source.Builder, installations: usize) !source.Module {
    if (installations == 0) return error.ExpectedInstallation;
    const integer = try b.scalar(u32);
    const unit = try b.scalar(void);
    const text = try b.schema(.text);
    const environment = try b.schema(.{ .product = &.{ integer, text } });
    const entry = try b.declare(&.{unit}, integer, &.{}, &.{});
    const helper = try sharedHelper(b, environment, integer);
    var next: ?Id = null;
    for (0..installations) |_| {
        const constant = try promptValue(b, text);
        const captured = try b.primitive(environment, .product, &.{
            try b.constant(u32, edited_source_value), constant,
        }, 0);
        const call = try b.term(.{ .call = .{
            .function = helper,
            .arguments = &.{captured},
        } });
        next = if (next) |tail| try b.bind(try b.variable(integer), call, tail) else call;
        // Repeated declarations must share the same public specialization too.
        _ = try agent.scopes.define(b, "economy.shared-skill", environment, integer, .{
            .captures = &.{environment},
        });
    }
    try b.define(entry, next.?);
    return b.module(entry, unit);
}

fn promptValue(b: *source.Builder, text: Id) !Id {
    const bytes = try agent.contracts.encodeOwned(agent.contracts.Utf8, b.allocator(), .{ .bytes = shared_prompt });
    return b.literal(.{ .schema = text, .bytes = bytes });
}

fn sharedHelper(b: *source.Builder, environment: Id, integer: Id) !Id {
    const reader = try agent.scopes.define(b, "economy.shared-skill", environment, integer, .{
        .captures = &.{environment},
    });
    const body = try b.declare(&.{reader.family.capability}, integer, &.{reader.family.effect}, &.{});
    const retained = try b.variable(environment);
    const selected = try b.primitive(integer, .field, &.{try b.reference(retained)}, 0);
    try b.define(body, try b.bind(retained, try agent.scopes.read(b, reader, try b.reference(b.parameter(body, 0))), try b.pure(selected)));
    const computation = try b.schema(.{ .internal = .{ .computation = .{
        .parameters = &.{reader.family.capability},
        .result = integer,
        .effects = &.{reader.family.effect},
        .use = .linear,
    } } });
    const helper = try b.declare(&.{environment}, integer, &.{}, &.{});
    try b.define(helper, try agent.scopes.enter(b, reader, try b.lambda(body, computation), try b.reference(b.parameter(helper, 0)), &.{}));
    return helper;
}

fn conversation(b: *source.Builder) !source.Module {
    const unit = try b.scalar(void);
    const integer = try b.scalar(u64);
    const memory = try b.schema(.{ .seq = integer });
    const exchange = try agent.interaction.define(b, .{
        .name = "economy.next",
        .channel = unit,
        .purpose = unit,
        .presentation = unit,
        .outgoing = integer,
        .input = integer,
        .close_conversation = unit,
    });
    const finish = try b.declare(&.{ memory, unit }, integer, &.{}, &.{});
    try b.define(finish, try b.pure(try b.primitive(integer, .sequence_length, &.{try b.reference(b.parameter(finish, 0))}, 0)));
    const empty = try b.constant(void, {});
    const loop = try agent.conversation.define(b, .{
        .memory = memory,
        .input = integer,
        .reply = integer,
        .result = integer,
        .exchange = exchange,
        .turn = try retainTurn(b, memory, integer, unit),
        .finish = finish,
        .channel = empty,
        .purpose = empty,
        .presentation = empty,
        .residual = .{ .effects = &.{exchange.effect} },
    });
    const entry = try b.declare(&.{unit}, integer, &.{exchange.effect}, &.{});
    try b.define(entry, try agent.conversation.run(b, loop, try b.primitive(memory, .sequence, &.{}, 0), try b.constant(u64, 7)));
    return b.module(entry, unit);
}

fn retainTurn(b: *source.Builder, memory: Id, integer: Id, unit: Id) !Id {
    const pair = try b.schema(.{ .product = &.{ memory, integer } });
    const turn = try b.declare(&.{ memory, integer }, pair, &.{}, &.{});
    const previous = try b.reference(b.parameter(turn, 0));
    const input = try b.reference(b.parameter(turn, 1));
    const count = try b.primitive(integer, .sequence_length, &.{previous}, 0);
    const not_full = try b.primitive(try b.scalar(bool), .less, &.{ count, try b.constant(u64, 8) }, 0);
    const append = try b.primitive(memory, .sequence_append, &.{ previous, input }, 0);
    const pop_pair = try b.schema(.{ .product = &.{ integer, memory } });
    const popped = try b.schema(.{ .sum = &.{ unit, pop_pair } });
    const vacant = try b.variable(unit);
    const present = try b.variable(pop_pair);
    const tail = try b.primitive(memory, .field, &.{try b.reference(present)}, 1);
    const replace = try b.primitive(memory, .sequence_append, &.{ tail, input }, 0);
    const at_capacity = try b.term(.{ .match_sum = .{
        .value = try b.primitive(popped, .sequence_pop, &.{previous}, 0),
        .cases = &.{
            .{ .variable = vacant, .body = try b.term(.{ .fail = try b.constant(void, {}) }) },
            .{ .variable = present, .body = try turnPair(b, pair, integer, replace) },
        },
    } });
    try b.define(turn, try b.term(.{ .conditional = .{
        .condition = not_full,
        .when_true = try turnPair(b, pair, integer, append),
        .when_false = at_capacity,
    } }));
    return turn;
}

fn turnPair(b: *source.Builder, pair: Id, integer: Id, memory: Id) !Id {
    return b.pure(try b.primitive(pair, .product, &.{
        memory, try b.primitive(integer, .sequence_length, &.{memory}, 0),
    }, 0));
}

const Phases = struct {
    source_copy: u64 = 0,
    source_check: u64 = 0,
    lowering: u64 = 0,
    target_check: u64 = 0,
    direct_optimization: u64 = 0,
    canonicalization: u64 = 0,
};
const Observer = struct {
    io: std.Io,
    phases: Phases = .{},
    previous: ?source.CompileStage = null,
    started: std.Io.Timestamp = undefined,
    fn enter(context: *anyopaque, stage: source.CompileStage) void {
        const self: *@This() = @ptrCast(@alignCast(context));
        const now = std.Io.Clock.awake.now(self.io);
        if (self.previous) |previous| {
            const ns: u64 = @intCast(self.started.durationTo(now).nanoseconds);
            inline for (std.meta.fields(Phases)) |field|
                if (previous == @field(source.CompileStage, field.name)) {
                    @field(self.phases, field.name) += ns;
                };
        }
        self.previous = stage;
        self.started = now;
    }
};

const AuthoringPhases = struct {
    descriptors: u64 = 0,
    application_source: u64 = 0,
    agent_admission: u64 = 0,
    boundary_compile: u64 = 0,
};
const AuthoringObserver = struct {
    io: std.Io,
    phases: AuthoringPhases = .{},
    previous: ?agent.CompileStage = null,
    started: std.Io.Timestamp = undefined,
    fn enter(context: *anyopaque, stage: agent.CompileStage) void {
        const self: *@This() = @ptrCast(@alignCast(context));
        const now = std.Io.Clock.awake.now(self.io);
        if (self.previous) |previous| {
            const ns: u64 = @intCast(self.started.durationTo(now).nanoseconds);
            inline for (std.meta.fields(AuthoringPhases)) |field|
                if (previous == @field(agent.CompileStage, field.name)) {
                    @field(self.phases, field.name) += ns;
                };
        }
        self.previous = stage;
        self.started = now;
    }
};

const Metrics = struct {
    name: []const u8,
    installations: ?usize = null,
    imageBytes: usize,
    imageSha256: []const u8,
    schemas: usize,
    functions: usize,
    blocks: usize,
    constants: usize,
    constantBytes: usize,
    handlerDefinitions: usize,
    helperFunctionCount: usize,
    helperIncomingCalls: usize,
    sharedPromptCopies: usize,
    sharedPromptBytes: usize,
    descriptorConstructionNs: ?u64,
    sourceConstructionNs: ?u64,
    descriptorAndSourceNs: ?u64,
    agentAdmissionNs: u64,
    authoringTotalNs: u64,
    compilerTotalNs: u64,
    compilerPhasesNs: ?Phases,
    imageEmissionNs: u64,
};

fn elapsed(io: std.Io, start: std.Io.Timestamp) u64 {
    return @intCast(start.durationTo(std.Io.Clock.awake.now(io)).nanoseconds);
}

const Workload = union(enum) { direct, sharing: usize, conversation };

fn declareDomain(b: *source.Builder, workload: Workload) !void {
    _ = try agent.contracts.schema(void, b);
    switch (workload) {
        .direct => _ = try agent.contracts.schema(u32, b),
        .sharing => _ = try agent.contracts.schema(struct {
            selected: u32,
            instructions: agent.contracts.Utf8,
        }, b),
        .conversation => {
            _ = try agent.contracts.schema(u64, b);
            _ = try agent.contracts.schema([]const u64, b);
        },
    }
}

fn measure(init: std.process.Init, directory: []const u8, name: []const u8, workload: Workload) !Metrics {
    const total_started = std.Io.Clock.awake.now(init.io);
    var b = source.Builder.init(init.gpa);
    var builder_live = true;
    defer if (builder_live) b.deinit();
    const started = std.Io.Clock.awake.now(init.io);
    try declareDomain(&b, workload);
    const descriptor_ns = elapsed(init.io, started);
    const source_start = std.Io.Clock.awake.now(init.io);
    const module = switch (workload) {
        .direct => try direct(&b),
        .sharing => |count| try sharing(&b, count),
        .conversation => try conversation(&b),
    };
    const source_ns = elapsed(init.io, source_start);
    var observer: Observer = .{ .io = init.io };
    var diagnostic: boundary.program.Diagnostic = .{};
    const compile_start = std.Io.Clock.awake.now(init.io);
    var compiled = boundary.program.compileObserved(init.gpa, module, .{
        .diagnostic = &diagnostic,
        .observer = .{ .context = &observer, .enter = Observer.enter },
    }) catch |err| {
        std.debug.print("{s}: {any}\n", .{ name, diagnostic });
        return err;
    };
    const compiler_ns = elapsed(init.io, compile_start);
    defer compiled.deinit();
    b.deinit();
    builder_live = false;
    const total_ns = elapsed(init.io, total_started);
    var metrics = try saveCompiled(init, directory, name, compiled);
    metrics.installations = if (workload == .sharing) workload.sharing else null;
    metrics.descriptorConstructionNs = descriptor_ns;
    metrics.sourceConstructionNs = source_ns;
    metrics.descriptorAndSourceNs = descriptor_ns + source_ns;
    metrics.compilerTotalNs = compiler_ns;
    metrics.compilerPhasesNs = observer.phases;
    metrics.authoringTotalNs = total_ns;
    return metrics;
}

fn facade(init: std.process.Init, directory: []const u8) !Metrics {
    var authoring: AuthoringObserver = .{ .io = init.io };
    var compiler: Observer = .{ .io = init.io };
    const started = std.Io.Clock.awake.now(init.io);
    var compiled = try agent.compileObserved(init.gpa, MinimalSystem, .{
        .observer = .{ .context = &authoring, .enter = AuthoringObserver.enter },
        .boundary_options = .{ .observer = .{ .context = &compiler, .enter = Observer.enter } },
    });
    const duration = elapsed(init.io, started);
    defer compiled.deinit();
    var metrics = try saveCompiled(init, directory, "facade", compiled);
    metrics.descriptorConstructionNs = authoring.phases.descriptors;
    metrics.sourceConstructionNs = authoring.phases.application_source;
    metrics.descriptorAndSourceNs = authoring.phases.descriptors + authoring.phases.application_source;
    metrics.agentAdmissionNs = authoring.phases.agent_admission;
    metrics.compilerTotalNs = authoring.phases.boundary_compile;
    metrics.compilerPhasesNs = compiler.phases;
    metrics.authoringTotalNs = duration;
    return metrics;
}

fn saveCompiled(init: std.process.Init, directory: []const u8, name: []const u8, compiled: source.Compiled) !Metrics {
    const started = std.Io.Clock.awake.now(init.io);
    const storage = try init.gpa.alloc(u8, try data.image.encodedLength(compiled.program));
    defer init.gpa.free(storage);
    const image = try compiled.encode(init.gpa, storage);
    const duration = elapsed(init.io, started);
    try save(init, directory, try std.fmt.allocPrint(init.gpa, "{s}.bpi2", .{name}), image);
    const hex = std.fmt.bytesToHex(data.wire.digest(image), .lower);
    const identity = try init.gpa.dupe(u8, &hex);
    const program = compiled.program;
    var helpers: std.ArrayList(Id) = .empty;
    defer helpers.deinit(init.gpa);
    for (program.blocks) |block| if (block.terminator == .handle and
        std.mem.indexOfScalar(Id, helpers.items, block.function) == null)
    {
        try helpers.append(init.gpa, block.function);
    };
    var calls: usize = 0;
    for (program.blocks) |block| if (block.terminator == .call and
        std.mem.indexOfScalar(Id, helpers.items, block.terminator.call.function) != null)
    {
        calls += 1;
    };
    var constant_bytes: usize = 0;
    var prompt_copies: usize = 0;
    const prompt_bytes = try agent.contracts.encodeOwned(agent.contracts.Utf8, init.gpa, .{ .bytes = shared_prompt });
    defer init.gpa.free(prompt_bytes);
    for (program.constants) |literal| {
        constant_bytes += literal.bytes.len;
        if (std.mem.eql(u8, literal.bytes, prompt_bytes)) prompt_copies += 1;
    }
    return .{
        .name = name,
        .imageBytes = image.len,
        .imageSha256 = identity,
        .schemas = program.schemas.len,
        .functions = program.functions.len,
        .blocks = program.blocks.len,
        .constants = program.constants.len,
        .constantBytes = constant_bytes,
        .handlerDefinitions = program.handlers.len,
        .helperFunctionCount = helpers.items.len,
        .helperIncomingCalls = calls,
        .sharedPromptCopies = prompt_copies,
        .sharedPromptBytes = prompt_bytes.len,
        .descriptorConstructionNs = null,
        .sourceConstructionNs = null,
        .descriptorAndSourceNs = null,
        .agentAdmissionNs = 0,
        .authoringTotalNs = 0,
        .compilerTotalNs = 0,
        .compilerPhasesNs = null,
        .imageEmissionNs = duration,
    };
}

fn save(init: std.process.Init, directory: []const u8, name: []const u8, bytes: []const u8) !void {
    const path = try std.fs.path.join(init.gpa, &.{ directory, name });
    defer init.gpa.free(path);
    try std.Io.Dir.cwd().writeFile(init.io, .{ .sub_path = path, .data = bytes });
}

fn warmup(allocator: std.mem.Allocator) !void {
    var b = source.Builder.init(allocator);
    defer b.deinit();
    var control = try boundary.program.compile(allocator, try direct(&b));
    defer control.deinit();
    var minimal = try agent.compile(allocator, MinimalSystem);
    defer minimal.deinit();
}

fn delta(facade_ns: u64, direct_ns: u64) i128 {
    return @as(i128, facade_ns) - @as(i128, direct_ns);
}

fn overhead(control: Metrics, minimal: Metrics) struct {
    relation: []const u8 = "facade minus matched direct Boundary; identical canonical BPI2",
    qualification: []const u8 = "one warmed pair in direct/facade order; observer and clock costs included, not a universal overhead bound",
    descriptorConstructionNs: i128,
    sourceConstructionNs: i128,
    agentAdmissionNs: i128,
    boundaryCompilerNs: i128,
    loweringNs: i128,
    authoringTotalNs: i128,
    imageEmissionNs: i128,
    totalThroughEmissionNs: i128,
    imageBytes: i128,
} {
    return .{
        .descriptorConstructionNs = delta(minimal.descriptorConstructionNs.?, control.descriptorConstructionNs.?),
        .sourceConstructionNs = delta(minimal.sourceConstructionNs.?, control.sourceConstructionNs.?),
        .agentAdmissionNs = delta(minimal.agentAdmissionNs, control.agentAdmissionNs),
        .boundaryCompilerNs = delta(minimal.compilerTotalNs, control.compilerTotalNs),
        .loweringNs = delta(minimal.compilerPhasesNs.?.lowering, control.compilerPhasesNs.?.lowering),
        .authoringTotalNs = delta(minimal.authoringTotalNs, control.authoringTotalNs),
        .imageEmissionNs = delta(minimal.imageEmissionNs, control.imageEmissionNs),
        .totalThroughEmissionNs = delta(minimal.authoringTotalNs + minimal.imageEmissionNs, control.authoringTotalNs + control.imageEmissionNs),
        .imageBytes = @as(i128, minimal.imageBytes) - @as(i128, control.imageBytes),
    };
}

fn emit(init: std.process.Init, directory: []const u8) !void {
    try std.Io.Dir.cwd().createDirPath(init.io, directory);
    // Warm each minimal authoring path once before paired phase observations.
    // This is measurement work, not compilation per runtime test scenario.
    try warmup(init.gpa);
    const control = try measure(init, directory, "direct", .direct);
    const minimal = try facade(init, directory);
    if (!std.mem.eql(u8, control.imageSha256, minimal.imageSha256))
        return error.FacadeCanonicalMismatch;
    var installations: [3]Metrics = undefined;
    for (&installations, [_]usize{ 1, 8, 64 }) |*item, count| {
        const name = try std.fmt.allocPrint(init.gpa, "sharing-{d}", .{count});
        item.* = try measure(init, directory, name, .{ .sharing = count });
        if (item.helperFunctionCount != 1 or item.helperIncomingCalls != count or
            item.sharedPromptCopies != 1 or item.handlerDefinitions != 1)
            return error.SharingMismatch;
    }
    const continuing = try measure(init, directory, "conversation", .conversation);
    try save(init, directory, "direct.args", &.{ 7, 0, 0, 0 });
    try save(init, directory, "facade.args", &.{ 7, 0, 0, 0 });
    try save(init, directory, "conversation.args", &.{});
    const report = try std.json.Stringify.valueAlloc(init.gpa, .{
        .relation = "Actual public compiler outputs; source work and emission timed with native Clock.awake",
        .descriptorRelation = "Portable domain schema derivation; internal handler/capture schemas belong to source construction",
        .timingStatus = "Observations only; acceptance requires an uncontended harness run",
        .canonicalEqual = true,
        .minimalWarmupCompilations = 2,
        .direct = control,
        .facade = minimal,
        .facadeOverhead = overhead(control, minimal),
        .sharing = installations,
        .conversation = continuing,
    }, .{ .whitespace = .indent_2 });
    defer init.gpa.free(report);
    try save(init, directory, "source-metrics.json", report);
}

fn inspectState(init: std.process.Init, path: []const u8) !void {
    const bytes = try std.Io.Dir.cwd().readFileAlloc(init.io, path, init.gpa, .unlimited);
    defer init.gpa.free(bytes);
    var decoded = try data.snapshot.decodeGraph(init.gpa, bytes);
    defer decoded.deinit();
    var statistics: data.snapshot.Statistics = .{};
    var normalized = try data.snapshot.canonicalizeMeasured(init.gpa, decoded.state, &statistics);
    defer normalized.deinit();
    const fields = std.meta.fields(data.graph.NodeTag);
    var counts = [_]usize{0} ** fields.len;
    for (decoded.state.nodes) |node| counts[@intFromEnum(std.meta.activeTag(node))] += 1;
    var blob_bytes: usize = 0;
    for (decoded.state.blobs) |blob| blob_bytes += blob.bytes.len;
    var output_buffer: [4096]u8 = undefined;
    var output = std.Io.File.stdout().writer(init.io, &output_buffer);
    try std.json.Stringify.value(.{
        .stateBytes = bytes.len,
        .nodes = decoded.state.nodes.len,
        .blobs = decoded.state.blobs.len,
        .blobBytes = blob_bytes,
        .canonicalReachable = statistics.nodes == decoded.state.nodes.len and
            normalized.state.blobs.len == decoded.state.blobs.len,
        .edges = statistics.edges,
        .frames = counts[0] + counts[1],
        .multiTemplates = counts[15],
        .cells = counts[13],
        .packages = counts[17],
        .regions = counts[6],
        .pending = counts[22],
        .obligations = counts[21],
        .handlers = counts[2],
        .attachments = counts[3],
        .environments = counts[4],
        .oneShots = counts[14],
        .resources = counts[19],
        .borrows = counts[20],
        .cleanup = counts[9] + counts[10] + counts[11] + counts[12] + counts[21],
        .nodeCounts = counts,
    }, .{}, &output.interface);
    try output.interface.writeByte('\n');
    try output.interface.flush();
}

pub fn main(original: std.process.Init) !void {
    var arena = std.heap.ArenaAllocator.init(original.gpa);
    defer arena.deinit();
    var init = original;
    init.gpa = arena.allocator();
    var arguments = std.process.Args.Iterator.init(init.minimal.args);
    defer arguments.deinit();
    _ = arguments.skip();
    const command = arguments.next() orelse return error.ExpectedCommand;
    const path = arguments.next() orelse return error.ExpectedPath;
    if (arguments.next() != null) return error.UnexpectedArgument;
    if (std.mem.eql(u8, command, "emit")) return emit(init, path);
    if (std.mem.eql(u8, command, "inspect-state")) return inspectState(init, path);
    return error.UnknownCommand;
}

test "minimal public facade has the exact direct Boundary image" {
    const a = std.testing.allocator;
    var b = source.Builder.init(a);
    defer b.deinit();
    var control = try boundary.program.compile(a, try direct(&b));
    defer control.deinit();
    var minimal = try agent.compile(a, MinimalSystem);
    defer minimal.deinit();
    const first = try data.image.identity(control.program);
    const second = try data.image.identity(minimal.program);
    try std.testing.expectEqualSlices(u8, &first, &second);
}

test "authoring and forwarded compiler observations do not change canonical BPI2" {
    const Trace = struct {
        authoring: [5]agent.CompileStage = undefined,
        authoring_count: usize = 0,
        compiler_count: usize = 0,
        fn author(context: *anyopaque, stage: agent.CompileStage) void {
            const self: *@This() = @ptrCast(@alignCast(context));
            if (self.authoring_count < self.authoring.len)
                self.authoring[self.authoring_count] = stage;
            self.authoring_count += 1;
        }
        fn compiler(context: *anyopaque, _: source.CompileStage) void {
            const self: *@This() = @ptrCast(@alignCast(context));
            self.compiler_count += 1;
        }
    };
    const a = std.testing.allocator;
    var trace: Trace = .{};
    var plain = try agent.compile(a, MinimalSystem);
    defer plain.deinit();
    var observed = try agent.compileObserved(a, MinimalSystem, .{
        .observer = .{ .context = &trace, .enter = Trace.author },
        .boundary_options = .{ .observer = .{ .context = &trace, .enter = Trace.compiler } },
    });
    defer observed.deinit();
    const left = try a.alloc(u8, try data.image.encodedLength(plain.program));
    defer a.free(left);
    const right = try a.alloc(u8, try data.image.encodedLength(observed.program));
    defer a.free(right);
    try std.testing.expectEqualSlices(u8, try plain.encode(a, left), try observed.encode(a, right));
    try std.testing.expectEqual(@as(usize, 5), trace.authoring_count);
    try std.testing.expectEqualSlices(agent.CompileStage, &.{
        .descriptors, .application_source, .agent_admission, .boundary_compile, .complete,
    }, &trace.authoring);
    try std.testing.expect(trace.compiler_count > 0);
}

test "retention and shared-scope consumers compile using public compositions" {
    const a = std.testing.allocator;
    var b = source.Builder.init(a);
    defer b.deinit();
    var output = try boundary.program.compile(a, try conversation(&b));
    defer output.deinit();
    try std.testing.expectEqual(@as(usize, 1), output.program.effects.len);
    var scope_builder = source.Builder.init(a);
    defer scope_builder.deinit();
    var shared = try boundary.program.compile(a, try sharing(&scope_builder, 8));
    defer shared.deinit();
    try std.testing.expectEqual(@as(usize, 1), shared.program.handlers.len);
}
