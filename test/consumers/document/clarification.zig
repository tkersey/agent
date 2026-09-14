//! Document-owned clarification control with a retained lexical interpretation.
const std = @import("std");
const agent = @import("agent");
const boundary = @import("boundary");
const source = boundary.computation;
const Builder = source.Builder;
const Id = source.Id;

pub const Definition = struct { function: Id, result: Id, ready: Id };

/// `(initial_input, environment) -> Ready(clarified, environment) | Aborted`.
/// The only residual effect is the supplied typed human interaction. Arithmetic
/// overflow and an impossible changed Reader interpretation use module failure.
pub fn define(c: agent.Context, d: agent.interaction.Definition, environment: Id) !Definition {
    const b = c.builder;
    try validate(b, d, environment);
    const instance = try b.specialization(Definition, "document.clarification/v1", .{
        d.effect, environment,
    });
    if (instance.cached) |cached| return cached;
    const integer = try b.scalar(u64);
    const unit = try b.scalar(void);
    const ready = try b.schema(.{ .product = &.{ integer, environment } });
    const result = try b.schema(.{ .sum = &.{ ready, unit } });
    const reader = try agent.scopes.define(b, "document.clarification.scope.v1", environment, result, .{
        .captures = &.{ integer, environment },
        .residual = .{ .effects = &.{d.effect} },
    });
    try c.registry.classify(reader.family.effect, .internal);
    const row = try (source.Row{ .effects = &.{d.effect} }).unionWith(b.allocator(), .{
        .effects = &.{reader.family.effect},
    });
    const body = try scopedBody(b, d, reader, ready, result, row.effects);
    const body_type = try b.schema(.{ .internal = .{ .computation = .{
        .parameters = &.{ reader.family.capability, integer },
        .result = result,
        .effects = row.effects,
        .use = .linear,
    } } });
    const function = try b.declare(&.{ integer, environment }, result, &.{d.effect}, &.{});
    try b.define(function, try agent.scopes.enter(
        b,
        reader,
        try b.lambda(body, body_type),
        try b.reference(b.parameter(function, 1)),
        &.{try b.reference(b.parameter(function, 0))},
    ));
    return instance.finish(b, .{ .function = function, .result = result, .ready = ready });
}

fn scopedBody(
    b: *Builder,
    d: agent.interaction.Definition,
    reader: agent.scopes.Reader,
    ready: Id,
    result: Id,
    effects: []const Id,
) !Id {
    const integer = try b.scalar(u64);
    const body = try b.declare(&.{ reader.family.capability, integer }, result, effects, &.{});
    const cap = try b.reference(b.parameter(body, 0));
    const local = try b.variable(integer);
    const before = try b.variable(reader.environment);
    const response = try b.variable(d.reply);
    const offered = try add(b, try b.reference(b.parameter(body, 1)), try b.constant(u64, 1000));
    const request = try agent.interaction.exchange(b, d, .{
        .channel = try b.literal(.{ .schema = d.contract.channel, .bytes = "\x0ddocument-user" }),
        .purpose = try b.literal(.{ .schema = d.contract.purpose, .bytes = "\x0dclarification" }),
        .presentation = try b.constant(void, {}),
        .outgoing = try b.reference(local),
    });
    const resumed = try replies(b, reader, ready, result, cap, local, before, response);
    try b.define(body, try b.bind(local, try b.pure(offered), try b.bind(
        before,
        try agent.scopes.read(b, reader, cap),
        try b.bind(response, request, resumed),
    )));
    return body;
}

fn replies(
    b: *Builder,
    reader: agent.scopes.Reader,
    ready: Id,
    result: Id,
    capability: Id,
    local: Id,
    before: Id,
    response: Id,
) !Id {
    const input = try b.variable(try b.scalar(u64));
    const abort = try b.variable(try b.scalar(void));
    const after = try b.variable(reader.environment);
    const restored = try b.primitive(ready, .product, &.{
        try add(b, try b.reference(local), try b.reference(input)), try b.reference(after),
    }, 0);
    const succeeded = try b.pure(try b.primitive(result, .variant, &.{restored}, 0));
    const checked = try sameInterpretation(b, reader.environment, before, after, succeeded);
    const value = try b.bind(after, try agent.scopes.read(b, reader, capability), checked);
    const aborted = try b.pure(try b.primitive(result, .variant, &.{try b.constant(void, {})}, 1));
    return b.term(.{ .match_sum = .{
        .value = try b.reference(response),
        .cases = &.{
            .{ .variable = input, .body = value },
            .{ .variable = abort, .body = aborted },
        },
    } });
}

