const agent = @import("agent");
const boundary = @import("boundary");

const Tool = boundary.effect.site(1, "fixture.tool.v1", void, u32);
const Forbidden = boundary.effect.site(98, "fixture.forbidden-admission.v1", bool, bool);
const Failure = enum { budget_exhausted, arithmetic_overflow, invalid_variant, capacity_exceeded };
const Action = union(enum) { tool: void, final: u32 };
const Observation = union(enum) { tool: u32 };

const Definition = agent.define(.{
    .name = "effectful-action-admission",
    .version = "1.0.0",
    .instructions = "Exercise action admission purity.",
    .Goal = u32,
    .Action = Action,
    .Observation = Observation,
    .Result = u32,
    .Failure = Failure,
    .decision = .{ .interface = "fixture.decide.v1", .maximum_request_bytes = 4096, .maximum_result_bytes = 64 },
    .actions = .{
        agent.action.effect(.tool, .tool, Tool, .{ .name = "tool", .description = "Run tool." }),
        agent.action.final(.final, .{ .name = "final", .description = "Return." }),
    },
    .budget = .{ .maximum_turns = 2, .maximum_decisions = 2, .maximum_effect_actions = 1, .maximum_child_actions = 0 },
});

const Implementation = struct {
    pub const semantic_identity = "fixture.effectful-action-admission.lowering.v1";
    pub fn validate(comptime _: type, comptime _: void) void {}
    pub fn Memory(comptime _: type, comptime _: void) type {
        return bool;
    }
    pub fn DecisionView(comptime _: type, comptime _: void) type {
        return bool;
    }
    pub fn StateSchemaTypes(comptime _: type, comptime _: void) @TypeOf(.{bool}) {
        return .{bool};
    }
    pub fn initialMemory(comptime _: type, comptime _: void) bool {
        return false;
    }
    pub fn emitObserve(comptime _: type, comptime _: void, flow: anytype, memory: anytype, _: anytype, comptime _: anytype) agent.Value(bool) {
        return flow.copy(memory);
    }
    pub fn emitProject(comptime _: type, comptime _: void, flow: anytype, memory: anytype) agent.Value(bool) {
        return flow.copy(memory);
    }
    pub fn emitActionAllowed(comptime _: type, comptime _: void, flow: anytype, memory: anytype, _: anytype, comptime _: anytype) agent.Value(bool) {
        const prior_request_count = flow.request_count;
        const prior_control_count = flow.control_mutation_count;
        const result = flow.perform(Forbidden, memory, .{}).value;
        flow.request_count = prior_request_count;
        flow.control_mutation_count = prior_control_count;
        return result;
    }
    pub fn emitFinalAllowed(comptime _: type, comptime _: void, flow: anytype, _: anytype, _: anytype, comptime context: anytype) agent.Value(bool) {
        return flow.constant(bool, context.true_index);
    }
};

const Epistemics = agent.epistemics.custom(.{
    .semantic_identity = "fixture.effectful-action-admission.v1",
    .config = {},
    .implementation = Implementation,
});

comptime {
    _ = agent.compile(Definition, agent.strategy.react(.{}), Epistemics, .{ .machine = .{} });
}
