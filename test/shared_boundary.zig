const std = @import("std");
const agent = @import("agent");
const boundary = @import("boundary");

const Action = union(enum) { final: u32 };
const Failure = enum {
    budget_exhausted,
    history_overflow,
    arithmetic_overflow,
    invalid_variant,
    capacity_exceeded,
};
const Definition = agent.define(.{
    .name = "shared-boundary-fixture",
    .version = "1.0.0",
    .instructions = "Return one typed result.",
    .Goal = u32,
    .Action = Action,
    .Observation = void,
    .Result = u32,
    .Failure = Failure,
    .decision = .{
        .interface = "fixture.shared-boundary-decide.v1",
        .maximum_request_bytes = 4096,
        .maximum_result_bytes = 64,
    },
    .actions = .{
        agent.action.final(.final, .{
            .name = "final",
            .description = "Return the result.",
        }),
    },
    .budget = .{
        .maximum_turns = 1,
        .maximum_decisions = 1,
        .maximum_effect_actions = 0,
        .maximum_child_actions = 0,
    },
});
const Compiled = agent.compile(Definition, agent.strategy.react(.{}), agent.epistemics.verbatim(.{
    .maximum_observations = 0,
    .overflow = .fail,
    .final = agent.final_policy.none,
}), .{
    .machine = .{
        .maximum_frames = 16,
        .maximum_state_bytes = 64 * 1024,
        .maximum_machine_fuel = 4096,
    },
});

test "public Boundary module shares Agent's exact nominal types" {
    const ExpectedMemory = boundary.Vector(void, 0);
    try std.testing.expect(ExpectedMemory == Compiled.Epistemics.MemoryType(Definition));
    try std.testing.expectEqualSlices(
        u8,
        &boundary.schema.schemaDigest(Compiled.Strategy.DecisionLocalType(Definition)),
        &Compiled.StrategyManifest.decision_local_schema_digest,
    );

    const Machine = Compiled.Machine;
    const state = try Machine.initialState(std.testing.allocator, @as(u32, 3));
    defer Machine.deinitState(state);
    var fuel: u64 = 1024;
    const request = switch (try Machine.step(state, &fuel)) {
        .request => |value| value,
        else => return error.UnexpectedMachineStep,
    };
    {
        const prepared = try Machine.prepareResume(state, request);
        defer Machine.deinitPreparedResume(prepared);
        try Machine.@"resume"(prepared, Action{ .final = 7 });
    }
    const done = switch (try Machine.step(state, &fuel)) {
        .done => |value| value,
        else => return error.UnexpectedMachineStep,
    };
    defer done.deinit();
    try std.testing.expectEqual(@as(u32, 7), done.value().*);
}
