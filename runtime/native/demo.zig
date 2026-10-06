//! Explicitly nondurable, offline execution through the same generic driver and
//! registry used by the task owner. No authored application phases live here.
const std = @import("std");
const data = @import("boundary_data");
const contracts = @import("agent_contracts");
const json = @import("json.zig");
const values = @import("values.zig");
const registry = @import("registry.zig");
const discovery = @import("discovery.zig");
const Driver = @import("driver.zig").Driver;

pub fn run(comptime Types: type, comptime Environment: type, io: std.Io, a: std.mem.Allocator, assets: discovery.Assets, app: discovery.Application, handlers: registry.Registry) !json.Value {
    const input = try contracts.encodeOwned(Types.Input, a, Environment.demo_input);
    const execution = try Driver.open(a, assets.image, .{ .initial_args = input }, 8 * 1024 * 1024);
    const grants = try a.alloc(registry.Grant, handlers.entries.len);
    for (handlers.entries, grants) |entry, *grant| grant.* = .{ .identity = entry.declaration.identity, .resource_role = entry.declaration.resource_role, .resource_identity = app.image_identity };
    const authority: registry.Authority = .{ .grants = grants, .principal = "offline-demo", .tenant = "offline-demo" };
    var control: data.invocation.Control = .none;
    var effects: u32 = 0;
    var yields: u32 = 0;
    // Finite run budget; exhaustion is a failed demo, not successful completion.
    for (0..1024) |_| {
        const encoded = try execution.drive(a, control, 256);
        defer a.free(encoded);
        var outcome = try data.invocation.decode(data.invocation.Outcome, a, encoded);
        defer outcome.deinit();
        switch (outcome.value) {
            .progressed => control = .none,
            .yielded => {
                yields += 1;
                control = .resume_yield;
            },
            .requested => |pending| {
                var request = try data.invocation.decode(data.invocation.Request, a, pending.request);
                defer request.deinit();
                const entry = try handlers.admit(request.value, authority, app.image_identity);
                const ctx: registry.Context = .{ .allocator = a, .io = io, .authority = &authority, .task_id = "offline-demo" };
                const acquired = switch (entry.declaration.kind) {
                    .leaf => try entry.declaration.invoke.?(ctx, request.value.binding.payload),
                    .question => try contracts.encodeOwned(Types.Answer, a, Environment.demo_answer),
                    .inbox => return error.UnsupportedCapability,
                };
                control = .{ .reply = try data.invocation.encodeOwned(data.invocation.Result, a, .{ .request_identity = request.value.request_identity, .value = acquired }) };
                effects += 1;
            },
            .completed => |bytes| {
                var result = try contracts.decodeOwned(Types.Output, a, bytes);
                defer result.deinit();
                var report = json.object();
                try json.put(a, &report, "mode", json.string("offline-demo"));
                try json.put(a, &report, "persistence", json.string("none"));
                try json.put(a, &report, "effects", try json.number(a, effects));
                try json.put(a, &report, "yields", try json.number(a, yields));
                // Keep returned client values after the decoder's arena dies.
                const projection = try json.canonical(a, try values.toJson(Types.Output, a, result.value));
                const retained = try json.parse(a, projection, .{});
                try json.put(a, &report, "output", retained.value);
                try execution.close();
                try execution.destroy();
                return report;
            },
            .failed, .cancelled, .needs_capacity => return error.DemoDidNotComplete,
        }
    }
    return error.DemoCapacity;
}
