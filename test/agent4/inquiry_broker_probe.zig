//! Independent numerical consumer of the public inquiry composition.
const std = @import("std");
const boundary = @import("boundary");
const agent = @import("agent");
const broker = agent.inquiry.broker;
const source = boundary.computation;
const Id = source.Id;
const Builder = source.Builder;

pub fn build(b: *Builder) !source.Module {
    const unit = try b.scalar(void);
    const integer = try b.scalar(u64);
    const boolean = try b.scalar(bool);
    const demand = try b.schema(.{ .product = &.{ integer, integer, boolean, integer, integer, boolean } });
    const demands = try b.schema(.{ .vector = .{ .element = demand, .maximum = 8 } });
    const key = try b.schema(.{ .product = &.{ integer, integer } });
    const model_payload = try b.schema(.{ .product = &.{ integer, integer } });
    const model = try b.effect(.{ .identity = "agent.probe.broker.model.v1", .payload = model_payload, .result = integer });
    const spec: broker.Spec = .{
        .identity = "agent.probe.broker",
        .subject = integer,
        .demand = demand,
        .key = key,
        .observation = integer,
        .finding = integer,
        .policy = integer,
        .failure = try b.constant(void, {}),
        .scope = .{ .captures = &.{ integer, demand }, .residual = .{ .effects = &.{model} } },
    };
    const d = try broker.define(b, spec);
    const e: Emit = .{ .b = b, .d = d, .unit = unit, .integer = integer, .boolean = boolean, .demand = demand, .demands = demands, .key = key, .model = model, .model_payload = model_payload };
    const run = try broker.implement(b, spec, d, .{
        .admit = try e.admission(),
        .select = try e.selection(spec),
        .finish = try e.finish(),
    });
    const seed = try e.seed(try e.investigator());
    const entry = try b.declare(&.{ integer, demands, integer, boolean, integer }, d.types.outcome, &.{ model, d.experiment }, &.{});
    const state = try b.variable(d.custody.types.state);
    try b.define(entry, try b.bind(state, try e.call(seed, &.{ try e.p(entry, 1), try agent.inquiry.empty(b, d.custody), try b.constant(u64, 1) }), try e.call(run, &.{ try b.reference(state), try e.p(entry, 0), try e.p(entry, 2), try e.p(entry, 3), try e.p(entry, 4) })));
    return b.module(entry, unit);
}

