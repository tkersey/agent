//! Custody witnesses; all control executes as ordinary Boundary program data.
const std = @import("std");
const boundary = @import("boundary");
const dialogue = @import("agent").dialogue;
const inquiry = @import("agent").inquiry;
const source = boundary.computation;
const Id = source.Id;
const Builder = source.Builder;

pub const Mode = enum {
    owned,
    composition,
    followup,
    duplicate_resume,
    duplicate_dispose,
    duplicate_queue,
    illicit_clone,
};

const Witness = struct {
    b: *Builder,
    d: dialogue.Dialogue,
    integer: Id,
    unit: Id,
    model: Id,
    cleanup: Id,
    experiment: Id,
    queue: Id,
    effects: []const Id,
    mode: Mode,

    fn ref(w: Witness, variable: Id) !Id {
        return w.b.reference(variable);
    }

    fn call(w: Witness, function: Id, arguments: []const Id) !Id {
        return w.b.term(.{ .call = .{ .function = function, .arguments = arguments } });
    }

    fn perform(w: Witness, effect: Id, payload: Id) !Id {
        return w.b.term(.{ .perform = .{ .effect = effect, .payload = payload } });
    }

    fn add(w: Witness, a: Id, b: Id) !Id {
        return w.b.value(.{ .schema = w.integer, .expression = .{ .primitive = .{
            .opcode = .integer_add,
            .operands = &.{ a, b },
            .failures = &.{.{ .kind = .arithmetic_overflow, .value = try w.b.failureLiteral(try w.b.constant(void, {})) }},
        } } });
    }

    fn lambda(w: Witness, function: Id, parameters: []const Id, result: Id, effects: []const Id, captures: []const Id) !Id {
        return w.b.lambda(function, try w.b.schema(.{ .internal = .{ .computation = .{
            .parameters = parameters,
            .result = result,
            .effects = effects,
            .capture_bound = captures,
        } } }));
    }

    // One body, parameterized by a captured local. Each occurrence creates its
    // own real protection obligation and captures the rest after the offer.
    fn investigator(w: Witness) !Id {
        const b = w.b;
        const effects = &.{ w.model, w.cleanup, w.d.effect };
        const start = try b.declare(&.{ w.d.capability, w.integer }, w.integer, effects, &.{});
        const body = try b.declare(&.{}, w.integer, &.{ w.model, w.d.effect }, &.{});
        const local = try w.ref(b.parameter(start, 1));
        const evidence = try b.variable(w.integer);
        const response = try b.variable(w.integer);
        const sum = try w.add(local, try w.ref(evidence));
        const non_tail = try w.add(sum, try w.ref(response));
        var finish = try b.pure(try w.add(non_tail, non_tail));
        if (w.mode == .followup) {
            const next = try b.variable(w.integer);
            const result = try w.add(non_tail, try w.ref(next));
            finish = try b.bind(next, try dialogue.offer(b, w.d, try w.ref(b.parameter(start, 0)), sum), try b.pure(try w.add(result, result)));
        }
        const modeled = try b.bind(response, try w.perform(w.model, sum), finish);
        try b.define(body, try b.bind(evidence, try dialogue.offer(b, w.d, try w.ref(b.parameter(start, 0)), local), modeled));
        const exit = try boundary.library.cleanup.exitInfo(b, w.unit);
        const cleanup = try b.declare(&.{exit}, w.unit, &.{w.cleanup}, &.{});
        try b.define(cleanup, try w.perform(w.cleanup, local));
        try b.define(start, try b.term(.{ .protect = .{
            .body = try w.lambda(body, &.{}, w.integer, &.{ w.model, w.d.effect }, &.{ w.integer, w.d.capability }),
            .cleanup = try w.lambda(cleanup, &.{exit}, w.unit, &.{w.cleanup}, &.{w.integer}),
        } }));
        return w.lambda(start, &.{ w.d.capability, w.integer }, w.integer, effects, &.{});
    }

    fn consume(w: Witness, function: Id, step: Id, rest: Id, evidence: Id, total: Id) !Id {
        const b = w.b;
        const done = try b.variable(w.integer);
        const waiting = try b.variable(w.d.awaiting);
        const demand = try b.variable(w.integer);
        const package = try b.variable(w.d.package);
        const resumed = try b.variable(w.d.answer);
        const ignored = try b.variable(w.unit);
        const rest_value = try w.ref(rest);
        const next_total = try w.add(total, try w.ref(done));
        const completed = try w.call(function, &.{ rest_value, evidence, next_total });
        const next_queue = try b.primitive(w.queue, .sequence_append, &.{ rest_value, try w.ref(resumed) }, 0);
        var resume_term = try dialogue.resumeWith(b, w.d, try w.ref(package), evidence);
        if (w.mode == .illicit_clone) {
            var signature = b.schemas.items[@intCast(w.d.resumption)].internal.resumption;
            signature.use = .multi;
            const template = try b.schema(.{ .internal = .{ .resumption = signature } });
            const owned = try b.primitive(w.d.resumption, .unpack, &.{try w.ref(package)}, 0);
            resume_term = try b.term(.{ .resume_value = .{
                .resumption = try b.cloneResumption(owned, template),
                .argument = evidence,
            } });
        }
        var advance = try b.bind(resumed, resume_term, try w.call(function, &.{ next_queue, evidence, total }));
        if (w.mode == .duplicate_resume) {
            advance = try b.bind(try b.variable(w.d.answer), try dialogue.resumeWith(b, w.d, try w.ref(package), evidence), advance);
        }
        var retire = try b.bind(ignored, try dialogue.dispose(b, w.d, try w.ref(package)), try w.call(function, &.{ rest_value, evidence, total }));
        if (w.mode == .duplicate_dispose) {
            retire = try b.bind(try b.variable(w.unit), try dialogue.dispose(b, w.d, try w.ref(package)), retire);
        }
        const retiring = try b.primitive(try b.scalar(bool), .equal, &.{ try w.ref(demand), try b.constant(u64, 30) }, 0);
        const select = try b.term(.{ .conditional = .{
            .condition = retiring,
            .when_true = retire,
            .when_false = advance,
        } });
        const unpack = try b.term(.{ .unpack_product = .{
            .value = try w.ref(waiting),
            .variables = &.{ demand, package },
            .body = select,
        } });
        return b.term(.{ .match_sum = .{
            .value = step,
            .cases = &.{
                .{ .variable = done, .body = completed },
                .{ .variable = waiting, .body = unpack },
            },
        } });
    }

    // sequence_pop consumes the queue, and unpack consumes its product. No
    // projection, policy calculation or external payload copies an owner.
    fn drain(w: Witness) !Id {
        const b = w.b;
        const function = try b.declare(&.{ w.queue, w.integer, w.integer }, w.integer, w.effects, &.{});
        const popped = try b.schema(.{ .product = &.{ w.d.answer, w.queue } });
        const optional = try b.schema(.{ .sum = &.{ w.unit, popped } });
        const empty = try b.variable(w.unit);
        const ready = try b.variable(popped);
        const current = try b.variable(w.d.answer);
        const rest = try b.variable(w.queue);
        const evidence = try w.ref(b.parameter(function, 1));
        const total = try w.ref(b.parameter(function, 2));
        const unpack = try b.term(.{ .unpack_product = .{
            .value = try w.ref(ready),
            .variables = &.{ current, rest },
            .body = try w.consume(function, try w.ref(current), rest, evidence, total),
        } });
        const pop = try b.primitive(optional, .sequence_pop, &.{try w.ref(b.parameter(function, 0))}, 0);
        try b.define(function, try b.term(.{ .match_sum = .{
            .value = pop,
            .cases = &.{
                .{ .variable = empty, .body = try b.pure(total) },
                .{ .variable = ready, .body = unpack },
            },
        } }));
        return function;
    }

    fn compositionEntry(w: Witness, definition: inquiry.Definition) !source.Module {
        const b = w.b;
        const t = definition.types;
        const f = try b.declare(&.{}, t.findings, w.effects, &.{});
        const body = try w.investigator();
        const state = try b.variable(t.state);
        const projected = try b.variable(t.projected);
        const preserved = try b.variable(t.state);
        const views = try b.variable(t.views);
        const evidence = try b.variable(w.integer);
        const delivered = try b.variable(t.state);
        const recipients = try b.primitive(t.ids, .sequence, &.{ try b.constant(u64, 1), try b.constant(u64, 3) }, 0);
        const finished = if (w.mode == .followup) try w.followup(definition, delivered) else try w.call(definition.finish, &.{try w.ref(delivered)});
        const fanout = try b.bind(delivered, try w.call(definition.distribute, &.{ try w.ref(preserved), recipients, try w.ref(evidence) }), finished);
        const acquire = try b.bind(evidence, try w.perform(w.experiment, try b.constant(u64, 7)), fanout);
        const unpack = try b.term(.{ .unpack_product = .{
            .value = try w.ref(projected),
            .variables = &.{ preserved, views },
            .body = acquire,
        } });
        var term = try b.bind(projected, try w.call(definition.project, &.{try w.ref(state)}), unpack);
        const locals = [_]u64{ 10, 30, 20 };
        var successor = state;
        var i: usize = locals.len;
        while (i > 0) {
            i -= 1;
            const before = try b.variable(t.state);
            const answer = try b.variable(w.d.answer);
            const parked = try b.bind(successor, try w.call(definition.park, &.{ try w.ref(before), try b.constant(u64, i + 1), try w.ref(answer) }), term);
            term = try b.bind(answer, try dialogue.start(b, w.d, body, &.{try b.constant(u64, locals[i])}), parked);
            successor = before;
        }
        try b.define(f, try b.bind(successor, try b.pure(try inquiry.empty(b, definition)), term));
        return b.module(f, w.unit);
    }

    fn followup(w: Witness, definition: inquiry.Definition, delivered: Id) !Id {
        const b = w.b;
        const t = definition.types;
        const unchanged = try b.variable(t.state);
        const retired = try b.variable(t.state);
        const completed = try b.variable(t.state);
        const stale_ids = try b.primitive(t.ids, .sequence, &.{ try b.constant(u64, 1), try b.constant(u64, 3) }, 0);
        const new_ids = try b.primitive(t.ids, .sequence, &.{ try b.constant(u64, 4), try b.constant(u64, 5) }, 0);
        const retired_ids = try b.primitive(t.ids, .sequence, &.{try b.constant(u64, 2)}, 0);
        const finish = try w.call(definition.finish, &.{try w.ref(completed)});
        const second = try b.bind(completed, try w.call(definition.distribute, &.{ try w.ref(retired), new_ids, try b.constant(u64, 9) }), finish);
        const dispose = try b.bind(retired, try w.call(definition.retire, &.{ try w.ref(unchanged), retired_ids }), second);
        return b.bind(unchanged, try w.call(definition.distribute, &.{ try w.ref(delivered), stale_ids, try b.constant(u64, 99) }), dispose);
    }

    fn entry(w: Witness) !source.Module {
        const b = w.b;
        const body = try w.investigator();
        const drain_fn = try w.drain();
        const entry_fn = try b.declare(&.{}, w.integer, w.effects, &.{});
        const evidence = try b.variable(w.integer);
        const a = try b.variable(w.d.answer);
        const c = try b.variable(w.d.answer);
        const other = try b.variable(w.d.answer);
        var queue = try b.primitive(w.queue, .sequence, &.{}, 0);
        for ([_]Id{ a, c, other }) |item|
            queue = try b.primitive(w.queue, .sequence_append, &.{ queue, try w.ref(item) }, 0);
        if (w.mode == .duplicate_queue)
            queue = try b.primitive(w.queue, .sequence_append, &.{ queue, try w.ref(a) }, 0);
        var term = try b.bind(evidence, try w.perform(w.experiment, try b.constant(u64, 7)), try w.call(drain_fn, &.{ queue, try w.ref(evidence), try b.constant(u64, 0) }));
        const variables = [_]Id{ a, c, other };
        const locals = [_]u64{ 10, 30, 20 };
        var i: usize = variables.len;
        while (i > 0) {
            i -= 1;
            term = try b.bind(variables[i], try dialogue.start(b, w.d, body, &.{try b.constant(u64, locals[i])}), term);
        }
        try b.define(entry_fn, term);
        return b.module(entry_fn, w.unit);
    }
};

