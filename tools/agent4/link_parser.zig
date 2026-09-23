//! Checked Agent entry-point linking; no participant emitter is imported as an entry point.
const std = @import("std");
const boundary = @import("boundary");
const application = @import("parser_application");
pub fn main(init: std.process.Init) !void {
    var args = init.minimal.args.iterate();
    _ = args.next();
    var inputs: [3][]u8 = undefined;
    var read: usize = 0;
    defer for (inputs[0..read]) |bytes| init.gpa.free(bytes);
    for (&inputs) |*bytes| {
        const path = args.next() orelse return error.ExpectedComponent;
        bytes.* = try std.Io.Dir.cwd().readFileAlloc(init.io, path, init.gpa, .limited(64 << 20));
        read += 1;
    }
    if (args.next() != null) return error.UnexpectedArgument;
    var compiled = try application.linkParticipants(init.gpa, inputs[0], inputs[1], inputs[2]);
    defer compiled.deinit();
    const bytes = try init.gpa.alloc(u8, try boundary.data.program_image.encodedLength(compiled.program));
    defer init.gpa.free(bytes);
    _ = try compiled.encode(init.gpa, bytes);
    var buffer: [4096]u8 = undefined;
    var output = std.Io.File.stdout().writer(init.io, &buffer);
    try output.interface.writeAll(bytes);
    try output.interface.flush();
}
