//! Deterministic client scenario through the same durable owner as stdio. The
//! authored application, not this scenario, chooses effects and control flow.
const std = @import("std");
const data = @import("boundary_data");
const tasks = @import("tasks.zig");
const client_api = @import("client.zig");
const json = @import("json.zig");
const values = @import("values.zig");

pub fn run(comptime Types: type, comptime Environment: type, a: std.mem.Allocator, service: *tasks.Service(Types), client: *client_api.Client(Types), operation_id: []const u8) !json.Value {
    const accepted = try service.submit(a, operation_id, Environment.demo_input);
    var effects: u32 = 0;
    var yields: u32 = 0;
    for (0..1024) |_| {
        const step = try service.pump(a);
        switch (step) {
            .work => |work| {
                var request = try data.invocation.decode(data.invocation.Request, a, work.request);
                defer request.deinit();
                const id = std.fmt.bytesToHex(work.task, .lower);
                const reply = work.entry.declaration.invoke.?(.{ .allocator = a, .io = service.io, .authority = &service.profile.authority, .task_id = &id }, request.value.binding.payload) catch |err| {
                    try service.unknown(a, work);
                    return err;
                };
                try service.acquire(a, work, reply);
                effects += 1;
            },
            .waiting => {
                var question = (try service.pendingQuestion(a, accepted.receipt.task)) orelse return error.DemoDidNotComplete;
                defer question.deinit();
                const id = try std.fmt.allocPrint(a, "demo-answer-{s}", .{std.fmt.bytesToHex(question.value.id, .lower)});
                _ = try service.respond(a, id, accepted.receipt.task, question.value.id, question.value.revision, question.value.request_digest, question.value.answer_schema_id.bytes, try values.toJson(Types.Answer, a, Environment.demo_answer));
                effects += 1;
            },
            .progressed, .idle => {},
        }
        var current = try service.task(a, accepted.receipt.task);
        defer current.deinit();
        if (current.value.outcome_kind == .yielded) yields += 1;
        if (!current.value.terminal()) continue;
        if (current.value.outcome_kind != .completed) return error.DemoDidNotComplete;
        var params = json.object();
        try json.put(a, &params, "task_id", json.string(try a.dupe(u8, &std.fmt.bytesToHex(accepted.receipt.task, .lower))));
        const result = try client.call(a, .@"task.result", params);
        var report = json.object();
        try json.put(a, &report, "mode", json.string("offline-demo"));
        try json.put(a, &report, "persistence", json.string("durable"));
        try json.put(a, &report, "effects", try json.number(a, effects));
        try json.put(a, &report, "yields", try json.number(a, yields));
        try json.put(a, &report, "task_id", params.object.get("task_id").?);
        try json.put(a, &report, "output", result.object.get("outcome").?.object.get("value") orelse return error.DemoCapacity);
        return report;
    }
    return error.DemoCapacity;
}
