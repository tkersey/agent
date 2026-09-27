//! Typed bidirectional dialogue built from ordinary Boundary deep handlers.
//! A suspended future remains internal program data and has linear custody.
const boundary = @import("boundary");
const source = boundary.computation;
const typed = boundary.authoring;
const Id = source.Id;

pub const Dialogue = struct {
    effect: Id,
    capability: Id,
    outgoing: Id,
    input: Id,
    result: Id,
    answer: Id,
    awaiting: Id,
    package: Id,
    resumption: Id,
    handler: Id,
};

pub const Scope = struct {
    captures: []const Id = &.{},
    owned_regions: []const Id = &.{},
    borrowed_regions: []const Id = &.{},
    residual: source.Row = .{ .effects = &.{} },
};

/// Declare Done(R) | Awaiting(Out, owned Suspension<In, Dialogue>).
/// Owned regions must originate inside the handled body; borrowed regions
/// must remain live in its caller. Boundary checks both at final compilation.
pub fn define(
    builder: *source.Builder,
    identity: []const u8,
    outgoing: Id,
    input: Id,
    result: Id,
    scope: Scope,
) source.Error!Dialogue {
    const instance = try builder.specialization(Dialogue, "agent.dialogue/v1", .{
        identity, outgoing, input, result, scope,
    });
    if (instance.cached) |cached| return cached;
    const effect = try builder.effect(.{
        .identity = identity,
        .payload = outgoing,
        .result = input,
        .external = false,
    });
    const capability = try builder.schema(.{ .internal = .{ .capability = effect } });
    const captures = try builder.allocator().alloc(Id, scope.captures.len + 1);
    @memcpy(captures[0..scope.captures.len], scope.captures);
    captures[scope.captures.len] = capability;
    const answer = try builder.reserveSchema();
    const resumption = try builder.schema(.{ .internal = .{ .resumption = .{
        .effect = effect,
        .input = input,
        .answer = answer,
        .effects = scope.residual.effects,
        .capture_bound = captures,
        .handled = &.{effect},
        .mode = .deep,
        .use = .linear,
        .owned_regions = scope.owned_regions,
        .obligations = true,
    } } });
    const package = try builder.schema(.{ .internal = .{ .suspension_package = resumption } });
    const awaiting = try builder.schema(.{ .product = &.{ outgoing, package } });
    try builder.defineSchema(answer, .{ .sum = &.{ result, awaiting } });
    const dialogue: Dialogue = .{
        .effect = effect,
        .capability = capability,
        .outgoing = outgoing,
        .input = input,
        .result = result,
        .answer = answer,
        .awaiting = awaiting,
        .package = package,
        .resumption = resumption,
        .handler = defineHandler(builder, effect, result, answer, awaiting, scope) catch |err|
            return typed.sourceError(err),
    };
    return instance.finish(builder, dialogue);
}

fn defineHandler(
    b: *source.Builder,
    effect: Id,
    result: Id,
    answer: Id,
    awaiting: Id,
    scope: Scope,
) typed.Error!Id {
    const c = try typed.Context.init(b);
    const operation = try typed.interop.operation(c, effect);
    const result_schema = try typed.interop.schema(c, result);
    // The finite recursive answer group was completed before its checked adoption.
    const answer_schema = try typed.interop.schema(c, answer);
    const awaiting_schema = try typed.interop.schema(c, awaiting);
    const captures = try b.allocator().alloc(*const typed.Schema, scope.captures.len + 1);
    for (scope.captures, 0..) |id, i| captures[i] = try typed.interop.schema(c, id);
    captures[scope.captures.len] = try c.capability(operation);
    const residual = try b.allocator().alloc(*const typed.Operation, scope.residual.effects.len);
    for (residual, scope.residual.effects) |*item, id| item.* = try typed.interop.operation(c, id);
    const owned = try b.allocator().alloc(*const typed.Region, scope.owned_regions.len);
    for (owned, scope.owned_regions) |*item, id| item.* = try typed.interop.region(c, id);
    const borrowed = try b.allocator().alloc(*const typed.Region, scope.borrowed_regions.len);
    for (borrowed, scope.borrowed_regions) |*item, id| item.* = try typed.interop.region(c, id);
    const handler = try c.handler(operation, result_schema, answer_schema, .{
        .mode = .deep,
        .use = .linear,
        .obligations = true,
        .residual = residual,
        .return_effects = &.{},
        .clause_effects = &.{},
        .captures = captures,
        .owned_regions = owned,
        .borrowed_regions = borrowed,
    });
    const returns_fn = try c.returnFunction(handler);
    const returns = try c.body(returns_fn);
    try c.define(returns_fn, try returns.ret(try returns.variant(
        answer_schema,
        "0",
        try returns.parameter("result"),
    )));
    const clause_fn = try c.clauseFunction(handler);
    const clause = try c.body(clause_fn);
    const future = try clause.package(try clause.parameter("resumption"));
    const offered = try clause.product(awaiting_schema, &.{
        .{ .name = "0", .value = try clause.parameter("payload") },
        .{ .name = "1", .value = future },
    });
    try c.define(clause_fn, try clause.ret(try clause.variant(answer_schema, "1", offered)));
    return typed.interop.handlerId(c, handler);
}

/// The body's first parameter receives the dialogue capability. Further
/// parameters are supplied in arguments, following Boundary's handle contract.
pub fn start(b: *source.Builder, d: Dialogue, body: Id, arguments: []const Id) source.Error!Id {
    return b.term(.{ .handle = .{ .handler = d.handler, .body = body, .arguments = arguments } });
}

pub fn offer(b: *source.Builder, d: Dialogue, capability: Id, outgoing: Id) source.Error!Id {
    return b.term(.{ .perform = .{
        .effect = d.effect,
        .capability = capability,
        .payload = outgoing,
    } });
}

/// Resuming consumes the package, restoring the captured handler and regions.
pub fn resumeWith(b: *source.Builder, d: Dialogue, package: Id, input: Id) source.Error!Id {
    return b.term(.{ .resume_value = .{
        .resumption = try b.primitive(d.resumption, .unpack, &.{package}, 0),
        .argument = input,
    } });
}

/// Disposal consumes the package and follows its authored cleanup, which may
/// itself perform a residual effect and suspend.
pub fn dispose(b: *source.Builder, d: Dialogue, package: Id) source.Error!Id {
    return b.term(.{ .dispose = try b.primitive(d.resumption, .unpack, &.{package}, 0) });
}
