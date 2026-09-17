//! Reuse immutable BMO1 objects; compile only the Agent caller when requested.
const std = @import("std");
const agent = @import("agent");
const boundary = @import("boundary");
const data = boundary.data_v2;
const ir = data.activation;
const source = boundary.source;
const examples = source.component_examples;

const Observed = struct {
    checks: usize = 0,
    lowerings: usize = 0,
    fn enter(context: *anyopaque, stage: source.CompileStage) void {
        const self: *@This() = @ptrCast(@alignCast(context));
        switch (stage) {
            .source_check => self.checks += 1,
            .lowering => self.lowerings += 1,
            else => {},
        }
    }
};

const Tool = struct {
    var object: []const u8 = &.{};
    pub fn declare(c: agent.Context) !agent.tools.Descriptor {
        const unit = try c.schema(void);
        const integer = try c.schema(u64);
        const read = try c.builder.effect(.{ .identity = "component/counter", .payload = unit, .result = integer, .external = false });
        try c.registry.classify(read, .internal);
        const release = try c.external("component/release", integer, unit, .read);
        return agent.tools.declareCompiled(c, .{
            .instance = "counter-tool",
            .object = object,
            .entry = "inspect",
            .identity = "agent.tool.component-counter.v1",
            .payload = unit,
            .result = integer,
            .effects = &.{ .{ .symbol = "read", .effect = read }, .{ .symbol = "release", .effect = release } },
            .name = "counter",
            .description = "Run the compiled effectful counter composition",
        });
    }
};
const Application = struct {
    var increment: u64 = 0;
    pub fn emit(c: agent.Context) !source.Module {
        const tool = try c.catalogs.tool("counter");
        const b = c.builder;
        const integer = try c.schema(u64);
        const entry = try b.declare(&.{integer}, integer, b.functions.items[@intCast(tool.implementation.local)].effects, &.{});
        const result = try b.variable(integer);
        const failure = try b.failureLiteral(try b.constant(void, {}));
        var sum = try b.reference(result);
        for ([_]source.Id{ try b.reference(b.parameter(entry, 0)), try b.constant(u64, increment) }) |value| {
            sum = try b.value(.{ .schema = integer, .expression = .{ .primitive = .{
                .opcode = .integer_add,
                .operands = &.{ sum, value },
                .failures = &.{.{ .kind = .arithmetic_overflow, .value = failure }},
            } } });
        }
        try b.define(entry, try b.bind(result, try agent.tools.perform(c, tool, try b.constant(void, {})), try b.pure(sum)));
        return b.module(entry, try b.scalar(void));
    }
};
const System = agent.system(.{ .InitialArgs = u64, .Result = u64, .Failure = void, .tools = .{Tool}, .application = Application });

fn effect(program: ir.Program, name: []const u8) !source.Id {
    var found: ?source.Id = null;
    for (program.effects, 0..) |value, id| if (std.mem.eql(u8, value.identity, name)) {
        if (found != null) return error.AmbiguousFixtureEffect;
        found = id;
    };
    return found orelse error.MissingFixtureEffect;
}