pub fn build(b: *Builder, mode: Mode) !source.Module {
    const integer = try b.scalar(u64);
    const unit = try b.scalar(void);
    const experiment = try b.effect(.{ .identity = "agent.probe.inquiry.experiment.v1", .payload = integer, .result = integer });
    const model = try b.effect(.{ .identity = "agent.probe.inquiry.model.v1", .payload = integer, .result = integer });
    const cleanup = try b.effect(.{ .identity = "agent.probe.inquiry.cleanup.v1", .payload = integer, .result = unit });
    const effects = try b.allocator().dupe(Id, &.{ experiment, model, cleanup });
    const scope: dialogue.Scope = .{
        .captures = &.{ integer, unit },
        .residual = .{ .effects = &.{ model, cleanup } },
    };
    const definition = if (mode == .composition or mode == .followup) try inquiry.define(b, .{
        .identity = "agent.probe.inquiry.need.v1",
        .demand = integer,
        .reply = integer,
        .finding = integer,
        .failure = try b.constant(void, {}),
        .scope = scope,
    }) else null;
    const d = if (definition) |value| value.dialogue else try dialogue.define(b, "agent.probe.inquiry.need.v1", integer, integer, integer, scope);
    const w: Witness = .{ .b = b, .d = d, .integer = integer, .unit = unit, .model = model, .cleanup = cleanup, .experiment = experiment, .queue = try b.schema(.{ .seq = d.answer }), .effects = effects, .mode = mode };
    return if (definition) |value| w.compositionEntry(value) else w.entry();
}

