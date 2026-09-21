const std = @import("std");
const agent = @import("agent");
const boundary = @import("boundary");
const source = boundary.computation;
fn construct(a: std.mem.Allocator) !void {
    var b = source.Builder.init(a);
    defer b.deinit();
    var registry = agent.admission.Registry.init(a);
    defer registry.deinit();
    const c = agent.Context{ .builder = &b, .registry = &registry };
    const integer = try b.scalar(u64);
    const shape = try agent.deliberation.selectionTypes(&b, integer, integer, 8);
    const assess = try b.declare(&.{integer}, integer, &.{}, &.{});
    try b.define(assess, try b.pure(try b.reference(b.parameter(assess, 0))));
    const choose = try b.declare(&.{shape.assessments}, shape.choice, &.{}, &.{});
    try b.define(choose, try b.pure(try b.primitive(shape.choice, .variant, &.{try b.constant(u64, 0)}, 0)));
    const d = try agent.deliberation.selectSequential(c, .{ .candidate = integer, .assessment = integer, .maximum = 8, .assess = assess, .choose = choose, .failure = try b.constant(void, {}) });
    const module = b.module(d.function, try b.scalar(void));
    try agent.admission.verify(a, module, &registry);
    var compiled = try source.lower(a, module);
    defer compiled.deinit();
}
test "selection construction and checking release partial allocations" {
    try std.testing.checkAllAllocationFailures(std.testing.allocator, construct, .{});
}
test "selection rejects invalid schemas and zero capacity" {
    var b = source.Builder.init(std.testing.allocator);
    defer b.deinit();
    const integer = try b.scalar(u64);
    try std.testing.expectError(error.InvalidReference, agent.deliberation.selectionTypes(&b, b.schemas.items.len, integer, 8));
    try std.testing.expectError(error.Capacity, agent.deliberation.selectionTypes(&b, integer, integer, 0));
}
