const std = @import("std");
const boundary = @import("boundary");
const agent = @import("agent");

fn body(b: *boundary.computation.Builder, effect: u64) !boundary.computation.Module {
    const integer = try b.scalar(u32);
    const unit = try b.scalar(void);
    const entry = try b.declare(&.{integer}, integer, &.{effect}, &.{});
    const argument = try b.reference(b.parameter(entry, 0));
    try b.define(entry, try b.term(.{ .perform = .{ .effect = effect, .payload = argument } }));
    return b.module(entry, unit);
}

const Direct = struct {
    pub fn emit(b: *boundary.computation.Builder) !boundary.computation.Module {
        const integer = try b.scalar(u32);
        const effect = try b.effect(.{
            .identity = "example.facade.read.v1",
            .payload = integer,
            .result = integer,
        });
        return body(b, effect);
    }
};

const Application = struct {
    pub fn emit(c: agent.Context) !boundary.computation.Module {
        const integer = try c.schema(u32);
        return body(c.builder, try c.external("example.facade.read.v1", integer, integer, .read));
    }
};

test "minimal Agent facade is the same canonical image as direct Boundary authoring" {
    const System = agent.system(.{
        .InitialArgs = u32,
        .Result = u32,
        .Failure = void,
        .application = Application,
    });
    var builder = boundary.computation.Builder.init(std.testing.allocator);
    defer builder.deinit();
    var direct = try boundary.program.compile(std.testing.allocator, try Direct.emit(&builder));
    defer direct.deinit();
    var facade = try agent.compile(std.testing.allocator, System);
    defer facade.deinit();
    const allocator = std.testing.allocator;
    const a = try allocator.alloc(u8, try boundary.data.program_image.encodedLength(direct.program));
    defer allocator.free(a);
    const b = try allocator.alloc(u8, try boundary.data.program_image.encodedLength(facade.program));
    defer allocator.free(b);
    try std.testing.expectEqualSlices(u8, try direct.encode(allocator, a), try facade.encode(allocator, b));
}
