//! Sole native task/occurrence mutation owner. Front ends submit ordinary typed
//! inputs; workers return acquired bytes. Neither can drive a World resident.
const std = @import("std");
const contracts = @import("agent_contracts");
const data = @import("boundary_data");
const state = @import("state.zig");
const occurrence = @import("occurrence.zig");
const storage = @import("store.zig");
const Namespace = @import("namespace.zig").Namespace;
const evaluator = @import("driver.zig");
const registry = @import("registry.zig");
const discovery = @import("discovery.zig");
const json = @import("json.zig");
const values = @import("values.zig");
const archive_api = @import("archive.zig");

pub const Profile = struct {
    id: []const u8,
    runtime_identity: state.Digest,
    /// Admitted immutable profile bytes, including concrete resource bindings.
    bytes: []const u8,
    authority: registry.Authority,
};
pub const Admission = struct { receipt: state.Receipt, replayed: bool };
pub const Status = state.Status;
pub const Work = struct {
    task: state.TaskId,
    occurrence: state.Digest,
    attempt: state.Digest,
    request: []const u8,
    prepared: ?[]const u8 = null,
    profile: []const u8 = &.{},
    entry: registry.Entry,
    cleanup: bool,
};
pub const Step = union(enum) { idle, progressed, waiting, work: Work };
const Active = struct { task: state.TaskId, execution_revision: u64, driver: *evaluator.Driver };

fn same(a: []const u8, b: []const u8) bool {
    return std.mem.eql(u8, a, b);
}
fn operation(comptime T: type, a: std.mem.Allocator, value: T) !state.Digest {
    const bytes = try contracts.encodeOwned(T, a, value);
    defer a.free(bytes);
    var hash = std.crypto.hash.sha2.Sha256.init(.{});
    hash.update("agent.native.operation.v1\x00");
    hash.update(bytes);
    var result: state.Digest = undefined;
    hash.final(&result);
    return result;
}
fn name(bytes: []const u8) !state.Name {
    if (bytes.len == 0 or bytes.len > 128 or !std.unicode.utf8ValidateSlice(bytes)) return error.InvalidParams;
    return .{ .bytes = bytes };
}
fn answerDigest(a: std.mem.Allocator, task_id: state.TaskId, question_id: state.Digest, revision: u64, request_digest: state.Digest, schema_id: []const u8, answer: []const u8) !state.Digest {
    const Request = struct { method: state.Method, task: state.TaskId, question: state.Digest, revision: u64, request: state.Digest, schema: state.Name, answer: contracts.Bytes(64 * 1024) };
    return operation(Request, a, .{ .method = .respond, .task = task_id, .question = question_id, .revision = revision, .request = request_digest, .schema = try name(schema_id), .answer = .{ .bytes = answer } });
}

