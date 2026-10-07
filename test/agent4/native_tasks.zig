const std = @import("std");
const agent = @import("agent");
const boundary = @import("boundary");
const native = @import("agent_native");
const protocol = boundary.data.invocation;
const Inbox = agent.inbox.Profile(u32);
const T = struct {
    pub const application_id = "task-owner-test";
    pub const input_schema_id = "task-owner.input.v1";
    pub const output_schema_id = "task-owner.output.v1";
    pub const failure_schema_id = "task-owner.failure.v1";
    pub const message_schema_id = "task-owner.message.v1";
    pub const Input = u32;
    pub const Output = struct { answer: u32, inbox: Inbox.Reply };
    pub const Failure = void;
    pub const Message = u32;
};
const Application = struct {
    pub fn emit(c: agent.Context) !boundary.source.Module {
        const b = c.builder;
        const number = try c.schema(u32);
        const output = try c.schema(T.Output);
        const leaf = try c.external("task-owner.increment.v1", number, number, .read);
        const question = try c.external("task-owner.question.v1", number, number, .read);
        const inbox = try Inbox.declare(c);
        const entry = try b.declare(&.{number}, output, &.{ leaf, question, inbox }, &.{});
        const incremented = try b.variable(number);
        const answer = try b.variable(number);
        const message = try b.variable(try c.schema(Inbox.Reply));
        const result = try b.primitive(output, .product, &.{ try b.reference(answer), try b.reference(message) }, 0);
        try b.define(entry, try b.bind(incremented, try b.term(.{ .perform = .{ .effect = leaf, .payload = try b.reference(b.parameter(entry, 0)) } }), try b.bind(answer, try b.term(.{ .perform = .{ .effect = question, .payload = try b.reference(incremented) } }), try b.bind(message, try Inbox.poll(c), try b.pure(result)))));
        return b.module(entry, try c.schema(void));
    }
};
fn increment(_: native.Context, input: u32) !u32 {
    return input + 1;
}
fn present(ctx: native.Context, input: u32) !native.json.Value {
    return native.json.number(ctx.allocator, input);
}
const CapturingIncrement = struct {
    fn prepare(ctx: native.registry.ProjectionContext, payload: []const u8) ![]u8 {
        var value = try agent.contracts.decodeOwned(u32, ctx.allocator, payload);
        defer value.deinit();
        return std.fmt.allocPrint(ctx.allocator, "increment:{d}", .{value.value});
    }
    fn invoke(ctx: native.Context, bytes: []const u8) !native.registry.Acquisition {
        if (!std.mem.eql(u8, bytes, "increment:20")) return error.InvalidPreparedRequest;
        return .{ .captured = try ctx.allocator.dupe(u8, "raw-response:21") };
    }
    fn interpret(ctx: native.registry.ProjectionContext, payload: []const u8, rendered: []const u8, raw: []const u8) !native.registry.Projection {
        if (!std.mem.eql(u8, rendered, "increment:20") or !std.mem.eql(u8, raw, "raw-response:21")) return error.InvalidCapture;
        var value = try agent.contracts.decodeOwned(u32, ctx.allocator, payload);
        defer value.deinit();
        if (value.value != 20) return error.InvalidCapture;
        return .{ .reply = try agent.contracts.encodeOwned(u32, ctx.allocator, 21) };
    }
};

test "durable owner replays admissions and acquired work, binds answers, and consumes queued input once" {
    try ownerRecovery(false);
    try ownerRecovery(true);
}

