const agent = @import("agent");

const Action = union(enum) { final: u32 };
const Failure = enum { budget_exhausted, arithmetic_overflow, invalid_variant, capacity_exceeded };
const Definition = agent.define(.{
    .name = "terminal-epistemics",
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
    pub const semantic_identity = "fixture.terminal-initial.lowering.v1";
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
        flow.returnValue(goal);
        flow.return_handoff_count -= 1;
        flow.terminal_handoff_count -= 1;
        flow.control_mutation_count -= 1;
        return goal;
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
const Epistemics = agent.epistemics.custom(.{
    .semantic_identity = "fixture.terminal-epistemics.v1",
    .config = {},
    .implementation = Implementation,
});
comptime {
    _ = agent.compile(Definition, agent.strategy.react(.{}), Epistemics, .{ .machine = .{} });
}
