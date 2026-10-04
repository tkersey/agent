//! A declared delivery requirement, independent of causal hypotheses or approval.
const std = @import("std");
const agent = @import("agent");
const a = @import("boundary").authoring;
const t = @import("types.zig");
const s = @import("source.zig");
const Id = s.Id;
const E = s.E;
pub const Definition = struct { function: Id, effect: Id };

fn schema(e: E, c: *a.Context, comptime T: type) !*const a.Schema {
    return a.interop.schema(c, try e.schema(T));
}

pub fn define(e: E) !Definition {
    const b = e.b();
    const d = try agent.interaction.define(b, .{ .name = "inquiry.repair.intent", .channel = try b.schema(.text), .purpose = try b.schema(.text), .presentation = try e.schema(void), .outgoing = try e.schema(t.IntentQuestion), .input = try e.schema(t.IntentReply), .abort_turn = try e.schema(void), .close_conversation = try e.schema(void) });
    try e.c.registry.classify(d.effect, .interaction);
    const c = try a.Context.init(b);
    const result = try schema(e, c, t.IntentResolution);
    const f = try c.function("resolve delivery requirement", &.{.{ .name = "task", .schema = try schema(e, c, t.Task) }}, result, &.{try a.interop.operation(c, d.effect)});
    const body = try c.body(f);
    const task = try body.parameter("task");
    const mode = try body.field(task, "9");
    const ask = try body.branch();
    const already = try body.branch();
    const question_schema = try schema(e, c, t.IntentQuestion);
    const question = try makeQuestion(e, c, ask, task);
    const exchange = try agent.interaction.exchange(b, d, .{
        .channel = try e.value(agent.contracts.Utf8, .{ .bytes = "repository-owner" }),
        .purpose = try e.value(agent.contracts.Utf8, .{ .bytes = "delivery-requirement" }),
        .presentation = try e.value(void, {}),
        .outgoing = try a.interop.valueId(ask, question),
    });
    const response = try a.interop.term(ask, exchange, try a.interop.schema(c, d.reply));
    const input = try ask.caseOf(response, "0");
    const aborted = try ask.caseOf(response, "1");
    const closed = try ask.caseOf(response, "2");
    const work = input.body();
    const equal = try agent.value_equality.create(c, question_schema, try c.literalFailure(void, {}));
    const same = try work.call(equal, &.{ .{ .name = "left", .value = try makeQuestion(e, c, work, task) }, .{ .name = "right", .value = try work.field(input.payload(), "0") } });
    const yes = try work.branch();
    const no = try work.branch();
    const checked = try work.conditional(same, try yes.ret(try choose(e, c, yes, task, try yes.field(input.payload(), "1"))), try no.ret(try empty(no, result, "6")));
    const dispatch = try ask.match(response, &.{ try input.ret(checked), try aborted.ret(try empty(aborted.body(), result, "4")), try closed.ret(try empty(closed.body(), result, "5")) });
    const known = try already.branch();
    const invalid = try already.branch();
    const existing = try already.conditional(try already.less(mode, try already.constant(u8, 2)), try known.ret(try known.variant(result, "0", task)), try invalid.ret(try empty(invalid, result, "6")));
    try c.define(f, try body.ret(try body.conditional(try body.equal(mode, try body.constant(u8, 2)), try ask.ret(dispatch), try already.ret(existing))));
    return .{ .function = try a.interop.functionId(c, f), .effect = d.effect };
}

// Rebuild this ordinary value after interaction rather than retaining a second
// task-bearing question in the portable checkpoint. The task is immutable.
fn makeQuestion(e: E, c: *a.Context, body: *a.Body, task: *const a.Value) !*const a.Value {
    return body.product(try schema(e, c, t.IntentQuestion), &.{
        .{ .name = "0", .value = task },
        .{ .name = "1", .value = try body.field(task, "7") },
        .{ .name = "2", .value = try a.interop.adoptValue(body, try e.value(t.Reason, .{ .bytes = "Should the checked repair be (1) a reviewable artifact only, or (2) conditionally written to the named target after a separate exact-candidate approval?" }), try schema(e, c, t.Reason)) },
        .{ .name = "3", .value = try a.interop.adoptValue(body, try e.value([2]u8, .{ 1, 2 }), try schema(e, c, [2]u8)) },
    });
}

fn choose(e: E, c: *a.Context, body: *a.Body, task: *const a.Value, answer: *const a.Value) !*const a.Value {
    const result = try schema(e, c, t.IntentResolution);
    const selected = try body.caseOf(answer, "0");
    const other = try body.caseOf(answer, "1");
    const unsure = try body.caseOf(answer, "2");
    const work = selected.body();
    const first = try work.equal(selected.payload(), try work.constant(u8, 1));
    const second = try work.equal(selected.payload(), try work.constant(u8, 2));
    const admitted = try work.branch();
    const invalid = try work.branch();
    var fields: [@typeInfo(t.Task).@"struct".field_names.len]a.Argument = undefined;
    inline for (0..@typeInfo(t.Task).@"struct".field_names.len) |i| {
        const name = std.fmt.comptimePrint("{d}", .{i});
        fields[i] = .{ .name = name, .value = if (i == 9) try admitted.select(first, try admitted.constant(u8, 1), try admitted.constant(u8, 0)) else try admitted.field(task, name) };
    }
    const resolved = try admitted.variant(result, "0", try admitted.product(try schema(e, c, t.Task), &fields));
    const valid = try work.select(first, try work.constant(bool, true), second);
    const checked = try work.conditional(valid, try admitted.ret(resolved), try invalid.ret(try empty(invalid, result, "3")));
    return body.match(answer, &.{ try selected.ret(checked), try other.ret(try empty(other.body(), result, "1")), try unsure.ret(try empty(unsure.body(), result, "2")) });
}

fn empty(body: *a.Body, result: *const a.Schema, tag: []const u8) !*const a.Value {
    return body.variant(result, tag, try body.constant(void, {}));
}
