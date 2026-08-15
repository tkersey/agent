const std = @import("std");
const agent = @import("agent");
const boundary = @import("boundary");

const ToolSite = boundary.effect.site(91, "fixture.malformed-tool.v1", u32, u32);
const Action = union(enum) {
    tool: u32,
    final: u32,
};
const Observation = union(enum) {
    tool: u32,
};
const Failure = enum {
    budget_exhausted,
    history_overflow,
    arithmetic_overflow,
    invalid_variant,
    capacity_exceeded,
};

const Definition = agent.define(.{
    .name = "malformed-decision-fixture",
    .version = "1.0.0",
    .instructions = "Accept only an exactly typed closed Action value.",
    .Goal = u32,
    .Action = Action,
    .Observation = Observation,
    .Result = u32,
    .Failure = Failure,
    .decision = .{
        .interface = "fixture.malformed-decide.v1",
        .maximum_request_bytes = 16 * 1024,
        .maximum_result_bytes = 1024,
    },
    .actions = .{
        agent.action.effect(.tool, .tool, ToolSite, .{
            .name = "tool",
            .description = "Perform the typed fixture action.",
        }),
        agent.action.final(.final, .{
            .name = "final",
            .description = "Return the typed result.",
        }),
    },
    .budget = .{
        .maximum_turns = 2,
        .maximum_decisions = 2,
        .maximum_effect_actions = 1,
        .maximum_child_actions = 0,
    },
});

const Machine = agent.compile(Definition, agent.strategy.react(.{}), agent.epistemics.verbatim(.{
    .maximum_observations = 1,
    .overflow = .fail,
    .final = agent.final_policy.none,
}), .{
    .machine = .{
        .maximum_frames = 16,
        .maximum_state_bytes = 64 * 1024,
        .maximum_machine_fuel = 4096,
    },
}).Machine;

test "invalid Action tag is rejected without mutating pending Machine state" {
    const state = try Machine.initialState(std.testing.allocator, @as(u32, 7));
    defer Machine.deinitState(state);
    var fuel: u64 = 4096;

    const decision = switch (try Machine.step(state, &fuel)) {
        .request => |request| request,
        else => return error.UnexpectedMachineStep,
    };
    const before = try Machine.encodeState(std.testing.allocator, state);
    defer std.testing.allocator.free(before);

    // Boundary encodes union tags as canonical u32 values. Two variants make
    // tag 2 invalid, so no typed Action exists that can be passed to resume.
    const invalid_action = [_]u8{ 0, 0, 0, 2 };
    try std.testing.expectError(
        error.InvalidTag,
        boundary.schema.decodeExact(Action, &invalid_action),
    );

    const after = try Machine.encodeState(std.testing.allocator, state);
    defer std.testing.allocator.free(after);
    try std.testing.expectEqualSlices(u8, before, after);

    {
        const prepared = try Machine.prepareResume(state, decision);
        defer Machine.deinitPreparedResume(prepared);
        try Machine.@"resume"(prepared, Action{ .final = 99 });
    }
    const done = switch (try Machine.step(state, &fuel)) {
        .done => |result| result,
        else => return error.UnexpectedMachineStep,
    };
    defer done.deinit();
    try std.testing.expectEqual(@as(u32, 99), done.value().*);
}

test "valid Action bytes reject trailing data" {
    var encoded: [boundary.schema.maximumEncodedSize(Action) + 1]u8 = undefined;
    const length = try boundary.schema.encode(
        Action,
        Action{ .final = 42 },
        encoded[0 .. encoded.len - 1],
    );
    encoded[length] = 0;
    try std.testing.expectError(
        error.TrailingBytes,
        boundary.schema.decodeExact(Action, encoded[0 .. length + 1]),
    );
}
