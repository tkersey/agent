const boundary = @import("boundary");
const closed = @import("closed_turn");
const std = @import("std");

pub fn main(init: std.process.Init) !void {
    const args = try init.minimal.args.toSlice(init.arena.allocator());
    if (args.len != 2) return error.InvalidArguments;
    var buffer: [4096]u8 = undefined;
    var output = std.Io.File.stdout().writer(init.io, &buffer);
    if (std.mem.eql(u8, args[1], "bpi1")) {
        try output.interface.writeAll(&closed.OpenAIProgram.image().bytes);
    } else if (std.mem.eql(u8, args[1], "initial")) {
        try writeValue(
            closed.Prompt,
            closed.Prompt.fromSlice("repair the fixture") catch unreachable,
            &output.interface,
        );
    } else if (std.mem.eql(u8, args[1], "model-set")) {
        try writeValue(
            closed.Protocol.Response,
            closed.Protocol.Response{ .response = .{
                .http_status = 200,
                .body = closed.set_response,
            } },
            &output.interface,
        );
    } else if (std.mem.eql(u8, args[1], "model-finish")) {
        try writeValue(
            closed.Protocol.Response,
            closed.Protocol.Response{ .response = .{
                .http_status = 200,
                .body = closed.finish_response,
            } },
            &output.interface,
        );
    } else if (std.mem.eql(u8, args[1], "tool-result")) {
        try writeValue(u8, 9, &output.interface);
    } else if (std.mem.eql(u8, args[1], "expected-set")) {
        try writeValue(
            closed.FinishPayload,
            .{ .message = boundary.Text(32).fromSlice("set") catch unreachable },
            &output.interface,
        );
    } else if (std.mem.eql(u8, args[1], "expected-finish")) {
        try writeValue(
            closed.FinishPayload,
            .{ .message = boundary.Text(32).fromSlice("ok") catch unreachable },
            &output.interface,
        );
    } else return error.InvalidArguments;
    try output.interface.flush();
}

fn writeValue(comptime T: type, value: T, output: *std.Io.Writer) !void {
    var bytes: [boundary.schema.maximumEncodedSize(T)]u8 = undefined;
    const length = try boundary.schema.encode(T, value, &bytes);
    try output.writeAll(bytes[0..length]);
}
