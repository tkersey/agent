const agent = @import("agent");
const boundary = @import("boundary");

const Action = union(enum) { final: u32 };
const Failure = enum { authored };
const Definition = agent.define(.{
    .name = "strategy-effect-row",
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
const ExtraSite = boundary.effect.site(99, "fixture.undeclared.v1", u32, u32);
const Implementation = struct {
    pub fn validate(comptime _: type, comptime _: void) void {}
    pub fn DecisionRequest(comptime _: type, comptime _: void) type {
        return u32;
    }
    pub fn StateSchemaTypes(comptime _: type, comptime _: void) @TypeOf(.{}) {
        return .{};
    }
    pub fn Body(comptime AgentDefinition: type, comptime _: void) type {
        return struct {
            pub const effect_sites = .{
                agent.strategy.DecisionSiteFor(AgentDefinition, u32),
                ExtraSite,
            };
        };
    }
};
const Strategy = agent.strategy.custom(.{
    .semantic_identity = "fixture.undeclared-effect.v1",
    .config = {},
    .implementation = Implementation,
    .action_coverage = .{"final"},
});

comptime {
    _ = agent.compile(Definition, Strategy, .{ .machine = .{} });
}
