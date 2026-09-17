//! Authored experiment admission, selection, acquisition and observation sharing.
//! No runtime native callback, continuation registry or external evidence cache.
const std = @import("std");
const boundary = @import("boundary");
const source = boundary.computation;
const custody = @import("inquiry.zig");
const equality = @import("value_equality.zig");
const authoring = @import("authoring.zig");
const admission = @import("admission.zig");
const Id = source.Id;
const Builder = source.Builder;
pub const Error = equality.Error || admission.Error;

pub const Status = enum(u8) {
    finished,
    unresolved,
    stopped,
    invalid_selection,
    invalid_evidence,
    environment_unavailable,
    conflicting_observations,
};

pub const Spec = struct {
    identity: []const u8,
    subject: Id,
    demand: Id,
    key: Id,
    observation: Id,
    finding: Id,
    policy: Id,
    failure: Id,
    scope: @import("dialogue.zig").Scope = .{},
};

pub const Types = struct {
    /// Admitted(key, reusable, priority class, cost class).
    admitted: Id,
    /// Denied | Admitted | Retire. Application derives dispositions and metadata.
    admission: Id,
    /// (ordinary custody view, admitted metadata).
    eligible: Id,
    eligible_list: Id,
    /// (experiment occurrence, key, observation, reusable).
    record: Id,
    records: Id,
    /// Evidence(record) | Denied | Inconclusive | NoNewEvidence(record).
    reply: Id,
    /// Completed(observation) | Inconclusive | EnvironmentUnavailable.
    completion: Id,
    /// (subject, key, occurrence, completion).
    envelope: Id,
    /// (subject, key, demand, occurrence).
    request: Id,
    /// (status, findings, records, acquisitions, reuse passes, recipients).
    outcome: Id,
};

pub const Definition = struct {
    custody: custody.Definition,
    types: Types,
    experiment: Id,
    subject_equal: Id,
    key_equal: Id,
    observation_equal: Id,
};

pub const Functions = struct {
    /// Pure (subject, demand) -> admission.
    admit: Id,
    /// Pure (subject, policy, eligible_list, findings) -> generation. Zero stops.
    select: Id,
    /// Pure (subject, findings) -> bool. A true result disposes remaining work.
    finish: Id,
    /// Optional pure (subject, key, observation) -> bool, for application result-kind checks.
    observe: ?Id = null,
};

pub fn define(b: *Builder, spec: Spec) Error!Definition {
    const instance = try b.specialization(Definition, "agent.inquiry.broker/v1", .{spec});
    if (instance.cached) |value| return value;
    for (b.effects.items) |effect|
        if (std.mem.eql(u8, effect.identity, spec.identity)) return error.InvalidSource;
    const integer = try b.scalar(u64);
    const unit = try b.scalar(void);
    const boolean = try b.scalar(bool);
    const record = try b.schema(.{ .product = &.{ integer, spec.key, spec.observation, boolean } });
    const records = try b.schema(.{ .seq = record });
    const reply = try b.schema(.{ .sum = &.{ record, unit, unit, record } });
    const admitted = try b.schema(.{ .product = &.{ spec.key, boolean, integer, integer } });
    const completion = try b.schema(.{ .sum = &.{ spec.observation, unit, unit } });
    const captures = try b.allocator().alloc(Id, spec.scope.captures.len + 5);
    @memcpy(captures[0..spec.scope.captures.len], spec.scope.captures);
    @memcpy(captures[spec.scope.captures.len..], &[_]Id{ spec.subject, spec.key, spec.observation, record, reply });
    var scope = spec.scope;
    scope.captures = captures;
    const own = try custody.define(b, .{
        .identity = spec.identity,
        .demand = spec.demand,
        .reply = reply,
        .finding = spec.finding,
        .failure = spec.failure,
        .scope = scope,
    });
    const eligible = try b.schema(.{ .product = &.{ own.types.view, admitted } });
    const request = try b.schema(.{ .product = &.{ spec.subject, spec.key, spec.demand, integer } });
    const envelope = try b.schema(.{ .product = &.{ spec.subject, spec.key, integer, completion } });
    const identity = try std.fmt.allocPrint(b.allocator(), "{s}.experiment.v1", .{spec.identity});
    const experiment = try b.effect(.{ .identity = identity, .payload = request, .result = envelope });
    return instance.finish(b, .{
        .custody = own,
        .experiment = experiment,
        .subject_equal = try equality.define(b, spec.subject, spec.failure),
        .key_equal = try equality.define(b, spec.key, spec.failure),
        .observation_equal = try equality.define(b, spec.observation, spec.failure),
        .types = .{
            .admitted = admitted,
            .admission = try b.schema(.{ .sum = &.{ unit, admitted, unit } }),
            .eligible = eligible,
            .eligible_list = try b.schema(.{ .seq = eligible }),
            .record = record,
            .records = records,
            .reply = reply,
            .completion = completion,
            .envelope = envelope,
            .request = request,
            .outcome = try b.schema(.{ .product = &.{ try b.scalar(u8), own.types.findings, records, integer, integer, integer } }),
        },
    });
}

