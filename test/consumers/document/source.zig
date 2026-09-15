//! Shared source construction helpers for the independent document modes.
const std = @import("std");
const agent = @import("agent");
const source = @import("boundary").computation;
const Id = source.Id;

pub fn field(b: *source.Builder, schema: Id, value: Id, n: u64) !Id {
    return b.primitive(schema, .field, &.{value}, n);
}
pub fn product(b: *source.Builder, schema: Id, values: []const Id) !Id {
    return b.primitive(schema, .product, values, 0);
}
pub fn perform(b: *source.Builder, effect: Id, value: Id) !Id {
    return b.term(.{ .perform = .{ .effect = effect, .payload = value } });
}
pub fn call(b: *source.Builder, function: Id, args: []const Id) !Id {
    return b.term(.{ .call = .{ .function = function, .arguments = args } });
}
pub fn fail(b: *source.Builder) !Id {
    return b.term(.{ .fail = try b.constant(void, {}) });
}
pub fn text(c: agent.Context, value: []const u8) !Id {
    return c.literal(agent.contracts.Utf8, .{ .bytes = value });
}
pub fn equal(b: *source.Builder, a: Id, z: Id) !Id {
    return b.primitive(try b.scalar(bool), .equal, &.{ a, z }, 0);
}
pub fn add(b: *source.Builder, a: Id, z: Id) !Id {
    return b.value(.{ .schema = try b.scalar(u64), .expression = .{ .primitive = .{ .opcode = .integer_add, .operands = &.{ a, z }, .failures = &.{.{ .kind = .arithmetic_overflow, .value = try b.failureLiteral(try b.constant(void, {})) }} } } });
}
pub fn index(b: *source.Builder, schema: Id, value: Id, n: u64) !Id {
    const optional = try b.schema(.{ .sum = &.{ try b.scalar(void), schema } });
    const found = try b.primitive(optional, .sequence_get, &.{ value, try b.constant(u64, n) }, 0);
    return b.value(.{ .schema = schema, .expression = .{ .primitive = .{ .opcode = .variant_payload, .operands = &.{found}, .immediate = 1, .failures = &.{.{ .kind = .invalid_variant, .value = try b.failureLiteral(try b.constant(void, {})) }} } } });
}
pub fn computation(b: *source.Builder, params: []const Id, result: Id, effects: []const Id, captures: []const Id) !Id {
    return b.schema(.{ .internal = .{ .computation = .{ .parameters = params, .result = result, .effects = effects, .capture_bound = captures } } });
}
pub fn scopedComputation(b: *source.Builder, params: []const Id, result: Id, effects: []const Id, captures: []const Id, regions: []const Id) !Id {
    return b.schema(.{ .internal = .{ .computation = .{ .parameters = params, .result = result, .effects = effects, .capture_bound = captures, .regions = regions } } });
}
pub fn row(b: *source.Builder, a: []const Id, z: []const Id) ![]const Id {
    const result = try b.allocator().alloc(Id, a.len + z.len);
    @memcpy(result[0..a.len], a);
    @memcpy(result[a.len..], z);
    std.mem.sort(Id, result, {}, std.sort.asc(Id));
    return result;
}
