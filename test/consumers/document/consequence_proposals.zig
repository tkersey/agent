//! Captured proposal continuation. No read, human exchange, or authority enters it.
const std = @import("std");
const agent = @import("agent");
const source = @import("boundary").computation;
const Id = source.Id;
const emit = @import("source.zig");
const t = @import("consequence_types.zig");
const P = t.P;

pub const Definition = struct { decision: agent.clarification.Definition, explore: Id, assess: Id };

pub fn define(c: agent.Context, model: Id) !Definition {
    const b = c.builder;
    const context = try c.schema(t.Context);
    const integer = try b.scalar(u64);
    const d = try agent.clarification.define(b, .{
        .identity = "document.terminology.scope-choice.v1",
        .candidate = try c.schema(t.Consequences),
        .key = try c.schema(t.Action),
        .domain = .{ .finite = &.{ 1, 2 } },
        .failure = try b.constant(void, {}),
        .scope = .{ .captures = &.{ context, integer }, .residual = .{ .effects = &.{model} } },
    });
    const branch = try scopedProposal(c, d, model);
    const f = try b.declare(&.{context}, d.types.classification, &.{model}, &.{});
    const body = try b.declare(&.{d.multi.capability}, d.types.evaluation, &.{ model, d.multi.effect }, &.{});
    const interpretation = try b.variable(integer);
    const alternatives = try b.primitive(d.multi.alternatives, .sequence, &.{
        try b.constant(u64, 1), try b.constant(u64, 2),
    }, 0);
    const chosen = try agent.deliberation.choose(b, d.multi, try b.reference(b.parameter(body, 0)), alternatives);
    const frozen = try b.reference(b.parameter(f, 0));
    try b.define(body, try b.bind(interpretation, chosen, try emit.call(b, branch, &.{ frozen, try b.reference(interpretation) })));
    const body_type = try emit.computation(b, &.{d.multi.capability}, d.types.evaluation, &.{ model, d.multi.effect }, &.{context});
    const task = try emit.field(b, try c.schema(t.Request), frozen, 0);
    const mandatory = try emit.field(b, try b.scalar(bool), task, 3);
    try b.define(f, try agent.clarification.explore(c, d, try b.lambda(body, body_type), &.{}, mandatory));
    return .{ .decision = d, .explore = f, .assess = branch };
}

fn scopedProposal(c: agent.Context, d: agent.clarification.Definition, model: Id) !Id {
    const b = c.builder;
    const context = try c.schema(t.Context);
    const integer = try b.scalar(u64);
    const environment = try c.schema(t.Environment);
    const reader = try agent.scopes.define(b, "document.terminology.model-scope.v1", environment, d.types.evaluation, .{
        .captures = &.{ context, integer },
        .residual = .{ .effects = &.{model} },
    });
    try c.registry.classify(reader.family.effect, .internal);
    const body = try b.declare(&.{ reader.family.capability, context, integer }, d.types.evaluation, &.{ model, reader.family.effect }, &.{});
    const retained = try b.variable(environment);
    const cap = try b.reference(b.parameter(body, 0));
    try b.define(body, try b.bind(retained, try agent.scopes.read(b, reader, cap), try assess(c, d, body, try b.reference(retained))));
    const body_type = try emit.computation(b, &.{ reader.family.capability, context, integer }, d.types.evaluation, &.{ model, reader.family.effect }, &.{});
    const f = try b.declare(&.{ context, integer }, d.types.evaluation, &.{model}, &.{});
    const scope = try b.reference(b.parameter(f, 1));
    const active = try emit.equal(b, scope, try b.constant(u64, 1));
    const scope_text = try b.primitive(try c.schema(P.MessageText), .select, &.{
        active,
        try c.literal(P.MessageText, .{ .bytes = "active_section" }),
        try c.literal(P.MessageText, .{ .bytes = "whole_document" }),
    }, 0);
    const value = try emit.product(b, environment, &.{
        try c.literal(P.ModelId, .{ .bytes = "fixture-model" }), scope_text,
    });
    try b.define(f, try agent.scopes.enter(b, reader, try b.lambda(body, body_type), value, &.{
        try b.reference(b.parameter(f, 0)), scope,
    }));
    return f;
}

