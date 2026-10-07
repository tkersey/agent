//! Public World consumer plus a qualification mode for the native HTTPS adapter.
//! This is an API witness, not the qualified reference product.
const std = @import("std");
const world = @import("world");
const data = @import("boundary_data");
const protocol = data.invocation;
const image = @embedFile("image");
const native = @import("agent_native");
const contracts = @import("agent_contracts");
const t = @import("application_types");

fn require(value: bool) !void {
    if (!value) return error.NativeConsumerMismatch;
}

pub fn main(init: std.process.Init) !void {
    var args = init.minimal.args.iterate();
    _ = args.next();
    if (args.next()) |mode| {
        if (std.mem.eql(u8, mode, "invoke")) {
            const path = args.next() orelse return error.InvalidArguments;
            if (args.next() != null) return error.InvalidArguments;
            // The parity peer supplies the existing PKI3 envelope, including
            // recorded replies. No application policy or capability runs here.
            var budget: world.AllocationBudget = .{ .parent = init.gpa, .limit = 32 * 1024 * 1024 };
            const allocator = budget.allocator();
            const bytes = try std.Io.Dir.cwd().readFileAlloc(init.io, path, allocator, .limited(4 * 1024 * 1024));
            defer allocator.free(bytes);
            var invocation = try protocol.decode(protocol.Input, allocator, bytes);
            defer invocation.deinit();
            var program = try world.Prepared.init(allocator, invocation.value.image);
            defer program.deinit();
            var handle = switch (invocation.value.instance) {
                .initial_args => |value| try world.Resident.start(allocator, &program, value),
                .state => |value| try world.Resident.restore(allocator, &program, value),
            };
            var outcome = try handle.drive(allocator, invocation.value.control, .{ .quantum = invocation.value.quantum, .checkpoint = true });
            defer outcome.deinit();
            switch (outcome.record) {
                .completed, .failed, .cancelled => try handle.close(),
                else => allocator.free(try handle.takeCheckpoint(allocator)),
            }
            const encoded_outcome = try protocol.encodeOwned(protocol.Outcome, allocator, outcome.record);
            defer allocator.free(encoded_outcome);
            try std.Io.File.stdout().writeStreamingAll(init.io, encoded_outcome);
            return;
        }
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
    const input = try contracts.encodeOwned(t.Input, a, .{ .value = 20 });
    var resident = try world.Resident.start(a, &prepared, input);
    var first = try resident.drive(a, .none, .{ .quantum = 64 });
    defer first.deinit();
    try require(first.record == .requested);
    var request = try protocol.decode(protocol.Request, a, first.record.requested.request);
    defer request.deinit();
    try require(std.mem.eql(u8, request.value.binding.semantic_identity, t.increment_identity));
    try require(std.mem.eql(u8, request.value.binding.payload, &.{ 20, 0, 0, 0 }));
    try require(std.mem.eql(u8, request.value.binding.payload_schema, request.value.binding.resume_schema));
    var value: [4]u8 = undefined;
    std.mem.writeInt(u32, &value, try std.math.add(u32, std.mem.readInt(u32, request.value.binding.payload[0..4], .little), 1), .little);
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
    var question = try restored.drive(a, .resume_yield, .{ .quantum = 64 });
    defer question.deinit();
    try require(question.record == .requested);
    const answer = try contracts.encodeOwned(t.Answer, a, .{ .message = .{ .bytes = "API witness" } });
    var cleanup = try restored.drive(a, .{ .reply = try answerRequest(a, question.record.requested.request, t.question_identity, answer) }, .{ .quantum = 64 });
    defer cleanup.deinit();
    try require(cleanup.record == .requested);
    var done = try restored.drive(a, .{ .reply = try answerRequest(a, cleanup.record.requested.request, t.cleanup_identity, &.{}) }, .{ .quantum = 64 });
    defer done.deinit();
    try require(done.record == .completed);
    const expected = try contracts.encodeOwned(t.Output, a, .{ .value = 41, .answer = .{ .bytes = "API witness" } });
    try require(std.mem.eql(u8, done.record.completed, expected));
    try restored.close();
    if (restored.checkpoint(a)) |_| return error.ExpectedClosed else |err| {
        if (err != error.InvalidState) return err;
    }
    var buffer: [256]u8 = undefined;
    var out = std.Io.File.stdout().writer(init.io, &buffer);
    try out.interface.writeAll("{\"result\":41,\"effects\":3,\"yields\":1,\"restored\":true,\"publication_rollback\":true}\n");
    try out.interface.flush();
}

fn answerRequest(a: std.mem.Allocator, bytes: []const u8, identity: []const u8, payload: []const u8) ![]u8 {
    var request = try protocol.decode(protocol.Request, a, bytes);
    defer request.deinit();
    try require(std.mem.eql(u8, request.value.binding.semantic_identity, identity));
    return protocol.encodeOwned(protocol.Result, a, .{ .request_identity = request.value.request_identity, .value = payload });
}
