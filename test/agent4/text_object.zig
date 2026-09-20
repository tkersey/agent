//! The component emitter is a different executable from the link-only consumer.
const std = @import("std");
const agent = @import("agent");
pub fn main(init: std.process.Init) !void {
    const bytes = try agent.tools.textInspection.emit(init.gpa);
    defer init.gpa.free(bytes);
    var buffer: [4096]u8 = undefined;
    var output = std.Io.File.stdout().writer(init.io, &buffer);
    try output.interface.writeAll(bytes);
    try output.interface.flush();
}
