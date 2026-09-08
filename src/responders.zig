//! Checked responder compositions over ordinary Boundary source.
//! A model result is candidate data; this module grants no operation authority.
const std = @import("std");
const boundary = @import("boundary");
const authoring = @import("authoring.zig");
const sets = @import("sets.zig");
const source = boundary.computation;
const Id = source.Id;

/// Normalized metadata is untrusted external evidence. Its adjacent admission
/// result is candidate data, never a grant or an executable operation.
pub fn ModelObservation(comptime P: type, comptime batch: bool) type {
    return struct {
        normalized: P.Result,
        interpretation: if (batch) P.BatchInterpretation else P.Interpretation,
    };
}

/// Declare a shared `(P.Request, [P.declaration_count]bool) -> Interpretation`
/// computation. The request is a semantic configuration template: its `tools`
/// field is intentionally replaced with the closed catalog filtered by offered.
/// All other fields are preserved. Selection and the very same offered value
/// are captured before suspension and used to admit the normalized result.
/// `failure` is a literal of the enclosing module's failure schema.
pub fn defineModel(
    comptime P: type,
    c: authoring.Context,
    failure: Id,
    comptime batch: bool,
) !Id {
    const b = c.builder;
    const observed = try defineModelObserved(P, c, failure, batch);
    const instance = try b.specialization(Id, "agent.model.candidate-projection/v3", .{observed});
    if (instance.cached) |cached| return cached;
    const result = try c.schema(if (batch) P.BatchInterpretation else P.Interpretation);
    const function = try b.declare(
        &.{ try c.schema(P.Request), try c.schema([P.declaration_count]bool) },
        result,
        b.functions.items[@intCast(observed)].effects,
        &.{},
    );
    const observation = try b.variable(try c.schema(ModelObservation(P, batch)));
    const call = try b.term(.{ .call = .{ .function = observed, .arguments = &.{
        try b.reference(b.parameter(function, 0)),
        try b.reference(b.parameter(function, 1)),
    } } });
    const interpreted = try b.primitive(result, .field, &.{try b.reference(observation)}, 1);
    try b.define(function, try b.bind(observation, call, try b.pure(interpreted)));
    return instance.finish(b, function);
}

/// The same owned invocation, with its complete normalized result retained for
/// authored refusal/retry/failure policies and audit. No normalization is repeated.
pub fn defineModelObserved(
    comptime P: type,
    c: authoring.Context,
    failure: Id,
    comptime batch: bool,
) !Id {
    const b = c.builder;
    const effect = try P.declare(b);
    try c.registry.classify(effect, .model);
    const fault = try b.failureLiteral(failure);
    const instance = try b.specialization(Id, "agent.model.observed-responder/v3", .{
        @typeName(P), effect, fault, batch,
    });
    if (instance.cached) |cached| return cached;
    const function = try b.declare(
        &.{ try c.schema(P.Request), try c.schema([P.declaration_count]bool) },
        try c.schema(ModelObservation(P, batch)),
        &.{effect},
        &.{},
    );
    const g = Generator(P, batch){ .context = c, .function = function, .fault = fault };
    try b.define(function, try g.body(effect));
    return instance.finish(b, function);
}

/// Return an ordinary call term. Bind the candidate result before interpreting
/// it further or presenting it to the separate protected commitment path.
pub fn invokeModel(
    comptime P: type,
    c: authoring.Context,
    failure: Id,
    comptime batch: bool,
    request: Id,
    offered: Id,
) !Id {
    return c.builder.term(.{ .call = .{
        .function = try defineModel(P, c, failure, batch),
        .arguments = &.{ request, offered },
    } });
}

pub fn invokeModelObserved(
    comptime P: type,
    c: authoring.Context,
    failure: Id,
    comptime batch: bool,
    request: Id,
    offered: Id,
) !Id {
    return c.builder.term(.{ .call = .{
        .function = try defineModelObserved(P, c, failure, batch),
        .arguments = &.{ request, offered },
    } });
}

