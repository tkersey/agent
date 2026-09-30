//! Authored experiment admission, selection, acquisition and observation sharing.
//! No runtime native callback, continuation registry or external evidence cache.
const std = @import("std");
const boundary = @import("boundary");
const source = boundary.source;
const typed = boundary.authoring;
const custody = @import("inquiry.zig");
const equality = @import("value_equality.zig");
const authoring = @import("authoring.zig");
const admission = @import("admission.zig");
const Id = source.Id;
const Builder = source.Builder;
pub const Error = equality.Error || admission.Error;
const ConstructionError = typed.Error || Error;
fn constructionError(err: ConstructionError) Error {
    return switch (err) {
        error.UnsupportedEqualitySchema, error.EffectRoleMismatch, error.DuplicateEffectIdentity, error.ProtectedEffectBypass, error.ProtectedHandler, error.PrivateFunctionBypass, error.SpeculativeEffect, error.SpeculativeCapture, error.ProtectedResourceEscape, error.UnprovenComputationOrigin => @errorCast(err),
        else => typed.sourceError(@errorCast(err)),
    };
}

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
    scope: boundary.library.generator.Scope = .{},
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
    try equality.checkPortableSchema(b, spec.subject);
    _ = try b.failureLiteral(spec.failure);
    try equality.checkPortableSchema(b, spec.key);
    try equality.checkPortableSchema(b, spec.observation);
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
    const e: Emit = .{ .b = b, .c = typed.Context.init(b) catch |err| return typed.sourceError(err), .s = spec, .d = d, .f = functions, .integer = integer, .boolean = boolean, .unit = try b.scalar(void), .effects = effects, .registry = registry };
    return e.controller();
}

