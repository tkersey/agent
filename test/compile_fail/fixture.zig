const agent = @import("agent");

pub const Failure = enum { authored };

pub fn define(
    comptime Action: type,
    comptime Observation: type,
    comptime actions: anytype,
    comptime history: anytype,
) type {
    return agent.define(.{
        .name = "compile-fail-fixture",
        .version = "1.0.0",
        .instructions = "Exercise one focused rejected invariant.",
        .Goal = u32,
        .Action = Action,
        .Observation = Observation,
        .Result = u32,
        .Failure = Failure,
        .decision = .{
            .interface = "fixture.compile-fail-decide.v1",
            .maximum_request_bytes = 4096,
            .maximum_result_bytes = 1024,
        },
        .actions = actions,
        .budget = .{
            .maximum_turns = 1,
            .maximum_decisions = 1,
            .maximum_effect_actions = 0,
            .maximum_child_actions = 0,
        },
        .history = history,
    });
}
