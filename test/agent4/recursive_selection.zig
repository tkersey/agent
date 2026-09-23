//! Candidate assessment recursively requests a contribution before comparison.
const std = @import("std");
const agent = @import("agent");
const boundary = @import("boundary");
const source = boundary.computation;
const hyper = boundary.library.hyper;
const Id = source.Id;
const State = struct { candidate: u64, nested: bool };
const Assessment = struct { established: bool, value: u64 };
const Row = struct { candidate: u64, assessment: Assessment };
const Result = union(enum(u32)) { selected: Row = 0, unresolved: agent.contracts.Vector(Row, 8) = 1 };
const Input = struct { minimize: bool, candidates: agent.contracts.Vector(u64, 8) };
const Types = struct { integer: Id, state: Id, task: Id, pair: hyper.Pair, read: Id };
fn types(b: *source.Builder) !Types {
    const cache = try b.specialization(Types, "test.recursive-selection/v1", .{});
    if (cache.cached) |t| return t;
    const integer = try b.scalar(u64);
    const state = try agent.contracts.schema(State, b);
    const read = try b.effect(.{ .identity = "selection/square", .payload = integer, .result = integer });
    const task = try b.reserveSchema();
    const pair = try hyper.pairWith(b, task, task, &.{ state, integer });
    try b.defineSchema(task, .{ .internal = .{ .computation = .{ .parameters = &.{}, .result = integer, .effects = &.{read}, .capture_bound = &.{ state, pair.peer_forward, pair.peer_backward } } } });
    return cache.finish(b, .{ .integer = integer, .state = state, .task = task, .pair = pair, .read = read });
}
fn field(b: *source.Builder, schema: Id, value: Id, index: Id) !Id {
    return b.primitive(schema, .field, &.{value}, index);
}
fn arithmetic(b: *source.Builder, opcode: boundary.data.program.Opcode, x: Id, y: Id) !Id {
    return b.value(.{ .schema = try b.scalar(u64), .expression = .{ .primitive = .{ .opcode = opcode, .operands = &.{ x, y }, .failures = &.{.{ .kind = .arithmetic_overflow, .value = try b.failureLiteral(try b.constant(void, {})) }} } } });
}
fn step(b: *source.Builder, q: hyper.Query, consumer: bool) !Id {
    const t = try types(b);
    const body = try b.declare(&.{}, t.integer, &.{t.read}, &.{});
    const candidate = try field(b, t.integer, q.state, 0);
    const next = try b.primitive(t.state, .product, &.{ candidate, try b.constant(bool, true) }, 0);
    const delayed = try b.variable(q.types.answer_backward);
    const task = try b.variable(t.task);
    const answer = try b.variable(t.integer);
    const value = try arithmetic(b, .integer_add, try b.reference(answer), if (consumer) try b.constant(u64, 5) else candidate);
    const nested = try b.bind(delayed, try q.ask(b, next), try b.bind(task, try hyper.force(b, try b.reference(delayed)), try b.bind(answer, try hyper.force(b, try b.reference(task)), try b.pure(value))));
    const contribution = if (Application.pure) try b.pure(try arithmetic(b, .integer_mul, candidate, candidate)) else try b.term(.{ .perform = .{ .effect = t.read, .payload = candidate } });
    try b.define(body, if (consumer) try b.term(.{ .conditional = .{ .condition = try field(b, try b.scalar(bool), q.state, 1), .when_true = contribution, .when_false = nested } }) else nested);
    const descriptor = try b.declare(&.{}, t.task, &.{}, &.{});
    try b.define(descriptor, try b.pure(try b.lambda(body, t.task)));
    return b.pure(try b.lambda(descriptor, q.types.answer_forward));
}
const Producer = struct {
    pub fn emit(b: *source.Builder, q: hyper.Query) !Id {
        return step(b, q, false);
    }
};
const Consumer = struct {
    pub fn emit(b: *source.Builder, q: hyper.Query) !Id {
        return step(b, q, true);
    }
};
fn producer(allocator: std.mem.Allocator) ![]u8 {
    var b = source.Builder.init(allocator);
    defer b.deinit();
    const t = try types(&b);
    const factory = try hyper.ana(&b, t.pair, t.state, Producer);
    var compiled = try source.component.compile(allocator, b.module(factory.function, try b.scalar(void)), .{
        .imports = &.{.{ .name = "read", .reference = .{ .kind = .effect, .id = t.read } }},
        .exports = &.{.{ .name = "create", .reference = .{ .kind = .function, .id = factory.function } }},
    });
    defer compiled.deinit();
    const bytes = try allocator.alloc(u8, try boundary.data.component.encodedLength(compiled.object));
    errdefer allocator.free(bytes);
    _ = try compiled.encode(allocator, bytes);
    return bytes;
}
const Application = struct {
    var object: []const u8 = &.{};
    var pure = false;
    var invalid = false;
    var smuggle = false;
    pub fn emit(c: agent.Context) !source.Module {
        const b = c.builder;
        const t = try types(b);
        try c.registry.classify(t.read, .read);
        const assessment = try c.schema(Assessment);
        const completion = try c.external("selection/complete", t.integer, try b.scalar(void), .write);
        const commit = try b.declare(&.{t.integer}, try b.scalar(void), &.{completion}, &.{});
        const write = try b.term(.{ .perform = .{ .effect = completion, .payload = try b.reference(b.parameter(commit, 0)) } });
        try c.registry.protectSite(commit, write, completion);
        try b.define(commit, write);
        const p = try agent.participant.declare(c, .{ .instance = "producer", .object = object, .entry = "create", .parameters = &.{t.state}, .result = t.pair.forward, .effects = &.{.{ .symbol = "read", .effect = t.read }} });
        const consumer = try hyper.ana(b, hyper.swap(t.pair), t.state, Consumer);
        const entry = try b.declare(&.{try c.schema(Input)}, try c.schema(Result), &.{ t.read, completion }, &.{});
        const input = try b.reference(b.parameter(entry, 0));
        const policy = try b.variable(try b.scalar(bool));
        const assessor = try b.declare(&.{t.integer}, assessment, &.{t.read}, &.{});
        const candidate = try b.reference(b.parameter(assessor, 0));
        const state = try b.primitive(t.state, .product, &.{ candidate, try b.constant(bool, false) }, 0);
        const left = try b.variable(t.pair.forward);
        const right = try b.variable(t.pair.backward);
        const peer = try b.declare(&.{}, t.pair.forward, &.{}, &.{});
        try b.define(peer, try b.pure(try b.reference(left)));
        const delayed = try b.variable(t.pair.answer_backward);
        const task = try b.variable(t.task);
        const value = try b.variable(t.integer);
        const established = try b.primitive(try b.scalar(bool), .less, &.{ try b.constant(u64, 0), candidate }, 0);
        const high = try b.pure(try b.primitive(assessment, .product, &.{ established, try b.reference(value) }, 0));
        const low = try b.pure(try b.primitive(assessment, .product, &.{ established, try arithmetic(b, .integer_sub, try b.constant(u64, 100), try b.reference(value)) }, 0));
        var observed = try b.term(.{ .conditional = .{ .condition = try b.reference(policy), .when_true = low, .when_false = high } });
        if (smuggle) {
            // A callable alias cannot launder actual completion authority.
            const f = try b.declare(&.{}, assessment, &.{completion}, &.{});
            try b.define(f, try b.bind(try b.variable(try b.scalar(void)), try b.term(.{ .call = .{ .function = commit, .arguments = &.{candidate} } }), observed));
            const signature = try b.schema(.{ .internal = .{ .computation = .{ .parameters = &.{}, .result = assessment, .effects = &.{completion}, .capture_bound = &.{ t.integer, try b.scalar(bool) } } } });
            observed = try b.term(.{ .apply = .{ .computation = try b.lambda(f, signature), .arguments = &.{} } });
            b.functions.items[@intCast(assessor)].effects = try b.allocator().dupe(Id, &.{ t.read, completion });
        }
        const run = try b.bind(delayed, try hyper.invoke(b, try b.reference(right), try b.lambda(peer, t.pair.peer_forward)), try b.bind(task, try hyper.force(b, try b.reference(delayed)), try b.bind(value, try hyper.force(b, try b.reference(task)), observed)));
        try b.define(assessor, try b.bind(left, try b.term(.{ .call = .{ .function = p, .arguments = &.{state} } }), try b.bind(right, try hyper.start(b, consumer, state), run)));
        const shape = try agent.deliberation.selectionTypes(b, t.integer, assessment, 8);
        const choose = try chooser(b, shape);
        const d = try agent.deliberation.selectSequential(c, .{ .candidate = t.integer, .assessment = assessment, .maximum = 8, .assess = assessor, .choose = choose, .allowed = if (smuggle) &.{ t.read, completion } else &.{t.read}, .failure = try b.constant(void, {}) });
        const selection = try b.variable(d.types.result);
        const selected = try b.variable(d.types.assessed);
        const completed = try b.bind(try b.variable(try b.scalar(void)), try b.term(.{ .call = .{ .function = commit, .arguments = &.{try field(b, t.integer, try b.reference(selected), 0)} } }), try b.pure(try b.reference(selection)));
        const done = try b.term(.{ .match_sum = .{ .value = try b.reference(selection), .cases = &.{ .{ .variable = selected, .body = completed }, .{ .variable = try b.variable(d.types.assessments), .body = try b.pure(try b.reference(selection)) } } } });
        try b.define(entry, try b.bind(policy, try b.pure(try field(b, try b.scalar(bool), input, 0)), try b.bind(selection, try b.term(.{ .call = .{ .function = d.function, .arguments = &.{try field(b, d.types.candidates, input, 1)} } }), done)));
        return b.module(entry, try b.scalar(void));
    }
};
fn chooser(b: *source.Builder, d: agent.deliberation.SelectionTypes) !Id {
    const f = try b.declare(&.{d.assessments}, d.choice, &.{}, &.{});
    const rows = try b.reference(b.parameter(f, 0));
    const integer = try b.scalar(u64);
    const optional = try b.schema(.{ .sum = &.{ try b.scalar(void), d.assessed } });
    var values: [2]Id = undefined;
    var established: [2]Id = undefined;
    for (&values, 0..) |*value, index| {
        const found = try b.primitive(optional, .sequence_get, &.{ rows, try b.constant(u64, index) }, 0);
        const row = try b.value(.{ .schema = d.assessed, .expression = .{ .primitive = .{ .opcode = .variant_payload, .operands = &.{found}, .immediate = 1, .failures = &.{.{ .kind = .invalid_variant, .value = try b.failureLiteral(try b.constant(void, {})) }} } } });
        value.* = try field(b, integer, try field(b, try agent.contracts.schema(Assessment, b), row, 1), 1);
        established[index] = try field(b, try b.scalar(bool), try field(b, try agent.contracts.schema(Assessment, b), row, 1), 0);
    }
    const index = if (Application.invalid) try b.constant(u64, 99) else try b.primitive(integer, .select, &.{ try b.primitive(try b.scalar(bool), .less, &values, 0), try b.constant(u64, 1), try b.constant(u64, 0) }, 0);
    const unresolved = try b.pure(try b.primitive(d.choice, .variant, &.{try b.constant(void, {})}, 1));
    var chosen = try b.pure(try b.primitive(d.choice, .variant, &.{index}, 0));
    for (established) |condition| chosen = try b.term(.{ .conditional = .{ .condition = condition, .when_true = chosen, .when_false = unresolved } });
    const count = try b.primitive(integer, .sequence_length, &.{rows}, 0);
    try b.define(f, try b.term(.{ .conditional = .{ .condition = try b.primitive(try b.scalar(bool), .equal, &.{ count, try b.constant(u64, 2) }, 0), .when_true = chosen, .when_false = unresolved } }));
    return f;
}
const System = agent.system(.{ .InitialArgs = Input, .Result = Result, .Failure = void, .application = Application });
pub fn main(init: std.process.Init) !void {
    var args = init.minimal.args.iterate();
    _ = args.next();
    const mode = args.next() orelse return error.MissingMode;
    var bytes: []const u8 = undefined;
    if (std.mem.eql(u8, mode, "producer")) bytes = try producer(init.gpa) else {
        const path = args.next() orelse return error.ExpectedObject;
        Application.object = try std.Io.Dir.cwd().readFileAlloc(init.io, path, init.gpa, .limited(1 << 20));
        defer init.gpa.free(Application.object);
        Application.pure = std.mem.eql(u8, mode, "pure");
        Application.invalid = std.mem.eql(u8, mode, "invalid");
        Application.smuggle = std.mem.eql(u8, mode, "smuggle");
        if (!Application.pure and !Application.invalid and !Application.smuggle and !std.mem.eql(u8, mode, "link")) return error.InvalidMode;
        var compiled = try agent.compile(init.gpa, System);
        defer compiled.deinit();
        bytes = try init.gpa.alloc(u8, try boundary.data.program_image.encodedLength(compiled.program));
        _ = try compiled.encode(init.gpa, @constCast(bytes));
    }
    defer init.gpa.free(bytes);
    var buffer: [4096]u8 = undefined;
    var writer = std.Io.File.stdout().writer(init.io, &buffer);
    try writer.interface.writeAll(bytes);
    try writer.interface.flush();
}
