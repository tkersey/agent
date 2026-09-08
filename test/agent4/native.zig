//! Test-only native consumer of the unchanged public World Process API.
//! The argument names one canonical PKI2; stdout receives one complete PKO2.
const std = @import("std");
const world = @import("world");
const protocol = @import("boundary_data_v2").protocol;

pub fn main(init: std.process.Init) !void {
    var arguments = init.minimal.args.iterate();
    _ = arguments.next();
    const input_path = arguments.next() orelse return error.ExpectedInputPath;
    if (arguments.next() != null) return error.UnexpectedArgument;
    // This is an input-file bound of the test host, not an Agent lifetime or
    // value limit. An oversized input rejects without publishing an outcome.
    const input_bytes = try std.Io.Dir.cwd().readFileAlloc(
        init.io,
        input_path,
        init.gpa,
        .limited(256 * 1024 * 1024),
    );
    defer init.gpa.free(input_bytes);
    const input = try protocol.decode(protocol.Input, init.gpa, input_bytes);
    var outcome = try world.process_v2.invoke(init.gpa, input);
    defer outcome.deinit();
    const bytes = try init.gpa.alloc(u8, try protocol.encodedLength(protocol.Outcome, outcome.record));
    defer init.gpa.free(bytes);
    const encoded = try protocol.encode(protocol.Outcome, init.gpa, outcome.record, bytes);
    var buffer: [4096]u8 = undefined;
    var output = std.Io.File.stdout().writer(init.io, &buffer);
    try output.interface.writeAll(encoded);
    try output.interface.flush();
}