fn assess(c: agent.Context, d: agent.clarification.Definition, body: Id, environment: Id) !Id {
    const b = c.builder;
    const frozen = try b.reference(b.parameter(body, 1));
    const scope = try b.reference(b.parameter(body, 2));
    const interpreted = try b.variable(try c.schema(P.Interpretation));
    const accepted = try b.variable(try c.schema(P.AnswerType));
    const rejected = try b.variable(try c.schema(P.InterpretationFailure));
    const proposed = try b.variable(try c.schema(t.ModelProposal));
    const candidate = try b.term(.{ .match_sum = .{
        .value = try b.reference(accepted),
        .cases = &.{.{
            .variable = proposed,
            .body = try checkProposal(c, d, frozen, scope, try b.reference(proposed)),
        }},
    } });
    const checked = try b.term(.{ .match_sum = .{
        .value = try b.reference(interpreted),
        .cases = &.{
            .{ .variable = accepted, .body = candidate },
            .{ .variable = rejected, .body = try unknown(c, d, scope, 1) },
        },
    } });
    const invoke = try agent.responders.invokeModel(P, c, d.failure, false, try request(c, frozen, environment), try c.literal([1]bool, .{true}));
    return b.bind(interpreted, invoke, checked);
}

fn request(c: agent.Context, frozen: Id, environment: Id) !Id {
    const b = c.builder;
    const task = try emit.field(b, try c.schema(t.Request), frozen, 0);
    const base = try emit.field(b, try c.schema(t.Observation), frozen, 1);
    const target = try b.value(.{ .schema = try c.schema(P.MessageText), .expression = .{
        .primitive = .{
            .opcode = .blob_concat,
            .operands = &.{ try c.literal(P.MessageText, .{ .bytes = "" }), try emit.field(b, try c.schema(t.Path), task, 0) },
            .failures = &.{.{ .kind = .capacity_exceeded, .value = try b.failureLiteral(try b.constant(void, {})) }},
        },
    } });
    const contents = [_]Id{
        try c.literal(P.MessageText, .{
            .bytes = "Replace exact non-overlapping literal occurrences; preserve section markers.",
        }),
        try emit.field(b, try c.schema(P.MessageText), environment, 1),
        try emit.field(b, try c.schema(t.Content), base, 0),
        try emit.field(b, try c.schema(t.Content), task, 1),
        try emit.field(b, try c.schema(t.Content), task, 2),
        target,
    };
    var messages: [contents.len]Id = undefined;
    for (&messages, contents, 0..) |*message, content, i| message.* = try emit.product(b, try c.schema(P.Message), &.{
        try c.literal(agent.model_invocation.MessageRole, if (i == 0) .system else .user),
        content,
    });
    const template = try P.templateValue(t.Model, .{ .items = &.{} }, .{
        .minimum_calls = 1,
        .maximum_calls = 1,
        .parallel_calls = false,
    });
    var fields: [std.meta.fields(P.Request).len]Id = undefined;
    inline for (std.meta.fields(P.Request), 0..) |field, i| fields[i] = switch (i) {
        1 => try emit.field(b, try c.schema(P.ModelId), environment, 0),
        3 => try b.primitive(try c.schema(P.Messages), .sequence, &messages, 0),
        else => try c.literal(field.type, @field(template, field.name)),
    };
    return emit.product(b, try c.schema(P.Request), &fields);
}

fn checkProposal(c: agent.Context, d: agent.clarification.Definition, frozen: Id, scope: Id, proposed: Id) !Id {
    const b = c.builder;
    const task = try emit.field(b, try c.schema(t.Request), frozen, 0);
    const base = try emit.field(b, try c.schema(t.Observation), frozen, 1);
    const edited = try b.variable(try c.schema(t.terminology.Edit));
    const known = try b.variable(try c.schema(t.terminology.Change));
    const invalid = try b.variable(try b.scalar(void));
    const replacement = try emit.field(b, try c.schema(t.Content), proposed, 1);
    const checked = try b.term(.{ .match_sum = .{
        .value = try b.reference(edited),
        .cases = &.{
            .{ .variable = known, .body = try admitAction(c, d, frozen, scope, replacement, try b.reference(known)) },
            .{ .variable = invalid, .body = try unknown(c, d, scope, 2) },
        },
    } });
    const construct = try emit.call(b, try t.terminology.define(c), &.{
        try emit.field(b, try c.schema(t.Content), base, 0),
        try emit.field(b, try c.schema(t.Content), task, 1),
        try emit.field(b, try c.schema(t.Content), task, 2),
        scope,
    });
    const status_type = @FieldType(t.ModelProposal, "status");
    const status = try emit.field(b, try c.schema(status_type), proposed, 0);
    const status_tag = try b.primitive(try b.scalar(u32), .enum_tag, &.{status}, 0);
    return b.term(.{ .conditional = .{
        .condition = try emit.equal(b, status_tag, try b.constant(u32, 0)),
        .when_true = try b.bind(edited, construct, checked),
        .when_false = try b.term(.{ .conditional = .{
            .condition = try emit.equal(b, status_tag, try b.constant(u32, 1)),
            .when_true = try unknown(c, d, scope, 1),
            .when_false = try unknown(c, d, scope, 3),
        } }),
    } });
}