pub fn Service(comptime Types: type) type {
    return struct {
        const Self = @This();
        allocator: std.mem.Allocator,
        io: std.Io,
        namespace: *Namespace,
        assets: discovery.Assets,
        application: *const discovery.Application,
        handlers: registry.Registry,
        profile: Profile,
        program: *evaluator.Program,
        active: ?Active = null,
        /// Only this process's explicit admissions/resumes are runnable. Merely
        /// opening a namespace never resumes a persisted task.
        runnable: std.ArrayList(state.TaskId) = .empty,
        owned: [16]?state.TaskId = @splat(null),
        work: ?Work = null,

        pub fn init(a: std.mem.Allocator, io: std.Io, namespace: *Namespace, assets: discovery.Assets, application: *const discovery.Application, handlers: registry.Registry, profile: Profile) !Self {
            _ = try name(profile.id);
            _ = try name(profile.authority.principal);
            if (profile.bytes.len > 256 * 1024 or profile.authority.revoked) return error.Denied;
            var self: Self = .{ .allocator = a, .io = io, .namespace = namespace, .assets = assets, .application = application, .handlers = handlers, .profile = profile, .program = try evaluator.Program.open(a, assets.image, 8 * 1024 * 1024) };
            errdefer self.program.close() catch unreachable;
            try self.recover(a);
            return self;
        }
        fn store(self: *Self) *storage.Store {
            return &self.namespace.store;
        }
        fn allowed(self: *Self) !void {
            if (self.profile.authority.revoked or !self.profile.authority.disclosure) return error.Denied;
            if (self.store().fenced) return error.StorageUnavailable;
        }
        pub fn task(self: *Self, a: std.mem.Allocator, id: state.TaskId) !contracts.Decoded(state.Task) {
            try self.allowed();
            const bytes = try self.store().taskBytes(a, id);
            defer a.free(bytes);
            var decoded = try contracts.decodeOwned(state.Task, a, bytes);
            errdefer decoded.deinit();
            if (!same(decoded.value.principal.bytes, self.profile.authority.principal) or !same(decoded.value.tenant.bytes, self.profile.authority.tenant)) return error.Denied;
            if (!same(&decoded.value.id, &id)) return error.CorruptState;
            return decoded;
        }
        pub fn pendingQuestion(self: *Self, a: std.mem.Allocator, id: state.TaskId) !?contracts.Decoded(state.Question) {
            var value = try self.task(a, id);
            defer value.deinit();
            const current = value.value.current_occurrence orelse return null;
            var saved = try self.record(occurrence.Occurrence, a, "occurrence", current, id);
            defer saved.deinit();
            const question_id = switch (saved.value.state) {
                .awaiting => |waiting| waiting.question,
                else => return null,
            };
            return try self.record(state.Question, a, "question", question_id, id);
        }
        pub fn status(self: *Self, a: std.mem.Allocator, value: state.Task) !Status {
            switch (value.outcome_kind) {
                .completed => return .completed,
                .failed => return .failed,
                .cancelled => return .cancelled,
                else => {},
            }
            if (value.current_occurrence) |id| {
                var saved = try self.record(occurrence.Occurrence, a, "occurrence", id, value.id);
                defer saved.deinit();
                if (saved.value.state == .unknown or (saved.value.state == .dispatching and (self.work == null or !same(&self.work.?.occurrence, &id)))) return .unknown;
                if (saved.value.state == .awaiting and (value.cancellation == null or value.cancellation_applied)) return .waiting_input;
            }
            if (value.blocker != null) return .blocked;
            if (value.cancellation != null) return .cancelling;
            for (self.runnable.items) |id| if (same(&id, &value.id)) return if (value.schedule == .queued) .queued else .running;
            return .parked;
        }
        fn recover(self: *Self, a: std.mem.Allocator) !void {
            const ids = try self.store().taskIds(a, true);
            defer a.free(ids);
            for (ids) |id| {
                var decoded = self.task(a, id) catch |err| switch (err) {
                    error.Denied => continue,
                    else => return err,
                };
                defer decoded.deinit();
                var value = decoded.value;
                const current = value.current_occurrence orelse continue;
                var saved = try self.record(occurrence.Occurrence, a, "occurrence", current, id);
                defer saved.deinit();
                if (saved.value.state != .dispatching) continue;
                const binding: occurrence.Binding = .{ .id = current, .task = id, .request = saved.value.request };
                const lost = try occurrence.unknown(saved.value, binding, saved.value.state.dispatching.id);
                const previous = value.revision;
                value.revision = try std.math.add(u64, previous, 1);
                value.schedule = .parked;
                value.blocker = .unavailable_environment;
                try self.store().begin();
                defer self.store().rollback();
                try self.store().putRecord(occurrence.Occurrence, "occurrence", current, id, lost);
                try self.event(&value, .delivery_unknown, "{}");
                try self.persist(value, previous, "process.recover-unknown");
            }
        }
        fn record(self: *Self, comptime T: type, a: std.mem.Allocator, comptime kind: []const u8, id: state.Digest, task_id: state.TaskId) !contracts.Decoded(T) {
            if (T != storage.Record(kind)) @compileError("native record type/kind mismatch");
            const bytes = (try self.store().recordBytes(a, kind, id, task_id)) orelse return error.CorruptState;
            defer a.free(bytes);
            return contracts.decodeOwned(T, a, bytes);
        }
        fn replay(self: *Self, a: std.mem.Allocator, id: []const u8, request: state.Digest) !?Admission {
            try self.allowed();
            _ = try name(id);
            const key = try self.operationKey(a, id);
            const bytes = (try self.store().receipt(a, &key, request)) orelse return null;
            defer a.free(bytes);
            var decoded = try contracts.decodeOwned(state.Receipt, a, bytes);
            defer decoded.deinit();
            var bound_task = try self.task(a, decoded.value.task);
            defer bound_task.deinit();
            var saved = decoded.value;
            saved.client_operation_id = .{ .bytes = try a.dupe(u8, saved.client_operation_id.bytes) };
            return .{ .receipt = saved, .replayed = true };
        }
        fn operationKey(self: *Self, a: std.mem.Allocator, id: []const u8) ![64]u8 {
            const Key = struct { principal: state.Name, tenant: state.Name, operation_id: state.Name };
            return std.fmt.bytesToHex(try operation(Key, a, .{ .principal = try name(self.profile.authority.principal), .tenant = try name(self.profile.authority.tenant), .operation_id = try name(id) }), .lower);
        }
        fn receipt(self: *Self, a: std.mem.Allocator, method: state.Method, id: []const u8, request: state.Digest, task_value: state.Task, disposition: state.Disposition, message_id: ?state.Digest, question: ?state.Digest) !Admission {
            var identity: state.Digest = undefined;
            try self.io.randomSecure(&identity);
            const saved: state.Receipt = .{ .id = identity, .client_operation_id = try name(id), .method = method, .request_digest = request, .task = task_value.id, .revision = task_value.revision, .disposition = disposition, .message = message_id, .question = question };
            const bytes = try contracts.encodeOwned(state.Receipt, a, saved);
            defer a.free(bytes);
            const key = try self.operationKey(a, id);
            try self.store().putReceipt(&key, request, bytes);
            return .{ .receipt = saved, .replayed = false };
        }
        fn event(self: *Self, value: *state.Task, kind: state.EventType, bytes: []const u8) !void {
            value.event_high = try std.math.add(u64, value.event_high, 1);
            try self.store().putEvent(.{ .task = value.id, .seq = value.event_high, .revision = value.revision, .kind = kind, .data = .{ .bytes = bytes } });
        }
        fn messageEvent(self: *Self, a: std.mem.Allocator, value: *state.Task, kind: state.EventType, item: state.Message) !void {
            var body = json.object();
            try json.put(a, &body, "message_id", json.string(try a.dupe(u8, &std.fmt.bytesToHex(item.id, .lower))));
            try json.put(a, &body, "ordinal", json.string(try std.fmt.allocPrint(a, "{d}", .{item.ordinal})));
            try json.put(a, &body, "disposition", json.string(@tagName(item.disposition)));
            const bytes = try json.canonical(a, body);
            defer a.free(bytes);
            try self.event(value, kind, bytes);
        }
        fn persist(self: *Self, value: state.Task, previous: u64, transition: []const u8) !void {
            try self.store().putTask(value, previous);
            try self.namespace.commit(transition);
        }
        fn runnableAdd(self: *Self, id: state.TaskId) !void {
            for (self.runnable.items) |item| if (same(&item, &id)) return;
            if (self.runnable.items.len == 16) return error.Capacity;
            try self.runnable.append(self.allocator, id);
        }
        fn claim(self: *Self, id: state.TaskId) void {
            for (self.owned) |slot| if (slot) |prior| if (same(&prior, &id)) return;
            for (&self.owned) |*slot| if (slot.* == null) {
                slot.* = id;
                return;
            };
            unreachable; // Namespace admission bounds all nonterminal tasks to 16.
        }
        fn unclaim(self: *Self, id: state.TaskId) void {
            for (&self.owned) |*slot| if (slot.*) |prior| if (same(&prior, &id)) {
                slot.* = null;
                return;
            };
        }
        fn runnableRemove(self: *Self, id: state.TaskId) void {
            for (self.runnable.items, 0..) |item, i| if (same(&item, &id)) {
                _ = self.runnable.orderedRemove(i);
                return;
            };
        }
        fn compatible(self: *Self, value: state.Task) !void {
            if (!same(value.application_id.bytes, Types.application_id) or
                !same(&value.profile.digest, &storage.digest(self.profile.bytes)) or !same(&value.image.digest, &storage.digest(self.assets.image)) or
                !same(&value.runtime_identity, &self.profile.runtime_identity)) return error.IncompatibleProfile;
        }
        fn retire(self: *Self, a: std.mem.Allocator) !void {
            if (self.active) |active| {
                const checkpoint = try active.driver.retire(a);
                a.free(checkpoint);
                try active.driver.destroy();
                self.active = null;
            }
        }
        fn resident(self: *Self, a: std.mem.Allocator, value: state.Task) !*evaluator.Driver {
            try self.compatible(value);
            if (self.active) |active| {
                if (same(&active.task, &value.id) and active.execution_revision == value.execution_revision) return active.driver;
                try self.retire(a);
            }
            const checkpoint = try self.store().object(a, value.checkpoint, 1024 * 1024);
            defer a.free(checkpoint);
            const driver = try evaluator.Driver.start(self.allocator, self.program, .{ .state = checkpoint }, 8 * 1024 * 1024);
            self.active = .{ .task = value.id, .execution_revision = value.execution_revision, .driver = driver };
            return driver;
        }

        pub fn submit(self: *Self, a: std.mem.Allocator, id: []const u8, input: Types.Input) !Admission {
            try self.allowed();
            var profile_digest = storage.digest(self.profile.bytes);
            const key = try self.operationKey(a, id);
            if (try self.store().savedReceipt(a, &key)) |bytes| {
                defer a.free(bytes);
                var saved = try contracts.decodeOwned(state.Receipt, a, bytes);
                defer saved.deinit();
                if (saved.value.method == .submit) {
                    var original = try self.task(a, saved.value.task);
                    defer original.deinit();
                    // The original alias is resolved only on first admission.
                    // Retrying it after a launch configuration change recovers
                    // the original receipt and cannot rebind the existing task.
                    if (same(original.value.profile_id.bytes, self.profile.id)) profile_digest = original.value.profile.digest;
                }
            }
            const Request = struct { method: state.Method, application: state.Name, profile_digest: state.Digest, input: Types.Input };
            const request = try operation(Request, a, .{ .method = .submit, .application = try name(Types.application_id), .profile_digest = profile_digest, .input = input });
            if (try self.replay(a, id, request)) |prior| return prior;
            const ids = try self.store().taskIds(a, true);
            defer a.free(ids);
            if (ids.len >= 16) return error.Capacity;
            // Reserve scheduling capacity before making acceptance durable.
            try self.runnable.ensureUnusedCapacity(self.allocator, 1);
            try self.retire(a);
            var task_id: state.TaskId = undefined;
            try self.io.randomSecure(&task_id);
            const input_bytes = try contracts.encodeOwned(Types.Input, a, input);
            defer a.free(input_bytes);
            const driver = try evaluator.Driver.start(self.allocator, self.program, .{ .initial_args = input_bytes }, 8 * 1024 * 1024);
            self.active = .{ .task = task_id, .execution_revision = 0, .driver = driver };
            errdefer self.retire(a) catch {
                self.store().fenced = true;
            };
            const outcome = try driver.drive(a, .none, 0);
            defer a.free(outcome);
            const checkpoint = try driver.checkpoint(a);
            defer a.free(checkpoint);
            if (checkpoint.len > 1024 * 1024) return error.Capacity;
            try self.store().begin();
            defer self.store().rollback();
            const value: state.Task = .{
                .id = task_id,
                .application_id = try name(Types.application_id),
                .input_schema_id = try name(Types.input_schema_id),
                .output_schema_id = try name(Types.output_schema_id),
                .failure_schema_id = try name(Types.failure_schema_id),
                .message_schema_id = try name(Types.message_schema_id),
                .principal = try name(self.profile.authority.principal),
                .tenant = try name(self.profile.authority.tenant),
                .profile_id = try name(self.profile.id),
                .profile = try self.store().putObject(self.profile.bytes),
                .image = try self.store().putObject(self.assets.image),
                .runtime_identity = self.profile.runtime_identity,
                .input = try self.store().putObject(input_bytes),
                .checkpoint = try self.store().putObject(checkpoint),
                .outcome = try self.store().putObject(outcome),
                .outcome_kind = .progressed,
                .current_occurrence = null,
                .revision = 1,
                .execution_revision = 0,
                .schedule = .queued,
                .cancellation = null,
                .cancellation_applied = false,
                .blocker = null,
                .result = null,
                .client_result = null,
                .result_artifact = null,
                .event_floor = 1,
                .event_high = 1,
                .next_message = 1,
                .messages = .{ .items = &.{} },
                .inference_attempts = 0,
                .inference_request_bytes = 0,
                .inference_output_tokens = 0,
                .evidence_bytes = 0,
            };
            // Establish the referenced task before its foreign-keyed events.
            try self.store().putTask(value, null);
            try self.store().putEvent(.{ .task = task_id, .seq = 1, .revision = 1, .kind = .accepted, .data = .{ .bytes = "{}" } });
            const admitted = try self.receipt(a, .submit, id, request, value, .accepted, null, null);
            try self.namespace.commit("task.submit");
            self.runnable.appendAssumeCapacity(task_id);
            self.claim(task_id);
            return admitted;
        }

        pub fn requestCancel(self: *Self, a: std.mem.Allocator, id: []const u8, task_id: state.TaskId, reason: []const u8) !Admission {
            if (reason.len > 256 or !std.unicode.utf8ValidateSlice(reason)) return error.InvalidParams;
            const Request = struct { method: state.Method, task: state.TaskId, reason: state.Reason };
            const request = try operation(Request, a, .{ .method = .cancel, .task = task_id, .reason = .{ .bytes = reason } });
            if (try self.replay(a, id, request)) |prior| return prior;
            var decoded = try self.task(a, task_id);
            defer decoded.deinit();
            var value = decoded.value;
            const previous = value.revision;
            try self.runnable.ensureUnusedCapacity(self.allocator, 1);
            value.revision = try std.math.add(u64, previous, 1);
            if (!value.terminal() and value.cancellation == null) value.cancellation = .{ .bytes = reason };
            try self.store().begin();
            defer self.store().rollback();
            try self.event(&value, .cancellation_requested, "{}");
            const admitted = try self.receipt(a, .cancel, id, request, value, .cancellation_requested, null, null);
            try self.persist(value, previous, "task.cancel");
            if (!value.terminal()) {
                try self.runnableAdd(task_id);
                self.claim(task_id);
            }
            return admitted;
        }

        pub fn resumeTask(self: *Self, a: std.mem.Allocator, id: []const u8, task_id: state.TaskId, expected: u64) !Admission {
            const Request = struct { method: state.Method, task: state.TaskId, revision: u64 };
            const request = try operation(Request, a, .{ .method = .@"resume", .task = task_id, .revision = expected });
            if (try self.replay(a, id, request)) |prior| return prior;
            var decoded = try self.task(a, task_id);
            defer decoded.deinit();
            var value = decoded.value;
            try self.compatible(value);
            if (value.revision != expected) return error.StaleRevision;
            if (value.terminal()) return error.TerminalTask;
            var rearmed: ?occurrence.Occurrence = null;
            if (value.current_occurrence) |current| {
                var saved = try self.record(occurrence.Occurrence, a, "occurrence", current, task_id);
                defer saved.deinit();
                if (saved.value.state == .unknown or saved.value.state == .dispatching) return error.UnsettledOccurrence;
                if (saved.value.state == .not_sent) rearmed = try occurrence.rearm(saved.value, .{ .id = current, .task = task_id, .request = saved.value.request });
            }
            try self.runnable.ensureUnusedCapacity(self.allocator, 1);
            value.revision = try std.math.add(u64, value.revision, 1);
            value.schedule = .queued;
            value.blocker = null;
            try self.store().begin();
            defer self.store().rollback();
            if (rearmed) |pending| try self.store().putRecord(occurrence.Occurrence, "occurrence", pending.id, task_id, pending);
            try self.event(&value, .resumed, "{}");
            const admitted = try self.receipt(a, .@"resume", id, request, value, .resumed, null, null);
            try self.persist(value, expected, "task.resume");
            try self.runnableAdd(task_id);
            self.claim(task_id);
            return admitted;
        }

        pub fn message(self: *Self, a: std.mem.Allocator, id: []const u8, task_id: state.TaskId, input: Types.Message) !Admission {
            const Request = struct { method: state.Method, task: state.TaskId, schema: state.Name, value: Types.Message };
            const request = try operation(Request, a, .{ .method = .message, .task = task_id, .schema = try name(Types.message_schema_id), .value = input });
            if (try self.replay(a, id, request)) |prior| return prior;
            var decoded = try self.task(a, task_id);
            defer decoded.deinit();
            var value = decoded.value;
            if (value.terminal() or value.cancellation != null) return error.TerminalTask;
            var supported = false;
            for (self.handlers.entries) |entry| supported = supported or entry.declaration.kind == .inbox;
            if (!supported) return error.UnsupportedCapability;
            if (value.messages.items.len >= 16) return error.Capacity;
            const bytes = try contracts.encodeOwned(Types.Message, a, input);
            defer a.free(bytes);
            var queued_bytes: u64 = bytes.len;
            for (value.messages.items) |message_id| {
                var saved = try self.record(state.Message, a, "message", message_id, task_id);
                defer saved.deinit();
                queued_bytes = try std.math.add(u64, queued_bytes, saved.value.value.bytes);
            }
            if (queued_bytes > 256 * 1024) return error.Capacity;
            var identity: state.Digest = undefined;
            try self.io.randomSecure(&identity);
            const previous = value.revision;
            value.revision = try std.math.add(u64, previous, 1);
            const ordinal = value.next_message;
            value.next_message = try std.math.add(u64, ordinal, 1);
            const queue = try a.alloc(state.Digest, value.messages.items.len + 1);
            defer a.free(queue);
            @memcpy(queue[0..value.messages.items.len], value.messages.items);
            queue[queue.len - 1] = identity;
            value.messages = .{ .items = queue };
            try self.store().begin();
            defer self.store().rollback();
            const saved: state.Message = .{ .id = identity, .task = task_id, .ordinal = ordinal, .schema_id = try name(Types.message_schema_id), .value = try self.store().putObject(bytes), .disposition = .queued, .occurrence = null };
            try self.store().createRecord(state.Message, "message", identity, task_id, saved);
            try self.messageEvent(a, &value, .message_queued, saved);
            const admitted = try self.receipt(a, .message, id, request, value, .queued, identity, null);
            try self.persist(value, previous, "task.message");
            return admitted;
        }

        pub fn respond(self: *Self, a: std.mem.Allocator, id: []const u8, task_id: state.TaskId, question_id: state.Digest, revision: u64, request_digest: state.Digest, schema_id: []const u8, answer_json: json.Value) !Admission {
            var decoded = try self.task(a, task_id);
            defer decoded.deinit();
            var value = decoded.value;
            var question_decoded = try self.record(state.Question, a, "question", question_id, task_id);
            defer question_decoded.deinit();
            var question = question_decoded.value;
            if (question.revision != revision or !same(&question.request_digest, &request_digest) or !same(question.answer_schema_id.bytes, schema_id)) return error.StaleInteraction;
            var answer_bytes: ?[]u8 = null;
            defer if (answer_bytes) |bytes| a.free(bytes);
            for (self.handlers.entries) |entry| {
                if (entry.declaration.kind == .question and same(entry.declaration.answer_schema_id.?, schema_id) and same(&storage.digest(entry.resume_schema), &question.answer_schema_digest)) {
                    answer_bytes = try entry.declaration.answer.?(a, answer_json);
                    break;
                }
            }
            const answer = answer_bytes orelse return error.IncompatibleProfile;
            const request = try answerDigest(a, task_id, question_id, revision, request_digest, schema_id, answer);
            if (try self.replay(a, id, request)) |prior| return prior;
            if (question.answer) |saved_answer| {
                if (!same(&saved_answer.digest, &storage.digest(answer))) return error.AnswerConflict;
                const original = question.receipt orelse return error.CorruptState;
                const bytes = try contracts.encodeOwned(state.Receipt, a, original);
                defer a.free(bytes);
                const key = try self.operationKey(a, id);
                try self.store().begin();
                defer self.store().rollback();
                try self.store().putReceipt(&key, request, bytes);
                try self.namespace.commit("task.respond.replay");
                var retained = original;
                retained.client_operation_id = .{ .bytes = try a.dupe(u8, original.client_operation_id.bytes) };
                return .{ .receipt = retained, .replayed = true };
            }
            if (question.retired or value.terminal() or (value.cancellation != null and !value.cancellation_applied) or value.current_occurrence == null or !same(&value.current_occurrence.?, &question.occurrence)) return error.StaleInteraction;
            const original_request = try self.store().object(a, question.request, 4 * 1024 * 1024);
            defer a.free(original_request);
            var admitted_request = try data.invocation.decode(data.invocation.Request, a, original_request);
            defer admitted_request.deinit();
            _ = try self.handlers.admit(admitted_request.value, self.profile.authority, self.application.image_identity);
            var pending = try self.record(occurrence.Occurrence, a, "occurrence", question.occurrence, task_id);
            defer pending.deinit();
            const bound = try data.invocation.encodeOwned(data.invocation.Result, a, .{ .request_identity = question.request_digest, .value = answer });
            defer a.free(bound);
            const binding: occurrence.Binding = .{ .id = pending.value.id, .task = task_id, .request = pending.value.request };
            const acquired = try occurrence.answered(pending.value, binding, question_id, question.pending_digest, storage.digest(answer), storage.digest(bound), false);
            try self.runnable.ensureUnusedCapacity(self.allocator, 1);
            const previous = value.revision;
            value.revision = try std.math.add(u64, previous, 1);
            value.schedule = .queued;
            try self.store().begin();
            defer self.store().rollback();
            question.answer = try self.store().putObject(answer);
            _ = try self.store().putObject(bound);
            try self.store().putRecord(occurrence.Occurrence, "occurrence", acquired.id, task_id, acquired);
            try self.event(&value, .input_accepted, "{}");
            const admitted = try self.receipt(a, .respond, id, request, value, .answer_acquired, null, question_id);
            question.receipt = admitted.receipt;
            try self.store().putRecord(state.Question, "question", question_id, task_id, question);
            try self.persist(value, previous, "task.respond");
            try self.runnableAdd(task_id);
            self.claim(task_id);
            return admitted;
        }

        fn blocked(self: *Self, a: std.mem.Allocator, initial: state.Task, blocker: state.Blocker) !Step {
            var value = initial;
            value.revision = try std.math.add(u64, value.revision, 1);
            value.blocker = blocker;
            value.schedule = .parked;
            try self.store().begin();
            defer self.store().rollback();
            try self.event(&value, .blocked, "{}");
            try self.persist(value, initial.revision, "task.blocked");
            self.runnableRemove(value.id);
            try self.retire(a);
            return .waiting;
        }

        /// At most one bounded World quantum or one durable environmental
        /// transition. The caller services its control channel between calls.
        pub fn pump(self: *Self, a: std.mem.Allocator) !Step {
            try self.allowed();
            if (self.work != null or self.runnable.items.len == 0) return .idle;
            const id = self.runnable.items[0];
            var decoded = try self.task(a, id);
            defer decoded.deinit();
            const value = decoded.value;
            if (value.terminal()) {
                self.runnableRemove(id);
                self.unclaim(id);
                return .progressed;
            }
            self.compatible(value) catch return self.blocked(a, value, .incompatible_profile);
            var current: ?contracts.Decoded(occurrence.Occurrence) = null;
            defer if (current) |*item| item.deinit();
            if (value.current_occurrence) |identity| current = try self.record(occurrence.Occurrence, a, "occurrence", identity, id);
            var control: data.invocation.Control = .none;
            var consumed: ?occurrence.Occurrence = null;
            var reply: ?[]u8 = null;
            defer if (reply) |bytes| a.free(bytes);
            if (current) |item| {
                const pending = item.value;
                const binding: occurrence.Binding = .{ .id = pending.id, .task = id, .request = pending.request };
                switch (pending.state) {
                    .captured => return self.interpretCapture(a, value, pending),
                    .unknown, .dispatching => return self.blocked(a, value, .unavailable_environment),
                    .settled_reply => |acquired| {
                        reply = try self.store().acquiredObject(a, acquired.reply, 4 * 1024 * 1024);
                        consumed = try occurrence.consumed(pending, binding, .{ .reply = acquired.reply }, value.cancellation != null);
                        control = .{ .reply = reply.? };
                    },
                    .ready, .awaiting, .not_sent => {
                        if (value.cancellation != null and !value.cancellation_applied) {
                            consumed = try occurrence.consumed(pending, binding, .cancel, true);
                            control = .{ .cancel = .{ .text = value.cancellation.?.bytes } };
                        } else if (pending.state == .awaiting or pending.state == .not_sent) {
                            self.runnableRemove(id);
                            try self.retire(a);
                            return .waiting;
                        } else return self.dispatch(a, value, pending);
                    },
                    .admitted => return error.CorruptState,
                }
            } else if (value.cancellation != null and !value.cancellation_applied) {
                control = .{ .cancel = .{ .text = value.cancellation.?.bytes } };
            } else if (value.outcome_kind == .yielded) {
                control = .resume_yield;
            }
            return self.advance(a, value, control, consumed);
        }

        fn advance(self: *Self, a: std.mem.Allocator, initial: state.Task, control: data.invocation.Control, consumed: ?occurrence.Occurrence) !Step {
            const driver = try self.resident(a, initial);
            const quantum: u64 = if (control == .reply and initial.cancellation != null and !initial.cancellation_applied) 0 else 256;
            const encoded = try driver.drive(a, control, quantum);
            defer a.free(encoded);
            // World may now be ahead of storage. Any failure below fences all
            // further effects; restart uses the old checkpoint and saved reply.
            errdefer self.store().fenced = true;
            var outcome = try data.invocation.decode(data.invocation.Outcome, a, encoded);
            defer outcome.deinit();
            if (outcome.value == .needs_capacity) return error.Capacity;
            const checkpoint = try driver.checkpoint(a);
            defer a.free(checkpoint);
            if (checkpoint.len > 1024 * 1024 or encoded.len > 4 * 1024 * 1024) return error.Capacity;
            var value = initial;
            value.revision = try std.math.add(u64, value.revision, 1);
            value.execution_revision = try std.math.add(u64, value.execution_revision, 1);
            value.current_occurrence = null;
            value.schedule = .active;
            value.blocker = null;
            if (control == .cancel) value.cancellation_applied = true;
            try self.store().begin();
            defer self.store().rollback();
            value.checkpoint = try self.store().putObject(checkpoint);
            value.outcome = try self.store().putObject(encoded);
            if (consumed) |prior| {
                try self.store().putRecord(occurrence.Occurrence, "occurrence", prior.id, value.id, prior);
                if (prior.state.admitted == .reply) try self.store().releaseReservation(prior.state.admitted.reply.attempt);
                const question_id: ?state.Digest = switch (prior.state.admitted) {
                    .reply => |acquired| if (acquired.answer) |answer| answer.question else null,
                    .cancelled => |waiting| if (waiting) |question| question.question else null,
                };
                if (question_id) |id| {
                    var saved = try self.record(state.Question, a, "question", id, value.id);
                    defer saved.deinit();
                    saved.value.retired = true;
                    try self.store().putRecord(state.Question, "question", id, value.id, saved.value);
                }
                if (value.messages.items.len != 0) {
                    const message_id = value.messages.items[0];
                    var saved = try self.record(state.Message, a, "message", message_id, value.id);
                    defer saved.deinit();
                    if (saved.value.disposition == .acquired and saved.value.occurrence != null and same(&saved.value.occurrence.?, &prior.id)) {
                        saved.value.disposition = .consumed;
                        try self.store().putRecord(state.Message, "message", message_id, value.id, saved.value);
                        value.messages.items = value.messages.items[1..];
                        try self.messageEvent(a, &value, .message_consumed, saved.value);
                    }
                }
            }
            switch (outcome.value) {
                .progressed => value.outcome_kind = .progressed,
                .yielded => value.outcome_kind = .yielded,
                .requested => |pending| {
                    var request = try data.invocation.decode(data.invocation.Request, a, pending.request);
                    defer request.deinit();
                    var id: state.Digest = undefined;
                    try self.io.randomSecure(&id);
                    const next: occurrence.Occurrence = .{ .id = id, .task = value.id, .request = request.value.request_identity };
                    _ = try self.store().putObject(pending.request);
                    try self.store().createRecord(occurrence.Occurrence, "occurrence", id, value.id, next);
                    value.current_occurrence = id;
                    value.outcome_kind = .requested;
                },
                .completed => |bytes| {
                    var checked = try contracts.decodeOwned(Types.Output, a, bytes);
                    defer checked.deinit();
                    value.outcome_kind = .completed;
                    value.result = try self.store().putObject(bytes);
                    try self.clientResult(Types.Output, a, &value, Types.output_schema_id, checked.value);
                    try self.event(&value, .completed, "{}");
                },
                .failed => |failure| {
                    var checked = try contracts.decodeOwned(Types.Failure, a, failure.value);
                    defer checked.deinit();
                    value.outcome_kind = .failed;
                    value.result = value.outcome;
                    try self.clientResult(Types.Failure, a, &value, Types.failure_schema_id, checked.value);
                    try self.event(&value, .failed, "{}");
                },
                .cancelled => {
                    value.outcome_kind = .cancelled;
                    value.result = value.outcome;
                    try self.event(&value, .cancelled, "{}");
                },
                .needs_capacity => unreachable,
            }
            if (value.terminal()) {
                value.schedule = .parked;
                for (value.messages.items) |id| {
                    var saved = try self.record(state.Message, a, "message", id, value.id);
                    defer saved.deinit();
                    saved.value.disposition = .not_consumed;
                    try self.store().putRecord(state.Message, "message", id, value.id, saved.value);
                    try self.messageEvent(a, &value, .message_not_consumed, saved.value);
                }
                value.messages.items = &.{};
            }
            try self.persist(value, initial.revision, "world.advance");
            self.active.?.execution_revision = value.execution_revision;
            if (value.terminal()) {
                try driver.close();
                try driver.destroy();
                self.active = null;
                self.runnableRemove(value.id);
                self.unclaim(value.id);
            }
            return .progressed;
        }
        fn clientResult(self: *Self, comptime T: type, a: std.mem.Allocator, value: *state.Task, schema_id: []const u8, result: T) !void {
            const bytes = try json.canonical(a, try values.toJson(T, a, result));
            defer a.free(bytes);
            if (bytes.len > 4 * 1024 * 1024) return error.Capacity;
            value.client_result = try self.store().putObject(bytes);
            if (bytes.len > 60 * 1024) {
                var id: state.Digest = undefined;
                try self.io.randomSecure(&id);
                const artifact: state.Artifact = .{ .id = id, .task = value.id, .value = value.client_result.?, .media_type = .{ .bytes = "application/json" }, .schema_id = try name(schema_id) };
                try self.store().createRecord(state.Artifact, "artifact", id, value.id, artifact);
                value.result_artifact = id;
            }
        }

        fn dispatch(self: *Self, a: std.mem.Allocator, initial: state.Task, pending: occurrence.Occurrence) !Step {
            const bytes = try self.store().object(a, initial.outcome, 4 * 1024 * 1024);
            defer a.free(bytes);
            var outcome = try data.invocation.decode(data.invocation.Outcome, a, bytes);
            defer outcome.deinit();
            if (outcome.value != .requested) return error.CorruptState;
            const request_bytes = outcome.value.requested.request;
            var request = try data.invocation.decode(data.invocation.Request, a, request_bytes);
            defer request.deinit();
            if (!same(&request.value.request_identity, &pending.request)) return error.CorruptState;
            const entry = self.handlers.admit(request.value, self.profile.authority, self.application.image_identity) catch |err|
                return self.blocked(a, initial, if (err == error.Denied) .denied else .missing_capability);
            var attempt: state.Digest = undefined;
            try self.io.randomSecure(&attempt);
            const binding: occurrence.Binding = .{ .id = pending.id, .task = pending.task, .request = pending.request };
            const dispatched = try occurrence.dispatch(pending, binding, attempt, initial.cancellation != null, initial.cancellation_applied);
            var value = initial;
            value.revision = try std.math.add(u64, value.revision, 1);
            value.schedule = .active;
            const task_name = std.fmt.bytesToHex(value.id, .lower);
            const ctx: registry.Context = .{ .allocator = a, .io = self.io, .authority = &self.profile.authority, .task_id = &task_name };
            switch (entry.declaration.kind) {
                .question => {
                    const prompt = try json.canonical(a, try entry.declaration.present.?(ctx, request.value.binding.payload));
                    defer a.free(prompt);
                    if (prompt.len > 32 * 1024) return self.blocked(a, initial, .capacity);
                    var question_id: state.Digest = undefined;
                    try self.io.randomSecure(&question_id);
                    const waiting = try occurrence.awaiting(pending, binding, .{ .attempt = attempt, .question = question_id, .pending_digest = request.value.binding.pending_state_digest }, initial.cancellation != null and !initial.cancellation_applied);
                    try self.store().begin();
                    defer self.store().rollback();
                    const question: state.Question = .{ .id = question_id, .task = value.id, .occurrence = pending.id, .revision = 1, .request_digest = pending.request, .pending_digest = request.value.binding.pending_state_digest, .answer_schema_id = try name(entry.declaration.answer_schema_id.?), .answer_schema_digest = storage.digest(entry.resume_schema), .request = try self.store().putObject(request_bytes), .prompt = try self.store().putObject(prompt), .answer = null, .receipt = null, .retired = false };
                    try self.store().createRecord(state.Question, "question", question_id, value.id, question);
                    try self.store().putRecord(occurrence.Occurrence, "occurrence", pending.id, value.id, waiting);
                    var event_data = json.object();
                    try json.put(a, &event_data, "question_id", json.string(try a.dupe(u8, &std.fmt.bytesToHex(question_id, .lower))));
                    try json.put(a, &event_data, "question_revision", json.string("1"));
                    try json.put(a, &event_data, "request_digest", json.string(try a.dupe(u8, &std.fmt.bytesToHex(pending.request, .lower))));
                    try json.put(a, &event_data, "answer_schema_id", json.string(question.answer_schema_id.bytes));
                    try json.put(a, &event_data, "prompt", (try json.parse(a, prompt, .{})).value);
                    const event_bytes = try json.canonical(a, event_data);
                    defer a.free(event_bytes);
                    try self.event(&value, .input_required, event_bytes);
                    try self.persist(value, initial.revision, "question.awaiting");
                    self.runnableRemove(value.id);
                    try self.retire(a);
                    return .waiting;
                },
                .inbox => {
                    var message_decoded: ?contracts.Decoded(state.Message) = null;
                    defer if (message_decoded) |*item| item.deinit();
                    var message_value: ?contracts.Decoded(Types.Message) = null;
                    defer if (message_value) |*item| item.deinit();
                    var input: contracts.InboxReply(Types.Message) = .empty;
                    var message_name: [64]u8 = undefined;
                    if (value.messages.items.len != 0) {
                        message_decoded = try self.record(state.Message, a, "message", value.messages.items[0], value.id);
                        const saved = &message_decoded.?.value;
                        if (saved.disposition != .queued or saved.occurrence != null) return error.CorruptState;
                        const message_bytes = try self.store().object(a, saved.value, 256 * 1024);
                        defer a.free(message_bytes);
                        message_value = try contracts.decodeOwned(Types.Message, a, message_bytes);
                        message_name = std.fmt.bytesToHex(saved.id, .lower);
                        input = .{ .message = .{ .id = .{ .bytes = &message_name }, .value = message_value.?.value } };
                        saved.disposition = .acquired;
                        saved.occurrence = pending.id;
                    }
                    const payload = try contracts.encodeOwned(contracts.InboxReply(Types.Message), a, input);
                    defer a.free(payload);
                    const bound = try data.invocation.encodeOwned(data.invocation.Result, a, .{ .request_identity = pending.request, .value = payload });
                    defer a.free(bound);
                    const acquired = try occurrence.acquired(dispatched, binding, attempt, storage.digest(bound));
                    try self.store().begin();
                    defer self.store().rollback();
                    _ = try self.store().putObject(bound);
                    if (message_decoded) |saved| try self.store().putRecord(state.Message, "message", saved.value.id, value.id, saved.value);
                    try self.store().putRecord(occurrence.Occurrence, "occurrence", pending.id, value.id, acquired);
                    try self.persist(value, initial.revision, "inbox.acquire");
                    return .progressed;
                },
                .leaf => {
                    var preparation = std.heap.ArenaAllocator.init(a);
                    defer preparation.deinit();
                    const prepared = if (entry.declaration.capture) |adapter| adapter.prepare(self.projectionContext(preparation.allocator(), value), request.value.binding.payload) catch |err|
                        return self.blocked(a, initial, switch (err) {
                            error.Capacity, error.OutOfMemory => .capacity,
                            error.MissingArtifact, error.CorruptObject => .missing_artifact,
                            else => .incompatible_profile,
                        }) else null;
                    if (prepared) |body| if (body.len > 2 * 1024 * 1024) return self.blocked(a, initial, .capacity);
                    const charged_bytes = if (prepared) |body| body.len else request_bytes.len;
                    if (entry.declaration.inference) {
                        if (value.inference_attempts >= 16 or value.inference_request_bytes + charged_bytes > 8 * 1024 * 1024) return self.blocked(a, initial, .capacity);
                        value.inference_attempts += 1;
                        value.inference_request_bytes += charged_bytes;
                    }
                    const retained = try self.allocator.dupe(u8, request_bytes);
                    errdefer self.allocator.free(retained);
                    const retained_prepared = if (prepared) |body| try self.allocator.dupe(u8, body) else null;
                    errdefer if (retained_prepared) |body| self.allocator.free(body);
                    const retained_profile = try self.allocator.dupe(u8, self.profile.bytes);
                    errdefer self.allocator.free(retained_profile);
                    const work: Work = .{ .task = value.id, .occurrence = pending.id, .attempt = attempt, .request = retained, .prepared = retained_prepared, .profile = retained_profile, .entry = entry, .cleanup = value.cancellation_applied };
                    try self.store().begin();
                    defer self.store().rollback();
                    try self.store().reserve(attempt);
                    try self.store().createRecord(state.Attempt, "attempt", attempt, value.id, .{ .id = attempt, .task = value.id, .occurrence = pending.id, .request = try self.store().putObject(request_bytes), .profile = value.profile, .capability = try name(entry.declaration.identity), .inference = entry.declaration.inference, .prepared = if (prepared) |body| try self.store().putObject(body) else null });
                    try self.store().putRecord(occurrence.Occurrence, "occurrence", pending.id, value.id, dispatched);
                    try self.persist(value, initial.revision, "effect.dispatch");
                    self.work = work;
                    return .{ .work = work };
                },
            }
        }

        fn projectionContext(self: *Self, a: std.mem.Allocator, value: state.Task) registry.ProjectionContext {
            return .{ .allocator = a, .task = value.id, .tenant = value.tenant.bytes, .profile = self.profile.bytes, .objects = .{ .owner = self.store(), .read = struct {
                fn read(owner: *anyopaque, allocator: std.mem.Allocator, ref: state.Reference, limit: usize) ![]u8 {
                    const objects: *storage.Store = @ptrCast(@alignCast(owner));
                    return objects.object(allocator, ref, limit);
                }
            }.read } };
        }

        fn capture(self: *Self, a: std.mem.Allocator, work: Work, raw: []const u8) !void {
            defer self.releaseWork();
            errdefer self.store().fenced = true;
            // The initial native profile keeps captured bytes within its
            // existing durable acquisition reservation.
            if (raw.len > 4 * 1024 * 1024 or work.prepared == null) return error.Capacity;
            var decoded = try self.task(a, work.task);
            defer decoded.deinit();
            var value = decoded.value;
            var saved = try self.record(occurrence.Occurrence, a, "occurrence", work.occurrence, work.task);
            defer saved.deinit();
            const next = try occurrence.captured(saved.value, .{ .id = work.occurrence, .task = work.task, .request = saved.value.request }, work.attempt);
            const previous = value.revision;
            value.revision = try std.math.add(u64, previous, 1);
            try self.store().begin();
            defer self.store().rollback();
            try self.store().createRecord(state.Capture, "capture", work.attempt, work.task, .{
                .task = work.task,
                .occurrence = work.occurrence,
                .attempt = work.attempt,
                .request = try self.store().putObject(work.prepared.?),
                .response = try self.store().putObject(raw),
                .disposition = .complete,
            });
            try self.store().reserveAcquired(work.attempt);
            try self.store().putRecord(occurrence.Occurrence, "occurrence", work.occurrence, work.task, next);
            try self.persist(value, previous, "effect.capture");
        }

        fn interpretCapture(self: *Self, a: std.mem.Allocator, initial: state.Task, pending: occurrence.Occurrence) !Step {
            const attempt_id = pending.state.captured.id;
            var attempt = try self.record(state.Attempt, a, "attempt", attempt_id, initial.id);
            defer attempt.deinit();
            var raw = try self.record(state.Capture, a, "capture", attempt_id, initial.id);
            defer raw.deinit();
            if (raw.value.disposition != .complete or raw.value.response == null or attempt.value.prepared == null or
                !same(&attempt.value.occurrence, &pending.id) or !same(&raw.value.occurrence, &pending.id) or
                !same(&attempt.value.profile.digest, &initial.profile.digest) or
                !std.meta.eql(attempt.value.prepared.?, raw.value.request)) return error.CorruptState;
            const encoded = try self.store().object(a, attempt.value.request, 4 * 1024 * 1024);
            defer a.free(encoded);
            var request = try data.invocation.decode(data.invocation.Request, a, encoded);
            defer request.deinit();
            if (!same(&request.value.request_identity, &pending.request)) return error.CorruptState;
            // Resolve the original schemas without acquiring another I/O grant.
            const entry = try self.handlers.resolve(request.value, self.application.image_identity);
            const adapter = entry.declaration.capture orelse return error.IncompatibleProfile;
            const rendered = try self.store().object(a, raw.value.request, 2 * 1024 * 1024);
            defer a.free(rendered);
            const response = try self.store().object(a, raw.value.response.?, 4 * 1024 * 1024);
            defer a.free(response);
            var projection_arena = std.heap.ArenaAllocator.init(a);
            defer projection_arena.deinit();
            const result = adapter.interpret(self.projectionContext(projection_arena.allocator(), initial), request.value.binding.payload, rendered, response) catch
                return self.blocked(a, initial, .unavailable_environment);
            if (result.reply.len > 1024 * 1024 or result.objects.len > 16) return self.blocked(a, initial, .capacity);
            var total: usize = 0;
            for (result.objects) |object| {
                total = std.math.add(usize, total, object.len) catch return self.blocked(a, initial, .capacity);
                if (total > 2 * 1024 * 1024) return self.blocked(a, initial, .capacity);
            }
            var schema = try data.schema.decode(a, entry.resume_schema);
            defer schema.deinit();
            data.schema.validateValue(a, schema.descriptor, result.reply) catch return self.blocked(a, initial, .unavailable_environment);
            const bound = try data.invocation.encodeOwned(data.invocation.Result, a, .{ .request_identity = pending.request, .value = result.reply });
            defer a.free(bound);
            const next = try occurrence.acquired(pending, .{ .id = pending.id, .task = initial.id, .request = pending.request }, attempt_id, storage.digest(bound));
            var value = initial;
            value.revision = try std.math.add(u64, value.revision, 1);
            if (entry.declaration.inference) if (result.output_tokens) |tokens| {
                value.inference_output_tokens = std.math.add(u64, value.inference_output_tokens, tokens) catch return self.blocked(a, initial, .capacity);
            };
            try self.store().begin();
            defer self.store().rollback();
            _ = try self.store().putObject(bound);
            for (result.objects) |object| _ = try self.store().putObject(object);
            try self.store().putRecord(occurrence.Occurrence, "occurrence", pending.id, initial.id, next);
            try self.persist(value, initial.revision, "effect.interpret");
            return .progressed;
        }

        fn currentWork(self: *Self, work: Work) !void {
            const current = self.work orelse return error.StaleOccurrence;
            if (!same(&current.task, &work.task) or !same(&current.occurrence, &work.occurrence) or !same(&current.attempt, &work.attempt)) return error.StaleOccurrence;
        }
        fn releaseWork(self: *Self) void {
            self.allocator.free(self.work.?.request);
            if (self.work.?.prepared) |body| self.allocator.free(body);
            self.allocator.free(self.work.?.profile);
            self.work = null;
        }
        /// A worker has returned and will no longer access this work item.
        /// Acquisition is published before any subsequent World consumption.
        pub fn acquire(self: *Self, a: std.mem.Allocator, work: Work, reply: []const u8) !void {
            try self.currentWork(work);
            if (work.entry.declaration.capture != null) return self.capture(a, work, reply);
            defer self.releaseWork();
            errdefer self.store().fenced = true;
            if (reply.len > 4 * 1024 * 1024) return error.Capacity;
            var schema = try data.schema.decode(a, work.entry.resume_schema);
            defer schema.deinit();
            try data.schema.validateValue(a, schema.descriptor, reply);
            var decoded = try self.task(a, work.task);
            defer decoded.deinit();
            var value = decoded.value;
            var saved = try self.record(occurrence.Occurrence, a, "occurrence", work.occurrence, work.task);
            defer saved.deinit();
            const binding: occurrence.Binding = .{ .id = work.occurrence, .task = work.task, .request = saved.value.request };
            const bound = try data.invocation.encodeOwned(data.invocation.Result, a, .{ .request_identity = saved.value.request, .value = reply });
            defer a.free(bound);
            const acquired = try occurrence.acquired(saved.value, binding, work.attempt, storage.digest(bound));
            const previous = value.revision;
            value.revision = try std.math.add(u64, previous, 1);
            try self.store().begin();
            defer self.store().rollback();
            _ = try self.store().putObject(bound);
            try self.store().reserveAcquired(work.attempt);
            try self.store().putRecord(occurrence.Occurrence, "occurrence", work.occurrence, work.task, acquired);
            try self.persist(value, previous, "effect.acquire");
        }
        pub fn unknown(self: *Self, a: std.mem.Allocator, work: Work) !void {
            try self.currentWork(work);
            defer self.releaseWork();
            errdefer self.store().fenced = true;
            var decoded = try self.task(a, work.task);
            defer decoded.deinit();
            var value = decoded.value;
            var saved = try self.record(occurrence.Occurrence, a, "occurrence", work.occurrence, work.task);
            defer saved.deinit();
            const binding: occurrence.Binding = .{ .id = work.occurrence, .task = work.task, .request = saved.value.request };
            const lost = try occurrence.unknown(saved.value, binding, work.attempt);
            const previous = value.revision;
            value.revision = try std.math.add(u64, previous, 1);
            value.schedule = .parked;
            value.blocker = .unavailable_environment;
            try self.store().begin();
            defer self.store().rollback();
            try self.store().putRecord(occurrence.Occurrence, "occurrence", work.occurrence, work.task, lost);
            try self.event(&value, .delivery_unknown, "{}");
            try self.persist(value, previous, "effect.unknown");
            self.runnableRemove(work.task);
            try self.retire(a);
        }

        pub fn notSent(self: *Self, a: std.mem.Allocator, work: Work) !void {
            try self.currentWork(work);
            defer self.releaseWork();
            var decoded = try self.task(a, work.task);
            defer decoded.deinit();
            var value = decoded.value;
            var saved = try self.record(occurrence.Occurrence, a, "occurrence", work.occurrence, work.task);
            defer saved.deinit();
            const next = try occurrence.notSent(saved.value, .{ .id = work.occurrence, .task = work.task, .request = saved.value.request }, work.attempt);
            const previous = value.revision;
            value.revision = try std.math.add(u64, previous, 1);
            value.blocker = if (value.cancellation != null and !value.cancellation_applied) null else .unavailable_environment;
            try self.store().begin();
            defer self.store().rollback();
            try self.store().releaseReservation(work.attempt);
            try self.store().putRecord(occurrence.Occurrence, "occurrence", work.occurrence, work.task, next);
            try self.event(&value, .blocked, "{\"delivery\":\"definitely_not_sent\"}");
            try self.persist(value, previous, "effect.not-sent");
        }

        fn archiveProfile(self: *Self, a: std.mem.Allocator) !void {
            try self.allowed();
            if (self.work != null) return error.UnsettledOccurrence;
            if (self.profile.authority.inference) return error.NonPortable;
            var profile = try json.parse(a, self.profile.bytes, .{ .bytes = 256 * 1024 });
            defer profile.deinit();
            const mode = json.get(profile.value, "mode") orelse return error.NonPortable;
            if (mode != .string or !same(mode.string, "offline")) return error.NonPortable;
        }

        pub fn exportCheckpoint(self: *Self, a: std.mem.Allocator, task_id: state.TaskId, path: []const u8) !archive_api.Exported {
            try self.archiveProfile(a);
            var value = try self.task(a, task_id);
            defer value.deinit();
            try self.compatible(value.value);
            return archive_api.write(self.allocator, self.io, self.store(), task_id, self.assets.manifest, path, self.namespace.directory);
        }

        /// A data-copy admission into a fresh namespace, not live custody.
        /// Existing task IDs/receipts survive; current grants are never loaded
        /// from the archive and no resident becomes runnable on import.
        pub fn importCheckpoint(self: *Self, a: std.mem.Allocator, id: []const u8, path: []const u8) !Admission {
            try self.archiveProfile(a);
            var reader = try archive_api.Reader.open(self.allocator, path);
            defer reader.deinit();
            const Request = struct { method: state.Method, archive: state.Digest };
            const request = try operation(Request, a, .{ .method = .import_checkpoint, .archive = reader.identity });
            if (try self.replay(a, id, request)) |prior| return prior;
            if (self.store().head.generation != 0 or self.active != null or self.runnable.items.len != 0) return error.NonEmptyNamespace;
            try self.store().begin();
            defer self.store().rollback();
            try reader.acquire(self.store());
            var inspected = try archive_api.inspect(a, self.store(), reader.manifest.value, null);
            defer inspected.task.deinit();
            var value = inspected.task.value;
            if (!same(value.principal.bytes, self.profile.authority.principal) or !same(value.tenant.bytes, self.profile.authority.tenant)) return error.Denied;
            const original_runtime = value.runtime_identity;
            value.runtime_identity = self.profile.runtime_identity;
            value.schedule = .parked;
            try self.compatible(value);
            if (!same(value.input_schema_id.bytes, Types.input_schema_id) or !same(value.output_schema_id.bytes, Types.output_schema_id) or !same(value.failure_schema_id.bytes, Types.failure_schema_id) or !same(value.message_schema_id.bytes, Types.message_schema_id)) return error.IncompatibleProfile;
            const build_bytes = try self.store().object(a, reader.manifest.value.build, 256 * 1024);
            defer a.free(build_bytes);
            var build = try json.parse(a, build_bytes, .{ .bytes = 256 * 1024 });
            defer build.deinit();
            for ([_][]const u8{ "native_host_contract", "protocol", "client_mapping", "state_format", "program_sha256", "program_identity", "application_assets_sha256", "optimize" }) |field| {
                const expected = json.get(self.application.manifest, field) orelse return error.InvalidAssets;
                try discovery.sameField(build.value, field, try json.text(expected));
            }
            const dependencies = json.get(build.value, "dependencies") orelse return error.InvalidArchive;
            const current_dependencies = json.get(self.application.manifest, "dependencies") orelse return error.InvalidAssets;
            for ([_][]const u8{ "world", "boundary" }) |field| try discovery.sameField(dependencies, field, try json.text(json.get(current_dependencies, field) orelse return error.InvalidAssets));
            const compiler = json.get(build.value, "compiler") orelse return error.InvalidArchive;
            const current_compiler = json.get(self.application.manifest, "compiler") orelse return error.InvalidAssets;
            try discovery.sameField(compiler, "version", try json.text(json.get(current_compiler, "version") orelse return error.InvalidAssets));
            // Scope remains exact. Opaque operation keys may be aliases of a
            // historical answer receipt; that receipt intentionally retains
            // its original client operation ID rather than the alias preimage.
            try self.store().restoreArchiveIndex(a, reader.manifest.value, value);
            try self.validateImportedState(a, value, inspected.current);
            const previous = value.revision;
            value.revision = try std.math.add(u64, previous, 1);
            const origin: state.Origin = .{ .id = reader.identity, .task = value.id, .build = reader.manifest.value.build, .native_identity = original_runtime, .source_revision = previous };
            try self.store().createRecord(state.Origin, "origin", origin.id, value.id, origin);
            var event_data = json.object();
            try json.put(a, &event_data, "archive_sha256", json.string(try a.dupe(u8, &std.fmt.bytesToHex(reader.identity, .lower))));
            try self.event(&value, .imported, try json.canonical(a, event_data));
            const admitted = try self.receipt(a, .import_checkpoint, id, request, value, .imported, null, null);
            try self.persist(value, previous, "checkpoint.import");
            return admitted;
        }

        fn validateImportedState(self: *Self, a: std.mem.Allocator, value: state.Task, pending: ?occurrence.Occurrence) !void {
            const driver = try self.resident(a, value);
            errdefer self.retire(a) catch {
                self.store().fenced = true;
            };
            const observed = try driver.drive(a, .none, 0);
            defer a.free(observed);
            const prior = try self.store().object(a, value.outcome, 4 * 1024 * 1024);
            defer a.free(prior);
            if (!same(observed, prior)) return error.InvalidArchive;
            const checkpoint = try driver.checkpoint(a);
            defer a.free(checkpoint);
            if (!same(&storage.digest(checkpoint), &value.checkpoint.digest) or checkpoint.len != value.checkpoint.bytes) return error.InvalidArchive;
            var decoded = try data.invocation.decode(data.invocation.Outcome, a, observed);
            defer decoded.deinit();
            if (!same(@tagName(decoded.value), @tagName(value.outcome_kind))) return error.InvalidArchive;
            switch (decoded.value) {
                .requested => |requested| {
                    const current = pending orelse return error.InvalidArchive;
                    var request = try data.invocation.decode(data.invocation.Request, a, requested.request);
                    defer request.deinit();
                    if (!same(&current.request, &request.value.request_identity)) return error.InvalidArchive;
                    const entry = try self.handlers.resolve(request.value, self.application.image_identity);
                    var acquired_answer: ?state.Digest = null;
                    if (current.state == .settled_reply) {
                        const bytes = try self.store().acquiredObject(a, current.state.settled_reply.reply, 4 * 1024 * 1024);
                        defer a.free(bytes);
                        var reply = try data.invocation.decode(data.invocation.Result, a, bytes);
                        defer reply.deinit();
                        if (!same(&reply.value.request_identity, &current.request)) return error.InvalidArchive;
                        var schema = try data.schema.decode(a, entry.resume_schema);
                        defer schema.deinit();
                        try data.schema.validateValue(a, schema.descriptor, reply.value.value);
                        acquired_answer = storage.digest(reply.value.value);
                    }
                    const question_id: ?state.Digest = switch (current.state) {
                        .awaiting => |waiting| waiting.question,
                        .settled_reply => |reply| if (reply.answer) |answer| answer.question else null,
                        else => null,
                    };
                    if (question_id) |id| {
                        var question = try self.record(state.Question, a, "question", id, value.id);
                        defer question.deinit();
                        const q = question.value;
                        if (entry.declaration.kind != .question or q.retired or q.revision == 0 or !same(&q.occurrence, &current.id) or !same(&q.request_digest, &current.request) or !same(&q.pending_digest, &request.value.binding.pending_state_digest) or !same(&q.answer_schema_digest, &storage.digest(entry.resume_schema)) or !same(q.answer_schema_id.bytes, entry.declaration.answer_schema_id.?)) return error.InvalidArchive;
                        const bytes = try self.store().object(a, q.request, 4 * 1024 * 1024);
                        defer a.free(bytes);
                        if (!same(bytes, requested.request)) return error.InvalidArchive;
                        if (current.state == .awaiting) {
                            if (q.answer != null or q.receipt != null) return error.InvalidArchive;
                            if (!same(&current.state.awaiting.pending_digest, &q.pending_digest)) return error.InvalidArchive;
                        } else {
                            const answer = q.answer orelse return error.InvalidArchive;
                            const answer_receipt = q.receipt orelse return error.InvalidArchive;
                            const binding = current.state.settled_reply.answer.?;
                            if (!same(&answer.digest, &acquired_answer.?) or !same(&binding.digest, &answer.digest) or !same(&binding.pending_digest, &q.pending_digest) or !same(&answer_receipt.task, &value.id) or answer_receipt.method != .respond or answer_receipt.disposition != .answer_acquired or answer_receipt.question == null or !same(&answer_receipt.question.?, &id)) return error.InvalidArchive;
                            const answer_bytes = try self.store().object(a, answer, 64 * 1024);
                            defer a.free(answer_bytes);
                            const expected = try answerDigest(a, value.id, id, q.revision, q.request_digest, q.answer_schema_id.bytes, answer_bytes);
                            if (!same(&expected, &answer_receipt.request_digest)) return error.InvalidArchive;
                            const key = try self.operationKey(a, answer_receipt.client_operation_id.bytes);
                            const saved = (try self.store().savedReceipt(a, &key)) orelse return error.InvalidArchive;
                            defer a.free(saved);
                            const receipt_bytes = try contracts.encodeOwned(state.Receipt, a, answer_receipt);
                            defer a.free(receipt_bytes);
                            if (!same(saved, receipt_bytes)) return error.InvalidArchive;
                        }
                    }
                },
                .completed => |bytes| {
                    if (value.result == null or !same(&value.result.?.digest, &storage.digest(bytes))) return error.InvalidArchive;
                    try self.validateImportedResult(Types.Output, a, value, bytes);
                },
                .failed => |failure| {
                    if (value.result == null or !same(&value.result.?.digest, &value.outcome.digest)) return error.InvalidArchive;
                    try self.validateImportedResult(Types.Failure, a, value, failure.value);
                },
                .cancelled => {
                    if (value.result == null or !same(&value.result.?.digest, &value.outcome.digest) or value.client_result != null or value.result_artifact != null) return error.InvalidArchive;
                },
                else => {},
            }
            if (!value.terminal() and (value.result != null or value.client_result != null or value.result_artifact != null)) return error.InvalidArchive;
            try self.retire(a);
        }
        fn validateImportedResult(self: *Self, comptime T: type, a: std.mem.Allocator, value: state.Task, bytes: []const u8) !void {
            var decoded = try contracts.decodeOwned(T, a, bytes);
            defer decoded.deinit();
            const expected = try json.canonical(a, try values.toJson(T, a, decoded.value));
            defer a.free(expected);
            const reference = value.client_result orelse return error.InvalidArchive;
            const saved = try self.store().object(a, reference, 4 * 1024 * 1024);
            defer a.free(saved);
            if (!same(expected, saved)) return error.InvalidArchive;
            if (value.result_artifact) |id| {
                var artifact = try self.record(state.Artifact, a, "artifact", id, value.id);
                defer artifact.deinit();
                if (!same(&artifact.value.value.digest, &reference.digest) or artifact.value.value.bytes != reference.bytes) return error.InvalidArchive;
                const schema_id = artifact.value.schema_id orelse return error.InvalidArchive;
                if (!same(artifact.value.media_type.bytes, "application/json") or !same(schema_id.bytes, if (value.outcome_kind == .completed) value.output_schema_id.bytes else value.failure_schema_id.bytes)) return error.InvalidArchive;
            } else if (saved.len > (@import("protocol.zig").Limits{}).inline_bytes) return error.InvalidArchive;
        }

        /// Call only after joining any in-flight worker. Closing is physical
        /// parking, never an implicit semantic cancellation or new dispatch.
        pub fn close(self: *Self, a: std.mem.Allocator) !void {
            if (self.work != null) return error.Busy;
            try self.retire(a);
            try self.program.close();
            self.runnable.deinit(self.allocator);
            self.* = undefined;
        }

        pub fn park(self: *Self, a: std.mem.Allocator) !void {
            if (self.work != null) return error.Busy;
            for (self.runnable.items) |id| {
                var decoded = try self.task(a, id);
                defer decoded.deinit();
                var value = decoded.value;
                if (value.terminal()) continue;
                const previous = value.revision;
                value.revision = try std.math.add(u64, previous, 1);
                value.schedule = .parked;
                try self.store().begin();
                defer self.store().rollback();
                try self.event(&value, .parked, "{}");
                try self.persist(value, previous, "task.park");
            }
            self.runnable.clearRetainingCapacity();
            try self.retire(a);
        }
    };
}
