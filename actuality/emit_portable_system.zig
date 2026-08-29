const portable = @import("portable_system");
const std = @import("std");

pub fn main(init: std.process.Init) !void {
    const Image = portable.System.Program.image();
    var output_buffer: [4096]u8 = undefined;
    var output = std.Io.File.stdout().writer(init.io, &output_buffer);
    try output.interface.writeAll(&Image.bytes);
    try output.interface.flush();
}
