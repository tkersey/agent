//! Typed client projection of the durable owner. It owns no evaluator policy.
const std = @import("std");
const contracts = @import("agent_contracts");
const data = @import("boundary_data");
const state = @import("state.zig");
const tasks = @import("tasks.zig");
const json = @import("json.zig");
const values = @import("values.zig");
const protocol = @import("protocol.zig");

pub fn identifier(comptime length: usize, value: json.Value) ![length]u8 {
    const text = try json.text(value);
    if (text.len != length * 2) return error.InvalidParams;
    var result: [length]u8 = undefined;
    _ = std.fmt.hexToBytes(&result, text) catch return error.InvalidParams;
    return result;
}
fn hexadecimal(a: std.mem.Allocator, bytes: anytype) !json.Value {
    return json.string(try a.dupe(u8, &std.fmt.bytesToHex(bytes, .lower)));
}
fn counter(a: std.mem.Allocator, value: u64) !json.Value {
    return json.string(try std.fmt.allocPrint(a, "{d}", .{value}));
}
fn field(value: json.Value, key: []const u8) !json.Value {
    return json.get(value, key) orelse error.InvalidParams;
}
fn operationId(value: json.Value) ![]const u8 {
    const id = try json.text(try field(value, "client_operation_id"));
    if (id.len == 0 or id.len > 128) return error.InvalidParams;
    return id;
}
fn typed(comptime T: type, a: std.mem.Allocator, object: json.Value, schema_id: []const u8) !T {
    try protocol.closed(object, .{ .required = &.{ "schema_id", "value" } });
    if (!std.mem.eql(u8, try json.text(try field(object, "schema_id")), schema_id)) return error.InvalidParams;
    return values.fromJson(T, a, try field(object, "value"));
}

pub const Subscription = struct { id: [16]u8, task: state.TaskId, after: u64 };
pub const Shutdown = enum { park, cancel };

