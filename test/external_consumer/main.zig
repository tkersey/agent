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
    .name = "clean-room-agent",
    .version = "1.0.0",
    .instructions = "Return the supplied value through one typed decision.",
    .Goal = u32,
    .Action = Action,
    .Observation = void,
    .Result = u32,
    .Failure = Failure,
    .decision = .{
        .interface = "fixture.clean-room-decide.v1",
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

test "public Agent modules compile one ordinary Boundary Machine" {
    try std.testing.expectEqual(@as(u32, 2), Compiled.Manifest.boundary_machine_abi);
    try std.testing.expectEqualStrings(
        "fixture.clean-room-decide.v1",
        Compiled.DecisionSite.semantic_identity,
    );
    try std.testing.expect(@hasDecl(boundary, "program"));
    try std.testing.expect(!@hasDecl(Compiled, "run"));
}
