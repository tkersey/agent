//! Test-only native consumer of the unchanged public World Process API.
//! The argument names one canonical PKI2; stdout receives one complete PKO2.
const std = @import("std");
const world = @import("world");
const protocol = @import("boundary_data_v2").protocol;

pub fn main(init: std.process.Init) !void {
    var arguments = init.minimal.args.iterate();
    _ = arguments.next();
    const input_path = arguments.next() orelse return error.ExpectedInputPath;
    const option = arguments.next();
    const statistics_requested = if (option) |value| blk: {
        if (!std.mem.eql(u8, value, "--statistics")) return error.UnexpectedArgument;
        break :blk true;
    } else false;
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
    var statistics: world.process_v2.Statistics = .{};
    const observed: world.process_v2.Invocation = .{
        .program = .{ .image = input.image },
        .instance = switch (input.instance) {
            .initial_args => |value| .{ .initial_args = value },
            .state => |value| .{ .snapshot = value },
        },
        .control = input.control,
        .statistics = &statistics,
    };
    var outcome = if (!statistics_requested) try world.process_v2.invoke(init.gpa, input) else switch (input.mode) {
        .run => try world.process_v2.run(init.gpa, observed),
        .advance => try world.process_v2.advance(init.gpa, observed),
    };
    defer outcome.deinit();
    const bytes = try init.gpa.alloc(u8, try protocol.encodedLength(protocol.Outcome, outcome.record));
    defer init.gpa.free(bytes);
    const encoded = try protocol.encode(protocol.Outcome, init.gpa, outcome.record, bytes);
    var buffer: [4096]u8 = undefined;
    var output = std.Io.File.stdout().writer(init.io, &buffer);
    try output.interface.writeAll(encoded);
    try output.interface.flush();
    if (statistics_requested) {
        var stats_buffer: [256]u8 = undefined;
        var stats = std.Io.File.stderr().writer(init.io, &stats_buffer);
        try stats.interface.print(
            "{{\"multiTemplates\":{d},\"branchActivations\":{d},\"transitions\":{d}}}\n",
            .{ statistics.multi_templates, statistics.branch_activations, statistics.transitions },
        );
        try stats.interface.flush();
    }
}
