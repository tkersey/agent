const agent = @import("agent");

const Action = union(enum) { final: u32 };
const Failure = enum { authored };
const instructions = [_]u8{'x'} ** (256 * 1024 + 1);

comptime {
    _ = agent.define(.{
        .name = "oversized-instructions",
        .version = "1.0.0",
        .instructions = &instructions,
        .Goal = u32,
        .Action = Action,
        .Observation = void,
        .Result = u32,
        .Failure = Failure,
        .decision = .{ .interface = "decide.v1", .maximum_request_bytes = 64, .maximum_result_bytes = 64 },
        .actions = .{agent.action.final(.final, .{ .name = "final", .description = "Return." })},
        .budget = .{ .maximum_turns = 1, .maximum_decisions = 1, .maximum_effect_actions = 0, .maximum_child_actions = 0 },
    });
}
