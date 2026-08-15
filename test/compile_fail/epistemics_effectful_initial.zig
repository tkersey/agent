const agent = @import("agent");
const boundary = @import("boundary");

const Action = union(enum) { final: u32 };
const Failure = enum {
    budget_exhausted,
    arithmetic_overflow,
    invalid_variant,
    capacity_exceeded,
};
const Definition = agent.define(.{
    .name = "effectful-epistemics",
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
const ForbiddenSite = boundary.effect.site(98, "fixture.forbidden-epistemic.v1", u32, u32);
const Implementation = struct {
    pub fn validate(comptime _: type, comptime _: void) void {}
    pub fn Memory(comptime _: type, comptime _: void) type {
        return u32;
    }
    pub fn DecisionView(comptime _: type, comptime _: void) type {
        return u32;
    }
    pub fn StateSchemaTypes(comptime _: type, comptime _: void) @TypeOf(.{u32}) {
        return .{u32};
    }
    pub fn initialMemory(comptime _: type, comptime _: void) u32 {
        return 0;
    }
    pub fn emitInitial(comptime _: type, comptime _: void, flow: anytype, goal: anytype, comptime _: anytype) agent.Value(u32) {
        return flow.perform(ForbiddenSite, goal, .{}).value;
    }
    pub fn emitObserve(comptime _: type, comptime _: void, flow: anytype, memory: anytype, _: anytype, comptime _: anytype) agent.Value(u32) {
        return flow.copy(memory);
    }
    pub fn emitProject(comptime _: type, comptime _: void, flow: anytype, memory: anytype) agent.Value(u32) {
        return flow.copy(memory);
    }
    pub fn emitFinalAllowed(comptime _: type, comptime _: void, flow: anytype, _: anytype, _: anytype, comptime context: anytype) agent.Value(bool) {
        return flow.constant(bool, context.true_index);
    }
};
const BaseEpistemics = agent.epistemics.custom(.{
    .semantic_identity = "fixture.effectful-epistemics.v1",
    .config = {},
    .implementation = Implementation,
});
const Epistemics = struct {
    pub const semantic_identity = BaseEpistemics.semantic_identity;
    pub const is_verbatim = BaseEpistemics.is_verbatim;
    pub const Config = BaseEpistemics.Config;
    pub const normalized_config = BaseEpistemics.normalized_config;
    pub const semantic_config_digest = BaseEpistemics.semantic_config_digest;
    pub const has_implementation_constant_values = BaseEpistemics.has_implementation_constant_values;
    pub const lowering_complexity = BaseEpistemics.lowering_complexity;

    pub fn constantValues(comptime D: type) @TypeOf(BaseEpistemics.constantValues(D)) {
        return BaseEpistemics.constantValues(D);
    }
    pub fn constantContext(comptime D: type, comptime base: u16) type {
        return BaseEpistemics.constantContext(D, base);
    }
    pub fn validate(comptime D: type) void {
        BaseEpistemics.validate(D);
    }
    pub fn MemoryType(comptime D: type) type {
        return BaseEpistemics.MemoryType(D);
    }
    pub fn DecisionViewType(comptime D: type) type {
        return BaseEpistemics.DecisionViewType(D);
    }
    pub fn StateSchemaTypes(comptime D: type) @TypeOf(BaseEpistemics.StateSchemaTypes(D)) {
        return BaseEpistemics.StateSchemaTypes(D);
    }
    pub fn initialMemory(comptime D: type) MemoryType(D) {
        return BaseEpistemics.initialMemory(D);
    }
    pub fn emitInitial(comptime _: type, flow: anytype, goal: anytype, comptime _: anytype) agent.Value(u32) {
        return flow.perform(ForbiddenSite, goal, .{}).value;
    }
    pub fn emitObserve(comptime D: type, flow: anytype, memory: anytype, observation: anytype, comptime context: anytype) agent.Value(MemoryType(D)) {
        return BaseEpistemics.emitObserve(D, flow, memory, observation, context);
    }
    pub fn emitObservePayload(comptime D: type, flow: anytype, memory: anytype, comptime observation_index: u16, payload: anytype, comptime context: anytype) agent.Value(MemoryType(D)) {
        return BaseEpistemics.emitObservePayload(D, flow, memory, observation_index, payload, context);
    }
    pub fn emitProject(comptime D: type, flow: anytype, memory: anytype) agent.Value(DecisionViewType(D)) {
        return BaseEpistemics.emitProject(D, flow, memory);
    }
    pub fn emitFinalAllowed(comptime D: type, flow: anytype, memory: anytype, result: anytype, comptime context: anytype) agent.Value(bool) {
        return BaseEpistemics.emitFinalAllowed(D, flow, memory, result, context);
    }
};

comptime {
    _ = agent.compile(
        Definition,
        agent.strategy.react(.{}),
        Epistemics,
        .{ .machine = .{} },
    );
}
