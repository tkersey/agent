//! Typed questions interpreted by statically authored computations.
//! These helpers emit Boundary source, never runtime Zig callbacks.
const boundary = @import("boundary");
const source = boundary.computation;
const Id = source.Id;

pub const Family = struct { effect: Id, capability: Id, question: Id, answer: Id };
pub const Interpretation = struct { handler: Id, resumption: Id };
pub const Scope = struct {
    captures: []const Id = &.{},
    residual: source.Row = .{ .effects = &.{} },
    owned_regions: []const Id = &.{},
    borrowed_regions: []const Id = &.{},
};

pub fn define(b: *source.Builder, identity: []const u8, question: Id, answer: Id) !Family {
    const instance = try b.specialization(Family, "agent.ask/v1", .{ identity, question, answer });
    if (instance.cached) |cached| return cached;
    for (b.effects.items) |effect| {
        if (@import("std").mem.eql(u8, effect.identity, identity)) return error.InvalidSource;
    }
    const effect = try b.effect(.{
        .identity = identity,
        .payload = question,
        .result = answer,
        .external = false,
    });
    return instance.finish(b, .{
        .effect = effect,
        .capability = try b.schema(.{ .internal = .{ .capability = effect } }),
        .question = question,
        .answer = answer,
    });
}

/// The responder is a reusable authored computation Q -> A. Its row and captures
/// remain subject to Boundary admission, including effects used while answering.
/// It may be implemented with human/model effects, rules, or a delegated body.
pub fn interpret(
    b: *source.Builder,
    family: Family,
    result: Id,
    responder: Id,
    scope: Scope,
) source.Error!Interpretation {
    try checkResponder(b, family, responder, scope.residual);
    const instance = try b.specialization(Interpretation, "agent.ask.interpret/v1", .{
        family, result, responder, scope,
    });
    if (instance.cached) |cached| return cached;
    const captures = try b.allocator().alloc(Id, scope.captures.len + 2);
    @memcpy(captures[0..scope.captures.len], scope.captures);
    captures[scope.captures.len] = family.capability;
    captures[scope.captures.len + 1] = responder;
    const token = try b.schema(.{ .internal = .{ .resumption = .{
        .effect = family.effect,
        .input = family.answer,
        .answer = result,
        .effects = scope.residual.effects,
        .capture_bound = captures,
        .handled = &.{family.effect},
        .mode = .deep,
        .use = .linear,
        .owned_regions = scope.owned_regions,
        .obligations = true,
    } } });
    const returns = try b.declare(&.{ responder, result }, result, &.{}, scope.borrowed_regions);
    try b.define(returns, try b.pure(try b.reference(b.parameter(returns, 1))));
    const clause = try b.declare(
        &.{ responder, family.question, token },
        result,
        scope.residual.effects,
        scope.borrowed_regions,
    );
    const answer = try b.variable(family.answer);
    const answered = try b.term(.{ .apply = .{
        .computation = try b.reference(b.parameter(clause, 0)),
        .arguments = &.{try b.reference(b.parameter(clause, 1))},
    } });
    const resumed = try b.term(.{ .resume_value = .{
        .resumption = try b.reference(b.parameter(clause, 2)),
        .argument = try b.reference(answer),
    } });
    try b.define(clause, try b.bind(answer, answered, resumed));
    return instance.finish(b, .{
        .handler = try b.handler(.{
            .mode = .deep,
            .input = result,
            .answer = result,
            .return_function = returns,
            .state = &.{responder},
            .effects = scope.residual.effects,
            .clauses = &.{.{ .effect = family.effect, .function = clause, .resumption = token }},
        }),
        .resumption = token,
    });
}

fn checkResponder(b: *source.Builder, family: Family, schema: Id, residual: source.Row) !void {
    if (schema >= b.schemas.items.len) return error.InvalidReference;
    const shape = b.schemas.items[@intCast(schema)];
    if (shape != .internal or shape.internal != .computation) return error.TypeMismatch;
    const computation = shape.internal.computation;
    if (computation.parameters.len != 1 or computation.parameters[0] != family.question or
        computation.result != family.answer) return error.TypeMismatch;
    if (computation.use != .reusable) return error.InvalidOwnership;
    for (computation.effects) |effect| {
        if (@import("std").mem.indexOfScalar(Id, residual.effects, effect) == null)
            return error.InvalidEffect;
    }
}

pub fn ask(b: *source.Builder, family: Family, capability: Id, question: Id) source.Error!Id {
    return b.term(.{ .perform = .{
        .effect = family.effect,
        .capability = capability,
        .payload = question,
    } });
}

pub fn handle(
    b: *source.Builder,
    interpretation: Interpretation,
    body: Id,
    responder: Id,
    arguments: []const Id,
) source.Error!Id {
    return b.term(.{ .handle = .{
        .handler = interpretation.handler,
        .body = body,
        .arguments = arguments,
        .state = &.{responder},
    } });
}
