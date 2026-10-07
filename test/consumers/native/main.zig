//! Public World consumer plus a qualification mode for the native HTTPS adapter.
//! This is an API witness, not the qualified reference product.
const std = @import("std");
const world = @import("world");
const data = @import("boundary_data");
const protocol = data.invocation;
const image = @embedFile("image");
const native = @import("agent_native");

fn require(value: bool) !void {
    if (!value) return error.NativeConsumerMismatch;
}

pub fn main(init: std.process.Init) !void {
    var args = init.minimal.args.iterate();
    _ = args.next();
    if (args.next()) |mode| {
        if (!std.mem.eql(u8, mode, "https")) return error.InvalidArguments;
        const endpoint = args.next() orelse return error.InvalidArguments;
        const root_path = args.next() orelse return error.InvalidArguments;
        const timeout_ms = try std.fmt.parseInt(u32, args.next() orelse return error.InvalidArguments, 10);
        const body = args.next() orelse return error.InvalidArguments;
        if (args.next() != null) return error.InvalidArguments;
        const root = try std.Io.Dir.cwd().readFileAlloc(init.io, root_path, init.gpa, .limited(64 * 1024));
        defer init.gpa.free(root);
        const result = native.https.post(init.gpa, init.io, .{ .endpoint = endpoint, .token = "qualification-only", .trust_root = root, .response_limit = 1024, .timeout_ms = timeout_ms }, body);
        var buffer: [4096]u8 = undefined;
        var out = std.Io.File.stdout().writer(init.io, &buffer);
        switch (result) {
            .captured => |capture| {
                defer capture.deinit(init.gpa);
                try out.interface.print("captured {d} {s}\n", .{ capture.status, capture.request_id orelse "absent" });
                try out.interface.writeAll(capture.body);
            },
            .definitely_not_sent => |err| try out.interface.print("not-sent {s}\n", .{@errorName(err)}),
            .unknown => |err| try out.interface.print("unknown {s}\n", .{@errorName(err)}),
        }
        try out.interface.flush();
        return;
    }
    // Explicit finite allocation domain includes prepared, execution and outputs.
    const storage = try init.gpa.alloc(u8, 4 * 1024 * 1024);
    defer init.gpa.free(storage);
    var arena = std.heap.FixedBufferAllocator.init(storage);
    const a = arena.allocator();
    var prepared = try world.Prepared.init(a, image);
    defer prepared.deinit();
    var resident = try world.Resident.start(a, &prepared, &.{ 20, 0, 0, 0, 0, 0, 0, 0 });
    var first = try resident.drive(a, .none, .{ .quantum = 64 });
    defer first.deinit();
    try require(first.record == .requested);
    var request = try protocol.decode(protocol.Request, a, first.record.requested.request);
    defer request.deinit();
    try require(std.mem.eql(u8, request.value.binding.semantic_identity, "agent.native.audit.increment.v1"));
    try require(std.mem.eql(u8, request.value.binding.payload, &.{ 20, 0, 0, 0, 0, 0, 0, 0 }));
    try require(std.mem.eql(u8, request.value.binding.payload_schema, request.value.binding.resume_schema));
    var value: [8]u8 = undefined;
    std.mem.writeInt(u64, &value, try std.math.add(u64, std.mem.readInt(u64, request.value.binding.payload[0..8], .little), 1), .little);
    const reply = try protocol.encodeOwned(protocol.Result, a, .{ .request_identity = request.value.request_identity, .value = &value });
    defer a.free(reply);
    const before = try resident.checkpoint(a);
    defer a.free(before);
    var empty: [0]u8 = .{};
    if (resident.driveInto(.{ .reply = reply }, .{ .quantum = 64 }, &empty)) |_| return error.ExpectedCapacity else |err| {
        if (err != error.Capacity) return err;
    }
    const after = try resident.checkpoint(a);
    defer a.free(after);
    try require(std.mem.eql(u8, before, after));
    var yielded = try resident.drive(a, .{ .reply = reply }, .{ .quantum = 64 });
    defer yielded.deinit();
    try require(yielded.record == .yielded);
    // N0 establishes canonical restore, not durable export or custody transfer.
    const checkpoint = try resident.takeCheckpoint(a);
    defer a.free(checkpoint);
    var restored = try world.Resident.restore(a, &prepared, checkpoint);
    var done = try restored.drive(a, .resume_yield, .{ .quantum = 64 });
    defer done.deinit();
    try require(done.record == .completed);
    try require(std.mem.eql(u8, done.record.completed, &.{ 41, 0, 0, 0, 0, 0, 0, 0 }));
    try restored.close();
    if (restored.checkpoint(a)) |_| return error.ExpectedClosed else |err| {
        if (err != error.InvalidState) return err;
    }
    var buffer: [256]u8 = undefined;
    var out = std.Io.File.stdout().writer(init.io, &buffer);
    try out.interface.writeAll("{\"result\":41,\"effects\":1,\"yields\":1,\"restored\":true,\"publication_rollback\":true}\n");
    try out.interface.flush();
}