const Emit = struct {
    b: *Builder,
    d: broker.Definition,
    unit: Id,
    integer: Id,
    boolean: Id,
    demand: Id,
    demands: Id,
    key: Id,
    model: Id,
    model_payload: Id,

    fn p(e: Emit, f: Id, i: usize) !Id {
        return e.b.reference(e.b.parameter(f, i));
    }
    fn call(e: Emit, f: Id, args: []const Id) !Id {
        return e.b.term(.{ .call = .{ .function = f, .arguments = args } });
    }
    fn field(e: Emit, t: Id, v: Id, i: u64) !Id {
        return e.b.primitive(t, .field, &.{v}, i);
    }
    fn add(e: Emit, a: Id, b: Id) !Id {
        return e.b.value(.{ .schema = e.integer, .expression = .{ .primitive = .{
            .opcode = .integer_add,
            .operands = &.{ a, b },
            .failures = &.{.{ .kind = .arithmetic_overflow, .value = try e.b.failureLiteral(try e.b.constant(void, {})) }},
        } } });
    }
    fn admission(e: Emit) !Id {
        const b = e.b;
        const t = e.d.types;
        const f = try b.declare(&.{ e.integer, e.demand }, t.admission, &.{}, &.{});
        const demand = try e.p(f, 1);
        const input = try e.field(e.integer, demand, 0);
        const key = try b.primitive(e.key, .product, &.{ try e.p(f, 0), input }, 0);
        const accepted = try b.primitive(t.admitted, .product, &.{ key, try e.field(e.boolean, demand, 2), try e.field(e.integer, demand, 3), try e.field(e.integer, demand, 4) }, 0);
        try b.define(f, try b.term(.{ .conditional = .{
            .condition = try b.primitive(e.boolean, .equal, &.{ input, try b.constant(u64, 0) }, 0),
            .when_true = try b.pure(try b.primitive(t.admission, .variant, &.{try b.constant(void, {})}, 0)),
            .when_false = try b.pure(try b.primitive(t.admission, .variant, &.{accepted}, 1)),
        } }));
        return f;
    }
    fn finish(e: Emit) !Id {
        const f = try e.b.declare(&.{ e.integer, e.d.custody.types.findings }, e.boolean, &.{}, &.{});
        try e.b.define(f, try e.b.pure(try e.b.constant(bool, false)));
        return f;
    }
    fn selection(e: Emit, spec: broker.Spec) !Id {
        const b = e.b;
        const t = e.d.types;
        const discriminates = try b.declare(&.{ e.demand, e.demand }, e.boolean, &.{}, &.{});
        const equal = try b.primitive(e.boolean, .equal, &.{ try e.field(e.integer, try e.p(discriminates, 0), 1), try e.field(e.integer, try e.p(discriminates, 1), 1) }, 0);
        try b.define(discriminates, try b.pure(try b.primitive(e.boolean, .boolean_not, &.{equal}, 0)));
        const normal = try broker.defaultSelection(b, spec, e.d, discriminates);
        const f = try b.declare(&.{ e.integer, e.integer, t.eligible_list, e.d.custody.types.findings }, e.integer, &.{}, &.{});
        try b.define(f, try b.term(.{ .conditional = .{
            .condition = try b.primitive(e.boolean, .equal, &.{ try e.p(f, 1), try b.constant(u64, 0) }, 0),
            .when_true = try e.call(normal, &.{ try e.p(f, 0), try e.p(f, 1), try e.p(f, 2), try e.p(f, 3) }),
            .when_false = try b.pure(try e.p(f, 1)),
        } }));
        return f;
    }
    fn investigator(e: Emit) !Id {
        const b = e.b;
        const d = e.d.custody.dialogue;
        const f = try b.declare(&.{ d.capability, e.demand }, e.integer, &.{ e.model, d.effect }, &.{});
        const reply = try b.variable(d.input);
        const again = try b.variable(d.input);
        const first = try b.variable(e.integer);
        const second = try b.variable(e.integer);
        const offer = try agent.inquiry.need(b, e.d.custody, try e.p(f, 0), try e.p(f, 1));
        const repeated = try b.bind(again, offer, try b.bind(second, try e.interpret(f, again), try b.pure(try e.add(try b.reference(first), try b.reference(second)))));
        const done = try b.term(.{ .conditional = .{
            .condition = try e.field(e.boolean, try e.p(f, 1), 5),
            .when_true = repeated,
            .when_false = try b.pure(try b.reference(first)),
        } });
        try b.define(f, try b.bind(reply, offer, try b.bind(first, try e.interpret(f, reply), done)));
        return b.lambda(f, try b.schema(.{ .internal = .{ .computation = .{
            .parameters = &.{ d.capability, e.demand },
            .result = e.integer,
            .effects = &.{ e.model, d.effect },
        } } }));
    }
    fn interpret(e: Emit, f: Id, reply: Id) !Id {
        const b = e.b;
        const evidence = try b.variable(e.d.types.record);
        const denied = try b.variable(e.unit);
        const inconclusive = try b.variable(e.unit);
        const cached = try b.variable(e.d.types.record);
        return b.term(.{ .match_sum = .{
            .value = try b.reference(reply),
            .cases = &.{
                .{ .variable = evidence, .body = try e.observed(f, try b.reference(evidence)) },
                .{ .variable = denied, .body = try b.pure(try b.constant(u64, 900)) },
                .{ .variable = inconclusive, .body = try b.pure(try b.constant(u64, 901)) },
                .{ .variable = cached, .body = try e.observed(f, try b.reference(cached)) },
            },
        } });
    }
    fn observed(e: Emit, f: Id, evidence: Id) !Id {
        const b = e.b;
        const sum = try e.add(try e.field(e.integer, try e.p(f, 1), 1), try e.field(e.integer, evidence, 2));
        const response = try b.variable(e.integer);
        const payload = try b.primitive(e.model_payload, .product, &.{ sum, try e.field(e.integer, evidence, 0) }, 0);
        return b.bind(response, try b.term(.{ .perform = .{ .effect = e.model, .payload = payload } }), try b.pure(try e.add(sum, try b.reference(response))));
    }
    fn seed(e: Emit, body_value: Id) !Id {
        const b = e.b;
        const own = e.d.custody;
        const f = try b.declare(&.{ e.demands, own.types.state, e.integer }, own.types.state, &.{e.model}, &.{});
        const pair = try b.schema(.{ .product = &.{ e.demand, e.demands } });
        const optional = try b.schema(.{ .sum = &.{ e.unit, pair } });
        const empty = try b.variable(e.unit);
        const present = try b.variable(pair);
        const head = try b.variable(e.demand);
        const rest = try b.variable(e.demands);
        const answer = try b.variable(own.dialogue.answer);
        const next = try b.variable(own.types.state);
        const recurse = try e.call(f, &.{ try b.reference(rest), try b.reference(next), try e.add(try e.p(f, 2), try b.constant(u64, 1)) });
        const park = try b.bind(next, try e.call(own.park, &.{ try e.p(f, 1), try e.p(f, 2), try b.reference(answer) }), recurse);
        const start = try b.bind(answer, try agent.dialogue.start(b, own.dialogue, body_value, &.{try b.reference(head)}), park);
        const unpack = try b.term(.{ .unpack_product = .{
            .value = try b.reference(present),
            .variables = &.{ head, rest },
            .body = start,
        } });
        try b.define(f, try b.term(.{ .match_sum = .{
            .value = try b.primitive(optional, .sequence_pop, &.{try e.p(f, 0)}, 0),
            .cases = &.{ .{ .variable = empty, .body = try b.pure(try e.p(f, 1)) }, .{ .variable = present, .body = unpack } },
        } }));
        return f;
    }
};

