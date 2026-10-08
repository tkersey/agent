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
        if (std.mem.eql(u8, mode, "client-integers")) {
            const encoded = args.next() orelse return error.InvalidArguments;
            if (args.next() != null) return error.InvalidArguments;
            var arena = std.heap.ArenaAllocator.init(init.gpa);
            defer arena.deinit();
            const a = arena.allocator();
            var input = try native.json.parse(a, encoded, .{});
            defer input.deinit();
            var accepted: std.array_list.Managed(native.json.Value) = .init(a);
            for (input.value.array.items) |item| {
                const signed = std.mem.eql(u8, item.object.get("definition").?.string, "signed");
                const value = item.object.get("value").?;
                const valid = if (signed) blk: {
                    _ = native.values.fromJson(i64, a, value) catch break :blk false;
                    break :blk true;
                } else blk: {
                    _ = native.values.fromJson(u64, a, value) catch break :blk false;
                    break :blk true;
                };
                try accepted.append(.{ .bool = valid });
            }
            var schema = (try native.json.parse(a, "{\"$schema\":\"https://json-schema.org/draft/2020-12/schema\",\"$id\":\"urn:agent:client-integer-qualification\"}", .{})).value;
            var definitions = native.json.object();
            try native.json.put(a, &definitions, "unsigned", (try native.json.parse(a, &contracts.json.ClientSchema(u64).value, .{})).value);
            try native.json.put(a, &definitions, "signed", (try native.json.parse(a, &contracts.json.ClientSchema(i64).value, .{})).value);
            try native.json.put(a, &schema, "$defs", definitions);
            var output = native.json.object();
            try native.json.put(a, &output, "schema", schema);
            try native.json.put(a, &output, "accepted", .{ .array = accepted });
            try std.Io.File.stdout().writeStreamingAll(init.io, try native.json.canonical(a, output));
            return;
        }
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
            const prepare_start = std.Io.Clock.awake.now(init.io).toNanoseconds();
            var program = try world.Prepared.init(allocator, invocation.value.image);
            const prepare_ns = std.Io.Clock.awake.now(init.io).toNanoseconds() - prepare_start;
            defer program.deinit();
            const restore_start = std.Io.Clock.awake.now(init.io).toNanoseconds();
            var handle = switch (invocation.value.instance) {
                .initial_args => |value| try world.Resident.start(allocator, &program, value),
                .state => |value| try world.Resident.restore(allocator, &program, value),
            };
            const restore_ns = std.Io.Clock.awake.now(init.io).toNanoseconds() - restore_start;
            var statistics: world.Statistics = .{};
            try handle.setStatistics(&statistics);
            const drive_start = std.Io.Clock.awake.now(init.io).toNanoseconds();
            var outcome = try handle.drive(allocator, invocation.value.control, .{ .quantum = invocation.value.quantum, .checkpoint = true });
            const drive_ns = std.Io.Clock.awake.now(init.io).toNanoseconds() - drive_start;
            defer outcome.deinit();
            switch (outcome.record) {
                .completed, .failed, .cancelled => try handle.close(),
                else => allocator.free(try handle.takeCheckpoint(allocator)),
            }
            const encoded_outcome = try protocol.encodeOwned(protocol.Outcome, allocator, outcome.record);
            defer allocator.free(encoded_outcome);
            try std.Io.File.stdout().writeStreamingAll(init.io, encoded_outcome);
            // The outer requested-byte counter is monotonic through teardown;
            // report it separately from OS RSS and allocator backing metadata.
            const measurement = try std.fmt.allocPrint(allocator, "{{\"fresh_prepare_ns\":{d},\"restore_ns\":{d},\"prepared_drive_checkpoint_ns\":{d},\"peak_requested_bytes\":{d},\"transitions\":{d},\"dispatches\":{d}}}\n", .{ prepare_ns, restore_ns, drive_ns, budget.peak, statistics.transitions, statistics.dispatches });
            defer allocator.free(measurement);
            try std.Io.File.stderr().writeStreamingAll(init.io, measurement);
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
    try require(!std.mem.eql(u8, request.value.binding.payload_schema, request.value.binding.resume_schema));
    // Independent canonical optional encoding: some(21), not bare u32(21).
    const value = [_]u8{ 1, 21, 0, 0, 0 };
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
