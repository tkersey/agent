const std = @import("std");
const boundary = @import("boundary");
const agent = @import("agent");
const world = @import("world");
const protocol = boundary.data.invocation;
const Message = struct { text: agent.contracts.Text(256) };
const Inbox = agent.inbox.Profile(Message);

const Application = struct {
    pub fn emit(c: agent.Context) !boundary.source.Module {
        const b = c.builder;
        const effect = try Inbox.declare(c);
        const entry = try b.declare(&.{try c.schema(void)}, try c.schema(Inbox.Reply), &.{effect}, &.{});
        try b.define(entry, try Inbox.poll(c));
        return b.module(entry, try c.schema(void));
    }
};

test "one authored inbox image carries empty and distinct messages through ordinary World replies" {
    const a = std.testing.allocator;
    const System = agent.system(.{ .InitialArgs = void, .Result = Inbox.Reply, .Failure = void, .application = Application });
    var compiled = try agent.compile(a, System);
    defer compiled.deinit();
    try std.testing.expectEqual(1, compiled.program.effects.len);
    const image = try a.alloc(u8, try boundary.data.program_image.encodedLength(compiled.program));
    defer a.free(image);
    _ = try compiled.encode(a, image);
    var prepared = try world.Prepared.init(a, image);
    defer prepared.deinit();
    const cases = [_]Inbox.Reply{
        .{ .empty = {} },
        .{ .message = .{ .id = .{ .bytes = "message-1" }, .value = .{ .text = .{ .bytes = "first" } } } },
        .{ .message = .{ .id = .{ .bytes = "message-2" }, .value = .{ .text = .{ .bytes = "雪 follow-up" } } } },
    };
    for (cases) |expected| {
        var resident = try world.Resident.start(a, &prepared, &.{});
        var pending = try resident.drive(a, .none, .{ .quantum = 64 });
        defer pending.deinit();
        try std.testing.expect(pending.record == .requested);
        var request = try protocol.decode(protocol.Request, a, pending.record.requested.request);
        defer request.deinit();
        try std.testing.expectEqualStrings(agent.inbox.semantic_identity, request.value.binding.semantic_identity);
        try std.testing.expectEqualSlices(u8, &.{}, request.value.binding.payload);
        const value = try agent.contracts.encodeOwned(Inbox.Reply, a, expected);
        defer a.free(value);
        const reply = try protocol.encodeOwned(protocol.Result, a, .{ .request_identity = request.value.request_identity, .value = value });
        defer a.free(reply);
        var completed = try resident.drive(a, .{ .reply = reply }, .{ .quantum = 64 });
        defer completed.deinit();
        try std.testing.expect(completed.record == .completed);
        try std.testing.expectEqualSlices(u8, value, completed.record.completed);
        try resident.close();
    }
}

test "an inbox identity cannot be redeclared with a different message contract" {
    const a = std.testing.allocator;
    var b = boundary.source.Builder.init(a);
    defer b.deinit();
    var registry = agent.admission.Registry.init(a);
    defer registry.deinit();
    const ctx = agent.Context{ .builder = &b, .registry = &registry };
    try std.testing.expectEqual(try Inbox.declare(ctx), try Inbox.declare(ctx));
    try std.testing.expectError(error.InvalidInboxContract, agent.inbox.Profile(u64).declare(ctx));
}