/// Returns (custody state, subject, allowance, coalesce, policy) -> outcome.
/// Allowance counts delivery/acquisition passes, including denied and cached
/// work. Every iteration spends one unit. It cannot be reset by an investigator.
pub fn implement(b: *Builder, spec: Spec, d: Definition, functions: Functions) Error!Id {
    return implementWithRegistry(b, spec, d, functions, null);
}

/// Protected Agent authoring classifies acquisition as real external write work.
/// Its actual transitive body cannot enter a model-only speculative scope.
pub fn implementProtected(c: authoring.Context, spec: Spec, d: Definition, functions: Functions) !Id {
    try c.registry.classify(d.experiment, .write);
    try c.registry.classify(d.custody.dialogue.effect, .internal);
    return implementWithRegistry(c.builder, spec, d, functions, c.registry);
}

fn implementWithRegistry(b: *Builder, spec: Spec, d: Definition, functions: Functions, registry: ?*admission.Registry) Error!Id {
    const integer = try b.scalar(u64);
    const boolean = try b.scalar(bool);
    try checkPure(b, functions.admit, &.{ spec.subject, spec.demand }, d.types.admission);
    try checkPure(b, functions.select, &.{ spec.subject, spec.policy, d.types.eligible_list, d.custody.types.findings }, integer);
    try checkPure(b, functions.finish, &.{ spec.subject, d.custody.types.findings }, boolean);
    if (functions.observe) |observe|
        try checkPure(b, observe, &.{ spec.subject, spec.key, spec.observation }, boolean);
    const effects = try b.allocator().alloc(Id, spec.scope.residual.effects.len + 1);
    @memcpy(effects[0..spec.scope.residual.effects.len], spec.scope.residual.effects);
    effects[effects.len - 1] = d.experiment;
    std.mem.sort(Id, effects, {}, std.sort.asc(Id));
    const e: Emit = .{ .b = b, .s = spec, .d = d, .f = functions, .integer = integer, .boolean = boolean, .unit = try b.scalar(void), .effects = effects, .registry = registry };
    return e.controller();
}

/// Priority class, then a reusable experiment with distinguishable predictions,
/// then cost class and oldest generation. The broker independently gives cached
/// applicable work precedence over this policy. `discriminates` is pure authored
/// (demand, demand) -> bool; it interprets application predictions/actions.
pub fn defaultSelection(b: *Builder, spec: Spec, d: Definition, discriminates: Id) Error!Id {
    const boolean = try b.scalar(bool);
    try checkPure(b, discriminates, &.{ spec.demand, spec.demand }, boolean);
    const e: Emit = .{ .b = b, .s = spec, .d = d, .f = null, .integer = try b.scalar(u64), .boolean = boolean, .unit = try b.scalar(void), .effects = &.{} };
    return e.defaultPolicy(discriminates);
}

fn checkPure(b: *Builder, function: Id, parameters: []const Id, result: Id) Error!void {
    if (function >= b.functions.items.len) return error.InvalidReference;
    const f = b.functions.items[@intCast(function)];
    if (f.parameters.len != parameters.len or f.result != result) return error.TypeMismatch;
    if (f.effects.len != 0 or f.regions.len != 0) return error.InvalidEffect;
    for (f.parameters, parameters) |variable, expected|
        if (b.variables.items[@intCast(variable)] != expected) return error.TypeMismatch;
}

