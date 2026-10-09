//! The actual adaptive image at the captured-before-interpreted boundary.
//! Copied-product admission is covered separately by native_adaptive.mjs.
const std = @import("std");
const agent = @import("agent");
const native = @import("agent_native");
const boundary = @import("boundary");
const world = @import("world");
const t = @import("adaptive_types");
const environment = @import("adaptive_environment");
const protocol = boundary.data.invocation;
const Ref = t.model.ArtifactReference;
// Independent projection of the persisted capture record, including the
// acquired-but-not-interpreted discriminant exercised below.
const CaptureRecord = struct {
    task: [16]u8,
    occurrence: [32]u8,
    attempt: [32]u8,
    request: Ref,
    response: ?Ref,
    disposition: enum { complete, definitely_not_sent, unknown },
    projection: ?struct { reply: Ref, objects: agent.contracts.Vector(Ref, 16), output_tokens: ?u64 },
};

test "adaptive unload capture recovers under its original plan without another acquisition" {
    var budget: world.AllocationBudget = .{ .parent = std.testing.allocator, .limit = 64 * 1024 * 1024 };
    const a = budget.allocator();
    const io = std.testing.io;
    var profile_arena = std.heap.ArenaAllocator.init(a);
    defer profile_arena.deinit();
    const permanent = profile_arena.allocator();
    const image = @embedFile("adaptive_image");
    const metadata = @embedFile("adaptive_application");
    const admitted_image = try boundary.data.program_image.Admitted.decode(a, image);
    defer admitted_image.deinit();
    const manifest = try @import("native_tasks.zig").ownerManifest(permanent, image, admitted_image.identity(), metadata);
    const assets: native.discovery.Assets = .{ .image = image, .application = metadata, .manifest = manifest };
    var application: native.discovery.Application = .{ .arena = .init(a), .metadata = .null, .manifest = .null, .manifest_id = "adaptive-unit", .image_identity = admitted_image.identity() };
    defer application.deinit();
    application.manifest = (try native.json.parse(application.arena.allocator(), manifest, .{})).value;
    var handlers = try native.Registry.init(a, &environment.handlers);
    defer handlers.deinit();
    const configured = try environment.configure(permanent, io, .{ .offline = true, .scratch_allocator = a }, null, assets);
    var grants: [environment.handlers.len]native.registry.Grant = undefined;
    const profile: native.tasks.Profile = .{ .id = configured.id, .runtime_identity = @splat(73), .bytes = configured.bytes, .environment = configured.environment, .resources = configured.resources, .authority = .{ .grants = &grants, .principal = "adaptive-unit", .tenant = "local", .inference = true } };
    for (&grants, handlers.entries) |*grant, entry| grant.* = .{ .identity = entry.declaration.identity, .resource_role = entry.declaration.resource_role, .resource_identity = try profile.resourceIdentity(application.image_identity) };
    var temporary = std.testing.tmpDir(.{});
    defer temporary.cleanup();
    var buffer: [4096]u8 = undefined;
    const length = try temporary.dir.realPath(io, &buffer);
    const path = try std.fmt.allocPrint(permanent, "{s}/adaptive", .{buffer[0..length]});
    var namespace = try native.Namespace.open(a, io, path);
    var namespace_live = true;
    defer if (namespace_live) namespace.close() catch unreachable;
    var service = try native.tasks.Service(t).init(a, io, &namespace, assets, &application, handlers, profile);
    var service_live = true;
    defer if (service_live) service.close(a) catch unreachable;
    const task = (try service.submit(permanent, "adaptive-recovery-submit", environment.demo_input)).receipt.task;
    var model_calls: usize = 0;
    var restarted = false;
    var witnessed = false;
    var finished = false;
    var maximum_state: u64 = 0;
    var maximum_prepared: usize = 0;
    var maximum_scratch: usize = 0;
    for (0..512) |_| {
        var scratch: world.AllocationBudget = .{ .parent = a, .limit = 64 * 1024 * 1024 };
        var arena = std.heap.ArenaAllocator.init(scratch.allocator());
        defer arena.deinit();
        defer maximum_scratch = @max(maximum_scratch, scratch.peak);
        const frame = arena.allocator();
        var saved = try service.task(frame, task);
        defer saved.deinit();
        maximum_state = @max(maximum_state, saved.value.checkpoint.bytes);
        if (saved.value.terminal()) {
            try std.testing.expect(saved.value.outcome_kind == .completed);
            const result = try namespace.store.object(frame, saved.value.result.?, 64 * 1024);
            var output = try agent.contracts.decodeOwned(t.Output, frame, result);
            defer output.deinit();
            try std.testing.expect(output.value.disposition == .report);
            try std.testing.expectEqual(13, output.value.model_calls);
            try std.testing.expectEqual(8, output.value.receipts.items.len);
            try std.testing.expectEqual(8, output.value.control.selection.control_revision);
            finished = true;
            break;
        }
        if (restarted and !witnessed and saved.value.outcome_kind == .requested) {
            const encoded = try namespace.store.object(frame, saved.value.outcome, 1024 * 1024);
            var outcome = try protocol.decode(protocol.Outcome, frame, encoded);
            defer outcome.deinit();
            var request = try protocol.decode(protocol.Request, frame, outcome.value.requested.request);
            defer request.deinit();
            if (std.mem.eql(u8, request.value.binding.semantic_identity, t.P.adaptive_identity)) {
                var adaptive = try agent.contracts.decodeOwned(t.P.AdaptiveRequest, frame, request.value.binding.payload);
                defer adaptive.deinit();
                if (adaptive.value.plan.watermark == 8) {
                    try std.testing.expectEqual(8, model_calls);
                    try std.testing.expectEqual(5, adaptive.value.selection.control_revision);
                    try std.testing.expectEqual(1, adaptive.value.plan.eviction_generation);
                    try std.testing.expectEqual(0, adaptive.value.plan.skills.items.len);
                    try std.testing.expect(!adaptive.value.offered[7] and !adaptive.value.materialized[7]);
                    try std.testing.expectEqual(8, saved.value.inference_attempts);
                    witnessed = true;
                }
            }
        }
        const step = try service.pump(frame);
        if (step == .work) {
            const work = step.work;
            var request = try protocol.decode(protocol.Request, frame, work.request);
            defer request.deinit();
            const context: native.Context = .{ .allocator = frame, .io = io, .authority = &profile.authority, .task_id = "adaptive-unit", .profile = profile.bytes, .environment = profile.environment };
            const reply = if (work.entry.declaration.capture) |adapter| blk: {
                maximum_prepared = @max(maximum_prepared, work.prepared.?.len);
                const acquired = try adapter.acquire(context, work.prepared.?);
                if (acquired != .captured) return error.UnexpectedAcquisitionFailure;
                break :blk acquired.captured;
            } else try work.entry.declaration.invoke.?(context, request.value.binding.payload);
            const inference = work.entry.declaration.inference;
            if (inference) model_calls += 1;
            try service.acquire(frame, work, reply);
            if (inference and model_calls == 8 and !restarted) {
                // No interpretation, receipt publication or World successor has
                // run after the raw control response became durable.
                const raw = (try namespace.store.recordBytes(frame, "capture", work.attempt, task)) orelse return error.MissingCapture;
                var capture = try agent.contracts.decodeOwned(CaptureRecord, frame, raw);
                defer capture.deinit();
                try std.testing.expect(capture.value.projection == null);
                try service.close(frame);
                service_live = false;
                try namespace.close();
                namespace_live = false;
                namespace = try native.Namespace.open(a, io, path);
                namespace_live = true;
                service = try native.tasks.Service(t).init(a, io, &namespace, assets, &application, handlers, profile);
                service_live = true;
                var current = try service.task(frame, task);
                defer current.deinit();
                _ = try service.resumeTask(frame, "adaptive-capture-resume", task, current.value.revision);
                restarted = true;
            }
        } else if (step == .waiting) {
            var question = (try service.pendingQuestion(frame, task)) orelse return error.MissingQuestion;
            defer question.deinit();
            _ = try service.respond(frame, "adaptive-recovery-answer", task, question.value.id, question.value.revision, question.value.request_digest, question.value.answer_schema_id.bytes, try native.values.toJson(t.Answer, frame, environment.demo_answer));
        }
    }
    try std.testing.expect(witnessed and finished);
    try std.testing.expectEqual(13, model_calls);
    std.debug.print("adaptive capture recovery: model_acquisitions={d} state_bytes_peak={d} prepared_bytes_peak={d} projection_and_step_scratch_peak={d} requested_memory_peak={d}\n", .{ model_calls, maximum_state, maximum_prepared, maximum_scratch, budget.peak });
    try service.close(a);
    service_live = false;
    try namespace.close();
    namespace_live = false;
    try narrowAttemptCeiling(a, io, assets, &application, handlers, configured, buffer[0..length]);
}

