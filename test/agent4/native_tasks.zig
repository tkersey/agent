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
    pub const Padding = agent.contracts.Bytes(64 * 1024);
    pub const Output = struct { answer: u32, inbox: Inbox.Reply, padding: Padding };
    pub const Failure = void;
    pub const Message = u32;
};
fn MessageContract(comptime application: []const u8, comptime message: []const u8) type {
    return struct {
        pub const application_id = application;
        pub const input_schema_id = T.input_schema_id;
        pub const output_schema_id = T.output_schema_id;
        pub const failure_schema_id = T.failure_schema_id;
        pub const message_schema_id = message;
        pub const Input = T.Input;
        pub const Output = T.Output;
        pub const Failure = T.Failure;
        pub const Message = T.Message;
    };
}
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
        const padding = try c.literal(T.Padding, .{ .bytes = &@as([64 * 1024]u8, @splat('x')) });
        const result = try b.primitive(output, .product, &.{ try b.reference(answer), try b.reference(message), padding }, 0);
        try b.define(entry, try b.bind(incremented, try b.term(.{ .perform = .{ .effect = leaf, .payload = try b.reference(b.parameter(entry, 0)) } }), try b.bind(answer, try b.term(.{ .perform = .{ .effect = question, .payload = try b.reference(incremented) } }), try b.bind(message, try Inbox.poll(c), try b.pure(result)))));
        return b.module(entry, try c.schema(void));
    }
};
fn increment(_: native.Context, input: u32) !u32 {
    return input + 1;
}
fn present(ctx: native.Context, input: u32) !native.json.Value {
    try std.testing.expectEqualStrings("fixed-profile", ctx.profile);
    const configured: *const u32 = @ptrCast(@alignCast(ctx.environment orelse return error.MissingConfiguration));
    try std.testing.expectEqual(37, configured.*);
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
    const a = std.testing.allocator;
    var compiled = try agent.compile(a, agent.system(.{ .InitialArgs = T.Input, .Result = T.Output, .Failure = T.Failure, .application = Application }));
    defer compiled.deinit();
    const image = try a.alloc(u8, try boundary.data.program_image.encodedLength(compiled.program));
    defer a.free(image);
    _ = try compiled.encode(a, image);
    try ownerRecovery(false, image);
    try ownerRecovery(true, image);
}

