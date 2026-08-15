const agent = @import("agent");

const Action = union(enum) { final: u32 };
const Failure = enum { budget_exhausted, history_overflow, arithmetic_overflow, invalid_variant, capacity_exceeded };
const Definition = agent.define(.{
    .name = "branching-runtime-strategy",
    .version = "2.0.0",
    .instructions = "Return.",
    .Goal = u32,
    .Action = Action,
    .Observation = void,
    .Result = u32,
    .Failure = Failure,
    .decision = .{ .interface = "fixture.decide.v1", .maximum_request_bytes = 4096, .maximum_result_bytes = 64 },
    .actions = .{agent.action.final(.final, .{ .name = "final", .description = "Return." })},
    .budget = .{ .maximum_turns = 1, .maximum_decisions = 1, .maximum_effect_actions = 0, .maximum_child_actions = 0 },
});
const Implementation = struct {
    pub fn validate(comptime _: type, comptime _: void) void {}
    pub fn DecisionLocalType(comptime _: type, comptime _: void) type {
        return u32;
    }
    pub fn StateSchemaTypes(comptime _: type, comptime _: void) @TypeOf(.{u32}) {
        return .{u32};
    }
    pub fn topology(comptime _: type, comptime _: void, comptime runtime: type) agent.RuntimeTopology {
        return runtime.react();
    }
    pub fn emitDecisionLocal(comptime _: type, comptime _: void, flow: anytype, state: anytype) agent.Value(u32) {
        const goal = flow.productExtract(0, state);
        const selected = flow.block(.segment, .{u32});
        flow.jump(selected, .{goal});
        return flow.enter(selected)[0];
    }
};
const Strategy = agent.strategy.custom(.{
    .semantic_identity = "fixture.branching-runtime-strategy.v1",
    .config = {},
    .implementation = Implementation,
    .action_coverage = .{"final"},
});
comptime {
    _ = agent.compile(Definition, Strategy, agent.epistemics.verbatim(.{
        .maximum_observations = 0,
        .overflow = .fail,
        .final = agent.final_policy.none,
    }), .{ .machine = .{} });
}
