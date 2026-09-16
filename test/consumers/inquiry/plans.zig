//! Interpret a normalized batch of model proposals as one bounded experiment.
const std = @import("std");
const agent = @import("agent");
const t = @import("types.zig");
const s = @import("source.zig");
const Id = s.Id;
const E = s.E;

pub fn define(e: E) !Id {
    const b = e.b();
    const step = try stepDecoder(e);
    const collect = try collector(e, step);
    const f = try b.declare(&.{try e.schema([]const t.Answer)}, try e.schema(t.Plan), &.{}, &.{});
    const answers = try e.p(f, 0);
    const pop = try Pop.init(e, []const t.Answer, t.Answer);
    const invalid = try invalidPlan(e);
    const fields = std.meta.fields(t.Answer);
    var cases: [fields.len]Case = undefined;
    inline for (fields, 0..) |field, i| {
        const v = try b.variable(try e.schema(field.type));
        var body = invalid;
        if (i == 1) {
            const empty = try e.value(@FieldType(t.Trace, "steps"), .{ .items = &.{} });
            body = try e.call(collect, &.{ try e.ref(pop.rest), try e.ref(v), empty });
        } else if (i >= 8) {
            const kind: u64 = i - 7;
            body = try e.cond(try e.eq(try b.primitive(try e.schema(u64), .sequence_length, &.{try e.ref(pop.rest)}, 0), try e.value(u64, 0)), try b.pure(try e.variant(t.Plan, try e.ref(v), kind)), invalid);
        }
        cases[i] = .{ .variable = v, .body = body };
    }
    const selected = try b.term(.{ .match_sum = .{ .value = try e.ref(pop.head), .cases = &cases } });
    try b.define(f, try pop.match(e, answers, invalid, selected));
    return f;
}

fn invalidPlan(e: E) !Id {
    return e.b().pure(try e.variant(t.Plan, try e.value(void, {}), 4));
}

fn stepDecoder(e: E) !Id {
    const b = e.b();
    const optional = try e.schema(?t.Step);
    const f = try b.declare(&.{try e.schema(t.Answer)}, optional, &.{}, &.{});
    const no = try b.pure(try e.value(?t.Step, null));
    var cases: [std.meta.fields(t.Answer).len]Case = undefined;
    inline for (std.meta.fields(t.Answer), 0..) |field, i| {
        const v = try b.variable(try e.schema(field.type));
        var body = no;
        if (i >= 2 and i <= 7) {
            const payload = switch (i) {
                2 => try issueValue(e, try e.ref(v)),
                3 => try e.ref(v),
                4 => try e.field(u64, try e.ref(v), 0),
                else => try e.value(void, {}),
            };
            const step = try e.variant(t.Step, payload, i - 2);
            body = try b.pure(try e.variant(?t.Step, step, 1));
            if (i == 2) {
                const count = try e.field(u8, try e.ref(v), 5);
                body = try e.cond(try e.less(try e.value(u8, 0), count), try e.cond(try e.less(count, try e.value(u8, 5)), body, no), no);
            }
        }
        cases[i] = .{ .variable = v, .body = body };
    }
    try b.define(f, try b.term(.{ .match_sum = .{ .value = try e.p(f, 0), .cases = &cases } }));
    return f;
}

fn issueValue(e: E, proposed: Id) !Id {
    const b = e.b();
    const choices_type = @FieldType(t.Issue, "choices");
    var choices: [4]Id = undefined;
    for (&choices, 0..) |*v, i| v.* = try e.field(u8, proposed, i + 1);
    const count = try e.field(u8, proposed, 5);
    var selected = try b.primitive(try e.schema(choices_type), .sequence, &choices, 0);
    var i: usize = 3;
    while (i > 0) : (i -= 1) selected = try b.primitive(try e.schema(choices_type), .select, &.{
        try e.eq(count, try e.value(u8, @intCast(i))),
        try b.primitive(try e.schema(choices_type), .sequence, choices[0..i], 0),
        selected,
    }, 0);
    return e.product(t.Issue, &.{ try e.field(agent.contracts.Text(64), proposed, 0), selected, try e.field(agent.contracts.Text(32), proposed, 6) });
}

fn collector(e: E, decode: Id) !Id {
    const b = e.b();
    const steps = @FieldType(t.Trace, "steps");
    const f = try b.declare(&.{ try e.schema([]const t.Answer), try e.schema(t.ModelPrediction), try e.schema(steps) }, try e.schema(t.Plan), &.{}, &.{});
    const pop = try Pop.init(e, []const t.Answer, t.Answer);
    const decoded = try b.variable(try e.schema(?t.Step));
    const no = try b.variable(try e.schema(void));
    const yes = try b.variable(try e.schema(t.Step));
    const result = try e.p(f, 2);
    const meta = try e.p(f, 1);
    const prediction = try e.product(t.Prediction, &.{ try e.field(u64, meta, 1), try e.field(t.Selector, meta, 2), try e.field(u64, meta, 3), try e.field(u8, meta, 4) });
    const trace = try e.product(t.Trace, &.{ try e.field(u8, meta, 0), result });
    const finished = try b.pure(try e.variant(t.Plan, try e.product(t.Probe, &.{ trace, prediction }), 0));
    const added = try b.value(.{ .schema = try e.schema(steps), .expression = .{ .primitive = .{
        .opcode = .sequence_append,
        .operands = &.{ result, try e.ref(yes) },
        .failures = &.{.{ .kind = .capacity_exceeded, .value = try e.fault() }},
    } } });
    const length = try b.primitive(try e.schema(u64), .sequence_length, &.{result}, 0);
    const next = try e.cond(try e.less(length, try e.value(u64, 24)), try e.call(f, &.{ try e.ref(pop.rest), meta, added }), try invalidPlan(e));
    const match = try b.term(.{ .match_sum = .{
        .value = try e.ref(decoded),
        .cases = &.{ .{ .variable = no, .body = try invalidPlan(e) }, .{ .variable = yes, .body = next } },
    } });
    const advance = try b.bind(decoded, try e.call(decode, &.{try e.ref(pop.head)}), match);
    try b.define(f, try pop.match(e, try e.p(f, 0), finished, advance));
    return f;
}

const Case = std.meta.Child(@FieldType(@FieldType(@import("boundary").computation.ast.Term, "match_sum"), "cases"));
pub const Pop = struct {
    optional: Id,
    empty: Id,
    present: Id,
    head: Id,
    rest: Id,
    pub fn init(e: E, comptime Sequence: type, comptime Element: type) !Pop {
        const b = e.b();
        const pair = try b.schema(.{ .product = &.{ try e.schema(Element), try e.schema(Sequence) } });
        return .{ .optional = try b.schema(.{ .sum = &.{ try e.schema(void), pair } }), .empty = try b.variable(try e.schema(void)), .present = try b.variable(pair), .head = try b.variable(try e.schema(Element)), .rest = try b.variable(try e.schema(Sequence)) };
    }
    pub fn match(p: Pop, e: E, values: Id, empty: Id, next: Id) !Id {
        const unpack = try e.b().term(.{ .unpack_product = .{ .value = try e.ref(p.present), .variables = &.{ p.head, p.rest }, .body = next } });
        return e.b().term(.{ .match_sum = .{
            .value = try e.b().primitive(p.optional, .sequence_pop, &.{values}, 0),
            .cases = &.{ .{ .variable = p.empty, .body = empty }, .{ .variable = p.present, .body = unpack } },
        } });
    }
};
