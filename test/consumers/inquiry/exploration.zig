//! A model-only delimiter nested inside one investigation. The outer queue is
//! neither a capture nor an assessment, and experimentation resumes outside it.
const agent = @import("agent");
const t = @import("types.zig");
const s = @import("source.zig");
const Id = s.Id;
const E = s.E;
const Assessment = struct { alternative: u64, before: u64, after: u64, proposal: t.P.BatchInterpretation };

pub fn define(e: E, model_call: Id) !Id {
    const b = e.b();
    const model = try t.P.declare(b);
    const integer = try e.schema(u64);
    const region = b.region();
    const region_type = try b.schema(.{ .internal = .{ .region = region } });
    const cell_type = try b.schema(.{ .internal = .{ .cell = .{ .element = integer, .region = region } } });
    const d = try agent.deliberation.define(b, "inquiry.repair.model-alternatives.v1", integer, try e.schema(Assessment), .{ .captures = &.{ try e.schema(t.Task), try e.schema(t.Working), integer, try e.schema(void), cell_type }, .owned_regions = &.{region}, .residual = .{ .effects = &.{model} } });
    const f = try b.declare(&.{ try e.schema(t.Task), integer, integer, try e.schema(t.Working) }, try e.schema(t.P.BatchInterpretation), &.{model}, &.{});
    const body = try b.declare(&.{d.capability}, try e.schema(Assessment), &.{ model, d.effect }, &.{});
    const private = try b.declare(&.{region_type}, try e.schema(Assessment), &.{ model, d.effect }, &.{region});
    const cell = try b.variable(cell_type);
    const created = try b.primitive(cell_type, .cell_new, &.{ try e.p(private, 0), try e.value(u64, 10) }, 0);
    const chosen = try b.variable(integer);
    const before = try b.variable(integer);
    const stored = try b.variable(try e.schema(void));
    const response = try b.variable(try e.schema(t.P.BatchInterpretation));
    const read = try b.primitive(integer, .cell_get, &.{try e.ref(cell)}, 0);
    const after = try e.arithmetic(.integer_add, try e.ref(before), try e.ref(chosen));
    const write = try b.primitive(try e.schema(void), .cell_set, &.{ try e.ref(cell), after }, 0);
    const working = try alternativeContext(e, try e.p(f, 3), try e.ref(chosen), try e.ref(before), read);
    const result = try e.product(Assessment, &.{ try e.ref(chosen), try e.ref(before), read, try e.ref(response) });
    const modeled = try b.bind(response, try e.call(model_call, &.{ try e.p(f, 0), try e.p(f, 1), try e.p(f, 2), working, try e.value(bool, false) }), try b.pure(result));
    const continued = try b.bind(before, try b.pure(read), try b.bind(stored, try b.pure(write), modeled));
    const selected = try b.bind(chosen, try agent.deliberation.choose(b, d, try e.p(body, 0), try b.primitive(d.alternatives, .sequence, &.{ try e.value(u64, 1), try e.value(u64, 2) }, 0)), continued);
    try b.define(private, try b.bind(cell, try b.pure(created), selected));
    const scoped = try b.schema(.{ .internal = .{ .computation = .{
        .parameters = &.{region_type},
        .result = try e.schema(Assessment),
        .effects = &.{ model, d.effect },
        .capture_bound = &.{ d.capability, try e.schema(t.Task), integer, try e.schema(t.Working) },
        .regions = &.{region},
    } } });
    try b.define(body, try b.term(.{ .with_region = .{ .region = region, .body = try b.lambda(private, scoped) } }));
    try agent.deliberation.register(e.c, d, body, &.{model});
    const computation = try e.lambda(body, &.{d.capability}, try e.schema(Assessment), &.{ model, d.effect }, &.{ try e.schema(t.Task), integer, try e.schema(t.Working) });
    const answers = try b.variable(d.answer);
    try b.define(f, try b.bind(answers, try agent.deliberation.evaluate(b, d, computation, &.{}), try e.call(try selectAssessment(e), &.{try e.ref(answers)})));
    return f;
}

fn alternativeContext(e: E, working: Id, choice: Id, before: Id, after: Id) !Id {
    const Text = agent.contracts.Text(4096);
    var report = try e.concat(Text, try e.field(Text, working, 2), try e.value(Text, .{ .bytes = "\nInterpretation alternative " }));
    report = try e.concat(Text, report, try e.textNumber(Text, choice));
    report = try e.concat(Text, report, try e.value(Text, .{ .bytes = "; private before=" }));
    report = try e.concat(Text, report, try e.textNumber(Text, before));
    report = try e.concat(Text, report, try e.value(Text, .{ .bytes = "; private after=" }));
    report = try e.concat(Text, report, try e.textNumber(Text, after));
    return e.product(t.Working, &.{ try e.field(t.Reason, working, 0), try e.field(u64, working, 1), report, try e.field(u64, working, 3), try e.field(t.Source, working, 4) });
}

fn selectAssessment(e: E) !Id {
    const b = e.b();
    const f = try b.declare(&.{try e.schema([]const Assessment)}, try e.schema(t.P.BatchInterpretation), &.{}, &.{});
    const none = try b.variable(try e.schema(void));
    const first = try b.variable(try e.schema(Assessment));
    const missing = try b.variable(try e.schema(void));
    const second = try b.variable(try e.schema(Assessment));
    const no = try b.pure(try e.value(t.P.BatchInterpretation, .{ .rejected = .invalid_selection }));
    const accepted = try b.variable(try e.schema([]const t.Answer));
    const rejected = try b.variable(try e.schema(t.P.InterpretationFailure));
    const first_proposal = try e.field(t.P.BatchInterpretation, try e.ref(first), 3);
    var yes = try b.term(.{ .match_sum = .{ .value = first_proposal, .cases = &.{
        .{ .variable = accepted, .body = try b.pure(first_proposal) },
        .{ .variable = rejected, .body = try b.pure(try e.field(t.P.BatchInterpretation, try e.ref(second), 3)) },
    } } });
    for ([_]Id{ first, second }, 1..) |v, choice| {
        const a = try e.ref(v);
        yes = try e.cond(try e.eq(try e.field(u64, a, 0), try e.value(u64, choice)), yes, no);
        yes = try e.cond(try e.eq(try e.field(u64, a, 1), try e.value(u64, 10)), yes, no);
        yes = try e.cond(try e.eq(try e.field(u64, a, 2), try e.value(u64, 10 + choice)), yes, no);
    }
    const right = try b.term(.{ .match_sum = .{
        .value = try e.index(Assessment, try e.p(f, 0), try e.value(u64, 1)),
        .cases = &.{ .{ .variable = missing, .body = no }, .{ .variable = second, .body = yes } },
    } });
    try b.define(f, try b.term(.{ .match_sum = .{
        .value = try e.index(Assessment, try e.p(f, 0), try e.value(u64, 0)),
        .cases = &.{ .{ .variable = none, .body = no }, .{ .variable = first, .body = right } },
    } }));
    return f;
}