const Emit = struct {
    b: *Builder,
    s: Spec,
    d: Definition,
    f: ?Functions,
    integer: Id,
    boolean: Id,
    unit: Id,
    effects: []const Id,
    registry: ?*admission.Registry = null,

    fn ref(e: Emit, v: Id) Error!Id {
        return e.b.reference(v);
    }
    fn p(e: Emit, f: Id, i: usize) Error!Id {
        return e.ref(e.b.parameter(f, i));
    }
    fn n(e: Emit, v: u64) Error!Id {
        return e.b.constant(u64, v);
    }
    fn call(e: Emit, f: Id, args: []const Id) Error!Id {
        return e.b.term(.{ .call = .{ .function = f, .arguments = args } });
    }
    fn field(e: Emit, t: Id, v: Id, i: u64) Error!Id {
        return e.b.primitive(t, .field, &.{v}, i);
    }
    fn product(e: Emit, t: Id, values: []const Id) Error!Id {
        return e.b.primitive(t, .product, values, 0);
    }
    fn variant(e: Emit, t: Id, v: Id, tag: u64) Error!Id {
        return e.b.primitive(t, .variant, &.{v}, tag);
    }
    fn sequence(e: Emit, t: Id, values: []const Id) Error!Id {
        return e.b.primitive(t, .sequence, values, 0);
    }
    fn append(e: Emit, t: Id, items: Id, v: Id) Error!Id {
        return e.b.primitive(t, .sequence_append, &.{ items, v }, 0);
    }
    fn eq(e: Emit, a: Id, b: Id) Error!Id {
        return e.b.primitive(e.boolean, .equal, &.{ a, b }, 0);
    }
    fn len(e: Emit, v: Id) Error!Id {
        return e.b.primitive(e.integer, .sequence_length, &.{v}, 0);
    }
    fn cond(e: Emit, v: Id, yes: Id, no: Id) Error!Id {
        return e.b.term(.{ .conditional = .{ .condition = v, .when_true = yes, .when_false = no } });
    }
    fn arithmetic(e: Emit, op: boundary.data.program.Opcode, a: Id, b: Id) Error!Id {
        return e.b.value(.{ .schema = e.integer, .expression = .{ .primitive = .{
            .opcode = op,
            .operands = &.{ a, b },
            .failures = &.{.{
                .kind = .arithmetic_overflow,
                .value = try e.b.failureLiteral(e.s.failure),
            }},
        } } });
    }
    fn unpack(e: Emit, value: Id, vars: []const Id, body: Id) Error!Id {
        return e.b.term(.{ .unpack_product = .{ .value = value, .variables = vars, .body = body } });
    }
    fn meta(e: Emit, offered: Id) Error!Id {
        return e.field(e.d.types.admitted, offered, 1);
    }
    fn view(e: Emit, offered: Id) Error!Id {
        return e.field(e.d.custody.types.view, offered, 0);
    }
    fn experimentKey(e: Emit, offered: Id) Error!Id {
        return e.field(e.s.key, try e.meta(offered), 0);
    }
    fn demandGeneration(e: Emit, offered: Id) Error!Id {
        return e.field(e.integer, try e.view(offered), 1);
    }
    fn reusable(e: Emit, offered: Id) Error!Id {
        return e.field(e.boolean, try e.meta(offered), 1);
    }

    fn admitViews(e: Emit) Error!Id {
        const b = e.b;
        const t = e.d.types;
        const own = e.d.custody.types;
        const result = try b.schema(.{ .product = &.{ t.eligible_list, own.ids, own.ids } });
        const f = try b.declare(&.{ own.views, e.s.subject, t.eligible_list, own.ids, own.ids }, result, &.{}, &.{});
        const pop = try Pop.init(e, own.views, own.view);
        const response = try b.variable(t.admission);
        const denied = try b.variable(e.unit);
        const retirement = try b.variable(e.unit);
        const metadata = try b.variable(t.admitted);
        const head = try e.ref(pop.head);
        const bad = try e.call(f, &.{ try e.ref(pop.rest), try e.p(f, 1), try e.p(f, 2), try e.append(own.ids, try e.p(f, 3), try e.field(e.integer, head, 1)), try e.p(f, 4) });
        const retired = try e.call(f, &.{ try e.ref(pop.rest), try e.p(f, 1), try e.p(f, 2), try e.p(f, 3), try e.append(own.ids, try e.p(f, 4), try e.field(e.integer, head, 1)) });
        const admitted = try e.product(t.eligible, &.{ head, try e.ref(metadata) });
        const good = try e.call(f, &.{ try e.ref(pop.rest), try e.p(f, 1), try e.append(t.eligible_list, try e.p(f, 2), admitted), try e.p(f, 3), try e.p(f, 4) });
        const branch = try b.term(.{ .match_sum = .{ .value = try e.ref(response), .cases = &.{
            .{ .variable = denied, .body = bad },         .{ .variable = metadata, .body = good },
            .{ .variable = retirement, .body = retired },
        } } });
        const next = try b.bind(response, try e.call(e.f.?.admit, &.{ try e.p(f, 1), try e.field(e.s.demand, head, 2) }), branch);
        try b.define(f, try pop.match(e, try e.p(f, 0), try b.pure(try e.product(result, &.{ try e.p(f, 2), try e.p(f, 3), try e.p(f, 4) })), next));
        return f;
    }

    // Only reusable completed records are applicable; failures never enter this list.
    fn lookupFunction(e: Emit, optional: Id) Error!Id {
        const b = e.b;
        const t = e.d.types;
        const f = try b.declare(&.{ t.records, e.s.key }, optional, &.{}, &.{});
        const pop = try Pop.init(e, t.records, t.record);
        const same = try b.variable(e.boolean);
        const next = try e.call(f, &.{ try e.ref(pop.rest), try e.p(f, 1) });
        const item = try e.ref(pop.head);
        const found = try b.pure(try e.variant(optional, item, 1));
        const compare = try b.bind(same, try e.call(e.d.key_equal, &.{ try e.field(e.s.key, item, 1), try e.p(f, 1) }), try e.cond(try e.ref(same), found, next));
        try b.define(f, try pop.match(e, try e.p(f, 0), try b.pure(try e.variant(optional, try b.constant(void, {}), 0)), try e.cond(try e.field(e.boolean, item, 3), compare, next)));
        return f;
    }

    fn cachedChoice(e: Emit, lookup: Id, optional: Id) Error!Id {
        const b = e.b;
        const t = e.d.types;
        const f = try b.declare(&.{ t.eligible_list, t.records, t.eligible_list }, t.eligible_list, &.{}, &.{});
        const pop = try Pop.init(e, t.eligible_list, t.eligible);
        const cached = try b.variable(optional);
        const missing = try b.variable(e.unit);
        const found = try b.variable(t.record);
        const next = try e.call(f, &.{ try e.ref(pop.rest), try e.p(f, 1), try e.p(f, 2) });
        const included = try e.call(f, &.{ try e.ref(pop.rest), try e.p(f, 1), try e.append(t.eligible_list, try e.p(f, 2), try e.ref(pop.head)) });
        const branch = try b.term(.{ .match_sum = .{
            .value = try e.ref(cached),
            .cases = &.{ .{ .variable = missing, .body = next }, .{ .variable = found, .body = included } },
        } });
        const checked = try b.bind(cached, try e.call(lookup, &.{ try e.p(f, 1), try e.experimentKey(try e.ref(pop.head)) }), branch);
        try b.define(f, try pop.match(e, try e.p(f, 0), try b.pure(try e.p(f, 2)), try e.cond(try e.reusable(try e.ref(pop.head)), checked, next)));
        return f;
    }

    fn selectedFunction(e: Emit, optional: Id) Error!Id {
        const b = e.b;
        const t = e.d.types;
        const f = try b.declare(&.{ t.eligible_list, e.integer }, optional, &.{}, &.{});
        const pop = try Pop.init(e, t.eligible_list, t.eligible);
        const next = try e.call(f, &.{ try e.ref(pop.rest), try e.p(f, 1) });
        const item = try e.ref(pop.head);
        try b.define(f, try pop.match(e, try e.p(f, 0), try b.pure(try e.variant(optional, try b.constant(void, {}), 0)), try e.cond(try e.eq(try e.demandGeneration(item), try e.p(f, 1)), try b.pure(try e.variant(optional, item, 1)), next)));
        return f;
    }

    fn recipients(e: Emit) Error!Id {
        const b = e.b;
        const t = e.d.types;
        const ids = e.d.custody.types.ids;
        const f = try b.declare(&.{ t.eligible_list, t.eligible, e.boolean, ids }, ids, &.{}, &.{});
        const pop = try Pop.init(e, t.eligible_list, t.eligible);
        const same = try b.variable(e.boolean);
        const item = try e.ref(pop.head);
        const chosen = try e.p(f, 1);
        const next = try e.call(f, &.{ try e.ref(pop.rest), chosen, try e.p(f, 2), try e.p(f, 3) });
        const included = try e.call(f, &.{ try e.ref(pop.rest), chosen, try e.p(f, 2), try e.append(ids, try e.p(f, 3), try e.demandGeneration(item)) });
        const compare = try b.bind(same, try e.call(e.d.key_equal, &.{ try e.experimentKey(item), try e.experimentKey(chosen) }), try e.cond(try e.ref(same), included, next));
        const shared = try e.cond(try e.reusable(item), compare, next);
        const eligible = try e.cond(try e.p(f, 2), try e.cond(try e.reusable(chosen), shared, next), next);
        const choose = try e.cond(try e.eq(try e.demandGeneration(item), try e.demandGeneration(chosen)), included, eligible);
        try b.define(f, try pop.match(e, try e.p(f, 0), try b.pure(try e.p(f, 3)), choose));
        return f;
    }

    fn discriminating(e: Emit, discriminator: Id) Error!Id {
        const b = e.b;
        const t = e.d.types;
        const f = try b.declare(&.{ t.eligible, t.eligible_list }, e.boolean, &.{}, &.{});
        const pop = try Pop.init(e, t.eligible_list, t.eligible);
        const candidate = try e.p(f, 0);
        const other = try e.ref(pop.head);
        const same = try b.variable(e.boolean);
        const differs = try b.variable(e.boolean);
        const next = try e.call(f, &.{ candidate, try e.ref(pop.rest) });
        const check_predictions = try b.bind(differs, try e.call(discriminator, &.{ try e.field(e.s.demand, try e.view(candidate), 2), try e.field(e.s.demand, try e.view(other), 2) }), try e.cond(try e.ref(differs), try b.pure(try b.constant(bool, true)), next));
        const check_key = try b.bind(same, try e.call(e.d.key_equal, &.{ try e.experimentKey(candidate), try e.experimentKey(other) }), try e.cond(try e.ref(same), check_predictions, next));
        const different = try e.cond(try e.eq(try e.demandGeneration(candidate), try e.demandGeneration(other)), next, check_key);
        const checked = try e.cond(try e.reusable(candidate), try e.cond(try e.reusable(other), different, next), next);
        try b.define(f, try pop.match(e, try e.p(f, 1), try b.pure(try b.constant(bool, false)), checked));
        return f;
    }

    fn less(e: Emit, a: Id, b: Id) Error!Id {
        return e.b.primitive(e.boolean, .less, &.{ a, b }, 0);
    }
    fn selectValue(e: Emit, condition: Id, yes: Id, no: Id) Error!Id {
        return e.b.primitive(e.boolean, .select, &.{ condition, yes, no }, 0);
    }
    fn better(e: Emit, a: Id, b: Id, shared_a: Id, shared_b: Id) Error!Id {
        const ma = try e.meta(a);
        const mb = try e.meta(b);
        const priority_a = try e.field(e.integer, ma, 2);
        const priority_b = try e.field(e.integer, mb, 2);
        const cost_a = try e.field(e.integer, ma, 3);
        const cost_b = try e.field(e.integer, mb, 3);
        const oldest = try e.less(try e.demandGeneration(a), try e.demandGeneration(b));
        const cheapest = try e.selectValue(try e.eq(cost_a, cost_b), oldest, try e.less(cost_a, cost_b));
        const shared = try e.selectValue(try e.eq(shared_a, shared_b), cheapest, shared_a);
        return e.selectValue(try e.eq(priority_a, priority_b), shared, try e.less(priority_a, priority_b));
    }

    fn defaultPolicy(e: Emit, discriminator: Id) Error!Id {
        const b = e.b;
        const t = e.d.types;
        const choice = try b.schema(.{ .sum = &.{ e.unit, t.eligible } });
        const score = try e.discriminating(discriminator);
        const scan = try b.declare(&.{ t.eligible_list, t.eligible_list, choice, e.boolean }, e.integer, &.{}, &.{});
        const pop = try Pop.init(e, t.eligible_list, t.eligible);
        const no_best = try b.variable(e.unit);
        const best = try b.variable(t.eligible);
        const head_shared = try b.variable(e.boolean);
        const head = try e.ref(pop.head);
        const adopt = try e.call(scan, &.{ try e.ref(pop.rest), try e.p(scan, 1), try e.variant(choice, head, 1), try e.ref(head_shared) });
        const retain = try e.call(scan, &.{ try e.ref(pop.rest), try e.p(scan, 1), try e.p(scan, 2), try e.p(scan, 3) });
        const compare = try e.cond(try e.better(head, try e.ref(best), try e.ref(head_shared), try e.p(scan, 3)), adopt, retain);
        const select_best = try b.term(.{ .match_sum = .{
            .value = try e.p(scan, 2),
            .cases = &.{ .{ .variable = no_best, .body = adopt }, .{ .variable = best, .body = compare } },
        } });
        const next = try b.bind(head_shared, try e.call(score, &.{ head, try e.p(scan, 1) }), select_best);
        const empty = try b.variable(e.unit);
        const final = try b.variable(t.eligible);
        const answer = try b.term(.{ .match_sum = .{
            .value = try e.p(scan, 2),
            .cases = &.{ .{ .variable = empty, .body = try b.pure(try e.n(0)) }, .{ .variable = final, .body = try b.pure(try e.demandGeneration(try e.ref(final))) } },
        } });
        try b.define(scan, try pop.match(e, try e.p(scan, 0), answer, next));
        const f = try b.declare(&.{ e.s.subject, e.s.policy, t.eligible_list, e.d.custody.types.findings }, e.integer, &.{}, &.{});
        try b.define(f, try e.call(scan, &.{ try e.p(f, 2), try e.p(f, 2), try e.variant(choice, try b.constant(void, {}), 0), try b.constant(bool, false) }));
        return f;
    }

    // Loop arguments: state, subject, allowance, coalesce, policy, records,
    // next experiment occurrence, acquisition count, cache passes, recipients.
    fn controller(e: Emit) Error!Id {
        const b = e.b;
        const t = e.d.types;
        const own = e.d.custody.types;
        const args: []const Id = &.{ own.state, e.s.subject, e.integer, e.boolean, e.s.policy, t.records, e.integer, e.integer, e.integer, e.integer };
        const loop = try b.declare(args, t.outcome, e.effects, e.s.scope.borrowed_regions);
        const stop = try e.stopper();
        const optional = try b.schema(.{ .sum = &.{ e.unit, t.record } });
        const choice = try b.schema(.{ .sum = &.{ e.unit, t.eligible } });
        const lookup = try e.lookupFunction(optional);
        const ops: Ops = .{ .loop = loop, .stop = stop, .optional = optional, .choice = choice, .admit = try e.admitViews(), .lookup = lookup, .recipients = try e.recipients(), .selected = try e.selectedFunction(choice), .cached_choice = try e.cachedChoice(lookup, optional) };
        try b.define(loop, try e.loopBody(ops));
        const run = try b.declare(args[0..5], t.outcome, e.effects, e.s.scope.borrowed_regions);
        try b.define(run, try e.call(loop, &.{ try e.p(run, 0), try e.p(run, 1), try e.p(run, 2), try e.p(run, 3), try e.p(run, 4), try e.sequence(t.records, &.{}), try e.n(1), try e.n(0), try e.n(0), try e.n(0) }));
        return run;
    }

    fn stopper(e: Emit) Error!Id {
        const b = e.b;
        const t = e.d.types;
        const f = try b.declare(&.{ e.d.custody.types.state, try b.scalar(u8), t.records, e.integer, e.integer, e.integer }, t.outcome, e.effects, e.s.scope.borrowed_regions);
        const findings = try b.variable(e.d.custody.types.findings);
        const result = try e.product(t.outcome, &.{ try e.p(f, 1), try e.ref(findings), try e.p(f, 2), try e.p(f, 3), try e.p(f, 4), try e.p(f, 5) });
        try b.define(f, try b.bind(findings, try e.call(e.d.custody.finish, &.{try e.p(f, 0)}), try b.pure(result)));
        return f;
    }

    fn stopWith(e: Emit, o: Ops, state: Id, status: Status, records: Id) Error!Id {
        return e.call(o.stop, &.{ state, try e.b.constant(u8, @intFromEnum(status)), records, try e.p(o.loop, 7), try e.p(o.loop, 8), try e.p(o.loop, 9) });
    }

    fn stopAfterAcquisition(e: Emit, o: Ops, state: Id, status: Status, records: Id) Error!Id {
        return e.call(o.stop, &.{ state, try e.b.constant(u8, @intFromEnum(status)), records, try e.arithmetic(.integer_add, try e.p(o.loop, 7), try e.n(1)), try e.p(o.loop, 8), try e.p(o.loop, 9) });
    }

    fn again(e: Emit, o: Ops, state: Id, records: Id, acquired: bool, reused: bool, recipients_count: Id) Error!Id {
        const f = o.loop;
        return e.call(f, &.{ state, try e.p(f, 1), try e.arithmetic(.integer_sub, try e.p(f, 2), try e.n(1)), try e.p(f, 3), try e.p(f, 4), records, try e.arithmetic(.integer_add, try e.p(f, 6), try e.n(@intFromBool(acquired))), try e.arithmetic(.integer_add, try e.p(f, 7), try e.n(@intFromBool(acquired))), try e.arithmetic(.integer_add, try e.p(f, 8), try e.n(@intFromBool(reused))), try e.arithmetic(.integer_add, try e.p(f, 9), recipients_count) });
    }

    fn loopBody(e: Emit, o: Ops) Error!Id {
        const b = e.b;
        const own = e.d.custody.types;
        const queue = try b.variable(own.queue);
        const findings = try b.variable(own.findings);
        const generation = try b.variable(e.integer);
        const rebuilt = try e.product(own.state, &.{ try e.ref(queue), try e.ref(findings), try e.ref(generation) });
        const done = try b.variable(e.boolean);
        const projected = try b.variable(own.projected);
        const state = try b.variable(own.state);
        const views = try b.variable(own.views);
        const select = try e.chooseWork(o, try e.ref(state), try e.ref(views), try e.ref(findings));
        const active = try b.bind(projected, try e.call(e.d.custody.project, &.{rebuilt}), try e.unpack(try e.ref(projected), &.{ state, views }, select));
        const empty = try e.eq(try e.len(try e.ref(queue)), try e.n(0));
        const finished = try e.stopWith(o, rebuilt, .finished, try e.p(o.loop, 5));
        const bounded = try e.cond(try e.eq(try e.p(o.loop, 2), try e.n(0)), try e.stopWith(o, rebuilt, .stopped, try e.p(o.loop, 5)), active);
        const terminal = try b.bind(done, try e.call(e.f.?.finish, &.{ try e.p(o.loop, 1), try e.ref(findings) }), try e.cond(try e.ref(done), finished, try e.cond(empty, finished, bounded)));
        return e.unpack(try e.p(o.loop, 0), &.{ queue, findings, generation }, terminal);
    }

    fn chooseWork(e: Emit, o: Ops, state: Id, views: Id, findings: Id) Error!Id {
        const b = e.b;
        const t = e.d.types;
        const ids = e.d.custody.types.ids;
        const admitted_type = b.functions.items[@intCast(o.admit)].result;
        const admitted = try b.variable(admitted_type);
        const offered = try b.variable(t.eligible_list);
        const denied = try b.variable(ids);
        const retired = try b.variable(ids);
        const after_denial = try b.variable(e.d.custody.types.state);
        const after_retirement = try b.variable(e.d.custody.types.state);
        const reject = try b.bind(after_denial, try e.call(e.d.custody.distribute, &.{ state, try e.ref(denied), try e.variant(t.reply, try b.constant(void, {}), 1) }), try e.again(o, try e.ref(after_denial), try e.p(o.loop, 5), false, false, try e.len(try e.ref(denied))));
        const good = try e.chooseAdmitted(o, state, try e.ref(offered), findings);
        const decide = try e.cond(try e.eq(try e.len(try e.ref(denied)), try e.n(0)), good, reject);
        const dispose = try b.bind(after_retirement, try e.call(e.d.custody.retire, &.{ state, try e.ref(retired) }), try e.again(o, try e.ref(after_retirement), try e.p(o.loop, 5), false, false, try e.n(0)));
        const selected = try e.cond(try e.eq(try e.len(try e.ref(retired)), try e.n(0)), decide, dispose);
        return b.bind(admitted, try e.call(o.admit, &.{ views, try e.p(o.loop, 1), try e.sequence(t.eligible_list, &.{}), try e.sequence(ids, &.{}), try e.sequence(ids, &.{}) }), try e.unpack(try e.ref(admitted), &.{ offered, denied, retired }, selected));
    }

    fn chooseAdmitted(e: Emit, o: Ops, state: Id, offered: Id, findings: Id) Error!Id {
        const b = e.b;
        const list = e.d.types.eligible_list;
        const cached = try b.variable(list);
        const candidates = try b.variable(list);
        const selected_id = try b.variable(e.integer);
        const choice = try b.variable(o.choice);
        const missing = try b.variable(e.unit);
        const found = try b.variable(e.d.types.eligible);
        const branch = try b.term(.{ .match_sum = .{
            .value = try e.ref(choice),
            .cases = &.{ .{ .variable = missing, .body = try e.stopWith(o, state, .invalid_selection, try e.p(o.loop, 5)) }, .{ .variable = found, .body = try e.dispatch(o, state, offered, try e.ref(found)) } },
        } });
        const checked = try b.bind(choice, try e.call(o.selected, &.{ try e.ref(candidates), try e.ref(selected_id) }), branch);
        const selected = try b.bind(selected_id, try e.call(e.f.?.select, &.{ try e.p(o.loop, 1), try e.p(o.loop, 4), try e.ref(candidates), findings }), try e.cond(try e.eq(try e.ref(selected_id), try e.n(0)), try e.stopWith(o, state, .unresolved, try e.p(o.loop, 5)), checked));
        const choose_candidates = try b.bind(candidates, try e.cond(try e.eq(try e.len(try e.ref(cached)), try e.n(0)), try b.pure(offered), try b.pure(try e.ref(cached))), selected);
        return b.bind(cached, try e.cond(try e.p(o.loop, 3), try e.call(o.cached_choice, &.{ offered, try e.p(o.loop, 5), try e.sequence(list, &.{}) }), try b.pure(try e.sequence(list, &.{}))), choose_candidates);
    }

    fn dispatch(e: Emit, o: Ops, state: Id, offered: Id, selected: Id) Error!Id {
        const b = e.b;
        const ids = try b.variable(e.d.custody.types.ids);
        const cached = try b.variable(o.optional);
        const absent = try b.variable(e.unit);
        const record = try b.variable(e.d.types.record);
        const acquire = try e.acquireObservation(o, state, selected, try e.ref(ids));
        const shared = try e.deliverRecord(o, state, try e.ref(ids), try e.ref(record), try e.p(o.loop, 5), false, true);
        const branch = try b.term(.{ .match_sum = .{
            .value = try e.ref(cached),
            .cases = &.{ .{ .variable = absent, .body = acquire }, .{ .variable = record, .body = shared } },
        } });
        const lookup = try b.bind(cached, try e.call(o.lookup, &.{ try e.p(o.loop, 5), try e.experimentKey(selected) }), branch);
        const perform = try e.cond(try e.p(o.loop, 3), try e.cond(try e.reusable(selected), lookup, acquire), acquire);
        return b.bind(ids, try e.call(o.recipients, &.{ offered, selected, try e.p(o.loop, 3), try e.sequence(e.d.custody.types.ids, &.{}) }), perform);
    }

    fn deliverRecord(e: Emit, o: Ops, state: Id, ids: Id, record: Id, records: Id, acquired: bool, reused: bool) Error!Id {
        const next = try e.b.variable(e.d.custody.types.state);
        const stored = try e.b.variable(e.d.types.records);
        const reply = try e.variant(e.d.types.reply, record, if (reused) 3 else 0);
        const distributed = try e.b.bind(next, try e.call(e.d.custody.distribute, &.{ state, ids, reply }), try e.again(o, try e.ref(next), try e.ref(stored), acquired, reused, try e.len(ids)));
        return e.b.bind(stored, try e.b.pure(records), distributed);
    }

    fn acquireObservation(e: Emit, o: Ops, state: Id, selected: Id, ids: Id) Error!Id {
        const b = e.b;
        const envelope = try b.variable(e.d.types.envelope);
        const response = try e.ref(envelope);
        const key = try e.experimentKey(selected);
        const subject = try e.p(o.loop, 1);
        const occurrence = try e.p(o.loop, 6);
        const same_subject = try b.variable(e.boolean);
        const same_key = try b.variable(e.boolean);
        const invalid = try e.stopAfterAcquisition(o, state, .invalid_evidence, try e.p(o.loop, 5));
        const complete = try e.completed(o, state, selected, ids, try e.field(e.d.types.completion, response, 3));
        const bound = try e.cond(try e.eq(occurrence, try e.field(e.integer, response, 2)), complete, invalid);
        const check_key = try b.bind(same_key, try e.call(e.d.key_equal, &.{ key, try e.field(e.s.key, response, 1) }), try e.cond(try e.ref(same_key), bound, invalid));
        const check_subject = try b.bind(same_subject, try e.call(e.d.subject_equal, &.{ subject, try e.field(e.s.subject, response, 0) }), try e.cond(try e.ref(same_subject), check_key, invalid));
        const request = try e.product(e.d.types.request, &.{ subject, key, try e.field(e.s.demand, try e.view(selected), 2), occurrence });
        const performed = try b.term(.{ .perform = .{
            .effect = e.d.experiment,
            .payload = request,
        } });
        if (e.registry) |registry| try registry.protectSite(o.loop, performed, e.d.experiment);
        return b.bind(envelope, performed, check_subject);
    }

    fn completed(e: Emit, o: Ops, state: Id, selected: Id, ids: Id, completion: Id) Error!Id {
        const b = e.b;
        const value = try b.variable(e.s.observation);
        const inconclusive = try b.variable(e.unit);
        const unavailable = try b.variable(e.unit);
        const next = try b.variable(e.d.custody.types.state);
        const unknown = try b.bind(next, try e.call(e.d.custody.distribute, &.{ state, ids, try e.variant(e.d.types.reply, try b.constant(void, {}), 2) }), try e.again(o, try e.ref(next), try e.p(o.loop, 5), true, false, try e.len(ids)));
        const record = try e.product(e.d.types.record, &.{ try e.p(o.loop, 6), try e.experimentKey(selected), try e.ref(value), try e.reusable(selected) });
        const stored = try e.append(e.d.types.records, try e.p(o.loop, 5), record);
        var accepted = try e.checkConflict(o, state, selected, ids, record, stored);
        if (e.f.?.observe) |observe| {
            const valid = try b.variable(e.boolean);
            accepted = try b.bind(valid, try e.call(observe, &.{ try e.p(o.loop, 1), try e.experimentKey(selected), try e.ref(value) }), try e.cond(try e.ref(valid), accepted, try e.stopAfterAcquisition(o, state, .invalid_evidence, try e.p(o.loop, 5))));
        }
        return b.term(.{ .match_sum = .{ .value = completion, .cases = &.{
            .{ .variable = value, .body = accepted },
            .{ .variable = inconclusive, .body = unknown },
            .{ .variable = unavailable, .body = try e.stopAfterAcquisition(o, state, .environment_unavailable, try e.p(o.loop, 5)) },
        } } });
    }

    fn checkConflict(e: Emit, o: Ops, state: Id, selected: Id, ids: Id, record: Id, records: Id) Error!Id {
        const b = e.b;
        const prior = try b.variable(o.optional);
        const absent = try b.variable(e.unit);
        const found = try b.variable(e.d.types.record);
        const same = try b.variable(e.boolean);
        const deliver = try e.deliverRecord(o, state, ids, record, records, true, false);
        const compared = try b.bind(same, try e.call(e.d.observation_equal, &.{ try e.field(e.s.observation, try e.ref(found), 2), try e.field(e.s.observation, record, 2) }), try e.cond(try e.ref(same), deliver, try e.stopAfterAcquisition(o, state, .conflicting_observations, records)));
        const branch = try b.term(.{ .match_sum = .{
            .value = try e.ref(prior),
            .cases = &.{ .{ .variable = absent, .body = deliver }, .{ .variable = found, .body = compared } },
        } });
        return e.cond(try e.reusable(selected), try b.bind(prior, try e.call(o.lookup, &.{ try e.p(o.loop, 5), try e.experimentKey(selected) }), branch), deliver);
    }
};

const Ops = struct {
    loop: Id,
    stop: Id,
    admit: Id,
    lookup: Id,
    optional: Id,
    choice: Id,
    cached_choice: Id,
    selected: Id,
    recipients: Id,
};

const Pop = struct {
    optional: Id,
    empty: Id,
    present: Id,
    head: Id,
    rest: Id,
    fn init(e: Emit, sequence: Id, element: Id) Error!Pop {
        const pair = try e.b.schema(.{ .product = &.{ element, sequence } });
        return .{ .optional = try e.b.schema(.{ .sum = &.{ e.unit, pair } }), .empty = try e.b.variable(e.unit), .present = try e.b.variable(pair), .head = try e.b.variable(element), .rest = try e.b.variable(sequence) };
    }
    fn match(p: Pop, e: Emit, sequence: Id, empty_body: Id, present: Id) Error!Id {
        return e.b.term(.{ .match_sum = .{
            .value = try e.b.primitive(p.optional, .sequence_pop, &.{sequence}, 0),
            .cases = &.{ .{ .variable = p.empty, .body = empty_body }, .{ .variable = p.present, .body = try e.unpack(try e.ref(p.present), &.{ p.head, p.rest }, present) } },
        } });
    }
};
