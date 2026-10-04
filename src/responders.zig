//! Checked responder compositions over ordinary Boundary source.
//! A model result is candidate data; this module grants no operation authority.
const std = @import("std");
const boundary = @import("boundary");
const authoring = @import("authoring.zig");
const sets = @import("sets.zig");
const source = boundary.source;
const typed = boundary.authoring;
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
/// Other fields are preserved; incompatible normalization bounds take `failure`
/// before external I/O. Selection and the very same offered value
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
    const t = try typed.Context.init(b);
    const result = try typed.interop.schema(t, try c.schema(if (batch) P.BatchInterpretation else P.Interpretation));
    const effects = b.functions.items[@intCast(observed)].effects;
    const row = try b.allocator().alloc(*const typed.Operation, effects.len);
    for (row, effects) |*item, id| item.* = try typed.interop.operation(t, id);
    const handle = try t.function("model candidate", &.{
        .{ .name = "request", .schema = try typed.interop.schema(t, try c.schema(P.Request)) },
        .{ .name = "offered", .schema = try typed.interop.schema(t, try c.schema([P.declaration_count]bool)) },
    }, result, row);
    const body = try t.body(handle);
    const call = try b.term(.{ .call = .{ .function = observed, .arguments = &.{
        try typed.interop.valueId(body, try body.parameter("request")),
        try typed.interop.valueId(body, try body.parameter("offered")),
    } } });
    const observation = try typed.interop.term(body, call, try typed.interop.schema(t, try c.schema(ModelObservation(P, batch))));
    try t.define(handle, try body.ret(try body.field(observation, "1")));
    const function = try typed.interop.functionId(t, handle);
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
    const t = try typed.Context.init(b);
    const handle = try t.function("observed model response", &.{
        .{ .name = "request", .schema = try typed.interop.schema(t, try c.schema(P.Request)) },
        .{ .name = "offered", .schema = try typed.interop.schema(t, try c.schema([P.declaration_count]bool)) },
    }, try typed.interop.schema(t, try c.schema(ModelObservation(P, batch))), &.{try typed.interop.operation(t, effect)});
    const function = try typed.interop.functionId(t, handle);
    const g = Generator(P, batch){ .context = c, .typed_context = t, .handle = handle, .function = function, .fault = fault, .failure = failure };
    try t.define(handle, try g.emitBody(effect));
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
        typed_context: *typed.Context,
        handle: *const typed.Function,
        function: Id,
        fault: Id,
        failure: Id,
        const G = @This();

        fn schema(g: G, comptime T: type) !*const typed.Schema {
            return typed.interop.schema(g.typed_context, try g.context.schema(T));
        }
        fn value(g: G, body: *typed.Body, id: Id) !*const typed.Value {
            return typed.interop.adoptValue(body, id, try typed.interop.schema(g.typed_context, g.context.builder.values.items[id].schema));
        }
        fn pure(g: G, body: *typed.Body, id: Id) !*const typed.Value {
            const b = g.context.builder;
            return typed.interop.term(body, try b.pure(id), try typed.interop.schema(g.typed_context, b.values.items[id].schema));
        }
        fn literal(g: G, body: *typed.Body, comptime T: type, item: T) !*const typed.Value {
            return g.value(body, try g.context.literal(T, item));
        }
        fn field(_: G, body: *typed.Body, datum: *const typed.Value, comptime T: type, comptime name: []const u8) !*const typed.Value {
            const index = comptime std.meta.fieldIndex(T, name).?;
            return body.field(datum, std.fmt.comptimePrint("{d}", .{index}));
        }
        fn less(g: G, body: *typed.Body, left: *const typed.Value, right: *const typed.Value) !*const typed.Value {
            return g.pure(body, try g.context.builder.primitive(try g.context.schema(bool), .less, &.{ try typed.interop.valueId(body, left), try typed.interop.valueId(body, right) }, 0));
        }
        fn rejectWhen(g: G, body: *typed.Body, invalid: *const typed.Value) !void {
            const rejected = try body.branch();
            const accepted = try body.branch();
            _ = try body.conditional(invalid, try rejected.fail(try g.schema(void), try g.value(rejected, g.failure)), try accepted.ret(try accepted.constant(void, {})));
        }
        fn emitBody(g: G, effect: Id) !*const typed.Computation {
            const root = try g.typed_context.body(g.handle);
            const template = try root.parameter("request");
            const offered = try root.parameter("offered");
            var tools = try g.literal(root, P.Tools, .{ .items = &.{} });
            for (0..P.declaration_count) |index| tools = try g.filter(root, offered, index, tools);
            const selection = try g.field(root, template, P.Request, "selection");
            try g.checkTemplate(root, template, selection);
            const payload = try g.request(root, template, tools);
            const b = g.context.builder;
            // Agent's registry binds this exact environmental site to its owner.
            const perform = try b.term(.{ .perform = .{
                .effect = effect,
                .payload = try typed.interop.valueId(root, payload),
            } });
            try g.context.registry.protectSite(g.function, perform, effect);
            const normalized = try typed.interop.term(root, perform, try g.schema(P.Result));
            // The protocol interpreter is independently generated/admitted code.
            const admit = try b.term(.{ .call = .{
                .function = if (batch) try P.interpretAll(b) else try P.interpreter(b),
                .arguments = &.{ try typed.interop.valueId(root, normalized), try typed.interop.valueId(root, offered), try typed.interop.valueId(root, selection) },
            } });
            const interpreted = try typed.interop.term(root, admit, try g.schema(if (batch) P.BatchInterpretation else P.Interpretation));
            return root.ret(try root.product(try g.schema(ModelObservation(P, batch)), &.{
                .{ .name = "0", .value = normalized }, .{ .name = "1", .value = interpreted },
            }));
        }
        fn filter(g: G, body: *typed.Body, offered: *const typed.Value, index: usize, previous: *const typed.Value) !*const typed.Value {
            const b = g.context.builder;
            const set = try sets.define(b, P.declaration_count);
            const present = try typed.interop.term(body, try sets.member(b, set, try typed.interop.valueId(body, offered), index), try g.schema(bool));
            const included = try body.branch();
            const excluded = try body.branch();
            const appended = try g.pure(included, try b.value(.{
                .schema = try g.context.schema(P.Tools),
                .expression = .{ .primitive = .{
                    .opcode = .sequence_append,
                    .operands = &.{ try typed.interop.valueId(included, previous), try P.declarationValue(b, index) },
                    .failures = &.{.{ .kind = .capacity_exceeded, .value = g.fault }},
                } },
            }));
            return body.conditional(present, try included.ret(appended), try excluded.ret(previous));
        }
        fn checkTemplate(g: G, body: *typed.Body, template: *const typed.Value, selection: *const typed.Value) !void {
            const bytes = try g.field(body, template, P.Request, "maximum_provider_response_bytes");
            try g.rejectWhen(body, try body.equal(bytes, try body.constant(u32, 0)));
            const Limits = @FieldType(P.Request, "normalization_limits");
            const limits = try g.field(body, template, P.Request, "normalization_limits");
            const count = try g.field(body, limits, Limits, "maximum_output_items");
            const Selection = @FieldType(P.Request, "selection");
            const minimum = try g.field(body, selection, Selection, "minimum_calls");
            const maximum = try g.field(body, selection, Selection, "maximum_calls");
            try g.rejectWhen(body, try g.less(body, count, maximum));
            try g.rejectWhen(body, try g.less(body, maximum, minimum));
            const bounds = P.normalizationLimits();
            // Preserve the predecessor's guard order, before any environmental I/O.
            inline for (.{ "maximum_result_text_bytes", "maximum_arguments_bytes", "maximum_name_bytes", "maximum_call_id_bytes", "maximum_output_items" }) |name| {
                const actual = try g.field(body, limits, Limits, name);
                try g.rejectWhen(body, try g.less(body, try body.constant(u32, @field(bounds, name)), actual));
            }
        }
        fn request(g: G, body: *typed.Body, template: *const typed.Value, tools: *const typed.Value) !*const typed.Value {
            const fields = @typeInfo(P.Request).@"struct".field_names;
            var values: [fields.len]typed.Argument = undefined;
            inline for (fields, 0..) |name, index| values[index] = .{
                .name = std.fmt.comptimePrint("{d}", .{index}),
                .value = if (comptime std.mem.eql(u8, name, "tools")) tools else try g.field(body, template, P.Request, name),
            };
            return body.product(try g.schema(P.Request), &values);
        }
    };
}