test "three protected futures compile under unchanged Boundary ownership" {
    for ([_]Mode{ .owned, .composition, .followup }) |mode| {
        var b = Builder.init(std.testing.allocator);
        defer b.deinit();
        var compiled = try boundary.program.compile(std.testing.allocator, try build(&b, mode));
        defer compiled.deinit();
        try std.testing.expect(compiled.program.handlers.len > 0);
    }
}

test "inquiry custody rejects double resume, double disposal and queue duplication" {
    for ([_]Mode{ .duplicate_resume, .duplicate_dispose, .duplicate_queue, .illicit_clone }) |mode| {
        var b = Builder.init(std.testing.allocator);
        defer b.deinit();
        const expected = if (mode == .illicit_clone) error.InvalidOwnership else error.UnavailableSlot;
        try std.testing.expectError(expected, boundary.program.compile(std.testing.allocator, try build(&b, mode)));
    }
}

pub fn main(init: std.process.Init) !void {
    var args = init.minimal.args.iterate();
    _ = args.next();
    const mode = std.meta.stringToEnum(Mode, args.next() orelse "owned") orelse
        return error.UnknownProbe;
    if (args.next() != null) return error.UnknownProbe;
    var b = Builder.init(init.gpa);
    defer b.deinit();
    var compiled = try boundary.program.compile(init.gpa, try build(&b, mode));
    defer compiled.deinit();
    const bytes = try init.gpa.alloc(u8, try boundary.data.program_image.encodedLength(compiled.program));
    defer init.gpa.free(bytes);
    _ = try compiled.encode(init.gpa, bytes);
    var buffer: [4096]u8 = undefined;
    var out = std.Io.File.stdout().writer(init.io, &buffer);
    try out.interface.writeAll(bytes);
    try out.interface.flush();
}