fn narrowAttemptCeiling(parent: std.mem.Allocator, io: std.Io, assets: native.discovery.Assets, application: *native.discovery.Application, handlers: native.Registry, original: native.configuration.Admitted, directory: []const u8) !void {
    var arena = std.heap.ArenaAllocator.init(parent);
    defer arena.deinit();
    const a = arena.allocator();
    var root = (try native.json.parse(a, original.bytes, .{ .bytes = 256 * 1024 })).value;
    try native.json.put(a, root.object.getPtr("adaptive").?, "model_attempts", try native.json.number(a, 1));
    const bytes = try native.json.canonical(a, root);
    const configured = try environment.configure(a, io, .{ .offline = true, .scratch_allocator = parent }, .{ .profile_id = original.id, .profile = bytes, .resources = original.resources }, assets);
    var grants: [environment.handlers.len]native.registry.Grant = undefined;
    const profile: native.tasks.Profile = .{ .id = configured.id, .runtime_identity = @splat(73), .bytes = configured.bytes, .environment = configured.environment, .resources = configured.resources, .authority = .{ .grants = &grants, .principal = "adaptive-unit", .tenant = "local", .inference = true } };
    for (&grants, handlers.entries) |*grant, entry| grant.* = .{ .identity = entry.declaration.identity, .resource_role = entry.declaration.resource_role, .resource_identity = try profile.resourceIdentity(application.image_identity) };
    const path = try std.fmt.allocPrint(a, "{s}/attempt-ceiling", .{directory});
    var namespace = try native.Namespace.open(parent, io, path);
    defer namespace.close() catch unreachable;
    var service = try native.tasks.Service(t).init(parent, io, &namespace, assets, application, handlers, profile);
    defer service.close(parent) catch unreachable;
    const task = (try service.submit(a, "one-attempt", environment.demo_input)).receipt.task;
    var unsent = false;
    for (0..128) |_| {
        var iteration = std.heap.ArenaAllocator.init(parent);
        defer iteration.deinit();
        const frame = iteration.allocator();
        var saved = try service.task(frame, task);
        defer saved.deinit();
        if (unsent and saved.value.blocker == .capacity) {
            try std.testing.expectEqual(1, saved.value.inference_attempts);
            return;
        }
        const step = try service.pump(frame);
        if (step != .work) continue;
        const work = step.work;
        if (work.entry.declaration.inference) {
            try std.testing.expect(!unsent);
            try service.notSent(frame, work);
            var stopped = try service.task(frame, task);
            defer stopped.deinit();
            _ = try service.resumeTask(frame, "retry-with-one-attempt-ceiling", task, stopped.value.revision);
            unsent = true;
        } else {
            var request = try protocol.decode(protocol.Request, frame, work.request);
            defer request.deinit();
            const ctx: native.Context = .{ .allocator = frame, .io = io, .authority = &profile.authority, .task_id = "one-attempt", .profile = profile.bytes, .environment = profile.environment };
            const reply = if (work.entry.declaration.capture) |adapter| (try adapter.acquire(ctx, work.prepared.?)).captured else try work.entry.declaration.invoke.?(ctx, request.value.binding.payload);
            try service.acquire(frame, work, reply);
        }
    }
    return error.MissingAttemptCeiling;
}
