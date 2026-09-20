//! Source-independent repository application image and its portable schemas.
const std = @import("std");
const agent = @import("agent");
const boundary = @import("boundary");
const app = @import("application.zig");

pub fn main(init: std.process.Init) !void {
    var args = init.minimal.args.iterate();
    _ = args.next();
    const mode = args.next() orelse "image";
    if (args.next() != null) return error.InvalidArgument;
    if (std.mem.eql(u8, mode, "task-schema")) return schema(init, app.Task);
    if (std.mem.eql(u8, mode, "result-schema")) return schema(init, app.t.FinalResult);
    if (std.mem.eql(u8, mode, "failure-schema")) return schema(init, app.t.Failure);
    if (!std.mem.eql(u8, mode, "image")) return error.InvalidArgument;
    var compiled = try agent.compile(init.gpa, app.System);
    defer compiled.deinit();
    const bytes = try init.gpa.alloc(u8, try boundary.data.program_image.encodedLength(compiled.program));
    defer init.gpa.free(bytes);
    return write(init, try compiled.encode(init.gpa, bytes));
}

fn schema(init: std.process.Init, comptime T: type) !void {
    var builder = boundary.computation.Builder.init(init.gpa);
    defer builder.deinit();
    const root = try agent.contracts.schema(T, &builder);
    const bytes = try boundary.data.schema.encodeOwned(init.gpa, builder.schemas.items, root);
    defer init.gpa.free(bytes);
    return write(init, bytes);
}

fn write(init: std.process.Init, bytes: []const u8) !void {
    var buffer: [4096]u8 = undefined;
    var output = std.Io.File.stdout().writer(init.io, &buffer);
    try output.interface.writeAll(bytes);
    try output.interface.flush();
}
