const std = @import("std");
const agent = @import("agent");
const boundary = @import("boundary");

const ToolSite = boundary.effect.site(70, "fixture.budget-tool.v1", u32, u32);
const ChildSite = boundary.effect.site(71, "fixture.budget-child.v1", u32, u32);
const Action = union(enum) {
    tool: u32,
    child: u32,
    final: u32,
};
const Observation = union(enum) {
    tool: u32,
    child: u32,
};
const Failure = enum {
    budget_exhausted,
    history_overflow,
    arithmetic_overflow,
    invalid_variant,
    capacity_exceeded,
};

fn Definition(
    comptime maximum_turns: u32,
    comptime maximum_decisions: u32,
    comptime maximum_effect_actions: u32,
    comptime maximum_child_actions: u32,
) type {
    return agent.define(.{
        .name = "budget-fixture",
        .version = "1.0.0",
        .instructions = "Exercise exactly the declared bounded actions.",
        .Goal = u32,
        .Action = Action,
        .Observation = Observation,
        .Result = u32,
        .Failure = Failure,
        .decision = .{
            .interface = "fixture.budget-decide.v1",
            .maximum_request_bytes = 16 * 1024,
            .maximum_result_bytes = 1024,
        },
        .actions = .{
            agent.action.effect(.tool, .tool, ToolSite, .{
                .name = "tool",
                .description = "Perform one tool action.",
                .class = .tool,
            }),
            agent.action.effect(.child, .child, ChildSite, .{
                .name = "child",
                .description = "Perform one child-agent action.",
                .class = .child_agent,
            }),
            agent.action.final(.final, .{
                .name = "final",
                .description = "Return the result.",
            }),
        },
        .budget = .{
            .maximum_turns = maximum_turns,
            .maximum_decisions = maximum_decisions,
            .maximum_effect_actions = maximum_effect_actions,
            .maximum_child_actions = maximum_child_actions,
        },
        .history = .{ .maximum_observations = 8, .overflow = .fail },
    });
}

fn MachineFor(comptime AgentDefinition: type, comptime Strategy: type) type {
    return agent.compile(AgentDefinition, Strategy, .{
        .machine = .{
            .maximum_frames = 32,
            .maximum_state_bytes = 128 * 1024,
            .maximum_machine_fuel = 10_000,
        },
    }).Machine;
}

const TurnMachine = MachineFor(Definition(2, 3, 3, 3), agent.strategy.react(.{}));
const EffectMachine = MachineFor(Definition(3, 3, 1, 3), agent.strategy.react(.{}));
const ChildMachine = MachineFor(Definition(3, 3, 3, 1), agent.strategy.react(.{}));
const DecisionMachine = MachineFor(
    Definition(3, 1, 3, 3),
    agent.strategy.reflective(.{ .reflection_rounds = 1 }),
);

fn nextRequest(
    comptime Machine: type,
    state: Machine.State,
    fuel: *u64,
) !Machine.Request {
    return switch (try Machine.step(state, fuel)) {
        .request => |request| request,
        else => error.UnexpectedMachineStep,
    };
}

fn resumeRequest(
    comptime Machine: type,
    state: Machine.State,
    request: Machine.Request,
    value: anytype,
) !void {
    const prepared = try Machine.prepareResume(state, request);
    defer Machine.deinitPreparedResume(prepared);
    try Machine.@"resume"(prepared, value);
}

fn expectBudgetFailure(comptime Machine: type, state: Machine.State, fuel: *u64) !void {
    switch (try Machine.step(state, fuel)) {
        .failed => |failure| switch (failure) {
            .authored => |authored| try std.testing.expectEqual(
                Failure.budget_exhausted,
                authored,
            ),
            else => return error.UnexpectedMachineFailure,
        },
        .request => return error.ExcessEffectWasEmitted,
        else => return error.UnexpectedMachineStep,
    }
}

fn performTool(
    comptime Machine: type,
    state: Machine.State,
    fuel: *u64,
    payload: u32,
    result: u32,
) !void {
    const decision = try nextRequest(Machine, state, fuel);
    try resumeRequest(Machine, state, decision, Action{ .tool = payload });
    const effect = try nextRequest(Machine, state, fuel);
    switch (effect.value) {
        .s1 => |observed| try std.testing.expectEqual(payload, observed),
        else => return error.UnexpectedEffectSite,
    }
    try resumeRequest(Machine, state, effect, result);
}

test "turn budget fails before the next decision" {
    const state = try TurnMachine.initialState(std.testing.allocator, @as(u32, 1));
    defer TurnMachine.deinitState(state);
    var fuel: u64 = 10_000;
    try performTool(TurnMachine, state, &fuel, 1, 11);
    try performTool(TurnMachine, state, &fuel, 2, 22);
    try expectBudgetFailure(TurnMachine, state, &fuel);
}

test "effect-action budget fails before the excess effect" {
    const state = try EffectMachine.initialState(std.testing.allocator, @as(u32, 1));
    defer EffectMachine.deinitState(state);
    var fuel: u64 = 10_000;
    try performTool(EffectMachine, state, &fuel, 1, 11);

    const decision = try nextRequest(EffectMachine, state, &fuel);
    try resumeRequest(EffectMachine, state, decision, Action{ .tool = 2 });
    try expectBudgetFailure(EffectMachine, state, &fuel);
}

test "child budget fails before the excess child effect" {
    const state = try ChildMachine.initialState(std.testing.allocator, @as(u32, 1));
    defer ChildMachine.deinitState(state);
    var fuel: u64 = 10_000;

    const first_decision = try nextRequest(ChildMachine, state, &fuel);
    try resumeRequest(ChildMachine, state, first_decision, Action{ .child = 1 });
    const first_child = try nextRequest(ChildMachine, state, &fuel);
    switch (first_child.value) {
        .s2 => |payload| try std.testing.expectEqual(@as(u32, 1), payload),
        else => return error.UnexpectedEffectSite,
    }
    try resumeRequest(ChildMachine, state, first_child, @as(u32, 2));

    const second_decision = try nextRequest(ChildMachine, state, &fuel);
    try resumeRequest(ChildMachine, state, second_decision, Action{ .child = 3 });
    try expectBudgetFailure(ChildMachine, state, &fuel);
}

test "reflection decision budget fails before the excess decision" {
    const state = try DecisionMachine.initialState(std.testing.allocator, @as(u32, 1));
    defer DecisionMachine.deinitState(state);
    var fuel: u64 = 10_000;
    const proposal = try nextRequest(DecisionMachine, state, &fuel);
    try resumeRequest(DecisionMachine, state, proposal, Action{ .final = 9 });
    try expectBudgetFailure(DecisionMachine, state, &fuel);
}
