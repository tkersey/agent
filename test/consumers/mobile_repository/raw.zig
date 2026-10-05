//! Staged construction helpers shared by the repository application.
const std = @import("std");
const agent = @import("agent");
const boundary = @import("boundary");
const t = @import("types.zig");
pub const Id = boundary.source.Id;

pub const Emit = struct {
    c: agent.Context,
    pub fn call(e: Emit, f: Id, args: []const Id) !Id {
        return e.c.builder.term(.{ .call = .{ .function = f, .arguments = args } });
    }
    pub fn concat(e: Emit, comptime T: type, a: Id, b: Id) !Id {
        return e.c.builder.value(.{ .schema = try e.c.schema(T), .expression = .{ .primitive = .{
            .opcode = .blob_concat,
            .operands = &.{ a, b },
            .failures = &.{.{ .kind = .capacity_exceeded, .value = try e.c.builder.failureLiteral(try e.c.literal(t.Failure, .capacity_exceeded)) }},
        } } });
    }
    pub fn param(e: Emit, f: Id, i: usize) !Id {
        return e.c.builder.reference(e.c.builder.parameter(f, i));
    }
    pub fn field(e: Emit, comptime T: type, value: Id, i: u64) !Id {
        return e.c.builder.primitive(try e.c.schema(T), .field, &.{value}, i);
    }
    pub fn product(e: Emit, comptime T: type, fields: []const Id) !Id {
        return e.c.builder.primitive(try e.c.schema(T), .product, fields, 0);
    }
    pub fn some(e: Emit, comptime T: type, value: Id) !Id {
        return e.c.builder.primitive(try e.c.schema(T), .variant, &.{value}, 1);
    }
    pub fn binary(e: Emit, op: boundary.data.program.Opcode, a: Id, b: Id) !Id {
        return e.c.builder.primitive(try e.c.schema(bool), op, &.{ a, b }, 0);
    }
    pub fn both(e: Emit, a: Id, b: Id) !Id {
        return e.select(bool, a, b, try e.c.literal(bool, false));
    }
    pub fn either(e: Emit, a: Id, b: Id) !Id {
        return e.select(bool, a, try e.c.literal(bool, true), b);
    }
    pub fn not(e: Emit, value: Id) !Id {
        return e.c.builder.primitive(try e.c.schema(bool), .boolean_not, &.{value}, 0);
    }
    pub fn select(e: Emit, comptime T: type, condition: Id, yes: Id, no: Id) !Id {
        return e.c.builder.primitive(try e.c.schema(T), .select, &.{ condition, yes, no }, 0);
    }
};
