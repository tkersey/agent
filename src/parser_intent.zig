//! Explicit EOF intent, using the existing consequence-sensitive resolver.
const source = @import("boundary").computation;
const Context = @import("authoring.zig").Context;
const contracts = @import("agent_contracts");
const parser = @import("parser_synthesis.zig");
const clarification = @import("clarification.zig");
const interaction = @import("interaction.zig");
const Id = source.Id;
pub const emit_contract = "agent.incremental-byte-parser-emit-eof/v1";
pub const Frozen = struct { strict: parser.Subject, emit: parser.Subject, occurrence: u64 };
pub const Question = struct { context: Frozen, prompt: contracts.Text(512) };
pub const Result = union(enum(u32)) { selected: u64 = 0, unresolved: void = 1 };
pub const Definition = struct { function: Id, effect: Id };
fn field(c: Context, comptime T: type, value: Id, index: Id) !Id {
    return c.builder.primitive(try c.schema(T), .field, &.{value}, index);
}
pub fn define(c: Context) !Definition {
    const b = c.builder;
    const cache = try b.specialization(Definition, "agent.parser.eof-intent/v1", .{});
    if (cache.cached) |d| return d;
    const unit = try b.scalar(void);
    const integer = try b.scalar(u64);
    const d = try clarification.define(b, .{ .identity = "parser.eof.alternatives", .candidate = integer, .key = integer, .domain = .{ .finite = &.{ 1, 2 } }, .failure = try b.constant(void, {}) });
    const exchange = try interaction.define(b, .{ .name = "parser.eof", .channel = try c.schema(contracts.Text(64)), .purpose = try c.schema(contracts.Text(64)), .presentation = unit, .outgoing = try c.schema(Question), .input = d.types.input, .abort_turn = unit, .close_conversation = unit });
    try c.registry.classify(exchange.effect, .interaction);
    const present = try b.declare(&.{ try c.schema(Frozen), d.types.choice }, try c.schema(Question), &.{}, &.{});
    const question = try b.primitive(try c.schema(Question), .product, &.{ try b.reference(b.parameter(present, 0)), try c.literal(contracts.Text(512), .{ .bytes = "Final unterminated-record behavior is unspecified. Choose 1: reject it as UnterminatedRecord at the end offset; or 2: emit it as a final record. Both retain DanglingEscape and InvalidEscape errors. This selects required behavior, not implementation style or approval." }) }, 0);
    try b.define(present, try b.pure(question));
    const resolver = try clarification.resolver(b, d, .{ .context = try c.schema(Frozen), .present = present, .exchange = exchange, .channel = try c.literal(contracts.Text(64), .{ .bytes = "fixture-owner" }), .purpose = try c.literal(contracts.Text(64), .{ .bytes = "parser-eof-behavior" }), .presentation = try b.constant(void, {}) });
    var rows: [2]Id = undefined;
    for (&rows, 0..) |*row, i| {
        const id = try b.constant(u64, i + 1);
        const known = try b.primitive(d.types.known, .product, &.{ id, id }, 0);
        const assessed = try b.primitive(d.types.assessed, .variant, &.{known}, 0);
        row.* = try b.primitive(d.types.evaluation, .product, &.{ id, assessed }, 0);
    }
    const evaluations = try b.primitive(d.types.evaluations, .sequence, &rows, 0);
    const f = try b.declare(&.{try c.schema(Frozen)}, try c.schema(Result), &.{exchange.effect}, &.{});
    const classification = try b.variable(d.types.classification);
    const resolution = try b.variable(d.types.resolution);
    const group = try b.variable(d.types.group);
    const candidate = try b.primitive(integer, .field, &.{try b.primitive(d.types.known, .field, &.{try b.reference(group)}, 1)}, 0);
    const selected = try b.pure(try b.primitive(try c.schema(Result), .variant, &.{candidate}, 0));
    const unresolved = try b.pure(try c.literal(Result, .{ .unresolved = {} }));
    const resolved = try b.term(.{ .match_sum = .{ .value = try b.reference(resolution), .cases = &.{
        .{ .variable = group, .body = selected },                                .{ .variable = group, .body = selected },
        .{ .variable = try b.variable(d.types.non_action), .body = unresolved }, .{ .variable = try b.variable(unit), .body = unresolved },
        .{ .variable = try b.variable(unit), .body = unresolved },
    } } });
    const frozen = try b.reference(b.parameter(f, 0));
    var run = try b.bind(classification, try b.term(.{ .call = .{ .function = d.classify, .arguments = &.{ evaluations, try b.constant(bool, false) } } }), try b.bind(resolution, try b.term(.{ .call = .{ .function = resolver, .arguments = &.{ frozen, try b.reference(classification) } } }), resolved));
    const strict = try field(c, parser.Subject, frozen, 0);
    const emit = try field(c, parser.Subject, frozen, 1);
    const pairs = [_][2]Id{
        .{ try field(c, parser.Digest, strict, 0), try field(c, parser.Digest, emit, 0) },
        .{ try field(c, contracts.Text(64), strict, 4), try c.literal(contracts.Text(64), .{ .bytes = parser.contract }) },
        .{ try field(c, contracts.Text(64), emit, 4), try c.literal(contracts.Text(64), .{ .bytes = emit_contract }) },
    };
    for (pairs) |pair| {
        const same = try b.primitive(try b.scalar(bool), .equal, &.{ try b.primitive(try b.scalar(i8), .blob_compare, &pair, 0), try b.constant(i8, 0) }, 0);
        run = try b.term(.{ .conditional = .{ .condition = same, .when_true = run, .when_false = unresolved } });
    }
    try b.define(f, run);
    return cache.finish(b, .{ .function = f, .effect = exchange.effect });
}
