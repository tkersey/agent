//! Typed bidirectional dialogue built from ordinary Boundary deep handlers.
//! A suspended future remains internal program data and has linear custody.
const boundary = @import("boundary");
const source = boundary.computation;
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
        .handler = try defineHandler(builder, effect, result, outgoing, answer, awaiting, package, resumption, scope),
    };
    return instance.finish(builder, dialogue);
}

fn defineHandler(
    b: *source.Builder,
    effect: Id,
    result: Id,
    outgoing: Id,
    answer: Id,
    awaiting: Id,
    package: Id,
    resumption: Id,
    scope: Scope,
) source.Error!Id {
    const returns = try b.declare(&.{result}, answer, &.{}, scope.borrowed_regions);
    const returned = try b.reference(b.parameter(returns, 0));
    try b.define(returns, try b.pure(try b.primitive(answer, .variant, &.{returned}, 0)));
    const clause = try b.declare(&.{ outgoing, resumption }, answer, &.{}, scope.borrowed_regions);
    const future = try b.primitive(package, .package, &.{try b.reference(b.parameter(clause, 1))}, 0);
    const offered = try b.primitive(awaiting, .product, &.{ try b.reference(b.parameter(clause, 0)), future }, 0);
    try b.define(clause, try b.pure(try b.primitive(answer, .variant, &.{offered}, 1)));
    return b.handler(.{
        .mode = .deep,
        .input = result,
        .answer = answer,
        .return_function = returns,
        .clauses = &.{.{ .effect = effect, .function = clause, .resumption = resumption }},
        .effects = scope.residual.effects,
    });
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
