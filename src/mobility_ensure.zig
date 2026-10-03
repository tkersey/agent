//! Pure candidate selection and bounded effectful placement, compiled to World.
const std = @import("std");
const boundary = @import("boundary");
const a = boundary.authoring;
const m = @import("mobility.zig");
const Context = @import("authoring.zig").Context;
const Id = boundary.source.Id;
const Candidates = @import("agent_contracts").Vector(m.Candidate, 32);
const Tried = []const m.Identifier;

const Emit = struct {
    agent: Context,
    c: *a.Context,
    fault: *const a.FailureLiteral,
    fn schema(e: Emit, comptime T: type) anyerror!*const a.Schema {
        switch (@typeInfo(T)) {
            .@"struct" => |info| {
                if (@hasDecl(T, "agent_value_kind")) return a.interop.schema(e.c, try e.agent.schema(T));
                var fields: [info.fields.len]a.Field = undefined;
                inline for (info.fields, 0..) |field, i| fields[i] = .{ .name = field.name, .schema = try e.schema(field.type) };
                return e.c.record(&fields);
            },
            .@"union" => |info| {
                var fields: [info.fields.len]a.Field = undefined;
                inline for (info.fields, 0..) |field, i| fields[i] = .{ .name = field.name, .schema = try e.schema(field.type) };
                return e.c.alternatives(&fields);
            },
            .optional => |info| return e.c.alternatives(&.{ .{ .name = "none", .schema = try e.c.scalar(void) }, .{ .name = "some", .schema = try e.schema(info.child) } }),
            else => return a.interop.schema(e.c, try e.agent.schema(T)),
        }
    }
    fn candidateAt(e: Emit, body: *a.Body, values: *const a.Value, index: *const a.Value) !*const a.Value {
        // The bounded vector is imported through the pure contract schema.
        // Bind a fresh optional with named fields at this source adapter, rather
        // than trying to rename an already-bound positional payload variable.
        const optional = try e.schema(?m.Candidate);
        const b = e.agent.builder;
        const value = try b.primitive(try a.interop.schemaId(e.c, optional), .sequence_get, &.{ try a.interop.valueId(body, values), try a.interop.valueId(body, index) }, 0);
        return a.interop.term(body, try b.pure(value), optional);
    }
    fn boolean(_: Emit, body: *a.Body, yes: *const a.Value, no: *const a.Value) !*const a.Value {
        return body.select(yes, no, try body.constant(bool, false));
    }
    fn textEqual(_: Emit, body: *a.Body, left: *const a.Value, right: *const a.Value) !*const a.Value {
        return body.equal(try body.blobCompare(left, right), try body.constant(i8, 0));
    }
    fn host(_: Emit, body: *a.Body, candidate: *const a.Value) !*const a.Value {
        return body.field(try body.field(candidate, "observation"), "host_id");
    }
    fn optionalMatch(e: Emit, body: *a.Body, optional: *const a.Value, host_value: *const a.Value, absent: bool) !*const a.Value {
        const none = try body.caseOf(optional, "none");
        const some = try body.caseOf(optional, "some");
        return body.match(optional, &.{ try none.ret(try none.body().constant(bool, absent)), try some.ret(try e.textEqual(some.body(), some.payload(), host_value)) });
    }
    fn increment(e: Emit, body: *a.Body, value: *const a.Value) !*const a.Value {
        return body.checkedAdd(value, try body.constant(u64, 1), e.fault);
    }
    fn subtract(e: Emit, body: *a.Body, left: *const a.Value, right: *const a.Value) !*const a.Value {
        return body.checked(.subtract, left, right, .{ .overflow = e.fault });
    }
    fn saturating(e: Emit, body: *a.Body, left: *const a.Value, right: *const a.Value) !*const a.Value {
        const maximum = try body.constant(u64, std.math.maxInt(u64));
        const room = try e.subtract(body, maximum, left);
        const saturated = try body.branch();
        const added = try body.branch();
        return body.conditional(try body.less(room, right), try saturated.ret(maximum), try added.ret(try added.checkedAdd(left, right, e.fault)));
    }
    fn failed(e: Emit, body: *a.Body, reason: []const u8) !*const a.Value {
        return body.variant(try e.schema(m.PlacementResult), "Failed", try body.variant(try e.schema(m.Reason), reason, try body.constant(void, {})));
    }
    fn ready(e: Emit, body: *a.Body, observation: *const a.Value, budget: *const a.Value) !*const a.Value {
        return body.variant(try e.schema(m.PlacementResult), "Ready", try body.product(try e.schema(m.Placement), &.{ .{ .name = "observation", .value = observation }, .{ .name = "remaining_moves", .value = budget } }));
    }
};