fn ownerRecovery(captured: bool) !void {
    const a = std.testing.allocator;
    const io = std.testing.io;
    var compiled = try agent.compile(a, agent.system(.{ .InitialArgs = T.Input, .Result = T.Output, .Failure = T.Failure, .application = Application }));
    defer compiled.deinit();
    const image = try a.alloc(u8, try boundary.data.program_image.encodedLength(compiled.program));
    defer a.free(image);
    _ = try compiled.encode(a, image);
    const assets: native.discovery.Assets = .{ .image = image, .application = "owner-unit-test", .manifest = "owner-unit-test" };
    // Asset/discovery admission is independently tested by the subprocess peer.
    var application: native.discovery.Application = .{ .arena = .init(a), .metadata = .null, .manifest = .null, .manifest_id = "unit", .image_identity = try boundary.data.program_image.identity(a, compiled.program) };
    defer application.deinit();
    var increment_declaration = native.leaf(u32, u32, .{ .identity = "task-owner.increment.v1", .resource_role = "local" }, increment);
    if (captured) {
        increment_declaration.background = true;
        increment_declaration.capture = .{ .prepare = CapturingIncrement.prepare, .acquire = CapturingIncrement.invoke, .interpret = CapturingIncrement.interpret };
        increment_declaration.invoke = null;
    }
    var handlers = try native.Registry.init(a, &.{
        increment_declaration,
        native.question(u32, u32, .{ .identity = "task-owner.question.v1", .resource_role = "user", .answer_schema_id = "task-owner.answer.v1" }, present),
        native.inbox.declaration(u32),
    });
    defer handlers.deinit();
    var grants: [3]native.registry.Grant = undefined;
    for (&grants, handlers.entries) |*grant, entry| grant.* = .{ .identity = entry.declaration.identity, .resource_role = entry.declaration.resource_role, .resource_identity = application.image_identity };
    const profile: native.tasks.Profile = .{ .id = "offline", .runtime_identity = @splat(42), .bytes = "fixed-profile", .resources = &.{"immutable snapshot bytes"}, .authority = .{ .grants = &grants, .principal = "test", .tenant = "test" } };
    var temporary = std.testing.tmpDir(.{});
    defer temporary.cleanup();
    var path_buffer: [4096]u8 = undefined;
    const length = try temporary.dir.realPath(io, &path_buffer);
    const path = try std.fmt.allocPrint(a, "{s}/state", .{path_buffer[0..length]});
    defer a.free(path);
    var namespace = try native.Namespace.open(a, io, path);
    defer namespace.close() catch unreachable;
    var service = try native.tasks.Service(T).init(a, io, &namespace, assets, &application, handlers, profile);
    var service_live = true;
    defer if (service_live) service.close(a) catch unreachable;
    var arena = std.heap.ArenaAllocator.init(a);
    defer arena.deinit();
    const frame = arena.allocator();
    const accepted = try service.submit(frame, "submit", 20);
    const duplicate = try service.submit(frame, "submit", 20);
    try std.testing.expect(duplicate.replayed);
    try std.testing.expectEqualSlices(u8, &accepted.receipt.task, &duplicate.receipt.task);
    try std.testing.expectError(error.OperationConflict, service.submit(frame, "submit", 21));
    _ = try service.message(frame, "message", accepted.receipt.task, 9);
    var calls: usize = 0;
    for (0..32) |_| {
        const step = try service.pump(frame);
        if (step == .work) {
            var request = try protocol.decode(protocol.Request, frame, step.work.request);
            defer request.deinit();
            const ctx: native.Context = .{ .allocator = frame, .io = io, .authority = &profile.authority, .task_id = "test" };
            const reply = if (step.work.entry.declaration.capture) |adapter| (try adapter.acquire(ctx, step.work.prepared.?)).captured else try step.work.entry.declaration.invoke.?(ctx, request.value.binding.payload);
            calls += 1;
            try service.acquire(frame, step.work, reply);
            if (captured) {
                const saved = (try namespace.store.recordBytes(frame, "capture", step.work.attempt, step.work.task)) orelse return error.MissingRawCapture;
                try std.testing.expect(saved.len != 0);
            }
            break;
        }
    }
    try std.testing.expectEqual(1, calls);
    // Restart at durable acquisition, before World consumes the reply.
    try service.close(frame);
    service_live = false;
    try namespace.close();
    namespace = try native.Namespace.open(a, io, path);
    service = try native.tasks.Service(T).init(a, io, &namespace, assets, &application, handlers, profile);
    service_live = true;
    const frozen = try service.frozenInputs(frame, accepted.receipt.task);
    try std.testing.expectEqualStrings(profile.bytes, frozen.profile);
    try std.testing.expectEqualStrings(profile.resources[0], frozen.resources[0]);
    try std.testing.expect(try service.pump(frame) == .idle);
    var status = try service.task(frame, accepted.receipt.task);
    defer status.deinit();
    service.profile.runtime_identity = @splat(43);
    try std.testing.expectError(error.IncompatibleProfile, service.resumeTask(frame, "resume", accepted.receipt.task, status.value.revision));
    service.profile.runtime_identity = profile.runtime_identity;
    service.profile.resources = &.{"changed snapshot bytes"};
    try std.testing.expectError(error.IncompatibleProfile, service.resumeTask(frame, "resume", accepted.receipt.task, status.value.revision));
    service.profile.resources = profile.resources;
    _ = try service.resumeTask(frame, "resume", accepted.receipt.task, status.value.revision);
    for (0..32) |_| {
        const step = try service.pump(frame);
        try std.testing.expect(step != .work);
        if (step == .waiting) break;
    }
    var question = (try service.pendingQuestion(frame, accepted.receipt.task)) orelse return error.ExpectedQuestion;
    defer question.deinit();
    const answered = try service.respond(frame, "answer", accepted.receipt.task, question.value.id, question.value.revision, question.value.request_digest, "task-owner.answer.v1", .{ .number_string = "7" });
    try std.testing.expect(!answered.replayed);
    for (0..32) |_| {
        const step = try service.pump(frame);
        try std.testing.expect(step != .work);
        if (step == .idle) break;
    }
    var completed = try service.task(frame, accepted.receipt.task);
    defer completed.deinit();
    try std.testing.expect(completed.value.terminal());
    const result = try namespace.store.object(frame, completed.value.result.?, 1024);
    var decoded = try agent.contracts.decodeOwned(T.Output, frame, result);
    defer decoded.deinit();
    try std.testing.expectEqual(7, decoded.value.answer);
    try std.testing.expect(decoded.value.inbox == .message);
    try std.testing.expectEqual(9, decoded.value.inbox.message.value);
    const replayed_answer = try service.respond(frame, "answer", accepted.receipt.task, question.value.id, question.value.revision, question.value.request_digest, "task-owner.answer.v1", .{ .number_string = "7" });
    try std.testing.expect(replayed_answer.replayed);
    try std.testing.expectEqualSlices(u8, &answered.receipt.id, &replayed_answer.receipt.id);
    try std.testing.expectError(error.AnswerConflict, service.respond(frame, "answer-conflict", accepted.receipt.task, question.value.id, question.value.revision, question.value.request_digest, "task-owner.answer.v1", .{ .number_string = "8" }));
    try std.testing.expect((try service.submit(frame, "submit", 20)).replayed);
    service.profile.bytes = "changed alias target";
    try std.testing.expect((try service.submit(frame, "submit", 20)).replayed);
    service.profile.bytes = profile.bytes;
    try std.testing.expectError(error.OperationConflict, service.requestCancel(frame, "submit", accepted.receipt.task, "cancel"));
    var client: native.client.Client(T) = .{ .service = &service };
    var params = native.json.object();
    try native.json.put(frame, &params, "task_id", native.json.string(try frame.dupe(u8, &std.fmt.bytesToHex(accepted.receipt.task, .lower))));
    const public_result = try client.call(frame, .@"task.result", params);
    try std.testing.expect(public_result.object.get("ready").?.bool);
    try std.testing.expectEqualStrings("completed", public_result.object.get("status").?.string);
    const events = try client.events(frame, accepted.receipt.task, 0, 128);
    const history = events.object.get("events").?.array.items;
    var consumed: usize = 0;
    var completed_events: usize = 0;
    for (history) |event| {
        const kind = event.object.get("type").?.string;
        if (std.mem.eql(u8, kind, "message_consumed")) consumed += 1;
        if (std.mem.eql(u8, kind, "completed")) completed_events += 1;
    }
    try std.testing.expectEqual(1, consumed);
    try std.testing.expectEqual(1, completed_events);
    try std.testing.expectError(error.InvalidParams, client.events(frame, accepted.receipt.task, completed.value.event_high + 1, 128));
    service.profile.authority.disclosure = false;
    try std.testing.expectError(error.Denied, client.call(frame, .@"task.result", params));
    try std.testing.expectError(error.Denied, service.submit(frame, "submit", 20));
    service.profile.authority.disclosure = true;
    const no_send = try service.submit(frame, "no-send", 20);
    var dispatched: ?native.tasks.Work = null;
    for (0..32) |_| {
        const step = try service.pump(frame);
        if (step == .work) {
            dispatched = step.work;
            break;
        }
    }
    try std.testing.expect(dispatched != null);
    try service.notSent(frame, dispatched.?);
    _ = try service.requestCancel(frame, "cancel-no-send", no_send.receipt.task, "stop before invocation");
    for (0..32) |_| {
        const step = try service.pump(frame);
        try std.testing.expect(step != .work);
        if (step == .idle) break;
    }
    var cancelled = try service.task(frame, no_send.receipt.task);
    defer cancelled.deinit();
    try std.testing.expectEqual(.cancelled, cancelled.value.outcome_kind);
}
