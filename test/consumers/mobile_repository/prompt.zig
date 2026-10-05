//! Bounded, labeled working-set rendering authored into the Program.
const std = @import("std");
const agent = @import("agent");
const boundary = @import("boundary");
const E = @import("raw.zig").Emit;
const t = @import("types.zig");
const Id = boundary.source.Id;
pub const Text = agent.contracts.Text(128 * 1024);
const Case = std.meta.Child(@FieldType(@FieldType(boundary.source.ast.Term, "match_sum"), "cases"));

pub fn render(comptime T: type, e: E) anyerror!Id {
    const b = e.c.builder;
    const cached = try b.specialization(Id, "mobile.repository.prompt", .{@typeName(T)});
    if (cached.cached) |f| return f;
    const f = try b.declare(&.{try e.c.schema(T)}, try e.c.schema(Text), &.{}, &.{});
    const value = try e.param(f, 0);
    const body = if (comptime @typeInfo(T) == .@"struct" and @hasDecl(T, "agent_value_kind")) blk: {
        if (T.agent_value_kind == .text)
            break :blk try b.pure(try e.concat(Text, try literal(e, ""), value));
        break :blk try vector(T, e, value);
    } else switch (@typeInfo(T)) {
        .bool => try b.pure(try e.select(Text, value, try literal(e, "true"), try literal(e, "false"))),
        .int => try b.pure(try e.concat(Text, try literal(e, ""), try b.primitive(try b.schema(.text), .text_integer, &.{value}, 0))),
        .@"enum" => |info| blk: {
            const tag = try b.primitive(try e.c.schema(u32), .enum_tag, &.{value}, 0);
            var text = try literal(e, "invalid");
            inline for (info.field_names, info.field_values) |field_name, field_value|
                text = try e.select(Text, try e.binary(.equal, tag, try e.c.literal(u32, field_value)), try literal(e, field_name), text);
            break :blk try b.pure(text);
        },
        .@"struct" => |info| blk: {
            var body = try b.pure(try literal(e, "}"));
            comptime var i: usize = info.field_names.len;
            inline while (i > 0) {
                i -= 1;
                const field_name = info.field_names[i];
                const FieldType = info.field_types[i];
                const rendered = try b.variable(try e.c.schema(Text));
                const rest = try b.variable(try e.c.schema(Text));
                const joined = try e.concat(Text, try literal(e, field_name ++ ": "), try b.reference(rendered));
                const line = try e.concat(Text, joined, try literal(e, "\n"));
                body = try b.bind(rendered, try e.call(try render(FieldType, e), &.{try e.field(FieldType, value, i)}), try b.bind(rest, body, try b.pure(try e.concat(Text, line, try b.reference(rest)))));
            }
            const fields = try b.variable(try e.c.schema(Text));
            break :blk try b.bind(fields, body, try b.pure(try e.concat(Text, try literal(e, "{\n"), try b.reference(fields))));
        },
        .array => |info| blk: {
            if (info.child != u8) @compileError("only digest byte arrays supported");
            const byte_fn = try b.declare(&.{try e.c.schema(u8)}, try e.c.schema(Text), &.{}, &.{});
            const byte = try e.param(byte_fn, 0);
            var hex = try literal(e, "00");
            inline for (1..256) |n| {
                const text = comptime &[_]u8{ "0123456789abcdef"[n / 16], "0123456789abcdef"[n % 16] };
                hex = try e.select(Text, try e.binary(.equal, byte, try e.c.literal(u8, n)), try literal(e, text), hex);
            }
            try b.define(byte_fn, try b.pure(hex));
            var body = try b.pure(try literal(e, ""));
            inline for (0..info.len) |i| {
                const prefix = try b.variable(try e.c.schema(Text));
                const suffix = try b.variable(try e.c.schema(Text));
                body = try b.bind(prefix, body, try b.bind(suffix, try e.call(byte_fn, &.{try b.value(.{ .schema = try e.c.schema(u8), .expression = .{ .primitive = .{ .opcode = .variant_payload, .operands = &.{try b.primitive(try e.c.schema(?u8), .sequence_get, &.{ value, try e.c.literal(u64, i) }, 0)}, .immediate = 1, .failures = &.{.{ .kind = .invalid_variant, .value = try b.failureLiteral(try e.c.literal(t.Failure, .invalid_model)) }} } } })}), try b.pure(try e.concat(Text, try b.reference(prefix), try b.reference(suffix)))));
            }
            const rendered = try b.variable(try e.c.schema(Text));
            break :blk try b.bind(rendered, body, try b.pure(try b.reference(rendered)));
        },
        .optional => |info| blk: {
            const no = try b.variable(try e.c.schema(void));
            const yes = try b.variable(try e.c.schema(info.child));
            break :blk try b.term(.{ .match_sum = .{ .value = value, .cases = &.{
                .{ .variable = no, .body = try b.pure(try literal(e, "not observed")) },
                .{ .variable = yes, .body = try e.call(try render(info.child, e), &.{try b.reference(yes)}) },
            } } });
        },
        .@"union" => |info| blk: {
            var cases: [info.field_names.len]Case = undefined;
            inline for (info.field_names, info.field_types, 0..) |field_name, FieldType, i| {
                const v = try b.variable(try e.c.schema(FieldType));
                const text = try b.variable(try e.c.schema(Text));
                cases[i] = .{ .variable = v, .body = try b.bind(text, try e.call(try render(FieldType, e), &.{try b.reference(v)}), try b.pure(try e.concat(Text, try literal(e, field_name ++ ": "), try b.reference(text)))) };
            }
            break :blk try b.term(.{ .match_sum = .{ .value = value, .cases = &cases } });
        },
        else => @compileError("unsupported repository prompt value"),
    };
    try b.define(f, body);
    return cached.finish(b, f);
}

fn vector(comptime T: type, e: E, value: Id) !Id {
    const b = e.c.builder;
    const f = try b.declare(&.{ try e.c.schema(T), try e.c.schema(Text) }, try e.c.schema(Text), &.{}, &.{});
    const Pair = struct { head: T.Child, rest: T };
    const pop = try b.primitive(try e.c.schema(?Pair), .sequence_pop, &.{try e.param(f, 0)}, 0);
    const no = try b.variable(try e.c.schema(void));
    const yes = try b.variable(try e.c.schema(Pair));
    const text = try b.variable(try e.c.schema(Text));
    const appended = try e.concat(Text, try e.param(f, 1), try b.reference(text));
    const next = try e.concat(Text, appended, try literal(e, "\n"));
    const more = try b.bind(text, try e.call(try render(T.Child, e), &.{try e.field(T.Child, try b.reference(yes), 0)}), try e.call(f, &.{ try e.field(T, try b.reference(yes), 1), next }));
    try b.define(f, try b.term(.{ .match_sum = .{ .value = pop, .cases = &.{
        .{ .variable = no, .body = try b.pure(try e.concat(Text, try e.param(f, 1), try literal(e, "]"))) },
        .{ .variable = yes, .body = more },
    } } }));
    return e.call(f, &.{ value, try literal(e, "[\n") });
}

fn literal(e: E, value: []const u8) !Id {
    return e.c.literal(Text, .{ .bytes = value });
}
