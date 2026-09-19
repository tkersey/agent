//! Bounded, labeled working-set rendering authored into the Program.
const std = @import("std");
const agent = @import("agent");
const boundary = @import("boundary");
const E = @import("source.zig").Emit;
const t = @import("types.zig");
const Id = boundary.computation.Id;
pub const Text = agent.contracts.Text(128 * 1024);
const Case = std.meta.Child(@FieldType(@FieldType(boundary.computation.ast.Term, "match_sum"), "cases"));

pub fn render(comptime T: type, e: E) anyerror!Id {
    const b = e.c.builder;
    const cached = try b.specialization(Id, "repository.prompt", .{@typeName(T)});
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
            inline for (info.fields) |field|
                text = try e.select(Text, try e.binary(.equal, tag, try e.c.literal(u32, field.value)), try literal(e, field.name), text);
            break :blk try b.pure(text);
        },
        .@"struct" => |info| blk: {
            var body = try b.pure(try literal(e, "}"));
            comptime var i: usize = info.fields.len;
            inline while (i > 0) {
                i -= 1;
                const field = info.fields[i];
                const rendered = try b.variable(try e.c.schema(Text));
                const rest = try b.variable(try e.c.schema(Text));
                const joined = try e.concat(Text, try literal(e, field.name ++ ": "), try b.reference(rendered));
                const line = try e.concat(Text, joined, try literal(e, "\n"));
                body = try b.bind(rendered, try e.call(try render(field.type, e), &.{try e.field(field.type, value, i)}), try b.bind(rest, body, try b.pure(try e.concat(Text, line, try b.reference(rest)))));
            }
            const fields = try b.variable(try e.c.schema(Text));
            break :blk try b.bind(fields, body, try b.pure(try e.concat(Text, try literal(e, "{\n"), try b.reference(fields))));
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
            var cases: [info.fields.len]Case = undefined;
            inline for (info.fields, 0..) |field, i| {
                const v = try b.variable(try e.c.schema(field.type));
                const text = try b.variable(try e.c.schema(Text));
                cases[i] = .{ .variable = v, .body = try b.bind(text, try e.call(try render(field.type, e), &.{try b.reference(v)}), try b.pure(try e.concat(Text, try literal(e, field.name ++ ": "), try b.reference(text)))) };
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