test "generic numerical inquiry broker compiles through public imports" {
    var b = Builder.init(std.testing.allocator);
    defer b.deinit();
    var diagnostic: boundary.program.Diagnostic = .{};
    var compiled = boundary.program.compileObserved(std.testing.allocator, try build(&b), .{ .diagnostic = &diagnostic }) catch |err| {
        std.debug.print("{any}\n", .{diagnostic});
        return err;
    };
    defer compiled.deinit();
}

test "broker declarations specialize once and reject impure or mistyped policies" {
    var b = Builder.init(std.testing.allocator);
    defer b.deinit();
    const integer = try b.scalar(u64);
    const unit = try b.scalar(void);
    const spec: broker.Spec = .{
        .identity = "probe.broker.contract",
        .subject = integer,
        .demand = integer,
        .key = integer,
        .observation = integer,
        .finding = integer,
        .policy = unit,
        .failure = try b.constant(void, {}),
    };
    const d = try broker.define(&b, spec);
    const repeated = try broker.define(&b, spec);
    try std.testing.expectEqual(d.experiment, repeated.experiment);
    try std.testing.expectEqual(d.custody.dialogue.effect, repeated.custody.dialogue.effect);
    const external = try b.effect(.{ .identity = "probe.policy.effect", .payload = unit, .result = unit });
    const impure = try b.declare(&.{ integer, integer }, d.types.admission, &.{external}, &.{});
    try std.testing.expectError(error.InvalidEffect, broker.implement(&b, spec, d, .{ .admit = impure, .select = 0, .finish = 0 }));
    const wrong = try b.declare(&.{ integer, integer }, integer, &.{}, &.{});
    try std.testing.expectError(error.TypeMismatch, broker.implement(&b, spec, d, .{ .admit = wrong, .select = 0, .finish = 0 }));
    const effectful_discriminator = try b.declare(&.{ integer, integer }, try b.scalar(bool), &.{external}, &.{});
    try std.testing.expectError(error.InvalidEffect, broker.defaultSelection(&b, spec, d, effectful_discriminator));
}

pub fn main(init: std.process.Init) !void {
    var b = Builder.init(init.gpa);
    defer b.deinit();
    var diagnostic: boundary.program.Diagnostic = .{};
    var compiled = boundary.program.compileObserved(init.gpa, try build(&b), .{ .diagnostic = &diagnostic }) catch |err| {
        std.debug.print("{any}\n", .{diagnostic});
        return err;
    };
    defer compiled.deinit();
    const bytes = try init.gpa.alloc(u8, try boundary.image_v2.encodedLength(compiled.program));
    defer init.gpa.free(bytes);
    _ = try compiled.encode(init.gpa, bytes);
    var buffer: [4096]u8 = undefined;
    var out = std.Io.File.stdout().writer(init.io, &buffer);
    try out.interface.writeAll(bytes);
    try out.interface.flush();
}
