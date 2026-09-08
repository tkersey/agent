//! Internal multi-shot evaluation over ordinary Boundary source computations.
//! Alternatives and assessments are program values; no host snapshot is cloned.
const source = @import("boundary").computation;
pub const Id = source.Id;

pub const Scope = struct {
    captures: []const Id = &.{},
    owned_regions: []const Id = &.{},
    borrowed_regions: []const Id = &.{},
    residual: source.Row = .{ .effects = &.{} },
};

pub const Deliberation = struct {
    effect: Id,
    capability: Id,
    candidate: Id,
    assessment: Id,
    alternatives: Id,
    answer: Id,
    resumption: Id,
    handler: Id,
    clause: Id,
    collect: Id,
};

/// Scope rows declare the actual capture/effect domain. Boundary checks their
/// use and lifetime; protected Agent admission additionally checks effect roles.
/// The caller acquires approval and exclusive live resources after evaluate.
pub fn define(
    b: *source.Builder,
    identity: []const u8,
    candidate: Id,
    assessment: Id,
    scope: Scope,
) source.Error!Deliberation {
    const instance = try b.specialization(Deliberation, "agent.deliberation/v1", .{
        identity, candidate, assessment, scope,
    });
    if (instance.cached) |cached| return cached;
    const alternatives = try b.schema(.{ .seq = candidate });
    const answer = try b.schema(.{ .seq = assessment });
    const effect = try b.effect(.{
        .identity = identity,
        .payload = alternatives,
        .result = candidate,
        .control_use = .multi,
        .external = false,
    });
    const capability = try b.schema(.{ .internal = .{ .capability = effect } });
    const captures = try b.allocator().alloc(Id, scope.captures.len + 1);
    @memcpy(captures[0..scope.captures.len], scope.captures);
    captures[scope.captures.len] = capability;
    const resumption = try b.schema(.{ .internal = .{ .resumption = .{
        .effect = effect,
        .input = candidate,
        .answer = answer,
        .effects = scope.residual.effects,
        .capture_bound = captures,
        .handled = &.{effect},
        .mode = .deep,
        .use = .multi,
        .owned_regions = scope.owned_regions,
    } } });
    return instance.finish(b, try interpretation(b, .{
        .effect = effect,
        .capability = capability,
        .candidate = candidate,
        .assessment = assessment,
        .alternatives = alternatives,
        .answer = answer,
        .resumption = resumption,
        .handler = 0,
        .clause = 0,
        .collect = 0,
    }, scope));
}

fn interpretation(
    b: *source.Builder,
    definition: Deliberation,
    scope: Scope,
) source.Error!Deliberation {
    var d = definition;
    const returns = try b.declare(&.{d.assessment}, d.answer, &.{}, scope.borrowed_regions);
    const returned = try b.reference(b.parameter(returns, 0));
    const singleton = try b.primitive(d.answer, .sequence, &.{returned}, 0);
    try b.define(returns, try b.pure(singleton));
    d.collect = try collector(b, d, scope);
    d.clause = try b.declare(
        &.{ d.alternatives, d.resumption },
        d.answer,
        scope.residual.effects,
        scope.borrowed_regions,
    );
    const arguments = [_]Id{
        try b.reference(b.parameter(d.clause, 1)),
        try b.reference(b.parameter(d.clause, 0)),
        try b.primitive(d.answer, .sequence, &.{}, 0),
    };
    try b.define(d.clause, try b.term(.{ .call = .{
        .function = d.collect,
        .arguments = &arguments,
    } }));
    d.handler = try b.handler(.{
        .mode = .deep,
        .input = d.assessment,
        .answer = d.answer,
        .return_function = returns,
        .clauses = &.{.{ .effect = d.effect, .function = d.clause, .resumption = d.resumption }},
        .effects = scope.residual.effects,
    });
    return d;
}

fn collector(b: *source.Builder, d: Deliberation, scope: Scope) source.Error!Id {
    const unit = try b.scalar(void);
    const popped = try b.schema(.{ .product = &.{ d.candidate, d.alternatives } });
    const optional = try b.schema(.{ .sum = &.{ unit, popped } });
    const collect = try b.declare(
        &.{ d.resumption, d.alternatives, d.answer },
        d.answer,
        scope.residual.effects,
        scope.borrowed_regions,
    );
    const template = try b.reference(b.parameter(collect, 0));
    const remaining = try b.reference(b.parameter(collect, 1));
    const found = try b.reference(b.parameter(collect, 2));
    const empty = try b.variable(unit);
    const present = try b.variable(popped);
    const candidate = try b.variable(d.candidate);
    const rest = try b.variable(d.alternatives);
    const assessed = try b.variable(d.answer);
    const resumed = try b.term(.{ .resume_value = .{
        .resumption = template,
        .argument = try b.reference(candidate),
    } });
    const resumed_answer = try b.reference(assessed);
    const combined = try b.primitive(d.answer, .sequence_concat, &.{ found, resumed_answer }, 0);
    const recurse = try b.term(.{ .call = .{
        .function = collect,
        .arguments = &.{ template, try b.reference(rest), combined },
    } });
    const unpack = try b.term(.{ .unpack_product = .{
        .value = try b.reference(present),
        .variables = &.{ candidate, rest },
        .body = try b.bind(assessed, resumed, recurse),
    } });
    const popped_value = try b.primitive(optional, .sequence_pop, &.{remaining}, 0);
    try b.define(collect, try b.term(.{ .match_sum = .{
        .value = popped_value,
        .cases = &.{
            .{ .variable = empty, .body = try b.pure(found) },
            .{ .variable = present, .body = unpack },
        },
    } }));
    return collect;
}

/// Body is a Boundary computation value whose first parameter is the internal
/// choice capability. Its result is one assessment, including non-tail work.
pub fn evaluate(
    b: *source.Builder,
    d: Deliberation,
    body: Id,
    arguments: []const Id,
) source.Error!Id {
    return b.term(.{ .handle = .{
        .handler = d.handler,
        .body = body,
        .arguments = arguments,
    } });
}

/// Register the actual function installed under this multi handler with the
/// protected Agent context. The admitted effects are an explicit allow-list;
/// final admission inspects their roles and the transitive source computation.
pub fn register(context: anytype, d: Deliberation, body: Id, allowed: []const Id) !void {
    try context.registry.classify(d.effect, .internal);
    try context.registry.speculate(body, allowed);
}

/// Each candidate resumes the same internal continuation. An empty collection
/// produces an empty assessment collection; it is an authored policy choice.
pub fn choose(
    b: *source.Builder,
    d: Deliberation,
    capability: Id,
    alternatives: Id,
) source.Error!Id {
    return b.term(.{ .perform = .{
        .effect = d.effect,
        .capability = capability,
        .payload = alternatives,
    } });
}