fn ownerRecovery(captured: bool, image: []const u8) !void {
    const a = std.testing.allocator;
    const io = std.testing.io;
    const admitted_image = try boundary.data.program_image.Admitted.decode(a, image);
    defer admitted_image.deinit();
    var image_digest: [32]u8 = undefined;
    var assets_digest: [32]u8 = undefined;
    std.crypto.hash.sha2.Sha256.hash(image, &image_digest, .{});
    std.crypto.hash.sha2.Sha256.hash("owner-unit-test", &assets_digest, .{});
    const image_hex = std.fmt.bytesToHex(image_digest, .lower);
    const identity_hex = std.fmt.bytesToHex(admitted_image.identity(), .lower);
    const assets_hex = std.fmt.bytesToHex(assets_digest, .lower);
    const manifest = try std.json.Stringify.valueAlloc(a, .{
        .native_host_contract = "unit-native-contract", .protocol = "agent-host/1.0", .client_mapping = "agent-client-values/1.0", .state_format = "agent-native-state/7", .optimize = "safe",
        .program_sha256 = @as([]const u8, &image_hex), .program_identity = @as([]const u8, &identity_hex), .application_assets_sha256 = @as([]const u8, &assets_hex),
        .dependencies = .{ .world = "unit-world", .boundary = "unit-boundary" }, .compiler = .{ .version = "0.17.0" },
    }, .{});
    defer a.free(manifest);
    const assets: native.discovery.Assets = .{ .image = image, .application = "owner-unit-test", .manifest = manifest };
    // Asset/discovery admission is independently tested by the subprocess peer.
    var application: native.discovery.Application = .{ .arena = .init(a), .metadata = .null, .manifest = .null, .manifest_id = "unit", .image_identity = admitted_image.identity() };
    defer application.deinit();
    application.manifest = (try native.json.parse(application.arena.allocator(), manifest, .{})).value;
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
    var configured: u32 = 37;
    const profile: native.tasks.Profile = .{ .id = "offline", .runtime_identity = @splat(42), .bytes = "fixed-profile", .environment = &configured, .resources = &.{"immutable snapshot bytes"}, .authority = .{ .grants = &grants, .principal = "test", .tenant = "test" } };
    for (&grants) |*grant| grant.resource_identity = try profile.resourceIdentity(application.image_identity);
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
    // Queuing typed input does not execute under the current launch profile.
    // A compatible application can accept it before restoring the task profile.
    service.profile.bytes = "another launch profile";
    const queued_message = try service.message(frame, "message", accepted.receipt.task, 9);
    service.profile.bytes = profile.bytes;
    var calls: usize = 0;
    for (0..32) |_| {
        const step = try service.pump(frame);
        if (step == .work) {
            var request = try protocol.decode(protocol.Request, frame, step.work.request);
            defer request.deinit();
            const ctx: native.Context = .{ .allocator = frame, .io = io, .authority = &profile.authority, .task_id = "test", .profile = profile.bytes, .environment = profile.environment };
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
    // Both fixtures preserve the exact image and value types. Independently
    // changing either nominal application or message identity must still reject
    // new input, while retaining access to the old task and its queued message.
    inline for (.{ MessageContract("another-application", T.message_schema_id), MessageContract(T.application_id, "another-message-schema") }) |Other| {
        var other = try native.tasks.Service(Other).init(a, io, &namespace, assets, &application, handlers, profile);
        defer other.close(frame) catch unreachable;
        var visible = try other.task(frame, accepted.receipt.task);
        defer visible.deinit();
        try std.testing.expectEqual(1, visible.value.messages.items.len);
        const generation = namespace.store.head.generation;
        try std.testing.expectError(error.IncompatibleProfile, other.message(frame, "foreign-message", accepted.receipt.task, 10));
        try std.testing.expectEqual(generation, namespace.store.head.generation);
    }
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
    try std.testing.expectError(error.StaleInteraction, service.respond(frame, "unknown-question", accepted.receipt.task, @splat(0), question.value.revision, question.value.request_digest, "task-owner.answer.v1", .{ .number_string = "7" }));
    const answered = try service.respond(frame, "answer", accepted.receipt.task, question.value.id, question.value.revision, question.value.request_digest, "task-owner.answer.v1", .{ .number_string = "7" });
    try std.testing.expect(!answered.replayed);
    var imported_inbox = false;
    var queue_client: native.client.Client(T) = .{ .service = &service };
    var queue_params = native.json.object();
    try native.json.put(frame, &queue_params, "task_id", native.json.string(try frame.dupe(u8, &std.fmt.bytesToHex(accepted.receipt.task, .lower))));
    for (0..32) |_| {
        const step = try service.pump(frame);
        try std.testing.expect(step != .work);
        if (!captured and !imported_inbox) {
            const queue = (try queue_client.call(frame, .@"task.status", queue_params)).object.get("pending_messages").?.array.items;
            if (queue.len != 0 and std.mem.eql(u8, queue[0].object.get("disposition").?.string, "acquired")) {
                const archive_path = try std.fmt.allocPrint(frame, "{s}/acquired-inbox.bundle", .{path_buffer[0..length]});
                _ = try service.exportCheckpoint(frame, accepted.receipt.task, archive_path);
                const imported_path = try std.fmt.allocPrint(frame, "{s}/imported-inbox", .{path_buffer[0..length]});
                var imported_namespace = try native.Namespace.open(a, io, imported_path);
                defer imported_namespace.close() catch unreachable;
                var imported_service = try native.tasks.Service(T).init(a, io, &imported_namespace, assets, &application, handlers, profile);
                defer imported_service.close(frame) catch unreachable;
                const imported = try imported_service.importCheckpoint(frame, "import-acquired", archive_path);
                var saved = try imported_service.task(frame, imported.receipt.task);
                defer saved.deinit();
                _ = try imported_service.resumeTask(frame, "resume-imported", imported.receipt.task, saved.value.revision);
                for (0..32) |_| {
                    const imported_step = try imported_service.pump(frame);
                    try std.testing.expect(imported_step != .work);
                    if (imported_step == .idle) break;
                }
                var finished = try imported_service.task(frame, imported.receipt.task);
                defer finished.deinit();
                try std.testing.expect(finished.value.terminal());
                const imported_bytes = try imported_namespace.store.object(frame, finished.value.result.?, 128 * 1024);
                var imported_output = try agent.contracts.decodeOwned(T.Output, frame, imported_bytes);
                defer imported_output.deinit();
                try std.testing.expectEqual(7, imported_output.value.answer);
                try std.testing.expect(imported_output.value.inbox == .message);
                try std.testing.expectEqual(9, imported_output.value.inbox.message.value);
                try std.testing.expectEqualStrings(&std.fmt.bytesToHex(queued_message.receipt.message.?, .lower), imported_output.value.inbox.message.id.bytes);
                imported_inbox = true;
            }
        }
        if (step == .idle) break;
    }
    try std.testing.expect(captured or imported_inbox);
    var completed = try service.task(frame, accepted.receipt.task);
    defer completed.deinit();
    try std.testing.expect(completed.value.terminal());
    const result = try namespace.store.object(frame, completed.value.result.?, 128 * 1024);
    var decoded = try agent.contracts.decodeOwned(T.Output, frame, result);
    defer decoded.deinit();
    try std.testing.expectEqual(7, decoded.value.answer);
    try std.testing.expect(decoded.value.inbox == .message);
    try std.testing.expectEqual(9, decoded.value.inbox.message.value);
    try std.testing.expectEqualStrings(&std.fmt.bytesToHex(queued_message.receipt.message.?, .lower), decoded.value.inbox.message.id.bytes);
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
    const public_outcome = public_result.object.get("outcome").?;
    try std.testing.expect(public_outcome.object.get("value") == null);
    const result_reference = public_outcome.object.get("value_ref").?;
    var read_params = native.json.object();
    try native.json.put(frame, &read_params, "task_id", params.object.get("task_id").?);
    try native.json.put(frame, &read_params, "artifact_id", result_reference.object.get("artifact_id").?);
    try native.json.put(frame, &read_params, "length", native.json.string("32768"));
    var reconstructed: std.array_list.Managed(u8) = .init(frame);
    while (true) {
        try native.json.put(frame, &read_params, "offset", native.json.string(try std.fmt.allocPrint(frame, "{d}", .{reconstructed.items.len})));
        const chunk = try client.call(frame, .@"artifact.read", read_params);
        const encoded = chunk.object.get("data").?.string;
        const decoder = std.base64.url_safe_no_pad.Decoder;
        const bytes = try frame.alloc(u8, try decoder.calcSizeForSlice(encoded));
        try decoder.decode(bytes, encoded);
        try std.testing.expect(bytes.len > 0);
        try reconstructed.appendSlice(bytes);
        try std.testing.expect(reconstructed.items.len <= 128 * 1024);
        if (chunk.object.get("eof").?.bool) break;
    }
    try std.testing.expectEqualSlices(u8, try native.json.canonical(frame, try native.values.toJson(T.Output, frame, decoded.value)), reconstructed.items);
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
    try std.testing.expectError(error.Denied, client.call(frame, .@"artifact.read", read_params));
    _ = read_params.object.swapRemove("task_id");
    try std.testing.expectError(error.Denied, client.call(frame, .@"artifact.read", read_params));
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

    if (!captured) {
        // Exercise the stored-event projection's byte domain without another
        // application image. Lifecycle production is exercised above; these
        // schema-shaped historical rows isolate pagination and batch framing.
        var large_data = found: {
            for (history) |event| {
                if (std.mem.eql(u8, event.object.get("type").?.string, "input_required")) break :found event.object.get("data").?;
            }
            return error.ExpectedQuestion;
        };
        const prompt = try frame.alloc(u8, 32 * 1024 - 2);
        @memset(prompt, 'q');
        try native.json.put(frame, &large_data, "prompt", native.json.string(prompt));
        const event_data = try native.json.canonical(frame, large_data);
        var paged = completed.value;
        paged.revision += 1;
        try namespace.store.begin();
        defer namespace.store.rollback();
        for (0..40) |_| {
            paged.event_high += 1;
            try namespace.store.putEvent(.{ .task = paged.id, .seq = paged.event_high, .revision = paged.revision, .kind = .input_required, .data = .{ .bytes = event_data } });
        }
        try namespace.store.putTask(paged, completed.value.revision);
        try namespace.commit("pagination-domain");
        var cursor = completed.value.event_high;
        var seen: usize = 0;
        while (cursor < paged.event_high) {
            var page_arena = std.heap.ArenaAllocator.init(a);
            defer page_arena.deinit();
            const pa = page_arena.allocator();
            const page = try client.events(pa, paged.id, cursor, 128);
            const next = try native.json.decimal(u64, page.object.get("next_after_seq").?);
            try std.testing.expect(next > cursor);
            seen += page.object.get("events").?.array.items.len;
            var batch: native.json.Value = .{ .array = .init(pa) };
            var id: [128]u8 = @splat(1); // maximum-length, heavily escaped IDs
            for (0..16) |index| {
                id[0] = @intCast(index + 32);
                try batch.array.append(try native.protocol.response(pa, native.json.string(try pa.dupe(u8, &id)), page));
            }
            try std.testing.expect((try native.json.canonical(pa, batch)).len + 1 <= 1024 * 1024);
            cursor = next;
        }
        try std.testing.expectEqual(40, seen);
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

const CleanupTypes = struct {
    pub const application_id = "cleanup-owner-test";
    pub const input_schema_id = "cleanup.input.v1";
    pub const output_schema_id = "cleanup.output.v1";
    pub const failure_schema_id = "cleanup.failure.v1";
    pub const message_schema_id = "cleanup.message.v1";
    pub const Input = bool;
    pub const Output = void;
    pub const Failure = void;
    pub const Message = void;
};
const CleanupApplication = struct {
    pub fn emit(c: agent.Context) !boundary.source.Module {
        const b = c.builder;
        const unit = try c.schema(void);
        const boolean = try c.schema(bool);
        const entry = try b.declare(&.{boolean}, unit, &.{}, &.{});
        const body = try b.declare(&.{}, unit, &.{}, &.{});
        // Stop inside protect before selecting failure versus cancellation.
        try b.define(body, try b.term(.{ .yield_then = try b.term(.{ .fail = try b.constant(void, {}) }) }));
        const exit_info = try boundary.library.cleanup.exitInfo(b, unit);
        const cleanup = try b.declare(&.{exit_info}, unit, &.{}, &.{});
        try b.define(cleanup, try b.term(.{ .conditional = .{
            .condition = try b.reference(b.parameter(entry, 0)),
            .when_true = try b.term(.{ .fail = try b.constant(void, {}) }),
            .when_false = try b.pure(try b.constant(void, {})),
        } }));
        const body_type = try b.schema(.{ .internal = .{ .computation = .{ .parameters = &.{}, .result = unit, .effects = &.{} } } });
        const cleanup_type = try b.schema(.{ .internal = .{ .computation = .{ .parameters = &.{exit_info}, .result = unit, .effects = &.{}, .capture_bound = &.{boolean} } } });
        try b.define(entry, try b.term(.{ .protect = .{ .body = try b.lambda(body, body_type), .cleanup = try b.lambda(cleanup, cleanup_type) } }));
        return b.module(entry, unit);
    }
};

test "terminal cleanup failures retain bounded shutdown ownership without runnable work" {
    const a = std.testing.allocator;
    const io = std.testing.io;
    var compiled = try agent.compile(a, agent.system(.{ .InitialArgs = bool, .Result = void, .Failure = void, .application = CleanupApplication }));
    defer compiled.deinit();
    const image = try a.alloc(u8, try boundary.data.program_image.encodedLength(compiled.program));
    defer a.free(image);
    _ = try compiled.encode(a, image);
    const admitted_image = try boundary.data.program_image.Admitted.decode(a, image);
    defer admitted_image.deinit();
    const assets: native.discovery.Assets = .{ .image = image, .application = "cleanup-test", .manifest = "cleanup-test" };
    var application: native.discovery.Application = .{ .arena = .init(a), .metadata = .null, .manifest = .null, .manifest_id = "unit", .image_identity = admitted_image.identity() };
    defer application.deinit();
    var handlers = try native.Registry.init(a, &.{});
    defer handlers.deinit();
    const profile: native.tasks.Profile = .{ .id = "offline", .runtime_identity = @splat(42), .bytes = "cleanup-profile", .authority = .{ .grants = &.{}, .principal = "test", .tenant = "test" } };
    var temporary = std.testing.tmpDir(.{});
    defer temporary.cleanup();
    var path_buffer: [4096]u8 = undefined;
    const length = try temporary.dir.realPath(io, &path_buffer);
    const path = try std.fmt.allocPrint(a, "{s}/state", .{path_buffer[0..length]});
    defer a.free(path);
    var namespace = try native.Namespace.open(a, io, path);
    defer namespace.close() catch unreachable;
    var service = try native.tasks.Service(CleanupTypes).init(a, io, &namespace, assets, &application, handlers, profile);
    var service_live = true;
    defer if (service_live) service.close(a) catch unreachable;
    var arena = std.heap.ArenaAllocator.init(a);
    defer arena.deinit();
    const frame = arena.allocator();
    var client: native.client.Client(CleanupTypes) = .{ .service = &service };
    // Successful cleanup releases slots. Both terminal outcomes with failed
    // cleanup remain owned. Then fill every slot to test admission-before-ack.
    for (0..18) |index| {
        const cleanup_fails = index >= 2;
        const cancel = index % 2 == 0;
        const operation = try std.fmt.allocPrint(frame, "cleanup-{d}", .{index});
        const submitted = try service.submit(frame, operation, cleanup_fails);
        try std.testing.expect(try service.pump(frame) == .progressed);
        var yielded = try service.task(frame, submitted.receipt.task);
        defer yielded.deinit();
        try std.testing.expectEqual(.yielded, yielded.value.outcome_kind);
        if (cancel) _ = try service.requestCancel(frame, try std.fmt.allocPrint(frame, "cancel-{d}", .{index}), submitted.receipt.task, "test cancellation");
        try std.testing.expect(try service.pump(frame) == .progressed);
        var terminal = try service.task(frame, submitted.receipt.task);
        defer terminal.deinit();
        const expected: @TypeOf(terminal.value.outcome_kind) = if (cancel) .cancelled else .failed;
        try std.testing.expectEqual(expected, terminal.value.outcome_kind);
        try std.testing.expectEqual(!cleanup_fails, try service.taskCleanupComplete(frame, terminal.value));
        try std.testing.expect(try service.pump(frame) == .idle);
        try std.testing.expectEqual(cleanup_fails, try service.shutdownIncomplete(frame));
        var count: usize = 0;
        for (service.owned) |id| if (id != null) {
            count += 1;
        };
        try std.testing.expectEqual(if (cleanup_fails) index - 1 else 0, count);
        var params = native.json.object();
        try native.json.put(frame, &params, "task_id", native.json.string(try frame.dupe(u8, &std.fmt.bytesToHex(submitted.receipt.task, .lower))));
        const result = try client.call(frame, .@"task.result", params);
        try std.testing.expect(result.object.get("ready").?.bool);
        try std.testing.expectEqual(!cleanup_fails, result.object.get("outcome").?.object.get("cleanup_complete").?.bool);
        try std.testing.expect((try service.submit(frame, operation, cleanup_fails)).replayed);
    }
    const generation = namespace.store.head.generation;
    try std.testing.expectError(error.Capacity, service.submit(frame, "overflow-owned", false));
    try std.testing.expectEqual(generation, namespace.store.head.generation);
    try service.park(frame);
    try std.testing.expect(try service.shutdownIncomplete(frame));
    // Reopening does not reacquire old work; its durable result stays honest.
    const retained_id = service.owned[0].?;
    try service.close(frame);
    service_live = false;
    service = try native.tasks.Service(CleanupTypes).init(a, io, &namespace, assets, &application, handlers, profile);
    service_live = true;
    var retained = try service.task(frame, retained_id);
    defer retained.deinit();
    try std.testing.expect(!try service.taskCleanupComplete(frame, retained.value));
    try std.testing.expect(try service.pump(frame) == .idle);
}