fn sameInterpretation(b: *Builder, environment: Id, before: Id, after: Id, next: Id) !Id {
    const fields = b.schemas.items[@intCast(environment)].product;
    const failure = try b.term(.{ .fail = try b.constant(void, {}) });
    var checked = next;
    // Model identity and ordered instructions are authoritative Reader values.
    // Permissions/skills remain in the same immutable environment returned below.
    var index: usize = 2;
    while (index > 0) {
        index -= 1;
        const left = try b.primitive(fields[index], .field, &.{try b.reference(before)}, index);
        const right = try b.primitive(fields[index], .field, &.{try b.reference(after)}, index);
        const ordering = try b.primitive(try b.scalar(i8), .blob_compare, &.{ left, right }, 0);
        const equal = try b.primitive(try b.scalar(bool), .equal, &.{
            ordering, try b.constant(i8, 0),
        }, 0);
        checked = try b.term(.{ .conditional = .{
            .condition = equal,
            .when_true = checked,
            .when_false = failure,
        } });
    }
    return checked;
}

fn validate(b: *Builder, d: agent.interaction.Definition, environment: Id) !void {
    const integer = try b.scalar(u64);
    const unit = try b.scalar(void);
    const text = try b.schema(.text);
    const contract = d.contract;
    if (contract.channel != text or contract.purpose != text or
        contract.presentation != unit or contract.outgoing != integer or
        contract.input != integer or contract.abort_turn != unit or
        contract.close_conversation != null) return error.InvalidInteractionContract;
    if (environment >= b.schemas.items.len) return error.InvalidReference;
    const fields = switch (b.schemas.items[@intCast(environment)]) {
        .product => |fields| fields,
        else => return error.InvalidEnvironment,
    };
    if (fields.len != 4) return error.InvalidEnvironment;
    const expected = [_]Id{
        try b.schema(.{ .bounded_text = 32 }),
        try b.schema(.{ .bounded_text = 128 }),
        try b.schema(.{ .array = .{ .element = try b.scalar(bool), .length = 1 } }),
        try b.schema(.{ .array = .{ .element = try b.scalar(bool), .length = 64 } }),
    };
    if (!std.mem.eql(Id, fields, &expected)) return error.InvalidEnvironment;
}

fn add(b: *Builder, left: Id, right: Id) !Id {
    return b.value(.{ .schema = try b.scalar(u64), .expression = .{ .primitive = .{
        .opcode = .integer_add,
        .operands = &.{ left, right },
        .failures = &.{.{
            .kind = .arithmetic_overflow,
            .value = try b.failureLiteral(try b.constant(void, {})),
        }},
    } } });
}

test "clarification lowers lexical reads around a typed human exchange" {
    var b = Builder.init(std.testing.allocator);
    defer b.deinit();
    var registry = agent.admission.Registry.init(b.allocator());
    defer registry.deinit();
    const c: agent.Context = .{ .builder = &b, .registry = &registry };
    const unit = try b.scalar(void);
    const integer = try b.scalar(u64);
    const text = try b.schema(.text);
    const d = try agent.interaction.define(&b, .{
        .name = "document.clarification.test",
        .channel = text,
        .purpose = text,
        .presentation = unit,
        .outgoing = integer,
        .input = integer,
        .abort_turn = unit,
    });
    try registry.classify(d.effect, .interaction);
    const environment = try c.schema(struct {
        model: agent.contracts.Text(32),
        instructions: agent.contracts.Text(128),
        offered: [1]bool,
        skills: [64]bool,
    });
    const helper = try define(c, d, environment);
    try std.testing.expectEqual(helper.function, (try define(c, d, environment)).function);
    const module = b.module(helper.function, unit);
    try agent.admission.verify(std.testing.allocator, module, &registry);
    var compiled = try boundary.program.compile(std.testing.allocator, module);
    defer compiled.deinit();
    try std.testing.expect(compiled.program.blocks.len > 0);
    try std.testing.expectEqualSlices(Id, &.{d.effect}, b.functions.items[helper.function].effects);
    try std.testing.expectEqualSlices(Id, &.{ helper.ready, unit }, b.schemas.items[helper.result].sum);
    try std.testing.expectError(error.InvalidEnvironment, define(c, d, integer));
}
