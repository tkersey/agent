//! Test requests bind the current authored source observation, not host memory.
const agent = @import("agent");
const E = @import("source.zig").Emit;
const t = @import("types.zig");
const Id = @import("source.zig").Id;

pub fn define(c: agent.Context) !Id {
    const e: E = .{ .c = c };
    const b = c.builder;
    const f = try b.declare(&.{ try c.schema(t.Memory), try c.schema(t.TestRequest) }, try c.schema(t.TestInvocation), &.{}, &.{});
    const missing = try b.variable(try c.schema(void));
    const read = try b.variable(try c.schema(t.ReadResult));
    const applied = try b.variable(try c.schema(t.SourceVersion));
    const request = try e.param(f, 1);
    const absent = try b.pure(try e.product(t.TestInvocation, &.{ request, try c.literal(?t.SourceVersion, null) }));
    const observed = try result(e, request, try e.field(t.Path, try b.reference(read), 2), try e.field(t.DigestHex, try b.reference(read), 3));
    const fallback = try b.term(.{ .match_sum = .{ .value = try e.field(?t.ReadResult, try e.param(f, 0), 2), .cases = &.{
        .{ .variable = missing, .body = absent }, .{ .variable = read, .body = observed },
    } } });
    const applied_path = try e.field(t.Path, try b.reference(applied), 0);
    const applied_digest = try e.field(t.DigestHex, try b.reference(applied), 1);
    const replaced = try result(e, request, applied_path, applied_digest);
    const source = try e.field(?t.SourceVersion, try e.param(f, 0), 10);
    try b.define(f, try b.term(.{ .match_sum = .{ .value = source, .cases = &.{
        .{ .variable = missing, .body = fallback }, .{ .variable = applied, .body = replaced },
    } } }));
    return f;
}

fn result(e: E, request: Id, path: Id, digest: Id) !Id {
    const version = try e.product(t.SourceVersion, &.{ path, digest });
    return e.c.builder.pure(try e.product(t.TestInvocation, &.{ request, try e.some(?t.SourceVersion, version) }));
}