fn membership(e: Emit, comptime List: type) !*const a.Function {
    const c = e.c;
    const f = try c.function("mobility identifier membership", &.{ .{ .name = "items", .schema = try e.schema(List) }, .{ .name = "needle", .schema = try e.schema(m.Identifier) }, .{ .name = "index", .schema = try c.scalar(u64) } }, try c.scalar(bool), &.{});
    const body = try c.body(f);
    const items = try body.parameter("items");
    const needle = try body.parameter("needle");
    const index = try body.parameter("index");
    const item = try body.sequenceGet(items, index);
    const none = try body.caseOf(item, "none");
    const some = try body.caseOf(item, "some");
    const found = try some.body().branch();
    const next = try some.body().branch();
    const continued = try next.call(f, &.{ .{ .name = "items", .value = items }, .{ .name = "needle", .value = needle }, .{ .name = "index", .value = try e.increment(next, index) } });
    const result = try some.body().conditional(try e.textEqual(some.body(), some.payload(), needle), try found.ret(try found.constant(bool, true)), try next.ret(continued));
    try c.define(f, try body.ret(try body.match(item, &.{ try none.ret(try none.body().constant(bool, false)), try some.ret(result) })));
    return f;
}

fn cost(e: Emit) !*const a.Function {
    const c = e.c;
    const f = try c.function("mobility saturating cost", &.{.{ .name = "candidate", .schema = try e.schema(m.Candidate) }}, try e.schema(?u64), &.{});
    const body = try c.body(f);
    const candidate = try body.parameter("candidate");
    var work = body;
    var cases: [3]struct { parent: *a.Body, value: *const a.Value, none: *const a.Case, some: *const a.Case } = undefined;
    var sum = try body.constant(u64, 0);
    for ([_][]const u8{ "transfer_microseconds", "startup_microseconds", "capability_microseconds" }, 0..) |name, i| {
        const value = try work.field(candidate, name);
        const none = try work.caseOf(value, "none");
        const some = try work.caseOf(value, "some");
        cases[i] = .{ .parent = work, .value = value, .none = none, .some = some };
        work = some.body();
        sum = try e.saturating(work, sum, some.payload());
    }
    var result = try work.variant(try e.schema(?u64), "some", sum);
    var i: usize = cases.len;
    while (i > 0) {
        i -= 1;
        const item = cases[i];
        result = try item.parent.match(item.value, &.{ try item.none.ret(try item.none.body().variant(try e.schema(?u64), "none", try item.none.body().constant(void, {}))), try item.some.ret(result) });
    }
    try c.define(f, try body.ret(result));
    return f;
}

fn identifierValid(e: Emit) !*const a.Function {
    const c = e.c;
    const f = try c.function("mobility identifier validation", &.{ .{ .name = "value", .schema = try e.schema(m.Identifier) }, .{ .name = "index", .schema = try c.scalar(u64) } }, try c.scalar(bool), &.{});
    const body = try c.body(f);
    const value = try body.parameter("value");
    const index = try body.parameter("index");
    const byte = try body.blobByte(value, index);
    const none = try body.caseOf(byte, "none");
    const some = try body.caseOf(byte, "some");
    const rejected = try some.body().branch();
    const next = try some.body().branch();
    const continued = try next.call(f, &.{ .{ .name = "value", .value = value }, .{ .name = "index", .value = try e.increment(next, index) } });
    const checked = try some.body().conditional(try some.body().equal(some.payload(), try some.body().constant(u8, 0)), try rejected.ret(try rejected.constant(bool, false)), try next.ret(continued));
    try c.define(f, try body.ret(try body.match(byte, &.{ try none.ret(try none.body().less(try none.body().constant(u64, 0), index)), try some.ret(checked) })));
    return f;
}

