const agent = @import("agent");

const Action = union(enum) { final: u32 };
const Failure = enum { authored };

comptime {
    _ = agent.define(.{
        .name = "nonportable-observation",
        .version = "1.0.0",
        .instructions = "Return.",
        .Goal = u32,
        .Action = Action,
        .Observation = *u8,
        .Result = u32,
        .Failure = Failure,
        .decision = .{ .interface = "decide.v1", .maximum_request_bytes = 64, .maximum_result_bytes = 64 },
        .actions = .{agent.action.final(.final, .{ .name = "final", .description = "Return." })},
        .budget = .{ .maximum_turns = 1, .maximum_decisions = 1, .maximum_effect_actions = 0, .maximum_child_actions = 0 },
        .history = .{ .maximum_observations = 0, .overflow = .fail },
    });
}
