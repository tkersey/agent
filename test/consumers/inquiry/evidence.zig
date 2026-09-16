//! Observation rendering and prediction comparison are authored computations.
const agent = @import("agent");
const t = @import("types.zig");
const s = @import("source.zig");
const Id = s.Id;
const E = s.E;
const Text = agent.contracts.Text(4096);

pub fn summary(e: E) !Id {
    const b = e.b();
    const f = try b.declare(&.{ try e.schema(t.Observation), try e.schema(t.Prediction) }, try e.schema(Text), &.{}, &.{});
    const rows = try b.variable(try e.schema(t.Rows));
    const checked = try b.variable(try e.schema(t.Checked));
    const table = try e.call(try renderRows(e), &.{ try e.ref(rows), try e.value(u64, 0), try e.value(Text, .{ .bytes = "Trace rows: index occurrence accepted issued accepted_count closed current.\n" }) });
    const matched = try b.variable(try e.schema(Text));
    const rendered = try b.variable(try e.schema(Text));
    const traced = try b.bind(matched, try e.call(try prediction(e), &.{ try e.ref(rows), try e.p(f, 1) }), try b.bind(rendered, table, try b.pure(try e.concat(Text, try e.ref(matched), try e.ref(rendered)))));
    const check = try e.ref(checked);
    var report = try e.value(Text, .{ .bytes = "Candidate acceptance: completed=" });
    report = try e.concat(Text, report, try e.textNumber(Text, try e.field(u64, check, 1)));
    report = try e.concat(Text, report, try e.value(Text, .{ .bytes = ", failed=" }));
    report = try e.concat(Text, report, try e.textNumber(Text, try e.field(u64, check, 2)));
    report = try e.concat(Text, report, try e.value(Text, .{ .bytes = ". Only zero failures after all 16 checks permits a ready candidate. Revise a failed candidate.\n" }));
    report = try e.concat(Text, report, try e.field(t.Reason, check, 3));
    try b.define(f, try b.term(.{ .match_sum = .{ .value = try e.p(f, 0), .cases = &.{
        .{ .variable = rows, .body = traced }, .{ .variable = checked, .body = try b.pure(report) },
    } } }));
    return f;
}

fn number(e: E, value: Id, boolean: bool) !Id {
    if (!boolean) return value;
    return e.b().primitive(try e.schema(u64), .select, &.{ value, try e.value(u64, 1), try e.value(u64, 0) }, 0);
}

// Preserve absence in the rendered observation; the explicitly numeric
// occurrence selector uses zero, and issue_returned_null inspects the sum tag.
fn occurrence(e: E, comptime Result: type) !Id {
    const b = e.b();
    const f = try b.declare(&.{try e.schema(?u64)}, try e.schema(Result), &.{}, &.{});
    const absent = try b.variable(try e.schema(void));
    const present = try b.variable(try e.schema(u64));
    const empty = if (Result == u64) try e.value(u64, 0) else try e.value(Text, .{ .bytes = "null" });
    const value = if (Result == u64) try e.ref(present) else try e.textNumber(Text, try e.ref(present));
    try b.define(f, try b.term(.{ .match_sum = .{ .value = try e.p(f, 0), .cases = &.{
        .{ .variable = absent, .body = try b.pure(empty) },
        .{ .variable = present, .body = try b.pure(value) },
    } } }));
    return f;
}

fn renderRows(e: E) !Id {
    const b = e.b();
    const f = try b.declare(&.{ try e.schema(t.Rows), try e.schema(u64), try e.schema(Text) }, try e.schema(Text), &.{}, &.{});
    const no = try b.variable(try e.schema(void));
    const row = try b.variable(try e.schema(t.Row));
    const identity_text = try b.variable(try e.schema(Text));
    const index = try e.p(f, 1);
    var text = try e.concat(Text, try e.p(f, 2), try e.textNumber(Text, index));
    inline for (.{ 1, 2, 3, 4, 5, 6 }) |i| {
        text = try e.concat(Text, text, try e.value(Text, .{ .bytes = " " }));
        if (i == 1) {
            text = try e.concat(Text, text, try e.ref(identity_text));
        } else {
            const boolean = i == 2 or i == 5;
            const scalar = try e.field(if (boolean) bool else u64, try e.ref(row), i);
            text = try e.concat(Text, text, try e.textNumber(Text, try number(e, scalar, boolean)));
        }
    }
    text = try e.concat(Text, text, try e.value(Text, .{ .bytes = "\n" }));
    const next = try e.call(f, &.{ try e.p(f, 0), try e.arithmetic(.integer_add, index, try e.value(u64, 1)), text });
    try b.define(f, try b.term(.{ .match_sum = .{
        .value = try e.index(t.Row, try e.p(f, 0), index),
        .cases = &.{ .{ .variable = no, .body = try b.pure(try e.p(f, 2)) }, .{ .variable = row, .body = try b.bind(identity_text, try e.call(try occurrence(e, Text), &.{try e.field(?u64, try e.ref(row), 1)}), next) } },
    } }));
    return f;
}

fn prediction(e: E) !Id {
    const b = e.b();
    const f = try b.declare(&.{ try e.schema(t.Rows), try e.schema(t.Prediction) }, try e.schema(Text), &.{}, &.{});
    const p = try e.p(f, 1);
    const no = try b.variable(try e.schema(void));
    const row = try b.variable(try e.schema(t.Row));
    const identity = try b.variable(try e.schema(u64));
    const selector = try b.primitive(try e.schema(u32), .enum_tag, &.{try e.field(t.Selector, p, 1)}, 0);
    var actual = try e.field(u64, try e.ref(row), 6);
    inline for (.{ 5, 4, 3, 2, 1 }, 0..) |field, reverse| {
        const tag = 4 - reverse;
        const boolean = field == 2 or field == 5;
        actual = try b.primitive(try e.schema(u64), .select, &.{
            try e.eq(selector, try e.value(u32, tag)),
            if (field == 1) try e.ref(identity) else try number(e, try e.field(if (boolean) bool else u64, try e.ref(row), field), boolean),
            actual,
        }, 0);
    }
    const tag = try b.primitive(try e.schema(u64), .variant_tag, &.{try e.field(?u64, try e.ref(row), 1)}, 0);
    actual = try b.primitive(try e.schema(u64), .select, &.{
        try e.eq(selector, try e.value(u32, 6)),
        try number(e, try e.eq(tag, try e.value(u64, 0)), true),
        actual,
    }, 0);
    const match = try e.eq(actual, try e.field(u64, p, 2));
    const compared = try b.pure(try b.primitive(try e.schema(Text), .select, &.{
        match,
        try e.value(Text, .{ .bytes = "The recorded prediction matched this observation; it is not general causal proof.\n" }),
        try e.value(Text, .{ .bytes = "The recorded prediction was contradicted. Reconsider the explanation or probe assumptions.\n" }),
    }, 0));
    try b.define(f, try b.term(.{ .match_sum = .{ .value = try e.index(t.Row, try e.p(f, 0), try e.field(u64, p, 0)), .cases = &.{
        .{ .variable = no, .body = try b.pure(try e.value(Text, .{ .bytes = "Prediction inconclusive: row unavailable.\n" })) },
        .{ .variable = row, .body = try b.bind(identity, try e.call(try occurrence(e, u64), &.{try e.field(?u64, try e.ref(row), 1)}), compared) },
    } } }));
    return f;
}
