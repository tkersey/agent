//! ReAct is an ordinary authored loop, reusable with any admitted interpretation.
//! The computations supplied to the loop are Boundary values, not native callbacks.
const std = @import("std");
const boundary = @import("boundary");
const source = boundary.computation;
const typed = boundary.authoring;
const Id = source.Id;

/// Continue(Action) is ordinal 0; Done(Result) is ordinal 1.
pub const Step = struct { schema: Id, action: Id, result: Id };
pub const Loop = struct { function: Id, step: Step };
pub const Spec = struct {
    state: Id,
    step: Step,
    observation: Id,
    /// Reusable computation schema: State -> Step.
    decide: Id,
    /// Reusable computation schema: Action -> Observation.
    execute: Id,
    /// Reusable computation schema: (State, Observation) -> State.
    fold: Id,
    residual: source.Row = .{ .effects = &.{} },
    regions: []const Id = &.{},
};

pub fn step(b: *source.Builder, action: Id, result: Id) source.Error!Step {
    return .{
        .schema = try b.schema(.{ .sum = &.{ action, result } }),
        .action = action,
        .result = result,
    };
}

/// Produces one shared recursive function. The application's decision determines
/// termination; this composition adds no turn count, branch count, or lifetime fuel.
/// Boundary checks the state/capture usage and region lifetime in the final module.
pub fn define(b: *source.Builder, spec: Spec) source.Error!Loop {
    try checkStep(b, spec.step);
    try checkComputation(b, spec.decide, &.{spec.state}, spec.step.schema, spec);
    try checkComputation(b, spec.execute, &.{spec.step.action}, spec.observation, spec);
    try checkComputation(b, spec.fold, &.{ spec.state, spec.observation }, spec.state, spec);
    const instance = try b.specialization(Loop, "agent.react/v1", spec);
    if (instance.cached) |cached| return cached;
    const function = loopDefinition(b, spec) catch |err| return typed.sourceError(err);
    return instance.finish(b, .{ .function = function, .step = spec.step });
}

fn loopDefinition(b: *source.Builder, spec: Spec) typed.Error!Id {
    const c = try typed.Context.init(b);
    const state_schema = try typed.interop.schema(c, spec.state);
    const decide_schema = try typed.interop.namedCallable(c, spec.decide, &.{"state"});
    const execute_schema = try typed.interop.namedCallable(c, spec.execute, &.{"action"});
    const fold_schema = try typed.interop.namedCallable(c, spec.fold, &.{ "state", "observation" });
    const residual = try b.allocator().alloc(*const typed.Operation, spec.residual.effects.len);
    for (residual, spec.residual.effects) |*item, id| item.* = try typed.interop.operation(c, id);
    const regions = try b.allocator().alloc(*const typed.Region, spec.regions.len);
    for (regions, spec.regions) |*item, id| item.* = try typed.interop.region(c, id);
    const signature = try c.callable(&.{
        .{ .name = "state", .schema = state_schema },
        .{ .name = "decide", .schema = decide_schema },
        .{ .name = "execute", .schema = execute_schema },
        .{ .name = "fold", .schema = fold_schema },
    }, try typed.interop.schema(c, spec.step.result), residual, .{
        .use = .reusable,
        .captures = &.{},
        .regions = regions,
    });
    const function = try c.functionFor("ReAct", signature);
    const body = try c.body(function);
    const state = try body.parameter("state");
    const decide = try body.parameter("decide");
    const execute = try body.parameter("execute");
    const fold = try body.parameter("fold");
    const selected = try body.apply(decide, &.{.{ .name = "state", .value = state }});
    const continuing = try body.caseOf(selected, "0");
    const working = continuing.body();
    const observation = try working.apply(execute, &.{.{
        .name = "action",
        .value = continuing.payload(),
    }});
    const next = try working.apply(fold, &.{
        .{ .name = "state", .value = state },
        .{ .name = "observation", .value = observation },
    });
    const again = try working.call(function, &.{
        .{ .name = "state", .value = next },
        .{ .name = "decide", .value = decide },
        .{ .name = "execute", .value = execute },
        .{ .name = "fold", .value = fold },
    });
    const done = try body.caseOf(selected, "1");
    const result = try body.match(selected, &.{
        try continuing.ret(again), try done.ret(done.payload()),
    });
    try c.define(function, try body.ret(result));
    return typed.interop.functionId(c, function);
}

fn checkStep(b: *source.Builder, declared: Step) source.Error!void {
    if (declared.schema >= b.schemas.items.len) return error.InvalidReference;
    const shape = b.schemas.items[@intCast(declared.schema)];
    if (shape != .sum or !std.mem.eql(Id, shape.sum, &.{ declared.action, declared.result }))
        return error.TypeMismatch;
}