fn preferable(e: Emit, price: *const a.Function) !*const a.Function {
    const c = e.c;
    const f = try c.function("mobility deterministic ordering", &.{ .{ .name = "left", .schema = try e.schema(m.Candidate) }, .{ .name = "right", .schema = try e.schema(m.Candidate) }, .{ .name = "constraints", .schema = try e.schema(m.Constraints) } }, try c.scalar(bool), &.{});
    const body = try c.body(f);
    const left = try body.parameter("left");
    const right = try body.parameter("right");
    const affinity = try body.field(try body.parameter("constraints"), "affinity_host_id");
    const preferred_left = try e.optionalMatch(body, affinity, try e.host(body, left), false);
    const preferred_right = try e.optionalMatch(body, affinity, try e.host(body, right), false);
    const lexical = try body.less(try body.blobCompare(try e.host(body, left), try e.host(body, right)), try body.constant(i8, 0));
    const l = try body.call(price, &.{.{ .name = "candidate", .value = left }});
    const ln = try body.caseOf(l, "none");
    const ls = try body.caseOf(l, "some");
    const unknown_r = try ln.body().call(price, &.{.{ .name = "candidate", .value = right }});
    const un = try ln.body().caseOf(unknown_r, "none");
    const us = try ln.body().caseOf(unknown_r, "some");
    const unknown_result = try ln.body().match(unknown_r, &.{ try un.ret(lexical), try us.ret(try us.body().constant(bool, false)) });
    const known_r = try ls.body().call(price, &.{.{ .name = "candidate", .value = right }});
    const kn = try ls.body().caseOf(known_r, "none");
    const ks = try ls.body().caseOf(known_r, "some");
    const known_result = try ls.body().match(known_r, &.{ try kn.ret(try kn.body().constant(bool, true)), try ks.ret(try ks.body().select(try ks.body().equal(ls.payload(), ks.payload()), lexical, try ks.body().less(ls.payload(), ks.payload()))) });
    const cheaper = try body.match(l, &.{ try ln.ret(unknown_result), try ls.ret(known_result) });
    try c.define(f, try body.ret(try body.select(try body.equal(preferred_left, preferred_right), cheaper, preferred_left)));
    return f;
}

