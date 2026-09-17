//! Small typed source helpers shared by this consumer's authored functions.
const std = @import("std");
const agent = @import("agent");
const boundary = @import("boundary");
pub const Id = boundary.computation.Id;
pub const E = struct {
    c: agent.Context,
    pub fn b(e: E) *@TypeOf(e.c.builder.*) {
        return e.c.builder;
    }
    pub fn schema(e: E, comptime T: type) !Id {
        return e.c.schema(T);
    }
    pub fn value(e: E, comptime T: type, v: T) !Id {
        return e.c.literal(T, v);
    }
    pub fn ref(e: E, v: Id) !Id {
        return e.b().reference(v);
    }
    pub fn p(e: E, f: Id, i: usize) !Id {
        return e.ref(e.b().parameter(f, i));
    }
    pub fn field(e: E, comptime T: type, v: Id, i: u64) !Id {
        return e.b().primitive(try e.schema(T), .field, &.{v}, i);
    }
    pub fn product(e: E, comptime T: type, v: []const Id) !Id {
        return e.b().primitive(try e.schema(T), .product, v, 0);
    }
    pub fn variant(e: E, comptime T: type, v: Id, tag: u64) !Id {
        return e.b().primitive(try e.schema(T), .variant, &.{v}, tag);
    }
    pub fn call(e: E, f: Id, args: []const Id) !Id {
        return e.b().term(.{ .call = .{ .function = f, .arguments = args } });
    }
    pub fn eq(e: E, a: Id, z: Id) !Id {
        return e.b().primitive(try e.schema(bool), .equal, &.{ a, z }, 0);
    }
    pub fn less(e: E, a: Id, z: Id) !Id {
        return e.b().primitive(try e.schema(bool), .less, &.{ a, z }, 0);
    }
    pub fn cond(e: E, condition: Id, yes: Id, no: Id) !Id {
        return e.b().term(.{ .conditional = .{ .condition = condition, .when_true = yes, .when_false = no } });
    }
    pub fn arithmetic(e: E, op: boundary.data.program.Opcode, a: Id, z: Id) !Id {
        return e.b().value(.{ .schema = try e.schema(u64), .expression = .{ .primitive = .{
            .opcode = op,
            .operands = &.{ a, z },
            .failures = &.{.{ .kind = .arithmetic_overflow, .value = try e.fault() }},
        } } });
    }
    pub fn fault(e: E) !Id {
        return e.b().failureLiteral(try e.value(void, {}));
    }
    pub fn lambda(e: E, f: Id, params: []const Id, result: Id, effects: []const Id, captures: []const Id) !Id {
        return e.b().lambda(f, try e.b().schema(.{ .internal = .{ .computation = .{
            .parameters = params,
            .result = result,
            .effects = effects,
            .capture_bound = captures,
        } } }));
    }
    pub fn row(e: E, a: []const Id, z: []const Id) ![]const Id {
        const result = try e.b().allocator().alloc(Id, a.len + z.len);
        @memcpy(result[0..a.len], a);
        @memcpy(result[a.len..], z);
        std.mem.sort(Id, result, {}, std.sort.asc(Id));
        return result;
    }
    pub fn index(e: E, comptime T: type, values: Id, at: Id) !Id {
        return e.b().primitive(try e.schema(?T), .sequence_get, &.{ values, at }, 0);
    }
    pub fn concat(e: E, comptime T: type, a: Id, z: Id) !Id {
        return e.b().value(.{ .schema = try e.schema(T), .expression = .{ .primitive = .{
            .opcode = .blob_concat,
            .operands = &.{ a, z },
            .failures = &.{.{ .kind = .capacity_exceeded, .value = try e.fault() }},
        } } });
    }
    pub fn textNumber(e: E, comptime T: type, number: Id) !Id {
        const text = try e.b().primitive(try e.b().schema(.text), .text_integer, &.{number}, 0);
        return e.concat(T, try e.value(T, .{ .bytes = "" }), text);
    }
};
