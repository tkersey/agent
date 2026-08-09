const agent = @import("agent");

const Action = union(enum) { final: u32 };
const Failure = enum { authored };
const Definition = agent.define(.{
    .name = "strategy-coverage",
    .version = "1.0.0",
    .instructions = "Return.",
    .Goal = u32,
    .Action = Action,
    .Observation = void,
    .Result = u32,
    .Failure = Failure,
    .decision = .{ .interface = "decide.v1", .maximum_request_bytes = 64, .maximum_result_bytes = 64 },
    .actions = .{agent.action.final(.final, .{ .name = "final", .description = "Return." })},
    .budget = .{ .maximum_turns = 1, .maximum_decisions = 1, .maximum_effect_actions = 0, .maximum_child_actions = 0 },
    .history = .{ .maximum_observations = 0, .overflow = .fail },
});
const Implementation = struct {
    pub fn validate(comptime _: type, comptime _: void) void {}
    pub fn DecisionRequest(comptime _: type, comptime _: void) type {
        return u32;
    }
    pub fn StateSchemaTypes(comptime _: type, comptime _: void) @TypeOf(.{}) {
        return .{};
    }
    pub fn Body(comptime _: type, comptime _: void) type {
        return void;
    }
};
const Strategy = agent.strategy.custom(.{
    .semantic_identity = "fixture.omits-action.v1",
    .config = {},
    .implementation = Implementation,
    .action_coverage = .{},
});

comptime {
    _ = agent.compile(Definition, Strategy, .{ .machine = .{} });
}