fn selector(e: Emit) !*const a.Function {
    const c = e.c;
    const better = try preferable(e, try cost(e));
    const valid_identifier = try identifierValid(e);
    const tried_contains = try membership(e, Tried);
    const domains_contains = try membership(e, @import("agent_contracts").Vector(m.Identifier, 16));
    const f = try c.function("mobility choose candidate", &.{ .{ .name = "candidates", .schema = try e.schema(Candidates) }, .{ .name = "constraints", .schema = try e.schema(m.Constraints) }, .{ .name = "tried", .schema = try e.schema(Tried) }, .{ .name = "index", .schema = try c.scalar(u64) }, .{ .name = "best", .schema = try e.schema(?m.Candidate) } }, try e.schema(?m.Candidate), &.{});
    const body = try c.body(f);
    const candidates = try body.parameter("candidates");
    const constraints = try body.parameter("constraints");
    const tried = try body.parameter("tried");
    const index = try body.parameter("index");
    const best = try body.parameter("best");
    const item = try e.candidateAt(body, candidates, index);
    const none = try body.caseOf(item, "none");
    const some = try body.caseOf(item, "some");
    const work = some.body();
    const candidate = some.payload();
    const host = try e.host(work, candidate);
    const domains = try work.field(constraints, "allowed_trust_domains");
    const domain_allowed = try work.call(domains_contains, &.{ .{ .name = "items", .value = domains }, .{ .name = "needle", .value = try work.field(candidate, "trust_domain") }, .{ .name = "index", .value = try work.constant(u64, 0) } });
    const tried_before = try work.call(tried_contains, &.{ .{ .name = "items", .value = tried }, .{ .name = "needle", .value = host }, .{ .name = "index", .value = try work.constant(u64, 0) } });
    const host_allowed = try e.optionalMatch(work, try work.field(constraints, "required_host_id"), host, true);
    const domain_ok = try work.select(try work.equal(try work.sequenceLength(domains), try work.constant(u64, 0)), try work.constant(bool, true), domain_allowed);
    var eligible = try e.boolean(work, try e.boolean(work, host_allowed, domain_ok), try work.equal(tried_before, try work.constant(bool, false)));
    const identifiers = [_]*const a.Value{ host, try work.field(candidate, "trust_domain"), try work.field(candidate, "cost_revision"), try work.field(try work.field(candidate, "observation"), "policy_revision") };
    for (identifiers) |identifier| eligible = try e.boolean(work, eligible, try work.call(valid_identifier, &.{ .{ .name = "value", .value = identifier }, .{ .name = "index", .value = try work.constant(u64, 0) } }));
    const empty = try work.caseOf(best, "none");
    const present = try work.caseOf(best, "some");
    const selected = try work.match(best, &.{ try empty.ret(try empty.body().variant(try e.schema(?m.Candidate), "some", candidate)), try present.ret(try present.body().select(try present.body().call(better, &.{ .{ .name = "left", .value = candidate }, .{ .name = "right", .value = present.payload() }, .{ .name = "constraints", .value = constraints } }), try present.body().variant(try e.schema(?m.Candidate), "some", candidate), best)) });
    const next = try work.call(f, &.{ .{ .name = "candidates", .value = candidates }, .{ .name = "constraints", .value = constraints }, .{ .name = "tried", .value = tried }, .{ .name = "index", .value = try e.increment(work, index) }, .{ .name = "best", .value = try work.select(eligible, selected, best) } });
    try c.define(f, try body.ret(try body.match(item, &.{ try none.ret(best), try some.ret(next) })));
    return f;
}

