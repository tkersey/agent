//! N0: the build host authors an ordinary Agent program, never target code.
const std = @import("std");
const agent = @import("agent");
const boundary = @import("boundary");

const Application = struct {
    pub fn emit(c: agent.Context) !boundary.source.Module {
        const b = c.builder;
        const integer = try c.schema(u64);
        const unit = try c.schema(void);
        const leaf = try c.external("agent.native.audit.increment.v1", integer, integer, .read);
        const child = try b.declare(&.{integer}, integer, &.{leaf}, &.{});
        try b.define(child, try b.term(.{ .perform = .{ .effect = leaf, .payload = try b.reference(b.parameter(child, 0)) } }));
        const entry = try b.declare(&.{integer}, integer, &.{leaf}, &.{});
        const reply = try b.variable(integer);
        const retained = try b.reference(b.parameter(entry, 0));
        // The child's result and the caller's input survive both call and yield.
        const result = try b.value(.{ .schema = integer, .expression = .{ .primitive = .{
            .opcode = .integer_add,
            .operands = &.{ retained, try b.reference(reply) },
            .failures = &.{.{ .kind = .arithmetic_overflow, .value = try b.failureLiteral(try b.constant(void, {})) }},
        } } });
        try b.define(entry, try b.bind(reply, try b.term(.{ .call = .{ .function = child, .arguments = &.{retained} } }), try b.term(.{ .yield_then = try b.pure(result) })));
        return b.module(entry, unit);
    }
};
const System = agent.system(.{ .InitialArgs = u64, .Result = u64, .Failure = void, .application = Application });

pub fn main(init: std.process.Init) !void {
    var compiled = try agent.compile(init.gpa, System);
    defer compiled.deinit();
    const bytes = try init.gpa.alloc(u8, try boundary.data.program_image.encodedLength(compiled.program));
    defer init.gpa.free(bytes);
    _ = try compiled.encode(init.gpa, bytes);
    var buffer: [4096]u8 = undefined;
    var out = std.Io.File.stdout().writer(init.io, &buffer);
    try out.interface.writeAll(bytes);
    try out.interface.flush();
}
