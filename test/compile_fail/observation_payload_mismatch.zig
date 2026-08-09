const agent = @import("agent");
const boundary = @import("boundary");

const Site = boundary.effect.site(9, "tool.v1", u32, u32);
const Action = union(enum) { tool: u32, final: u32 };
const Observation = union(enum) { tool: u64 };
const Failure = enum { authored };

comptime {
    _ = agent.define(.{
        .name = "observation-mismatch",
        .version = "1.0.0",
        .instructions = "Use tool.",
        .Goal = u32,
        .Action = Action,
        .Observation = Observation,
        .Result = u32,
        .Failure = Failure,
        .decision = .{ .interface = "decide.v1", .maximum_request_bytes = 64, .maximum_result_bytes = 64 },
        .actions = .{
            agent.action.effect(.tool, .tool, Site, .{ .name = "tool", .description = "Tool." }),
            agent.action.final(.final, .{ .name = "final", .description = "Return." }),
        },
        .budget = .{ .maximum_turns = 1, .maximum_decisions = 1, .maximum_effect_actions = 1, .maximum_child_actions = 0 },
        .history = .{ .maximum_observations = 1, .overflow = .fail },
    });
}