pub fn Client(comptime Types: type) type {
    return struct {
        const Self = @This();
        service: *tasks.Service(Types),
        subscriptions: [16]?Subscription = @splat(null),
        shutdown: ?Shutdown = null,

        fn snapshot(self: *Self, a: std.mem.Allocator, id: state.TaskId) !json.Value {
            var decoded = try self.service.task(a, id);
            defer decoded.deinit();
            const task = decoded.value;
            var result = json.object();
            try json.put(a, &result, "task_id", try hexadecimal(a, id));
            try json.put(a, &result, "application_id", json.string(try a.dupe(u8, task.application_id.bytes)));
            try json.put(a, &result, "profile_id", json.string(try a.dupe(u8, task.profile_id.bytes)));
            try json.put(a, &result, "profile_digest", try hexadecimal(a, task.profile.digest));
            try json.put(a, &result, "status", json.string(@tagName(try self.service.status(a, task))));
            try json.put(a, &result, "revision", try counter(a, task.revision));
            try json.put(a, &result, "result_available", .{ .bool = task.terminal() });
            try json.put(a, &result, "earliest_available_seq", try counter(a, task.event_floor));
            try json.put(a, &result, "high_water_seq", try counter(a, task.event_high));
            try json.put(a, &result, "blocker", if (task.blocker) |blocker| json.string(@tagName(blocker)) else .null);
            try json.put(a, &result, "cancellation", if (task.cancellation) |reason| json.string(try a.dupe(u8, reason.bytes)) else .null);
            var messages: std.array_list.Managed(json.Value) = .init(a);
            for (task.messages.items) |message_id| {
                const bytes = (try self.service.namespace.store.recordBytes(a, "message", message_id, id)) orelse return error.CorruptState;
                defer a.free(bytes);
                var saved = try contracts.decodeOwned(state.Message, a, bytes);
                defer saved.deinit();
                var item = json.object();
                try json.put(a, &item, "message_id", try hexadecimal(a, message_id));
                try json.put(a, &item, "ordinal", try counter(a, saved.value.ordinal));
                try json.put(a, &item, "disposition", json.string(@tagName(saved.value.disposition)));
                try messages.append(item);
            }
            try json.put(a, &result, "pending_messages", .{ .array = messages });
            try json.put(a, &result, "message_history", json.string("task.events"));
            if (try self.service.pendingQuestion(a, id)) |pending| {
                var question = pending;
                defer question.deinit();
                var item = json.object();
                try json.put(a, &item, "question_id", try hexadecimal(a, question.value.id));
                try json.put(a, &item, "question_revision", try counter(a, question.value.revision));
                try json.put(a, &item, "request_digest", try hexadecimal(a, question.value.request_digest));
                try json.put(a, &item, "answer_schema_id", json.string(try a.dupe(u8, question.value.answer_schema_id.bytes)));
                const bytes = try self.service.namespace.store.object(a, question.value.prompt, 32 * 1024);
                defer a.free(bytes);
                try json.put(a, &item, "prompt", (try json.parse(a, bytes, .{})).value);
                try json.put(a, &result, "question", item);
            } else try json.put(a, &result, "question", .null);
            return result;
        }

        fn admission(self: *Self, a: std.mem.Allocator, admitted: tasks.Admission) !json.Value {
            var result = try self.snapshot(a, admitted.receipt.task);
            try json.put(a, &result, "receipt_id", try hexadecimal(a, admitted.receipt.id));
            try json.put(a, &result, "receipt_revision", try counter(a, admitted.receipt.revision));
            try json.put(a, &result, "replayed", .{ .bool = admitted.replayed });
            try json.put(a, &result, "disposition", json.string(@tagName(admitted.receipt.disposition)));
            if (admitted.receipt.message) |id| try json.put(a, &result, "message_id", try hexadecimal(a, id));
            if (admitted.receipt.question) |id| try json.put(a, &result, "question_id", try hexadecimal(a, id));
            return result;
        }

        pub fn events(self: *Self, a: std.mem.Allocator, id: state.TaskId, after: u64, limit: u32) !json.Value {
            var decoded = try self.service.task(a, id);
            defer decoded.deinit();
            const task = decoded.value;
            if (after < task.event_floor - 1) return error.CursorExpired;
            if (after > task.event_high) return error.InvalidParams;
            const records = try self.service.namespace.store.eventsAfter(a, id, after, limit);
            defer {
                for (records) |bytes| a.free(bytes);
                a.free(records);
            }
            var items: std.array_list.Managed(json.Value) = .init(a);
            var next = after;
            for (records) |bytes| {
                var saved = try contracts.decodeOwned(state.Event, a, bytes);
                defer saved.deinit();
                const event = saved.value;
                if (event.seq != next + 1 or !std.mem.eql(u8, &event.task, &id)) return error.CorruptState;
                var item = json.object();
                try json.put(a, &item, "task_id", try hexadecimal(a, id));
                try json.put(a, &item, "seq", try counter(a, event.seq));
                try json.put(a, &item, "revision", try counter(a, event.revision));
                try json.put(a, &item, "type", json.string(@tagName(event.kind)));
                try json.put(a, &item, "data", (try json.parse(a, event.data.bytes, .{})).value);
                try items.append(item);
                next = event.seq;
            }
            var result = json.object();
            try json.put(a, &result, "events", .{ .array = items });
            try json.put(a, &result, "earliest_available_seq", try counter(a, task.event_floor));
            try json.put(a, &result, "high_water_seq", try counter(a, task.event_high));
            try json.put(a, &result, "next_after_seq", try counter(a, next));
            try json.put(a, &result, "has_more", .{ .bool = next < task.event_high });
            return result;
        }

        fn taskResult(self: *Self, a: std.mem.Allocator, id: state.TaskId) !json.Value {
            var output = try self.snapshot(a, id);
            var decoded = try self.service.task(a, id);
            defer decoded.deinit();
            const task = decoded.value;
            try json.put(a, &output, "ready", .{ .bool = task.terminal() });
            if (!task.terminal()) return output;
            const bytes = try self.service.namespace.store.object(a, task.result orelse return error.CorruptState, 4 * 1024 * 1024);
            defer a.free(bytes);
            var outcome = json.object();
            try json.put(a, &outcome, "type", json.string(@tagName(task.outcome_kind)));
            if (task.outcome_kind == .completed) {
                if (!std.mem.eql(u8, task.output_schema_id.bytes, Types.output_schema_id)) return error.IncompatibleProfile;
                var value = try contracts.decodeOwned(Types.Output, a, bytes);
                defer value.deinit();
                try json.put(a, &outcome, "schema_id", json.string(Types.output_schema_id));
                // Copy the projection before the ordinary decoder releases it.
                const projected = try json.canonical(a, try values.toJson(Types.Output, a, value.value));
                if (projected.len > 60 * 1024) return error.Capacity;
                try json.put(a, &outcome, "value", (try json.parse(a, projected, .{})).value);
            } else {
                var saved = try data.invocation.decode(data.invocation.Outcome, a, bytes);
                defer saved.deinit();
                switch (saved.value) {
                    .failed => |failure| {
                        var value = try contracts.decodeOwned(Types.Failure, a, failure.value);
                        defer value.deinit();
                        try json.put(a, &outcome, "schema_id", json.string(Types.failure_schema_id));
                        const projected = try json.canonical(a, try values.toJson(Types.Failure, a, value.value));
                        try json.put(a, &outcome, "value", (try json.parse(a, projected, .{})).value);
                        try json.put(a, &outcome, "cleanup_complete", .{ .bool = std.mem.eql(u8, failure.cleanup_failures, &.{0}) });
                    },
                    .cancelled => |cancelled| {
                        try json.put(a, &outcome, "cleanup_complete", .{ .bool = std.mem.eql(u8, cancelled.cleanup_failures, &.{0}) });
                    },
                    else => return error.CorruptState,
                }
            }
            try json.put(a, &output, "outcome", outcome);
            return output;
        }

        pub fn call(self: *Self, a: std.mem.Allocator, method: protocol.Method, params: json.Value) !json.Value {
            if (self.shutdown != null and (method == .@"task.submit" or method == .@"task.message" or method == .@"task.resume")) return error.ShuttingDown;
            switch (method) {
                .@"task.submit" => {
                    if (!std.mem.eql(u8, try json.text(try field(params, "application_id")), Types.application_id) or !std.mem.eql(u8, try json.text(try field(params, "profile_id")), self.service.profile.id)) return error.NotFound;
                    return self.admission(a, try self.service.submit(a, try operationId(params), try typed(Types.Input, a, try field(params, "input"), Types.input_schema_id)));
                },
                .@"task.message" => return self.admission(a, try self.service.message(a, try operationId(params), try identifier(16, try field(params, "task_id")), try typed(Types.Message, a, try field(params, "message"), Types.message_schema_id))),
                .@"task.respond" => {
                    const answer = try field(params, "answer");
                    try protocol.closed(answer, .{ .required = &.{ "schema_id", "value" } });
                    return self.admission(a, try self.service.respond(a, try operationId(params), try identifier(16, try field(params, "task_id")), try identifier(32, try field(params, "question_id")), try json.decimal(u64, try field(params, "question_revision")), try identifier(32, try field(params, "request_digest")), try json.text(try field(answer, "schema_id")), try field(answer, "value")));
                },
                .@"task.cancel" => return self.admission(a, try self.service.requestCancel(a, try operationId(params), try identifier(16, try field(params, "task_id")), if (json.get(params, "reason")) |reason| try json.text(reason) else "client requested cancellation")),
                .@"task.resume" => return self.admission(a, try self.service.resumeTask(a, try operationId(params), try identifier(16, try field(params, "task_id")), try json.decimal(u64, try field(params, "expected_revision")))),
                .@"task.status" => return self.snapshot(a, try identifier(16, try field(params, "task_id"))),
                .@"task.result" => return self.taskResult(a, try identifier(16, try field(params, "task_id"))),
                .@"task.events" => return self.events(a, try identifier(16, try field(params, "task_id")), try json.decimal(u64, try field(params, "after_seq")), if (json.get(params, "limit")) |limit| try json.integer(u32, if (limit == .number_string) limit.number_string else return error.InvalidParams) else 16),
                .@"task.subscribe" => {
                    const task_id = try identifier(16, try field(params, "task_id"));
                    const after = try json.decimal(u64, try field(params, "after_seq"));
                    var result_value = try self.events(a, task_id, after, 1);
                    _ = result_value.object.swapRemove("events");
                    for (&self.subscriptions) |*slot| if (slot.* == null) {
                        var id: [16]u8 = undefined;
                        try self.service.io.randomSecure(&id);
                        slot.* = .{ .id = id, .task = task_id, .after = after };
                        try json.put(a, &result_value, "subscription_id", try hexadecimal(a, id));
                        return result_value;
                    };
                    return error.Capacity;
                },
                .@"task.unsubscribe" => {
                    const id = try identifier(16, try field(params, "subscription_id"));
                    for (&self.subscriptions) |*slot| if (slot.*) |subscription| {
                        if (std.mem.eql(u8, &subscription.id, &id)) {
                            slot.* = null;
                            return json.object();
                        }
                    };
                    return error.NotFound;
                },
                .shutdown => {
                    const mode = std.meta.stringToEnum(Shutdown, try json.text(try field(params, "mode"))) orelse return error.InvalidParams;
                    if (self.shutdown != null and self.shutdown.? != mode) return error.ShuttingDown;
                    self.shutdown = mode;
                    var result_value = json.object();
                    try json.put(a, &result_value, "mode", json.string(@tagName(mode)));
                    try json.put(a, &result_value, "accepted", .{ .bool = true });
                    return result_value;
                },
                else => return error.UnsupportedCapability,
            }
        }
    };
}
