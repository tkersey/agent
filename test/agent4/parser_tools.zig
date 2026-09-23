//! Normal Agent compilation and portable schemas for parser tool integration.
const std = @import("std");
const agent = @import("agent");
const boundary = @import("boundary");
const parser = agent.parser_synthesis;
const Application = struct {
    pub fn emit(c: agent.Context) !boundary.computation.Module {
        const tools = try parser.declareTools(c);
        const b = c.builder;
        const entry = try b.declare(&.{try c.schema(parser.ExecutionRequest)}, try c.schema(parser.ExecutionReply), &.{tools.execution}, &.{});
        try b.define(entry, try parser.execute(c, tools, try b.reference(b.parameter(entry, 0)), try b.constant(void, {})));
        return b.module(entry, try b.scalar(void));
    }
};
const System = agent.system(.{ .InitialArgs = parser.ExecutionRequest, .Result = parser.ExecutionReply, .Failure = void, .application = Application });
test "parser execution enters the normal simulation-role Agent path" {
    var compiled = try agent.compile(std.testing.allocator, System);
    defer compiled.deinit();
    try std.testing.expectEqualStrings(parser.execution_identity, compiled.program.effects[0].identity);
}
pub fn main(init: std.process.Init) !void {
    var args = init.minimal.args.iterate();
    _ = args.next();
    const mode = args.next() orelse return error.ExpectedMode;
    if (args.next() != null) return error.UnexpectedArgument;
    if (std.mem.eql(u8, mode, "program")) {
        var compiled = try agent.compile(init.gpa, System);
        defer compiled.deinit();
        const bytes = try init.gpa.alloc(u8, try boundary.data.program_image.encodedLength(compiled.program));
        defer init.gpa.free(bytes);
        _ = try compiled.encode(init.gpa, bytes);
        return output(init, bytes);
    }
    var b = boundary.computation.Builder.init(init.gpa);
    defer b.deinit();
    const schema = if (std.mem.eql(u8, mode, "reference-request")) try agent.contracts.schema(parser.ReferenceRequest, &b) else if (std.mem.eql(u8, mode, "reference-reply")) try agent.contracts.schema(parser.ReferenceReply, &b) else if (std.mem.eql(u8, mode, "execution-request")) try agent.contracts.schema(parser.ExecutionRequest, &b) else if (std.mem.eql(u8, mode, "execution-reply")) try agent.contracts.schema(parser.ExecutionReply, &b) else return error.InvalidMode;
    const bytes = try boundary.data.schema.encodeOwned(init.gpa, b.schemas.items, schema);
    defer init.gpa.free(bytes);
    return output(init, bytes);
}
fn output(init: std.process.Init, bytes: []const u8) !void {
    var buffer: [4096]u8 = undefined;
    var out = std.Io.File.stdout().writer(init.io, &buffer);
    try out.interface.writeAll(bytes);
    try out.interface.flush();
}
