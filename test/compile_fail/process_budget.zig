const agent = @import("agent");

const Failure = enum { invalid_variant };
const Action = union(enum) { abort: Failure };

const Invalid = agent.process.define(.{
    .name = "invalid-budgeted-process",
    .version = "1.0.0",
    .instructions = "A process must not silently acquire a universal horizon.",
    .Goal = void,
    .Action = Action,
    .Observation = void,
    .Result = void,
    .Failure = Failure,
    .decision = .{
        .interface = "fixture.process.v1",
        .maximum_request_bytes = 4096,
        .maximum_result_bytes = 64,
    },
    .actions = .{agent.action.fail(.abort, .{
        .name = "abort",
        .description = "Abort explicitly.",
    })},
    .budget = .{
        .maximum_turns = 1,
        .maximum_decisions = 1,
        .maximum_effect_actions = 0,
        .maximum_child_actions = 0,
    },
});

comptime {
    _ = Invalid;
}
