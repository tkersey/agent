//! A declared delivery requirement, independent of causal hypotheses or approval.
const std = @import("std");
const agent = @import("agent");
const t = @import("types.zig");
const s = @import("source.zig");
const Id = s.Id;
const E = s.E;
pub const Definition = struct { function: Id, effect: Id };

pub fn define(e: E) !Definition {
    const b = e.b();
    const d = try agent.interaction.define(b, .{ .name = "inquiry.repair.intent", .channel = try b.schema(.text), .purpose = try b.schema(.text), .presentation = try e.schema(void), .outgoing = try e.schema(t.IntentQuestion), .input = try e.schema(t.IntentReply), .abort_turn = try e.schema(void), .close_conversation = try e.schema(void) });
    try e.c.registry.classify(d.effect, .interaction);
    const f = try b.declare(&.{try e.schema(t.Task)}, try e.schema(t.IntentResolution), &.{d.effect}, &.{});
    const task = try e.p(f, 0);
    const question = try e.product(t.IntentQuestion, &.{ task, try e.field(u64, task, 7), try e.value(t.Reason, .{ .bytes = "Should the checked repair be (1) a reviewable artifact only, or (2) conditionally written to the named target after a separate exact-candidate approval?" }), try e.value([2]u8, .{ 1, 2 }) });
    const response = try b.variable(d.reply);
    const input = try b.variable(try e.schema(t.IntentReply));
    const aborted = try b.variable(try e.schema(void));
    const closed = try b.variable(try e.schema(void));
    const same = try b.variable(try e.schema(bool));
    const checked = try b.bind(same, try agent.value_equality.compare(b, try e.schema(t.IntentQuestion), question, try e.field(t.IntentQuestion, try e.ref(input), 0), try e.value(void, {})), try e.cond(try e.ref(same), try choose(e, task, try e.field(t.IntentChoice, try e.ref(input), 1)), try empty(e, 6)));
    const dispatch = try b.term(.{ .match_sum = .{ .value = try e.ref(response), .cases = &.{
        .{ .variable = input, .body = checked },          .{ .variable = aborted, .body = try empty(e, 4) },
        .{ .variable = closed, .body = try empty(e, 5) },
    } } });
    const ask = try b.bind(response, try agent.interaction.exchange(b, d, .{
        .channel = try e.value(agent.contracts.Utf8, .{ .bytes = "repository-owner" }),
        .purpose = try e.value(agent.contracts.Utf8, .{ .bytes = "delivery-requirement" }),
        .presentation = try e.value(void, {}),
        .outgoing = question,
    }), dispatch);
    const known = try b.pure(try e.variant(t.IntentResolution, task, 0));
    const mode = try e.field(u8, task, 9);
    try b.define(f, try e.cond(try e.eq(mode, try e.value(u8, 2)), ask, try e.cond(try e.less(mode, try e.value(u8, 2)), known, try empty(e, 6))));
    return .{ .function = f, .effect = d.effect };
}

fn choose(e: E, task: Id, answer: Id) !Id {
    const b = e.b();
    const selected = try b.variable(try e.schema(u8));
    const other = try b.variable(try e.schema(void));
    const unsure = try b.variable(try e.schema(void));
    var fields: [std.meta.fields(t.Task).len]Id = undefined;
    inline for (std.meta.fields(t.Task), 0..) |field, i| fields[i] = if (i == 9)
        try b.primitive(try e.schema(u8), .select, &.{ try e.eq(try e.ref(selected), try e.value(u8, 1)), try e.value(u8, 1), try e.value(u8, 0) }, 0)
    else
        try e.field(field.type, task, i);
    const resolved = try b.pure(try e.variant(t.IntentResolution, try e.product(t.Task, &fields), 0));
    const admitted = try e.cond(try e.eq(try e.ref(selected), try e.value(u8, 1)), resolved, try e.cond(try e.eq(try e.ref(selected), try e.value(u8, 2)), resolved, try empty(e, 3)));
    return b.term(.{ .match_sum = .{ .value = answer, .cases = &.{
        .{ .variable = selected, .body = admitted },      .{ .variable = other, .body = try empty(e, 1) },
        .{ .variable = unsure, .body = try empty(e, 2) },
    } } });
}

fn empty(e: E, tag: u64) !Id {
    return e.b().pure(try e.variant(t.IntentResolution, try e.value(void, {}), tag));
}