fn admitAction(c: agent.Context, d: agent.clarification.Definition, frozen: Id, scope: Id, proposed: Id, expected: Id) !Id {
    const b = c.builder;
    const boolean = try b.scalar(bool);
    const text = try c.schema(t.Content);
    const task = try emit.field(b, try c.schema(t.Request), frozen, 0);
    const base = try emit.field(b, try c.schema(t.Observation), frozen, 1);
    const changed_archive = try emit.field(b, boolean, expected, 1);
    const allow_archive = try emit.field(b, boolean, task, 4);
    const replacement = try emit.field(b, text, expected, 0);
    const same = try blobEqual(b, proposed, replacement);
    const no_change = try blobEqual(b, proposed, try emit.field(b, text, base, 0));
    const operation_type = @FieldType(t.Action, "operation");
    const operation = try b.primitive(try c.schema(operation_type), .select, &.{
        no_change, try c.literal(operation_type, .no_change), try c.literal(operation_type, .replace),
    }, 0);
    const proposal = try emit.product(b, try c.schema(t.Proposal), &.{
        try emit.field(b, try c.schema(t.Path), task, 0), base,                   replacement,
        try b.constant(u64, 1),                           try b.constant(u64, 7), try c.literal(t.Reason, .{ .bytes = "Apply the checked literal terminology replacement." }),
    });
    const action = try emit.product(b, try c.schema(t.Action), &.{
        operation, proposal, task, try b.constant(u64, 1),
    });
    const consequences = try emit.product(b, try c.schema(t.Consequences), &.{changed_archive});
    const result = try b.pure(try emit.product(b, d.types.evaluation, &.{
        scope,
        try b.primitive(d.types.assessed, .variant, &.{
            try emit.product(b, d.types.known, &.{ consequences, action }),
        }, 0),
    }));
    const rejected = try unknown(c, d, scope, 2);
    const policy = try b.term(.{ .conditional = .{
        .condition = changed_archive,
        .when_true = try b.term(.{ .conditional = .{
            .condition = allow_archive,
            .when_true = result,
            .when_false = rejected,
        } }),
        .when_false = result,
    } });
    return b.term(.{ .conditional = .{
        .condition = same,
        .when_true = policy,
        .when_false = rejected,
    } });
}

pub fn blobEqual(b: *source.Builder, left: Id, right: Id) !Id {
    const order = try b.primitive(try b.scalar(i8), .blob_compare, &.{ left, right }, 0);
    return emit.equal(b, order, try b.constant(i8, 0));
}

fn unknown(c: agent.Context, d: agent.clarification.Definition, scope: Id, tag: u64) !Id {
    const b = c.builder;
    const assessed = try b.primitive(d.types.assessed, .variant, &.{try b.constant(void, {})}, tag);
    return b.pure(try emit.product(b, d.types.evaluation, &.{ scope, assessed }));
}

test "document proposal continuation is protected portable program data" {
    var b = source.Builder.init(std.testing.allocator);
    defer b.deinit();
    var registry = agent.admission.Registry.init(b.allocator());
    defer registry.deinit();
    const c = agent.Context{ .builder = &b, .registry = &registry };
    const model = try P.declare(&b);
    try registry.classify(model, .model);
    const composition = try define(c, model);
    const module = b.module(composition.explore, try b.scalar(void));
    try agent.admission.verify(std.testing.allocator, module, &registry);
    var compiled = try @import("boundary").source.construct(std.testing.allocator, module);
    defer compiled.deinit();
    try std.testing.expect(compiled.program.blocks.len > 0);
}