fn Generator(comptime P: type, comptime batch: bool) type {
    return struct {
        context: authoring.Context,
        function: Id,
        fault: Id,

        const G = @This();

        fn body(g: G, effect: Id) !Id {
            const c = g.context;
            const b = c.builder;
            const template = try b.reference(b.parameter(g.function, 0));
            const offered = try b.reference(b.parameter(g.function, 1));
            const tools_schema = try c.schema(P.Tools);
            var tools: [P.declaration_count + 1]Id = undefined;
            for (&tools) |*value| value.* = try b.variable(tools_schema);
            var continuation = try g.invoke(effect, template, offered, tools[tools.len - 1]);
            var index = P.declaration_count;
            while (index != 0) {
                index -= 1;
                continuation = try g.filter(
                    offered,
                    index,
                    tools[index],
                    tools[index + 1],
                    continuation,
                );
            }
            const empty = try c.literal(P.Tools, .{ .items = &.{} });
            return b.bind(tools[0], try b.pure(empty), continuation);
        }

        fn filter(g: G, offered: Id, index: usize, before: Id, after: Id, next: Id) !Id {
            const c = g.context;
            const b = c.builder;
            const set = try sets.define(b, P.declaration_count);
            const present = try b.variable(try c.schema(bool));
            const previous = try b.reference(before);
            const tool = try P.declarationValue(b, index);
            const append = try b.value(.{
                .schema = try c.schema(P.Tools),
                .expression = .{ .primitive = .{
                    .opcode = .sequence_append,
                    .operands = &.{ previous, tool },
                    .failures = &.{.{ .kind = .capacity_exceeded, .value = g.fault }},
                } },
            });
            const choose = try b.term(.{ .conditional = .{
                .condition = try b.reference(present),
                .when_true = try b.pure(append),
                .when_false = try b.pure(previous),
            } });
            const availability = try sets.member(b, set, offered, index);
            return b.bind(present, availability, try b.bind(after, choose, next));
        }

        fn invoke(g: G, effect: Id, template: Id, offered: Id, tools: Id) !Id {
            const c = g.context;
            const b = c.builder;
            const selection_schema = try c.schema(@FieldType(P.Request, "selection"));
            const selection = try b.variable(selection_schema);
            const normalized = try b.variable(try c.schema(P.Result));
            const payload = try g.request(template, try b.reference(tools));
            const perform = try b.term(.{ .perform = .{ .effect = effect, .payload = payload } });
            try c.registry.protectSite(g.function, perform, effect);
            const admit = try b.term(.{ .call = .{
                .function = if (batch) try P.interpretAll(b) else try P.interpreter(b),
                .arguments = &.{
                    try b.reference(normalized), offered, try b.reference(selection),
                },
            } });
            const interpreted = try b.variable(try c.schema(
                if (batch) P.BatchInterpretation else P.Interpretation,
            ));
            const observation = try b.primitive(try c.schema(ModelObservation(P, batch)), .product, &.{ try b.reference(normalized), try b.reference(interpreted) }, 0);
            const observed = try b.bind(interpreted, admit, try b.pure(observation));
            const selected = try b.primitive(
                selection_schema,
                .field,
                &.{template},
                comptime std.meta.fieldIndex(P.Request, "selection").?,
            );
            return b.bind(selection, try b.pure(selected), try b.bind(normalized, perform, observed));
        }

        fn request(g: G, template: Id, tools: Id) !Id {
            const c = g.context;
            const fields = std.meta.fields(P.Request);
            var values: [fields.len]Id = undefined;
            inline for (fields, 0..) |field, index| {
                if (comptime std.mem.eql(u8, field.name, "tools")) {
                    values[index] = tools;
                    continue;
                }
                values[index] = try c.builder.primitive(
                    try c.schema(field.type),
                    .field,
                    &.{template},
                    index,
                );
            }
            return c.builder.primitive(try c.schema(P.Request), .product, &values, 0);
        }
    };
}