fn checkComputation(
    b: *source.Builder,
    schema: Id,
    parameters: []const Id,
    result: Id,
    spec: Spec,
) source.Error!void {
    if (schema >= b.schemas.items.len) return error.InvalidReference;
    const shape = b.schemas.items[@intCast(schema)];
    if (shape != .internal or shape.internal != .computation) return error.TypeMismatch;
    const computation = shape.internal.computation;
    if (!std.mem.eql(Id, computation.parameters, parameters) or computation.result != result)
        return error.TypeMismatch;
    if (computation.use != .reusable) return error.InvalidOwnership;
    for (computation.effects) |effect| {
        if (std.mem.indexOfScalar(Id, spec.residual.effects, effect) == null)
            return error.InvalidEffect;
    }
    for (computation.regions) |region| {
        if (std.mem.indexOfScalar(Id, spec.regions, region) == null)
            return error.InvalidOwnership;
    }
}

/// All arguments are staged value IDs. Final Boundary admission checks their types.
pub fn run(
    b: *source.Builder,
    loop: Loop,
    initial_state: Id,
    decide: Id,
    execute: Id,
    fold: Id,
) source.Error!Id {
    return b.term(.{ .call = .{
        .function = loop.function,
        .arguments = &.{ initial_state, decide, execute, fold },
    } });
}

pub fn continueWith(b: *source.Builder, declared: Step, action: Id) source.Error!Id {
    return b.primitive(declared.schema, .variant, &.{action}, 0);
}

pub fn finishWith(b: *source.Builder, declared: Step, result: Id) source.Error!Id {
    return b.primitive(declared.schema, .variant, &.{result}, 1);
}

fn testSpec(b: *source.Builder) !Spec {
    const integer = try b.scalar(u64);
    const selected = try step(b, integer, integer);
    return .{
        .state = integer,
        .step = selected,
        .observation = integer,
        .decide = try b.schema(.{ .internal = .{ .computation = .{
            .parameters = &.{integer},
            .result = selected.schema,
        } } }),
        .execute = try b.schema(.{ .internal = .{ .computation = .{
            .parameters = &.{integer},
            .result = integer,
        } } }),
        .fold = try b.schema(.{ .internal = .{ .computation = .{
            .parameters = &.{ integer, integer },
            .result = integer,
        } } }),
    };
}

test "ReAct constructs shared ordinary source with authored computation arguments" {
    var b = source.Builder.init(std.testing.allocator);
    defer b.deinit();
    const spec = try testSpec(&b);
    const loop = try define(&b, spec);
    try std.testing.expectEqual(loop.function, (try define(&b, spec)).function);
    const integer = spec.state;
    const decide = try b.declare(&.{integer}, spec.step.schema, &.{}, &.{});
    const execute = try b.declare(&.{integer}, integer, &.{}, &.{});
    const fold = try b.declare(&.{ integer, integer }, integer, &.{}, &.{});
    const selected = try finishWith(&b, spec.step, try b.reference(b.parameter(decide, 0)));
    try b.define(decide, try b.pure(selected));
    try b.define(execute, try b.pure(try b.reference(b.parameter(execute, 0))));
    try b.define(fold, try b.pure(try b.reference(b.parameter(fold, 1))));
    const entry = try b.declare(&.{integer}, integer, &.{}, &.{});
    try b.define(entry, try run(
        &b,
        loop,
        try b.reference(b.parameter(entry, 0)),
        try b.lambda(decide, spec.decide),
        try b.lambda(execute, spec.execute),
        try b.lambda(fold, spec.fold),
    ));
    var compiled = try boundary.program.compile(std.testing.allocator, b.module(entry, integer));
    defer compiled.deinit();
}

test "ReAct rejects mismatched computations and forged Step shapes" {
    var b = source.Builder.init(std.testing.allocator);
    defer b.deinit();
    const spec = try testSpec(&b);
    var wrong = spec;
    wrong.decide = spec.execute;
    try std.testing.expectError(error.TypeMismatch, define(&b, wrong));
    wrong = spec;
    wrong.step.schema = spec.state;
    try std.testing.expectError(error.TypeMismatch, define(&b, wrong));
    wrong = spec;
    wrong.fold = try b.schema(.{ .internal = .{ .computation = .{
        .parameters = &.{ spec.state, spec.observation },
        .result = spec.state,
        .use = .linear,
    } } });
    try std.testing.expectError(error.InvalidOwnership, define(&b, wrong));
}

test "ReAct rejects omitted residual effects and borrowed regions" {
    var b = source.Builder.init(std.testing.allocator);
    defer b.deinit();
    var spec = try testSpec(&b);
    const effect = try b.effect(.{
        .identity = "react.test.observation",
        .payload = spec.step.action,
        .result = spec.observation,
    });
    const region = b.region();
    spec.execute = try b.schema(.{ .internal = .{ .computation = .{
        .parameters = &.{spec.step.action},
        .result = spec.observation,
        .effects = &.{effect},
        .regions = &.{region},
    } } });
    try std.testing.expectError(error.InvalidEffect, define(&b, spec));
    spec.residual = .{ .effects = &.{effect} };
    try std.testing.expectError(error.InvalidOwnership, define(&b, spec));
    spec.regions = &.{region};
    _ = try define(&b, spec);
}
