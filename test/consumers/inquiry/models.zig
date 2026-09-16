//! The existing semantic model protocol supplies fallible, typed proposal data.
const std = @import("std");
const agent = @import("agent");
const t = @import("types.zig");
const s = @import("source.zig");
const Id = s.Id;
const E = s.E;
const P = t.P;

pub fn define(e: E) !Id {
    const b = e.b();
    const effect = try P.declare(b);
    const f = try b.declare(&.{ try e.schema(t.Task), try e.schema(u64), try e.schema(u64), try e.schema(t.Working), try e.schema(bool) }, try e.schema(P.BatchInterpretation), &.{effect}, &.{});
    const initial = try e.p(f, 4);
    var first = [_]bool{false} ** P.declaration_count;
    first[0] = true;
    var later = [_]bool{true} ** P.declaration_count;
    later[0] = false;
    const offered = try b.primitive(try e.schema([P.declaration_count]bool), .select, &.{ initial, try e.value([P.declaration_count]bool, first), try e.value([P.declaration_count]bool, later) }, 0);
    const request = try requestValue(e, f);
    try b.define(f, try agent.responders.invokeModel(P, e.c, try e.value(void, {}), true, request, offered));
    return f;
}

fn requestValue(e: E, f: Id) !Id {
    const b = e.b();
    const task = try e.p(f, 0);
    const subject = try e.field(t.Subject, task, 0);
    const working = try e.p(f, 3);
    var scope = try e.value(P.MessageText, .{ .bytes = "Investigation " });
    scope = try e.concat(P.MessageText, scope, try e.textNumber(P.MessageText, try e.p(f, 1)));
    scope = try e.concat(P.MessageText, scope, try e.value(P.MessageText, .{ .bytes = "; version " }));
    scope = try e.concat(P.MessageText, scope, try e.textNumber(P.MessageText, try e.p(f, 2)));
    scope = try e.concat(P.MessageText, scope, try e.value(P.MessageText, .{ .bytes = "; current observation " }));
    scope = try e.concat(P.MessageText, scope, try e.textNumber(P.MessageText, try e.field(u64, working, 1)));
    const contents = [_]Id{
        try e.value(P.MessageText, .{ .bytes = "Investigate the supplied module. Initially return hypothesis calls. " ++
            "For an investigator, return a prediction followed by ordered issue/encode/submit/abort/close/inspect calls, " ++
            "or exactly one repair, revise, or stop call. Trace indices are zero-based and refer only to earlier outputs. " ++
            "Prediction fields are occurrence, accepted (0/1), issued, accepted_count, closed (0/1), current. " ++
            "Requirements 0..7 refer to binding, stale rejection, unchanged rejection, progression, presentation independence, " ++
            "adapter association, matched modes, and close/abort. " ++
            "A matched prediction is not a proof of the explanation. Revise inadequate explanations or stop honestly. " ++
            "Repair is complete self-contained JavaScript with the original exports and no imports. " ++
            "Cite the current observation ID (zero before any evidence). Tests and approval are separate from your claims." }),
        try widen(e, try e.field(agent.contracts.Text(2048), subject, 3)),
        try widen(e, try e.field(t.Source, subject, 1)),
        try widen(e, try e.field(t.Reason, working, 0)),
        scope,
        try widen(e, try e.field(agent.contracts.Text(4096), working, 2)),
        try widen(e, try e.field(t.Source, working, 4)),
    };
    var messages: [contents.len]Id = undefined;
    for (&messages, contents, 0..) |*message, content, i| message.* = try e.product(P.Message, &.{
        try e.value(agent.model_invocation.MessageRole, if (i == 0) .system else .user), content,
    });
    const template = try P.templateValue(t.Model, .{ .items = &.{} }, .{
        .minimum_calls = 1,
        .maximum_calls = 25,
        .parallel_calls = true,
    });
    var fields: [std.meta.fields(P.Request).len]Id = undefined;
    inline for (std.meta.fields(P.Request), 0..) |field, i| fields[i] = switch (i) {
        1 => try e.field(P.ModelId, task, 1),
        3 => try b.primitive(try e.schema(P.Messages), .sequence, &messages, 0),
        else => try e.value(field.type, @field(template, field.name)),
    };
    return e.product(P.Request, &fields);
}

fn widen(e: E, value: Id) !Id {
    return e.concat(P.MessageText, try e.value(P.MessageText, .{ .bytes = "" }), value);
}