/// Priority class, then a reusable experiment with distinguishable predictions,
/// then cost class and oldest generation. The broker independently gives cached
/// applicable work precedence over this policy. `discriminates` is pure authored
/// (demand, demand) -> bool; it interprets application predictions/actions.
pub fn defaultSelection(b: *Builder, spec: Spec, d: Definition, discriminates: Id) Error!Id {
    const boolean = try b.scalar(bool);
    try checkPure(b, discriminates, &.{ spec.demand, spec.demand }, boolean);
    const e: Emit = .{ .b = b, .c = typed.Context.init(b) catch |err| return typed.sourceError(err), .s = spec, .d = d, .f = null, .integer = try b.scalar(u64), .boolean = boolean, .unit = try b.scalar(void), .effects = &.{} };
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
    c: *typed.Context,
    s: Spec,
    d: Definition,
    f: ?Functions,
    integer: Id,
    boolean: Id,
    unit: Id,
    effects: []const Id,
    registry: ?*admission.Registry = null,

    // Temporary boundary for existing source-defined policy/custody functions.
    // Argument categories are checked here; normal Source/Agent admission still
    // checks lexical captures, effects, and authority on the resulting call.
    fn callSource(e: Emit, body: *typed.Body, function: Id, arguments: []const *const typed.Value) typed.Error!*const typed.Value {
        if (function >= e.b.functions.items.len) return error.InvalidReference;
        const target = e.b.functions.items[@intCast(function)];
        if (target.parameters.len != arguments.len) return error.TypeMismatch;
        const ids = try e.b.allocator().alloc(Id, arguments.len);
        for (arguments, target.parameters, ids) |value, parameter, *id| {
            id.* = try typed.interop.valueId(body, value);
            if (e.b.values.items[@intCast(id.*)].schema != e.b.variables.items[@intCast(parameter)]) return error.TypeMismatch;
        }
        return typed.interop.term(body, try e.b.term(.{ .call = .{ .function = function, .arguments = ids } }), try typed.interop.schema(e.c, target.result));
    }

    fn admitViews(e: Emit) Error!Id {
        return e.admitTyped() catch |err| return typed.sourceError(err);
    }
    fn admitTyped(e: Emit) typed.Error!Id {
        const c = e.c;
        const offers = try typed.interop.schema(c, e.d.types.eligible_list);
        const ids = try typed.interop.schema(c, e.d.custody.types.ids);
        const result = try c.record(&.{ .{ .name = "offered", .schema = offers }, .{ .name = "denied", .schema = ids }, .{ .name = "retired", .schema = ids } });
        const function = try c.function("admit inquiry views", &.{ .{ .name = "views", .schema = try typed.interop.schema(c, e.d.custody.types.views) }, .{ .name = "subject", .schema = try typed.interop.schema(c, e.s.subject) }, .{ .name = "offered", .schema = offers }, .{ .name = "denied", .schema = ids }, .{ .name = "retired", .schema = ids } }, result, &.{});
        const body = try c.body(function);
        const subject = try body.parameter("subject");
        const offered = try body.parameter("offered");
        const denied_ids = try body.parameter("denied");
        const retired_ids = try body.parameter("retired");
        const popped = try body.pop(try body.parameter("views"));
        const empty = try body.caseOf(popped, "empty");
        const item = try body.caseOf(popped, "item");
        const finished = try empty.body().product(result, &.{ .{ .name = "offered", .value = offered }, .{ .name = "denied", .value = denied_ids }, .{ .name = "retired", .value = retired_ids } });
        const work = item.body();
        const parts = try work.destructure(item.payload());
        const view_value = try parts.get("head");
        const tail = try parts.get("tail");
        const response = try e.callSource(work, e.f.?.admit, &.{ subject, try work.field(view_value, "2") });
        const denied = try work.caseOf(response, "0");
        const accepted = try work.caseOf(response, "1");
        const retired = try work.caseOf(response, "2");
        const bad = try denied.body().call(function, &.{ .{ .name = "views", .value = tail }, .{ .name = "subject", .value = subject }, .{ .name = "offered", .value = offered }, .{ .name = "denied", .value = try denied.body().append(denied_ids, try denied.body().field(view_value, "1")) }, .{ .name = "retired", .value = retired_ids } });
        const metadata = try accepted.body().product(try typed.interop.schema(c, e.d.types.eligible), &.{ .{ .name = "0", .value = view_value }, .{ .name = "1", .value = accepted.payload() } });
        const good = try accepted.body().call(function, &.{ .{ .name = "views", .value = tail }, .{ .name = "subject", .value = subject }, .{ .name = "offered", .value = try accepted.body().append(offered, metadata) }, .{ .name = "denied", .value = denied_ids }, .{ .name = "retired", .value = retired_ids } });
        const stopped = try retired.body().call(function, &.{ .{ .name = "views", .value = tail }, .{ .name = "subject", .value = subject }, .{ .name = "offered", .value = offered }, .{ .name = "denied", .value = denied_ids }, .{ .name = "retired", .value = try retired.body().append(retired_ids, try retired.body().field(view_value, "1")) } });
        const classified = try work.match(response, &.{ try denied.ret(bad), try accepted.ret(good), try retired.ret(stopped) });
        try c.define(function, try body.ret(try body.match(popped, &.{ try empty.ret(finished), try item.ret(classified) })));
        return typed.interop.functionId(c, function);
    }

    // Only reusable completed records are applicable; failures never enter this list.
    fn lookupFunction(e: Emit, optional: Id) Error!Id {
        return e.lookupTyped(optional) catch |err| {
            if (err == error.UnsupportedEqualitySchema) return error.UnsupportedEqualitySchema;
            return typed.sourceError(@errorCast(err));
        };
    }
    fn lookupTyped(e: Emit, optional: Id) equality.TypedError!Id {
        const c = e.c;
        const records = try typed.interop.schema(c, e.d.types.records);
        const key = try typed.interop.schema(c, e.s.key);
        const result = try typed.interop.schema(c, optional);
        if (e.s.failure >= e.b.values.items.len) return error.InvalidReference;
        const failure = try typed.interop.literalFailure(c, e.s.failure, try typed.interop.schema(c, e.b.values.items[@intCast(e.s.failure)].schema));
        const equal = try equality.create(c, key, failure);
        const function = try c.function("find reusable observation", &.{ .{ .name = "records", .schema = records }, .{ .name = "key", .schema = key } }, result, &.{});
        const body = try c.body(function);
        const wanted = try body.parameter("key");
        const popped = try body.pop(try body.parameter("records"));
        const empty = try body.caseOf(popped, "empty");
        const item = try body.caseOf(popped, "item");
        const work = item.body();
        const parts = try work.destructure(item.payload());
        const record = try parts.get("head");
        const tail = try parts.get("tail");
        const applicable = try work.branch();
        const skipped = try work.branch();
        const same = try applicable.call(equal, &.{ .{ .name = "left", .value = try applicable.field(record, "1") }, .{ .name = "right", .value = wanted } });
        const found = try applicable.branch();
        const different = try applicable.branch();
        const continued = try different.call(function, &.{ .{ .name = "records", .value = tail }, .{ .name = "key", .value = wanted } });
        const selected = try applicable.conditional(same, try found.ret(try found.variant(result, "1", record)), try different.ret(continued));
        const next = try skipped.call(function, &.{ .{ .name = "records", .value = tail }, .{ .name = "key", .value = wanted } });
        const checked = try work.conditional(try work.field(record, "3"), try applicable.ret(selected), try skipped.ret(next));
        try c.define(function, try body.ret(try body.match(popped, &.{ try empty.ret(try empty.body().variant(result, "0", try empty.body().constant(void, {}))), try item.ret(checked) })));
        return typed.interop.functionId(c, function);
    }

    fn cachedChoice(e: Emit, lookup: Id, optional: Id) Error!Id {
        return e.cachedTyped(lookup, optional) catch |err| return typed.sourceError(err);
    }
    fn cachedTyped(e: Emit, lookup: Id, optional: Id) typed.Error!Id {
        const c = e.c;
        const offered = try typed.interop.schema(c, e.d.types.eligible_list);
        const records = try typed.interop.schema(c, e.d.types.records);
        _ = try typed.interop.schema(c, optional);
        const find = try typed.interop.declaredFunction(c, lookup);
        const function = try c.function("prefer cached observations", &.{ .{ .name = "offered", .schema = offered }, .{ .name = "records", .schema = records }, .{ .name = "selected", .schema = offered } }, offered, &.{});
        const body = try c.body(function);
        const observed = try body.parameter("records");
        const selected = try body.parameter("selected");
        const popped = try body.pop(try body.parameter("offered"));
        const empty = try body.caseOf(popped, "empty");
        const item = try body.caseOf(popped, "item");
        const work = item.body();
        const parts = try work.destructure(item.payload());
        const head = try parts.get("head");
        const tail = try parts.get("tail");
        const applicable = try work.branch();
        const skipped = try work.branch();
        const cached = try applicable.call(find, &.{ .{ .name = "records", .value = observed }, .{ .name = "key", .value = try applicable.field(try applicable.field(head, "1"), "0") } });
        const missing = try applicable.caseOf(cached, "0");
        const found = try applicable.caseOf(cached, "1");
        const without = try missing.body().call(function, &.{ .{ .name = "offered", .value = tail }, .{ .name = "records", .value = observed }, .{ .name = "selected", .value = selected } });
        const included = try found.body().call(function, &.{ .{ .name = "offered", .value = tail }, .{ .name = "records", .value = observed }, .{ .name = "selected", .value = try found.body().append(selected, head) } });
        const checked = try applicable.match(cached, &.{ try missing.ret(without), try found.ret(included) });
        const next = try skipped.call(function, &.{ .{ .name = "offered", .value = tail }, .{ .name = "records", .value = observed }, .{ .name = "selected", .value = selected } });
        const result = try work.conditional(try work.field(try work.field(head, "1"), "1"), try applicable.ret(checked), try skipped.ret(next));
        try c.define(function, try body.ret(try body.match(popped, &.{ try empty.ret(selected), try item.ret(result) })));
        return typed.interop.functionId(c, function);
    }

    fn selectedFunction(e: Emit, optional: Id) Error!Id {
        return e.selectedTyped(optional) catch |err| return typed.sourceError(err);
    }
    fn selectedTyped(e: Emit, optional: Id) typed.Error!Id {
        const c = e.c;
        const offered = try typed.interop.schema(c, e.d.types.eligible_list);
        const result = try typed.interop.schema(c, optional);
        const function = try c.function("select offered generation", &.{ .{ .name = "offered", .schema = offered }, .{ .name = "generation", .schema = try c.scalar(u64) } }, result, &.{});
        const body = try c.body(function);
        const generation = try body.parameter("generation");
        const popped = try body.pop(try body.parameter("offered"));
        const empty = try body.caseOf(popped, "empty");
        const item = try body.caseOf(popped, "item");
        const work = item.body();
        const parts = try work.destructure(item.payload());
        const candidate = try parts.get("head");
        const found = try work.branch();
        const next = try work.branch();
        const continued = try next.call(function, &.{ .{ .name = "offered", .value = try parts.get("tail") }, .{ .name = "generation", .value = generation } });
        const matched = try work.conditional(try work.equal(try work.field(try work.field(candidate, "0"), "1"), generation), try found.ret(try found.variant(result, "1", candidate)), try next.ret(continued));
        try c.define(function, try body.ret(try body.match(popped, &.{ try empty.ret(try empty.body().variant(result, "0", try empty.body().constant(void, {}))), try item.ret(matched) })));
        return typed.interop.functionId(c, function);
    }

    fn recipients(e: Emit) Error!Id {
        return e.recipientsTyped() catch |err| {
            if (err == error.UnsupportedEqualitySchema) return error.UnsupportedEqualitySchema;
            return typed.sourceError(@errorCast(err));
        };
    }
    fn recipientsTyped(e: Emit) equality.TypedError!Id {
        const c = e.c;
        const offered = try typed.interop.schema(c, e.d.types.eligible_list);
        const eligible_type = try typed.interop.schema(c, e.d.types.eligible);
        const ids = try typed.interop.schema(c, e.d.custody.types.ids);
        if (e.s.failure >= e.b.values.items.len) return error.InvalidReference;
        const failure = try typed.interop.literalFailure(c, e.s.failure, try typed.interop.schema(c, e.b.values.items[@intCast(e.s.failure)].schema));
        const equal = try equality.create(c, try typed.interop.schema(c, e.s.key), failure);
        const function = try c.function("choose observation recipients", &.{ .{ .name = "offered", .schema = offered }, .{ .name = "chosen", .schema = eligible_type }, .{ .name = "coalesce", .schema = try c.scalar(bool) }, .{ .name = "ids", .schema = ids } }, ids, &.{});
        const body = try c.body(function);
        const chosen = try body.parameter("chosen");
        const coalesce = try body.parameter("coalesce");
        const selected = try body.parameter("ids");
        const popped = try body.pop(try body.parameter("offered"));
        const empty = try body.caseOf(popped, "empty");
        const item = try body.caseOf(popped, "item");
        const work = item.body();
        const parts = try work.destructure(item.payload());
        const head = try parts.get("head");
        const generation = try work.field(try work.field(head, "0"), "1");
        const exact = try work.branch();
        const other = try work.branch();
        const chosen_generation = try work.field(try work.field(chosen, "0"), "1");
        const shared = try e.shareRecipients(other, equal, function, try parts.get("tail"), head, chosen, coalesce, selected, generation);
        const included = try e.nextRecipients(exact, function, try parts.get("tail"), chosen, coalesce, try exact.append(selected, generation));
        const next = try work.conditional(try work.equal(generation, chosen_generation), try exact.ret(included), try other.ret(shared));
        try c.define(function, try body.ret(try body.match(popped, &.{ try empty.ret(selected), try item.ret(next) })));
        return typed.interop.functionId(c, function);
    }
    fn nextRecipients(_: Emit, body: *typed.Body, function: *const typed.Function, tail: *const typed.Value, chosen: *const typed.Value, coalesce: *const typed.Value, ids: *const typed.Value) typed.Error!*const typed.Value {
        return body.call(function, &.{ .{ .name = "offered", .value = tail }, .{ .name = "chosen", .value = chosen }, .{ .name = "coalesce", .value = coalesce }, .{ .name = "ids", .value = ids } });
    }
    fn shareRecipients(e: Emit, body: *typed.Body, equal: *const typed.Function, function: *const typed.Function, tail: *const typed.Value, item: *const typed.Value, chosen: *const typed.Value, coalesce: *const typed.Value, ids: *const typed.Value, generation: *const typed.Value) typed.Error!*const typed.Value {
        const Guard = struct { parent: *typed.Body, condition: *const typed.Value, yes: *typed.Body, no: *typed.Body };
        var guards: [3]Guard = undefined;
        var work = body;
        for (&guards, 0..) |*guard, index| {
            const condition = switch (index) {
                0 => coalesce,
                1 => try work.field(try work.field(chosen, "1"), "1"),
                else => try work.field(try work.field(item, "1"), "1"),
            };
            const yes = try work.branch();
            guard.* = .{ .parent = work, .condition = condition, .yes = yes, .no = try work.branch() };
            work = yes;
        }
        const matches = try work.call(equal, &.{ .{ .name = "left", .value = try work.field(try work.field(item, "1"), "0") }, .{ .name = "right", .value = try work.field(try work.field(chosen, "1"), "0") } });
        const included = try work.branch();
        const skipped = try work.branch();
        var result = try work.conditional(matches, try included.ret(try e.nextRecipients(included, function, tail, chosen, coalesce, try included.append(ids, generation))), try skipped.ret(try e.nextRecipients(skipped, function, tail, chosen, coalesce, ids)));
        var remaining = guards.len;
        while (remaining != 0) {
            remaining -= 1;
            const guard = guards[remaining];
            result = try guard.parent.conditional(guard.condition, try guard.yes.ret(result), try guard.no.ret(try e.nextRecipients(guard.no, function, tail, chosen, coalesce, ids)));
        }
        return result;
    }

    fn discriminating(e: Emit, discriminator: Id) equality.TypedError!*const typed.Function {
        const c = e.c;
        const eligible_type = try typed.interop.schema(c, e.d.types.eligible);
        const offers = try typed.interop.schema(c, e.d.types.eligible_list);
        const boolean = try c.scalar(bool);
        if (e.s.failure >= e.b.values.items.len) return error.InvalidReference;
        const failure = try typed.interop.literalFailure(c, e.s.failure, try typed.interop.schema(c, e.b.values.items[@intCast(e.s.failure)].schema));
        const key_equal = try equality.create(c, try typed.interop.schema(c, e.s.key), failure);
        const function = try c.function("find distinguishing prediction", &.{ .{ .name = "candidate", .schema = eligible_type }, .{ .name = "offered", .schema = offers } }, boolean, &.{});
        const body = try c.body(function);
        const candidate = try body.parameter("candidate");
        const popped = try body.pop(try body.parameter("offered"));
        const empty = try body.caseOf(popped, "empty");
        const item = try body.caseOf(popped, "item");
        var work = item.body();
        const parts = try work.destructure(item.payload());
        const other = try parts.get("head");
        const tail = try parts.get("tail");
        const Guard = struct { parent: *typed.Body, condition: *const typed.Value, yes: *typed.Body, no: *typed.Body, accepts_true: bool };
        var guards: [5]Guard = undefined;
        for (&guards, 0..) |*guard, index| {
            const condition = switch (index) {
                0 => try work.field(try work.field(candidate, "1"), "1"),
                1 => try work.field(try work.field(other, "1"), "1"),
                2 => try work.equal(try work.field(try work.field(candidate, "0"), "1"), try work.field(try work.field(other, "0"), "1")),
                3 => try work.call(key_equal, &.{ .{ .name = "left", .value = try work.field(try work.field(candidate, "1"), "0") }, .{ .name = "right", .value = try work.field(try work.field(other, "1"), "0") } }),
                else => try e.callDiscriminator(work, discriminator, try work.field(try work.field(candidate, "0"), "2"), try work.field(try work.field(other, "0"), "2")),
            };
            const yes = try work.branch();
            guard.* = .{ .parent = work, .condition = condition, .yes = yes, .no = try work.branch(), .accepts_true = index != 2 };
            work = yes;
        }
        var result = try work.constant(bool, true);
        var remaining = guards.len;
        while (remaining != 0) {
            remaining -= 1;
            const guard = guards[remaining];
            const next = try guard.no.call(function, &.{ .{ .name = "candidate", .value = candidate }, .{ .name = "offered", .value = tail } });
            const yes = try guard.yes.ret(result);
            const no = try guard.no.ret(next);
            result = try guard.parent.conditional(guard.condition, if (guard.accepts_true) yes else no, if (guard.accepts_true) no else yes);
        }
        try c.define(function, try body.ret(try body.match(popped, &.{ try empty.ret(try empty.body().constant(bool, false)), try item.ret(result) })));
        return function;
    }
    // The public source callback was checked by checkPure before this adapter.
    // Remove this call-site projection when its policy callers become typed.
    fn callDiscriminator(e: Emit, body: *typed.Body, function: Id, left: *const typed.Value, right: *const typed.Value) typed.Error!*const typed.Value {
        return e.callSource(body, function, &.{ left, right });
    }
    fn betterTyped(_: Emit, body: *typed.Body, left: *const typed.Value, right: *const typed.Value, shared_left: *const typed.Value, shared_right: *const typed.Value) typed.Error!*const typed.Value {
        const lm = try body.field(left, "1");
        const rm = try body.field(right, "1");
        const lp = try body.field(lm, "2");
        const rp = try body.field(rm, "2");
        const lc = try body.field(lm, "3");
        const rc = try body.field(rm, "3");
        const oldest = try body.less(try body.field(try body.field(left, "0"), "1"), try body.field(try body.field(right, "0"), "1"));
        const cheapest = try body.select(try body.equal(lc, rc), oldest, try body.less(lc, rc));
        const shared = try body.select(try body.equal(shared_left, shared_right), cheapest, shared_left);
        return body.select(try body.equal(lp, rp), shared, try body.less(lp, rp));
    }
    fn defaultPolicy(e: Emit, discriminator: Id) Error!Id {
        return e.policyTyped(discriminator) catch |err| {
            if (err == error.UnsupportedEqualitySchema) return error.UnsupportedEqualitySchema;
            return typed.sourceError(@errorCast(err));
        };
    }
    fn policyTyped(e: Emit, discriminator: Id) equality.TypedError!Id {
        const c = e.c;
        const offers = try typed.interop.schema(c, e.d.types.eligible_list);
        const eligible_type = try typed.interop.schema(c, e.d.types.eligible);
        const integer = try c.scalar(u64);
        const choice = try c.alternatives(&.{ .{ .name = "none", .schema = try c.scalar(void) }, .{ .name = "some", .schema = eligible_type } });
        const score = try e.discriminating(discriminator);
        const scan = try c.function("rank admitted work", &.{ .{ .name = "remaining", .schema = offers }, .{ .name = "all", .schema = offers }, .{ .name = "best", .schema = choice }, .{ .name = "shared", .schema = try c.scalar(bool) } }, integer, &.{});
        const body = try c.body(scan);
        const all = try body.parameter("all");
        const best = try body.parameter("best");
        const shared = try body.parameter("shared");
        const popped = try body.pop(try body.parameter("remaining"));
        const empty = try body.caseOf(popped, "empty");
        const item = try body.caseOf(popped, "item");
        const absent = try empty.body().caseOf(best, "none");
        const final = try empty.body().caseOf(best, "some");
        const exhausted_result = try empty.body().match(best, &.{ try absent.ret(try absent.body().constant(u64, 0)), try final.ret(try final.body().field(try final.body().field(final.payload(), "0"), "1")) });
        const work = item.body();
        const parts = try work.destructure(item.payload());
        const head = try parts.get("head");
        const tail = try parts.get("tail");
        const head_shared = try work.call(score, &.{ .{ .name = "candidate", .value = head }, .{ .name = "offered", .value = all } });
        const missing = try work.caseOf(best, "none");
        const present = try work.caseOf(best, "some");
        const first = try missing.body().call(scan, &.{ .{ .name = "remaining", .value = tail }, .{ .name = "all", .value = all }, .{ .name = "best", .value = try missing.body().variant(choice, "some", head) }, .{ .name = "shared", .value = head_shared } });
        const adopt = try present.body().branch();
        const retain = try present.body().branch();
        const replacement = try adopt.call(scan, &.{ .{ .name = "remaining", .value = tail }, .{ .name = "all", .value = all }, .{ .name = "best", .value = try adopt.variant(choice, "some", head) }, .{ .name = "shared", .value = head_shared } });
        const retained = try retain.call(scan, &.{ .{ .name = "remaining", .value = tail }, .{ .name = "all", .value = all }, .{ .name = "best", .value = best }, .{ .name = "shared", .value = shared } });
        const selected = try present.body().conditional(try e.betterTyped(present.body(), head, present.payload(), head_shared, shared), try adopt.ret(replacement), try retain.ret(retained));
        const continued = try work.match(best, &.{ try missing.ret(first), try present.ret(selected) });
        try c.define(scan, try body.ret(try body.match(popped, &.{ try empty.ret(exhausted_result), try item.ret(continued) })));
        const entry = try c.function("default inquiry policy", &.{ .{ .name = "subject", .schema = try typed.interop.schema(c, e.s.subject) }, .{ .name = "policy", .schema = try typed.interop.schema(c, e.s.policy) }, .{ .name = "offered", .schema = offers }, .{ .name = "findings", .schema = try typed.interop.schema(c, e.d.custody.types.findings) } }, integer, &.{});
        const root = try c.body(entry);
        const offered = try root.parameter("offered");
        try c.define(entry, try root.ret(try root.call(scan, &.{ .{ .name = "remaining", .value = offered }, .{ .name = "all", .value = offered }, .{ .name = "best", .value = try root.variant(choice, "none", try root.constant(void, {})) }, .{ .name = "shared", .value = try root.constant(bool, false) } })));
        return typed.interop.functionId(c, entry);
    }

    fn controller(e: Emit) Error!Id {
        return e.controllerTyped() catch |err| return constructionError(err);
    }
    fn controllerTyped(e: Emit) ConstructionError!Id {
        const c = e.c;
        const names = [_][]const u8{ "state", "subject", "allowance", "coalesce", "policy", "records", "occurrence", "acquisitions", "reused", "recipients" };
        const ids = [_]Id{ e.d.custody.types.state, e.s.subject, e.integer, e.boolean, e.s.policy, e.d.types.records, e.integer, e.integer, e.integer, e.integer };
        var fields: [names.len]typed.Field = undefined;
        for (names, ids, &fields) |name, id, *field| field.* = .{ .name = name, .schema = try typed.interop.schema(c, id) };
        const effects = try e.b.allocator().alloc(*const typed.Operation, e.effects.len);
        for (effects, e.effects) |*out, id| out.* = try typed.interop.operation(c, id);
        const regions = try e.b.allocator().alloc(*const typed.Region, e.s.scope.borrowed_regions.len);
        for (regions, e.s.scope.borrowed_regions) |*out, id| out.* = try typed.interop.region(c, id);
        const outcome = try typed.interop.schema(c, e.d.types.outcome);
        const loop = try c.functionFor("inquiry controller", try c.callable(&fields, outcome, effects, .{ .use = .reusable, .captures = &.{}, .regions = regions }));
        const optional = try e.b.schema(.{ .sum = &.{ e.unit, e.d.types.record } });
        const choice = try e.b.schema(.{ .sum = &.{ e.unit, e.d.types.eligible } });
        const lookup = try e.lookupFunction(optional);
        const fault = try typed.interop.literalFailure(c, e.s.failure, try typed.interop.schema(c, e.b.values.items[@intCast(e.s.failure)].schema));
        const ops: LoopOps = .{ .loop = loop, .stop = try typed.interop.declaredFunction(c, try e.stopper()), .admit = try typed.interop.declaredFunction(c, try e.admitViews()), .lookup = try typed.interop.declaredFunction(c, lookup), .recipients = try typed.interop.declaredFunction(c, try e.recipients()), .selected = try typed.interop.declaredFunction(c, try e.selectedFunction(choice)), .cached_choice = try typed.interop.declaredFunction(c, try e.cachedChoice(lookup, optional)), .failure = fault, .subject_equal = try equality.create(c, try typed.interop.schema(c, e.s.subject), fault), .key_equal = try equality.create(c, try typed.interop.schema(c, e.s.key), fault), .observation_equal = try equality.create(c, try typed.interop.schema(c, e.s.observation), fault) };
        const body = try c.body(loop);
        var args: LoopArgs = undefined;
        inline for (@typeInfo(LoopArgs).@"struct".fields) |field| @field(args, field.name) = try body.parameter(field.name);
        try c.define(loop, try body.ret(try e.loopTyped(body, ops, args)));
        const entry = try c.functionFor("start inquiry controller", try c.callable(fields[0..5], outcome, effects, .{ .use = .reusable, .captures = &.{}, .regions = regions }));
        const root = try c.body(entry);
        try c.define(entry, try root.ret(try root.call(loop, &.{
            .{ .name = "state", .value = try root.parameter("state") },         .{ .name = "subject", .value = try root.parameter("subject") },
            .{ .name = "allowance", .value = try root.parameter("allowance") }, .{ .name = "coalesce", .value = try root.parameter("coalesce") },
            .{ .name = "policy", .value = try root.parameter("policy") },       .{ .name = "records", .value = try root.sequenceValue(try typed.interop.schema(c, e.d.types.records), &.{}) },
            .{ .name = "occurrence", .value = try root.constant(u64, 1) },      .{ .name = "acquisitions", .value = try root.constant(u64, 0) },
            .{ .name = "reused", .value = try root.constant(u64, 0) },          .{ .name = "recipients", .value = try root.constant(u64, 0) },
        })));
        return typed.interop.functionId(c, entry);
    }

    fn stopper(e: Emit) Error!Id {
        return e.stopperTyped() catch |err| return constructionError(err);
    }
    fn stopperTyped(e: Emit) ConstructionError!Id {
        const c = e.c;
        const integer = try c.scalar(u64);
        const effects = try e.b.allocator().alloc(*const typed.Operation, e.effects.len);
        for (effects, e.effects) |*out, id| out.* = try typed.interop.operation(c, id);
        const regions = try e.b.allocator().alloc(*const typed.Region, e.s.scope.borrowed_regions.len);
        for (regions, e.s.scope.borrowed_regions) |*out, id| out.* = try typed.interop.region(c, id);
        const result = try typed.interop.schema(c, e.d.types.outcome);
        const signature = try c.callable(&.{ .{ .name = "state", .schema = try typed.interop.schema(c, e.d.custody.types.state) }, .{ .name = "status", .schema = try c.scalar(u8) }, .{ .name = "records", .schema = try typed.interop.schema(c, e.d.types.records) }, .{ .name = "acquisitions", .schema = integer }, .{ .name = "reused", .schema = integer }, .{ .name = "recipients", .schema = integer } }, result, effects, .{ .use = .reusable, .captures = &.{}, .regions = regions });
        const function = try c.functionFor("stop inquiry with findings", signature);
        const body = try c.body(function);
        const findings = try e.callSource(body, e.d.custody.finish, &.{try body.parameter("state")});
        try c.define(function, try body.ret(try body.product(result, &.{ .{ .name = "0", .value = try body.parameter("status") }, .{ .name = "1", .value = findings }, .{ .name = "2", .value = try body.parameter("records") }, .{ .name = "3", .value = try body.parameter("acquisitions") }, .{ .name = "4", .value = try body.parameter("reused") }, .{ .name = "5", .value = try body.parameter("recipients") } })));
        return typed.interop.functionId(c, function);
    }

    fn stopTyped(_: Emit, body: *typed.Body, o: LoopOps, v: LoopArgs, state: *const typed.Value, status: Status, records: *const typed.Value, acquired: bool) ConstructionError!*const typed.Value {
        const count = if (acquired) try body.checkedAdd(v.acquisitions, try body.constant(u64, 1), o.failure) else v.acquisitions;
        return body.call(o.stop, &.{ .{ .name = "state", .value = state }, .{ .name = "status", .value = try body.constant(u8, @intFromEnum(status)) }, .{ .name = "records", .value = records }, .{ .name = "acquisitions", .value = count }, .{ .name = "reused", .value = v.reused }, .{ .name = "recipients", .value = v.recipients } });
    }
    fn againTyped(_: Emit, body: *typed.Body, o: LoopOps, v: LoopArgs, state: *const typed.Value, records: *const typed.Value, acquired: bool, reused: bool, recipients_count: *const typed.Value) ConstructionError!*const typed.Value {
        return body.call(o.loop, &.{
            .{ .name = "state", .value = state },                                                                                               .{ .name = "subject", .value = v.subject },
            .{ .name = "allowance", .value = try body.checked(.subtract, v.allowance, try body.constant(u64, 1), .{ .overflow = o.failure }) }, .{ .name = "coalesce", .value = v.coalesce },
            .{ .name = "policy", .value = v.policy },                                                                                           .{ .name = "records", .value = records },
            .{ .name = "occurrence", .value = try body.checkedAdd(v.occurrence, try body.constant(u64, @intFromBool(acquired)), o.failure) },   .{ .name = "acquisitions", .value = try body.checkedAdd(v.acquisitions, try body.constant(u64, @intFromBool(acquired)), o.failure) },
            .{ .name = "reused", .value = try body.checkedAdd(v.reused, try body.constant(u64, @intFromBool(reused)), o.failure) },             .{ .name = "recipients", .value = try body.checkedAdd(v.recipients, recipients_count, o.failure) },
        });
    }
    fn rebuildState(e: Emit, body: *typed.Body, queue: *const typed.Value, findings: *const typed.Value, generation: *const typed.Value) ConstructionError!*const typed.Value {
        return body.product(try typed.interop.schema(e.c, e.d.custody.types.state), &.{ .{ .name = "0", .value = queue }, .{ .name = "1", .value = findings }, .{ .name = "2", .value = generation } });
    }
    fn loopTyped(e: Emit, body: *typed.Body, o: LoopOps, v: LoopArgs) ConstructionError!*const typed.Value {
        const parts = try body.destructure(v.state);
        const queue = try parts.get("0");
        const findings = try parts.get("1");
        const generation = try parts.get("2");
        const finished = try e.callSource(body, e.f.?.finish, &.{ v.subject, findings });
        const done = try body.branch();
        const unfinished = try body.branch();
        const empty = try unfinished.branch();
        const pending = try unfinished.branch();
        const stopped = try pending.branch();
        const active = try pending.branch();
        const projected = try e.callSource(active, e.d.custody.project, &.{try e.rebuildState(active, queue, findings, generation)});
        const projection = try active.destructure(projected);
        const next = try e.chooseTyped(active, o, v, try projection.get("0"), try projection.get("1"), findings);
        const bounded = try pending.conditional(try pending.equal(v.allowance, try pending.constant(u64, 0)), try stopped.ret(try e.stopTyped(stopped, o, v, try e.rebuildState(stopped, queue, findings, generation), .stopped, v.records, false)), try active.ret(next));
        const has_work = try unfinished.conditional(try unfinished.equal(try unfinished.sequenceLength(queue), try unfinished.constant(u64, 0)), try empty.ret(try e.stopTyped(empty, o, v, try e.rebuildState(empty, queue, findings, generation), .finished, v.records, false)), try pending.ret(bounded));
        return body.conditional(finished, try done.ret(try e.stopTyped(done, o, v, try e.rebuildState(done, queue, findings, generation), .finished, v.records, false)), try unfinished.ret(has_work));
    }
    fn chooseTyped(e: Emit, body: *typed.Body, o: LoopOps, v: LoopArgs, state: *const typed.Value, views: *const typed.Value, findings: *const typed.Value) ConstructionError!*const typed.Value {
        const ids_type = try typed.interop.schema(e.c, e.d.custody.types.ids);
        const admitted = try body.call(o.admit, &.{ .{ .name = "views", .value = views }, .{ .name = "subject", .value = v.subject }, .{ .name = "offered", .value = try body.sequenceValue(try typed.interop.schema(e.c, e.d.types.eligible_list), &.{}) }, .{ .name = "denied", .value = try body.sequenceValue(ids_type, &.{}) }, .{ .name = "retired", .value = try body.sequenceValue(ids_type, &.{}) } });
        const parts = try body.destructure(admitted);
        const offered = try parts.get("offered");
        const denied_ids = try parts.get("denied");
        const retired_ids = try parts.get("retired");
        const no_retirement = try body.branch();
        const retirement = try body.branch();
        const disposed = try e.callSource(retirement, e.d.custody.retire, &.{ state, retired_ids });
        const after_retirement = try e.againTyped(retirement, o, v, disposed, v.records, false, false, try retirement.constant(u64, 0));
        const admitted_work = try no_retirement.branch();
        const denial = try no_retirement.branch();
        const denied_reply = try denial.variant(try typed.interop.schema(e.c, e.d.types.reply), "1", try denial.constant(void, {}));
        const distributed = try e.callSource(denial, e.d.custody.distribute, &.{ state, denied_ids, denied_reply });
        const after_denial = try e.againTyped(denial, o, v, distributed, v.records, false, false, try denial.sequenceLength(denied_ids));
        const selected = try no_retirement.conditional(try no_retirement.equal(try no_retirement.sequenceLength(denied_ids), try no_retirement.constant(u64, 0)), try admitted_work.ret(try e.chooseAdmittedTyped(admitted_work, o, v, state, offered, findings)), try denial.ret(after_denial));
        return body.conditional(try body.equal(try body.sequenceLength(retired_ids), try body.constant(u64, 0)), try no_retirement.ret(selected), try retirement.ret(after_retirement));
    }
    fn chooseAdmittedTyped(e: Emit, body: *typed.Body, o: LoopOps, v: LoopArgs, state: *const typed.Value, offered: *const typed.Value, findings: *const typed.Value) ConstructionError!*const typed.Value {
        const list = try typed.interop.schema(e.c, e.d.types.eligible_list);
        const caching = try body.branch();
        const uncached = try body.branch();
        const found = try caching.call(o.cached_choice, &.{ .{ .name = "offered", .value = offered }, .{ .name = "records", .value = v.records }, .{ .name = "selected", .value = try caching.sequenceValue(list, &.{}) } });
        const cached = try body.conditional(v.coalesce, try caching.ret(found), try uncached.ret(try uncached.sequenceValue(list, &.{})));
        const no_cache = try body.branch();
        const use_cache = try body.branch();
        const candidates = try body.conditional(try body.equal(try body.sequenceLength(cached), try body.constant(u64, 0)), try no_cache.ret(offered), try use_cache.ret(cached));
        const selected_id = try e.callSource(body, e.f.?.select, &.{ v.subject, v.policy, candidates, findings });
        const unresolved = try body.branch();
        const selected = try body.branch();
        const choice = try selected.call(o.selected, &.{ .{ .name = "offered", .value = candidates }, .{ .name = "generation", .value = selected_id } });
        const missing = try selected.caseOf(choice, "0");
        const present = try selected.caseOf(choice, "1");
        const checked = try selected.match(choice, &.{ try missing.ret(try e.stopTyped(missing.body(), o, v, state, .invalid_selection, v.records, false)), try present.ret(try e.dispatchTyped(present.body(), o, v, state, offered, present.payload())) });
        return body.conditional(try body.equal(selected_id, try body.constant(u64, 0)), try unresolved.ret(try e.stopTyped(unresolved, o, v, state, .unresolved, v.records, false)), try selected.ret(checked));
    }
    fn dispatchTyped(e: Emit, body: *typed.Body, o: LoopOps, v: LoopArgs, state: *const typed.Value, offered: *const typed.Value, selected: *const typed.Value) ConstructionError!*const typed.Value {
        const ids = try body.call(o.recipients, &.{ .{ .name = "offered", .value = offered }, .{ .name = "chosen", .value = selected }, .{ .name = "coalesce", .value = v.coalesce }, .{ .name = "ids", .value = try body.sequenceValue(try typed.interop.schema(e.c, e.d.custody.types.ids), &.{}) } });
        const optional = try typed.interop.schema(e.c, e.b.functions.items[@intCast(try typed.interop.functionId(e.c, o.lookup))].result);
        const enabled = try body.branch();
        const disabled = try body.branch();
        const reusable_case = try enabled.branch();
        const fresh_case = try enabled.branch();
        const prior = try reusable_case.call(o.lookup, &.{ .{ .name = "records", .value = v.records }, .{ .name = "key", .value = try reusable_case.field(try reusable_case.field(selected, "1"), "0") } });
        const selected_case = try enabled.conditional(try enabled.field(try enabled.field(selected, "1"), "1"), try reusable_case.ret(prior), try fresh_case.ret(try fresh_case.variant(optional, "0", try fresh_case.constant(void, {}))));
        const cached = try body.conditional(v.coalesce, try enabled.ret(selected_case), try disabled.ret(try disabled.variant(optional, "0", try disabled.constant(void, {}))));
        const absent = try body.caseOf(cached, "0");
        const present = try body.caseOf(cached, "1");
        return body.match(cached, &.{ try absent.ret(try e.acquireTyped(absent.body(), o, v, state, selected, ids)), try present.ret(try e.deliverTyped(present.body(), o, v, state, ids, present.payload(), v.records, false, true)) });
    }
    fn deliverTyped(e: Emit, body: *typed.Body, o: LoopOps, v: LoopArgs, state: *const typed.Value, ids: *const typed.Value, record: *const typed.Value, records: *const typed.Value, acquired: bool, reused: bool) ConstructionError!*const typed.Value {
        const reply = try body.variant(try typed.interop.schema(e.c, e.d.types.reply), if (reused) "3" else "0", record);
        const next = try e.callSource(body, e.d.custody.distribute, &.{ state, ids, reply });
        return e.againTyped(body, o, v, next, records, acquired, reused, try body.sequenceLength(ids));
    }
    fn acquireTyped(e: Emit, body: *typed.Body, o: LoopOps, v: LoopArgs, state: *const typed.Value, selected: *const typed.Value, ids: *const typed.Value) ConstructionError!*const typed.Value {
        const key = try body.field(try body.field(selected, "1"), "0");
        const request = try body.product(try typed.interop.schema(e.c, e.d.types.request), &.{ .{ .name = "0", .value = v.subject }, .{ .name = "1", .value = key }, .{ .name = "2", .value = try body.field(try body.field(selected, "0"), "2") }, .{ .name = "3", .value = v.occurrence } });
        // Keep the exact perform-site witness required by Agent's registry.
        const site = try e.b.term(.{ .perform = .{ .effect = e.d.experiment, .payload = try typed.interop.valueId(body, request) } });
        if (e.registry) |registry| try registry.protectSite(try typed.interop.functionId(e.c, o.loop), site, e.d.experiment);
        const response = try typed.interop.term(body, site, try typed.interop.schema(e.c, e.d.types.envelope));
        const Guard = struct { parent: *typed.Body, condition: *const typed.Value, yes: *typed.Body, no: *typed.Body };
        var guards: [3]Guard = undefined;
        var work = body;
        for (&guards, 0..) |*guard, index| {
            const condition = switch (index) {
                0 => try work.call(o.subject_equal, &.{ .{ .name = "left", .value = v.subject }, .{ .name = "right", .value = try work.field(response, "0") } }),
                1 => try work.call(o.key_equal, &.{ .{ .name = "left", .value = try work.field(try work.field(selected, "1"), "0") }, .{ .name = "right", .value = try work.field(response, "1") } }),
                else => try work.equal(v.occurrence, try work.field(response, "2")),
            };
            const yes = try work.branch();
            guard.* = .{ .parent = work, .condition = condition, .yes = yes, .no = try work.branch() };
            work = yes;
        }
        var result = try e.completedTyped(work, o, v, state, selected, ids, try work.field(response, "3"));
        var remaining = guards.len;
        while (remaining != 0) {
            remaining -= 1;
            const guard = guards[remaining];
            result = try guard.parent.conditional(guard.condition, try guard.yes.ret(result), try guard.no.ret(try e.stopTyped(guard.no, o, v, state, .invalid_evidence, v.records, true)));
        }
        return result;
    }
    fn completedTyped(e: Emit, body: *typed.Body, o: LoopOps, v: LoopArgs, state: *const typed.Value, selected: *const typed.Value, ids: *const typed.Value, completion: *const typed.Value) ConstructionError!*const typed.Value {
        const completed_case = try body.caseOf(completion, "0");
        const inconclusive = try body.caseOf(completion, "1");
        const unavailable = try body.caseOf(completion, "2");
        const work = completed_case.body();
        const key = try work.field(try work.field(selected, "1"), "0");
        const accepted = if (e.f.?.observe) |observe| blk: {
            const valid = try e.callSource(work, observe, &.{ v.subject, key, completed_case.payload() });
            const yes = try work.branch();
            const no = try work.branch();
            break :blk try work.conditional(valid, try yes.ret(try e.acceptObservation(yes, o, v, state, selected, ids, completed_case.payload())), try no.ret(try e.stopTyped(no, o, v, state, .invalid_evidence, v.records, true)));
        } else try e.acceptObservation(work, o, v, state, selected, ids, completed_case.payload());
        const unknown = inconclusive.body();
        const reply = try unknown.variant(try typed.interop.schema(e.c, e.d.types.reply), "2", try unknown.constant(void, {}));
        const next = try e.callSource(unknown, e.d.custody.distribute, &.{ state, ids, reply });
        return body.match(completion, &.{ try completed_case.ret(accepted), try inconclusive.ret(try e.againTyped(unknown, o, v, next, v.records, true, false, try unknown.sequenceLength(ids))), try unavailable.ret(try e.stopTyped(unavailable.body(), o, v, state, .environment_unavailable, v.records, true)) });
    }
    fn acceptObservation(e: Emit, body: *typed.Body, o: LoopOps, v: LoopArgs, state: *const typed.Value, selected: *const typed.Value, ids: *const typed.Value, observation: *const typed.Value) ConstructionError!*const typed.Value {
        const record = try body.product(try typed.interop.schema(e.c, e.d.types.record), &.{ .{ .name = "0", .value = v.occurrence }, .{ .name = "1", .value = try body.field(try body.field(selected, "1"), "0") }, .{ .name = "2", .value = observation }, .{ .name = "3", .value = try body.field(try body.field(selected, "1"), "1") } });
        return e.conflictTyped(body, o, v, state, selected, ids, record);
    }
    fn deliverNew(e: Emit, body: *typed.Body, o: LoopOps, v: LoopArgs, state: *const typed.Value, ids: *const typed.Value, record: *const typed.Value) ConstructionError!*const typed.Value {
        return e.deliverTyped(body, o, v, state, ids, record, try body.append(v.records, record), true, false);
    }
    fn conflictTyped(e: Emit, body: *typed.Body, o: LoopOps, v: LoopArgs, state: *const typed.Value, selected: *const typed.Value, ids: *const typed.Value, record: *const typed.Value) ConstructionError!*const typed.Value {
        const reusable_case = try body.branch();
        const fresh = try body.branch();
        const prior = try reusable_case.call(o.lookup, &.{ .{ .name = "records", .value = v.records }, .{ .name = "key", .value = try reusable_case.field(try reusable_case.field(selected, "1"), "0") } });
        const absent = try reusable_case.caseOf(prior, "0");
        const present = try reusable_case.caseOf(prior, "1");
        const same = try present.body().call(o.observation_equal, &.{ .{ .name = "left", .value = try present.body().field(present.payload(), "2") }, .{ .name = "right", .value = try present.body().field(record, "2") } });
        const yes = try present.body().branch();
        const no = try present.body().branch();
        const compared = try present.body().conditional(same, try yes.ret(try e.deliverNew(yes, o, v, state, ids, record)), try no.ret(try e.stopTyped(no, o, v, state, .conflicting_observations, try no.append(v.records, record), true)));
        const checked = try reusable_case.match(prior, &.{ try absent.ret(try e.deliverNew(absent.body(), o, v, state, ids, record)), try present.ret(compared) });
        return body.conditional(try body.field(try body.field(selected, "1"), "1"), try reusable_case.ret(checked), try fresh.ret(try e.deliverNew(fresh, o, v, state, ids, record)));
    }
};

const LoopOps = struct {
    subject_equal: *const typed.Function,
    key_equal: *const typed.Function,
    observation_equal: *const typed.Function,
    loop: *const typed.Function,
    stop: *const typed.Function,
    admit: *const typed.Function,
    lookup: *const typed.Function,
    cached_choice: *const typed.Function,
    selected: *const typed.Function,
    recipients: *const typed.Function,
    failure: *const typed.FailureLiteral,
};
const LoopArgs = struct {
    state: *const typed.Value,
    subject: *const typed.Value,
    allowance: *const typed.Value,
    coalesce: *const typed.Value,
    policy: *const typed.Value,
    records: *const typed.Value,
    occurrence: *const typed.Value,
    acquisitions: *const typed.Value,
    reused: *const typed.Value,
    recipients: *const typed.Value,
};