/// A first-order arity adapter preserves every declared residual effect. It
/// neither interprets code nor revisits any component's authoring representation.
fn toolObject(a: std.mem.Allocator, program: ir.Program) ![]u8 {
    const root = program.functions[@intCast(program.roots.entry)];
    if (root.inputs.len != 0 or program.schemas[@intCast(program.roots.failure)] != .unit)
        return error.InvalidFixtureInterface;
    const functions = try a.alloc(ir.Function, program.functions.len + 1);
    defer a.free(functions);
    @memcpy(functions[0..program.functions.len], program.functions);
    const blocks = try a.alloc(ir.Block, program.blocks.len + 2);
    defer a.free(blocks);
    @memcpy(blocks[0..program.blocks.len], program.blocks);
    const id = program.functions.len;
    const at = program.blocks.len;
    functions[id] = .{ .entry = at, .inputs = &.{0}, .layout = .{ .slots = &.{ program.roots.failure, root.result } }, .result = root.result, .effects = root.effects };
    blocks[at] = .{ .function = id, .instructions = &.{}, .terminator = .{ .call = .{
        .function = program.roots.entry,
        .arguments = &.{},
        .next = .{ .block = at + 1, .assignments = &.{.{ .destination = 1, .source = .returned }} },
    } } };
    blocks[at + 1] = .{ .function = id, .instructions = &.{}, .terminator = .{ .return_value = 1 } };
    var adapted = program;
    adapted.functions = functions;
    adapted.blocks = blocks;
    adapted.roots.entry = id;
    const object: data.component.Object = .{
        .program = adapted,
        .imports = &.{ .{ .name = "read", .reference = .{ .kind = .effect, .id = try effect(program, "component/counter") } }, .{ .name = "release", .reference = .{ .kind = .effect, .id = try effect(program, "component/release") } } },
        .exports = &.{.{ .name = "inspect", .reference = .{ .kind = .function, .id = id } }},
    };
    const bytes = try a.alloc(u8, try data.component.encodedLength(object));
    errdefer a.free(bytes);
    _ = try data.component.encode(a, object, bytes);
    return bytes;
}

fn write(init: std.process.Init, bytes: []const u8) !void {
    var buffer: [4096]u8 = undefined;
    var output = std.Io.File.stdout().writer(init.io, &buffer);
    try output.interface.writeAll(bytes);
    try output.interface.flush();
}

pub fn main(init: std.process.Init) !void {
    var observed: Observed = .{};
    defer std.debug.print("{{\"sourceChecks\":{d},\"lowerings\":{d}}}\n", .{ observed.checks, observed.lowerings });
    var args = std.process.Args.Iterator.init(init.minimal.args);
    _ = args.next();
    const mode = args.next() orelse return error.ExpectedMode;
    if (args.next() != null) return error.UnexpectedArgument;
    const doubled = std.mem.eql(u8, mode, "double");
    const agent_mode = std.mem.eql(u8, mode, "agent") or std.mem.eql(u8, mode, "agent-next");
    if (!doubled and !agent_mode and !std.mem.eql(u8, mode, "standalone"))
        return error.InvalidMode;
    const names = [_][]const u8{ "call", "state", "suspend", "double" };
    var objects: [4][]u8 = undefined;
    var instances: [4]data.linker.Instance = undefined;
    var count: usize = 0;
    defer for (objects[0..count]) |bytes| init.gpa.free(bytes);
    for (names[0..@as(usize, if (doubled) 4 else 3)], 0..) |name, i| {
        var filename: [64]u8 = undefined;
        const path = try std.fmt.bufPrint(&filename, "{s}.bmo1", .{name});
        objects[i] = try std.Io.Dir.cwd().readFileAlloc(init.io, path, init.gpa, .limited(64 << 20));
        count += 1;
        instances[i] = .{ .key = name, .object = objects[i] };
    }
    var linked = try data.linker.link(init.gpa, instances[0..count], if (doubled) &examples.double_bindings else &examples.bindings, .{ .instance = if (doubled) "double" else "suspend", .symbol = "main" });
    defer linked.deinit();
    if (agent_mode) {
        const object = try toolObject(init.gpa, linked.program);
        defer init.gpa.free(object);
        Tool.object = object;
        Application.increment = @intFromBool(std.mem.eql(u8, mode, "agent-next"));
        var compiled = try agent.compileObserved(init.gpa, System, .{
            .boundary_options = .{ .observer = .{
                .context = &observed,
                .enter = Observed.enter,
            } },
        });
        defer compiled.deinit();
        const image = try init.gpa.alloc(u8, try data.program_image.encodedLength(compiled.program));
        defer init.gpa.free(image);
        _ = try compiled.encode(init.gpa, image);
        return write(init, image);
    }
    const image = try init.gpa.alloc(u8, try data.program_image.encodedLength(linked.program));
    defer init.gpa.free(image);
    _ = try linked.encode(init.gpa, image);
    try write(init, image);
}
