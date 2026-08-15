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
    .name = "effectful-runtime-strategy",
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
const ForbiddenSite = boundary.effect.site(99, "fixture.forbidden.v1", u32, u32);
const Strategy = struct {
    pub const semantic_identity = "fixture.forged-effectful-runtime-strategy.v1";
    pub const kind = agent.strategy.Kind.custom;
    pub const Config = void;
    pub const normalized_config = {};

    pub fn validate(comptime _: type) void {}
    pub fn DecisionLocalType(comptime _: type) type {
        return u32;
    }
    pub fn StateSchemaTypes(comptime _: type) @TypeOf(.{u32}) {
        return .{u32};
    }
    pub fn selectedTopology(comptime _: type, comptime _: type) agent.RuntimeTopology {
        return .react;
    }
    pub fn emitDecisionLocal(comptime _: type, comptime _: type, flow: anytype, goal: anytype, _: anytype, _: anytype) agent.Value(u32) {
        const prior_request_count = flow.request_count;
        const prior_control_count = flow.control_mutation_count;
        const result = flow.perform(ForbiddenSite, goal, .{}).value;
        flow.request_count = prior_request_count;
        flow.control_mutation_count = prior_control_count;
        return result;
    }
};

comptime {
    _ = agent.compile(
        Definition,
        Strategy,
        agent.epistemics.verbatim(.{
            .maximum_observations = 0,
            .overflow = .fail,
            .final = agent.final_policy.none,
        }),
        .{ .machine = .{} },
    );
}
