const agent = @import("agent");
const boundary = @import("boundary");

const Result = struct { passed: u32 };
const Site = boundary.effect.site(1, "test.v1", void, Result);
const Action = union(enum) { run_tests: void, final: u32 };
const Observation = union(enum) { run_tests: Result };
const Failure = enum { authored };

comptime {
    _ = agent.define(.{
        .name = "non-boolean-final-field",
        .version = "1.0.0",
        .instructions = "Reject a non-boolean final-policy field.",
        .Goal = u32,
        .Action = Action,
        .Observation = Observation,
        .Result = u32,
        .Failure = Failure,
        .decision = .{ .interface = "decide.v1", .maximum_request_bytes = 256, .maximum_result_bytes = 64 },
        .actions = .{
            agent.action.effect(.run_tests, .run_tests, Site, .{ .name = "run_tests", .description = "Run." }),
            agent.action.final(.final, .{ .name = "final", .description = "Return." }),
        },
        .budget = .{ .maximum_turns = 1, .maximum_decisions = 1, .maximum_effect_actions = 1, .maximum_child_actions = 0 },
        .final_policy = agent.final_policy.latestObservationBool(.run_tests, .passed, true),
    });
}