fn attempts(e: Emit, select: *const a.Function, move_op: *const a.Operation) !*const a.Function {
    const c = e.c;
    const f = try c.function("mobility bounded attempts", &.{ .{ .name = "input", .schema = try e.schema(m.EnsureInput) }, .{ .name = "candidates", .schema = try e.schema(Candidates) }, .{ .name = "tried", .schema = try e.schema(Tried) }, .{ .name = "attempt", .schema = try c.scalar(u32) } }, try e.schema(m.PlacementResult), &.{move_op});
    const body = try c.body(f);
    const input = try body.parameter("input");
    const candidates = try body.parameter("candidates");
    const tried = try body.parameter("tried");
    const attempt = try body.parameter("attempt");
    const budget = try body.field(input, "budget");
    const placement = try body.field(input, "placement");
    const moves = try body.field(budget, "moves");
    const limit = try body.field(budget, "attempts");
    const exhausted = try body.branch();
    const active = try body.branch();
    const eligible = try e.boolean(body, try e.boolean(body, try body.less(attempt, limit), try body.less(attempt, try body.constant(u32, 32))), try body.less(try body.constant(u32, 0), moves));
    const selected = try active.call(select, &.{ .{ .name = "candidates", .value = candidates }, .{ .name = "constraints", .value = try active.field(placement, "constraints") }, .{ .name = "tried", .value = tried }, .{ .name = "index", .value = try active.constant(u64, 0) }, .{ .name = "best", .value = try active.variant(try e.schema(?m.Candidate), "none", try active.constant(void, {})) } });
    const unavailable = try active.caseOf(selected, "none");
    const chosen = try active.caseOf(selected, "some");
    const work = chosen.body();
    const host = try e.host(work, chosen.payload());
    const request = try work.product(try e.schema(m.RelocateInput), &.{ .{ .name = "destination_host_id", .value = host }, .{ .name = "requirements", .value = try work.field(placement, "requirements") }, .{ .name = "placement_intent_id", .value = try work.field(input, "placement_intent_id") }, .{ .name = "export_policy_ref", .value = try work.field(input, "export_policy_ref") }, .{ .name = "remaining_move_budget", .value = moves } });
    const reply = try a.interop.term(work, try m.relocate(e.agent, try a.interop.functionId(c, f), try a.interop.valueId(work, request)), try e.schema(m.RelocationReply));
    const arrived = try work.caseOf(reply, "Arrived");
    const refused = try work.caseOf(reply, "Refused");
    const again = try refused.body().call(f, &.{ .{ .name = "input", .value = input }, .{ .name = "candidates", .value = candidates }, .{ .name = "tried", .value = try refused.body().append(tried, host) }, .{ .name = "attempt", .value = try refused.body().checkedAdd(attempt, try refused.body().constant(u32, 1), e.fault) } });
    const result = try work.match(reply, &.{ try arrived.ret(try e.ready(arrived.body(), try arrived.body().field(arrived.payload(), "observation"), try e.subtract(arrived.body(), moves, try arrived.body().constant(u32, 1)))), try refused.ret(again) });
    const choice = try active.match(selected, &.{ try unavailable.ret(try e.failed(unavailable.body(), "unavailable")), try chosen.ret(result) });
    try c.define(f, try body.ret(try body.conditional(eligible, try active.ret(choice), try exhausted.ret(try e.failed(exhausted, "budget_exhausted")))));
    return f;
}

pub fn define(context: Context, failure: Id) !Id {
    if (failure >= context.builder.values.items.len) return error.InvalidReference;
    const cached = try context.builder.specialization(Id, "agent.mobility.ensure/v1", .{failure});
    if (cached.cached) |present| return present;
    const c = try a.Context.init(context.builder);
    const e = Emit{ .agent = context, .c = c, .fault = try a.interop.literalFailure(c, failure, try a.interop.schema(c, context.builder.values.items[@intCast(failure)].schema)) };
    const definition = try m.define(context);
    const resolve_op = try a.interop.operation(c, definition.resolve);
    const move_op = try a.interop.operation(c, definition.relocate);
    const attempt = try attempts(e, try selector(e), move_op);
    const f = try c.function("ensure placement", &.{.{ .name = "input", .schema = try e.schema(m.EnsureInput) }}, try e.schema(m.PlacementResult), &.{ resolve_op, move_op });
    const body = try c.body(f);
    const input = try body.parameter("input");
    const resolution = try a.interop.term(body, try m.resolve(context, try a.interop.functionId(c, f), try a.interop.valueId(body, try body.field(input, "placement"))), try e.schema(m.Resolution));
    const here = try body.caseOf(resolution, "Here");
    const candidates = try body.caseOf(resolution, "Candidates");
    const unavailable = try body.caseOf(resolution, "Unavailable");
    const placed = try candidates.body().call(attempt, &.{ .{ .name = "input", .value = input }, .{ .name = "candidates", .value = candidates.payload() }, .{ .name = "tried", .value = try candidates.body().sequenceValue(try e.schema(Tried), &.{}) }, .{ .name = "attempt", .value = try candidates.body().constant(u32, 0) } });
    const result = try body.match(resolution, &.{ try here.ret(try e.ready(here.body(), here.payload(), try here.body().field(try here.body().field(input, "budget"), "moves"))), try candidates.ret(placed), try unavailable.ret(try unavailable.body().variant(try e.schema(m.PlacementResult), "Failed", unavailable.payload())) });
    try c.define(f, try body.ret(result));
    return cached.finish(context.builder, try a.interop.functionId(c, f));
}
