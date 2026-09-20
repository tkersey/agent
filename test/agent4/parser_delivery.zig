const std = @import("std");
const agent = @import("agent");
const boundary = @import("boundary");
const delivery = agent.parser_delivery;
const Input = struct { proposal: delivery.Proposal, apply: bool };
const Application = struct {
    pub fn emit(c: agent.Context) !boundary.computation.Module {
        const b = c.builder;
        const d = try delivery.define(c);
        const entry = try b.declare(&.{try c.schema(Input)}, try c.schema(delivery.Result), d.effects, &.{});
        const input = try b.reference(b.parameter(entry, 0));
        const proposal = try b.primitive(try c.schema(delivery.Proposal), .field, &.{input}, 0);
        const apply = try b.primitive(try b.scalar(bool), .field, &.{input}, 1);
        try b.define(entry, try delivery.run(c, d, entry, proposal, apply));
        return b.module(entry, try b.scalar(void));
    }
};
const System = agent.system(.{ .InitialArgs = Input, .Result = delivery.Result, .Failure = void, .application = Application });
fn output(init: std.process.Init, bytes: []const u8) !void {
    var buffer: [4096]u8 = undefined;
    var out = std.Io.File.stdout().writer(init.io, &buffer);
    try out.interface.writeAll(bytes);
    try out.interface.flush();
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
    const schema = if (std.mem.eql(u8, mode, "input-schema")) try agent.contracts.schema(Input, &b) else if (std.mem.eql(u8, mode, "result-schema")) try agent.contracts.schema(delivery.Result, &b) else return error.InvalidMode;
    const bytes = try boundary.data.schema.encodeOwned(init.gpa, b.schemas.items, schema);
    defer init.gpa.free(bytes);
    return output(init, bytes);
}
