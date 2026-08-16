const std = @import("std");
const agent = @import("agent");
const boundary = @import("boundary");

const ToolSite = boundary.effect.site(77, "fixture.tool.v1", u32, u32);

const Action = union(enum) {
    tool: u32,
    final: u32,
    abort: Failure,
};

const Observation = union(enum) {
    tool: u32,
};

const Failure = enum {
    budget_exhausted,
    history_overflow,
    arithmetic_overflow,
    invalid_variant,
    invalid_index,
    capacity_exceeded,
    authored_abort,
};

const Definition = agent.define(.{
    .name = "compiler-fixture",
    .version = "1.0.0",
    .instructions = "Use the declared tool and return a typed result.",
    .Goal = u32,
    .Action = Action,
    .Observation = Observation,
    .Result = u32,
    .Failure = Failure,
    .decision = .{
        .interface = "fixture.decide.v1",
        .maximum_request_bytes = 32 * 1024,
        .maximum_result_bytes = 1024,
    },
    .actions = .{
        agent.action.effect(.tool, .tool, ToolSite, .{
            .name = "tool",
            .description = "Invoke the typed fixture tool.",
            .class = .tool,
        }),
        agent.action.final(.final, .{
            .name = "final",
            .description = "Return the typed result.",
        }),
        agent.action.fail(.abort, .{
            .name = "abort",
            .description = "Return an authored failure.",
        }),
    },
    .budget = .{
        .maximum_turns = 4,
        .maximum_decisions = 4,
        .maximum_effect_actions = 2,
        .maximum_child_actions = 0,
    },
});

const Strategy = agent.strategy.react(.{});
const Epistemics = agent.epistemics.verbatim(.{
    .maximum_observations = 1,
    .overflow = .drop_oldest,
    .final = agent.final_policy.none,
});
const Compiled = agent.compile(Definition, Strategy, Epistemics, .{
    .machine = .{
        .maximum_frames = 32,
        .maximum_state_bytes = 64 * 1024,
        .maximum_machine_fuel = 4096,
    },
});
const Machine = Compiled.Machine;

const HighComplexityWorkingSet = struct {
    pub const semantic_identity = "agent.epistemics.high-complexity-buffer-witness.v1";
    pub const lowering_complexity: usize = 8;

    pub fn validate(comptime _: type, comptime _: anytype) void {}
    pub fn Memory(comptime _: type, comptime _: anytype) type {
        return u32;
    }
    pub fn DecisionView(comptime _: type, comptime _: anytype) type {
        return u32;
    }
    pub fn StateSchemaTypes(comptime _: type, comptime _: anytype) @TypeOf(.{u32}) {
        return .{u32};
    }
    pub fn initialMemory(comptime _: type, comptime _: anytype) u32 {
        return 0;
    }
    pub fn emitObserve(comptime _: type, comptime _: anytype, flow: anytype, _: anytype, observation: anytype, comptime _: anytype) agent.Value(u32) {
        return flow.sumExtract(0, observation);
    }
    pub fn emitProject(comptime _: type, comptime _: anytype, flow: anytype, memory: anytype) agent.Value(u32) {
        return flow.copy(memory);
    }
    pub fn emitActionAllowed(comptime _: type, comptime _: anytype, _: anytype, _: anytype, _: anytype, comptime _: anytype) agent.Value(bool) {
        @compileError("known action admission must bypass the global lowering");
    }
    pub fn emitActionAllowedKnown(comptime _: type, comptime _: anytype, flow: anytype, _: anytype, comptime action_index: u16, _: anytype, comptime context: anytype) agent.Value(bool) {
        if (action_index != 0) @compileError("unexpected effect action index");
        return flow.constant(bool, context.true_index);
    }
    pub fn actionAlwaysAllowedKnown(comptime _: type, comptime _: anytype, comptime action_index: u16) bool {
        if (action_index != 0) @compileError("unexpected effect action index");
        return true;
    }
    pub fn emitFinalAllowed(comptime _: type, comptime _: anytype, flow: anytype, _: anytype, _: anytype, comptime context: anytype) agent.Value(bool) {
        return flow.constant(bool, context.true_index);
    }
};

const HighComplexityCompiled = agent.compile(
    Definition,
    Strategy,
    agent.epistemics.custom(.{
        .semantic_identity = "agent.epistemics.high-complexity-buffer-witness.v1",
        .config = .{},
        .implementation = HighComplexityWorkingSet,
    }),
    .{
        .machine = .{
            .maximum_frames = 32,
            .maximum_state_bytes = 64 * 1024,
            .maximum_machine_fuel = 4096,
        },
    },
);

test "custom epistemic complexity and known admission fit the released Boundary compiler envelope" {
    try std.testing.expectEqual(@as(u32, 2), HighComplexityCompiled.Machine.abi_version);
}

const DropOldestFailure = enum {
    budget_exhausted,
    arithmetic_overflow,
    invalid_variant,
    invalid_index,
    capacity_exceeded,
};
const DropOldestAction = union(enum) { tool: u32, final: u32 };
const DropOldestDefinition = agent.define(.{
    .name = "drop-oldest-without-overflow-failure",
    .version = "2.0.0",
    .instructions = "Use the tool and retain the newest observation.",
    .Goal = u32,
    .Action = DropOldestAction,
    .Observation = Observation,
    .Result = u32,
    .Failure = DropOldestFailure,
    .decision = .{ .interface = "fixture.drop-oldest.v1", .maximum_request_bytes = 32 * 1024, .maximum_result_bytes = 1024 },
    .actions = .{
        agent.action.effect(.tool, .tool, ToolSite, .{ .name = "tool", .description = "Use the tool.", .class = .tool }),
        agent.action.final(.final, .{ .name = "final", .description = "Finish." }),
    },
    .budget = .{ .maximum_turns = 2, .maximum_decisions = 2, .maximum_effect_actions = 1, .maximum_child_actions = 0 },
});
const DropOldestWithoutOverflowFailure = agent.compile(
    DropOldestDefinition,
    agent.strategy.react(.{}),
    agent.epistemics.verbatim(.{
        .maximum_observations = 1,
        .overflow = .drop_oldest,
        .final = agent.final_policy.none,
    }),
    .{ .machine = .{ .maximum_frames = 8, .maximum_state_bytes = 64 * 1024, .maximum_machine_fuel = 4096 } },
);

const FailHistoryDefinition = agent.define(.{
    .name = "history-fail-fixture",
    .version = "1.0.0",
    .instructions = "Use the declared tool and retain bounded history.",
    .Goal = u32,
    .Action = Action,
    .Observation = Observation,
    .Result = u32,
    .Failure = Failure,
    .decision = .{
        .interface = "fixture.decide.v1",
        .maximum_request_bytes = 32 * 1024,
        .maximum_result_bytes = 1024,
    },
    .actions = .{
        agent.action.effect(.tool, .tool, ToolSite, .{
            .name = "tool",
            .description = "Invoke the typed fixture tool.",
            .class = .tool,
        }),
        agent.action.final(.final, .{
            .name = "final",
            .description = "Return the typed result.",
        }),
        agent.action.fail(.abort, .{
            .name = "abort",
            .description = "Return an authored failure.",
        }),
    },
    .budget = .{
        .maximum_turns = 4,
        .maximum_decisions = 4,
        .maximum_effect_actions = 3,
        .maximum_child_actions = 0,
    },
});

const FailHistoryMachine = agent.compile(
    FailHistoryDefinition,
    agent.strategy.react(.{}),
    agent.epistemics.verbatim(.{
        .maximum_observations = 1,
        .overflow = .fail,
        .final = agent.final_policy.none,
    }),
    .{
        .machine = .{
            .maximum_frames = 32,
            .maximum_state_bytes = 64 * 1024,
            .maximum_machine_fuel = 4096,
        },
    },
).Machine;

const BudgetBeforeHistoryDefinition = agent.define(.{
    .name = "budget-before-history-fixture",
    .version = "2.0.0",
    .instructions = "Use the declared tool within both budgets.",
    .Goal = u32,
    .Action = Action,
    .Observation = Observation,
    .Result = u32,
    .Failure = Failure,
    .decision = .{
        .interface = "fixture.decide.v1",
        .maximum_request_bytes = 32 * 1024,
        .maximum_result_bytes = 1024,
    },
    .actions = .{
        agent.action.effect(.tool, .tool, ToolSite, .{
            .name = "tool",
            .description = "Invoke the typed fixture tool.",
            .class = .tool,
        }),
        agent.action.final(.final, .{ .name = "final", .description = "Finish." }),
        agent.action.fail(.abort, .{ .name = "abort", .description = "Abort." }),
    },
    .budget = .{
        .maximum_turns = 3,
        .maximum_decisions = 3,
        .maximum_effect_actions = 1,
        .maximum_child_actions = 0,
    },
});
const BudgetBeforeHistoryMachine = agent.compile(
    BudgetBeforeHistoryDefinition,
    agent.strategy.react(.{}),
    agent.epistemics.verbatim(.{
        .maximum_observations = 1,
        .overflow = .fail,
        .final = agent.final_policy.none,
    }),
    .{ .machine = .{ .maximum_frames = 16, .maximum_state_bytes = 64 * 1024, .maximum_machine_fuel = 4096 } },
).Machine;

fn resumeRequest(state: *Machine.State, request: Machine.Request, value: anytype) !void {
    const prepared = try Machine.prepareResume(state.*, request);
    defer Machine.deinitPreparedResume(prepared);
    try Machine.@"resume"(prepared, value);
}

test "drop_oldest keeps the newest bounded observation" {
    var state = try Machine.initialState(std.testing.allocator, @as(u32, 1));
    defer Machine.deinitState(state);
    var fuel: u64 = 4096;

    const decision_one = switch (try Machine.step(state, &fuel)) {
        .request => |request| request,
        else => return error.UnexpectedMachineStep,
    };
    try resumeRequest(&state, decision_one, Action{ .tool = 1 });
    const tool_one = switch (try Machine.step(state, &fuel)) {
        .request => |request| request,
        else => return error.UnexpectedMachineStep,
    };
    try resumeRequest(&state, tool_one, @as(u32, 11));

    const decision_two = switch (try Machine.step(state, &fuel)) {
        .request => |request| request,
        else => return error.UnexpectedMachineStep,
    };
    try resumeRequest(&state, decision_two, Action{ .tool = 2 });
    const tool_two = switch (try Machine.step(state, &fuel)) {
        .request => |request| request,
        else => return error.UnexpectedMachineStep,
    };
    try resumeRequest(&state, tool_two, @as(u32, 22));

    const decision_three = switch (try Machine.step(state, &fuel)) {
        .request => |request| request,
        else => return error.UnexpectedMachineStep,
    };
    switch (decision_three.value) {
        .s0 => |request| {
            try std.testing.expectEqual(@as(u32, 1), try request.context.len());
            const observation = (try request.context.get(0)).?;
            switch (observation) {
                .tool => |value| try std.testing.expectEqual(@as(u32, 22), value),
            }
        },
        else => return error.UnexpectedEffectSite,
    }
    try resumeRequest(&state, decision_three, Action{ .tool = 3 });
    switch (try Machine.step(state, &fuel)) {
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

test "drop_oldest does not require an unused history_overflow failure" {
    const state = try DropOldestWithoutOverflowFailure.Machine.initialState(
        std.testing.allocator,
        @as(u32, 1),
    );
    defer DropOldestWithoutOverflowFailure.Machine.deinitState(state);
}

test "verbatim fail policy rejects an effect before execution at capacity" {
    const state = try FailHistoryMachine.initialState(
        std.testing.allocator,
        @as(u32, 1),
    );
    defer FailHistoryMachine.deinitState(state);
    var fuel: u64 = 4096;

    const first_decision = switch (try FailHistoryMachine.step(state, &fuel)) {
        .request => |request| request,
        else => return error.UnexpectedMachineStep,
    };
    {
        const prepared = try FailHistoryMachine.prepareResume(state, first_decision);
        defer FailHistoryMachine.deinitPreparedResume(prepared);
        try FailHistoryMachine.@"resume"(prepared, Action{ .tool = 1 });
    }
    const first_tool = switch (try FailHistoryMachine.step(state, &fuel)) {
        .request => |request| request,
        else => return error.UnexpectedMachineStep,
    };
    {
        const prepared = try FailHistoryMachine.prepareResume(state, first_tool);
        defer FailHistoryMachine.deinitPreparedResume(prepared);
        try FailHistoryMachine.@"resume"(prepared, @as(u32, 11));
    }
    const second_decision = switch (try FailHistoryMachine.step(state, &fuel)) {
        .request => |request| request,
        else => return error.UnexpectedMachineStep,
    };
    {
        const prepared = try FailHistoryMachine.prepareResume(state, second_decision);
        defer FailHistoryMachine.deinitPreparedResume(prepared);
        try FailHistoryMachine.@"resume"(prepared, Action{ .tool = 2 });
    }

    switch (try FailHistoryMachine.step(state, &fuel)) {
        .failed => |failure| switch (failure) {
            .authored => |authored| try std.testing.expectEqual(
                Failure.history_overflow,
                authored,
            ),
            else => return error.UnexpectedMachineFailure,
        },
        .request => return error.UnexpectedMachineStep,
        else => return error.UnexpectedMachineStep,
    }
}

test "effect budget failure precedes verbatim history overflow" {
    const state = try BudgetBeforeHistoryMachine.initialState(
        std.testing.allocator,
        @as(u32, 1),
    );
    defer BudgetBeforeHistoryMachine.deinitState(state);
    var fuel: u64 = 4096;

    const first_decision = switch (try BudgetBeforeHistoryMachine.step(state, &fuel)) {
        .request => |request| request,
        else => return error.UnexpectedMachineStep,
    };
    {
        const prepared = try BudgetBeforeHistoryMachine.prepareResume(state, first_decision);
        defer BudgetBeforeHistoryMachine.deinitPreparedResume(prepared);
        try BudgetBeforeHistoryMachine.@"resume"(prepared, Action{ .tool = 1 });
    }
    const tool = switch (try BudgetBeforeHistoryMachine.step(state, &fuel)) {
        .request => |request| request,
        else => return error.UnexpectedMachineStep,
    };
    {
        const prepared = try BudgetBeforeHistoryMachine.prepareResume(state, tool);
        defer BudgetBeforeHistoryMachine.deinitPreparedResume(prepared);
        try BudgetBeforeHistoryMachine.@"resume"(prepared, @as(u32, 11));
    }
    const second_decision = switch (try BudgetBeforeHistoryMachine.step(state, &fuel)) {
        .request => |request| request,
        else => return error.UnexpectedMachineStep,
    };
    {
        const prepared = try BudgetBeforeHistoryMachine.prepareResume(state, second_decision);
        defer BudgetBeforeHistoryMachine.deinitPreparedResume(prepared);
        try BudgetBeforeHistoryMachine.@"resume"(prepared, Action{ .tool = 2 });
    }
    switch (try BudgetBeforeHistoryMachine.step(state, &fuel)) {
        .failed => |failure| switch (failure) {
            .authored => |authored| try std.testing.expectEqual(Failure.budget_exhausted, authored),
            else => return error.UnexpectedMachineFailure,
        },
        else => return error.UnexpectedMachineStep,
    }
}

test "agent.compile specializes ReAct into one Boundary Machine" {
    try std.testing.expectEqual(@as(u32, 2), Machine.abi_version);
    try std.testing.expect(Compiled.Program.control_ir.blocks.len > 0);
    try std.testing.expectEqual(@as(u32, 0), Compiled.DecisionSite.site_id);
    try std.testing.expectEqual(@as(u32, 1), Compiled.ActionSites[1].site_id);

    var state = try Machine.initialState(std.testing.allocator, @as(u32, 9));
    defer Machine.deinitState(state);
    var fuel: u64 = 2048;

    const first_decision = switch (try Machine.step(state, &fuel)) {
        .request => |request| request,
        else => return error.UnexpectedMachineStep,
    };
    switch (first_decision.value) {
        .s0 => |request| {
            try std.testing.expectEqual(@as(u32, 9), request.goal);
            try std.testing.expectEqual(@as(u32, 0), request.counters.decisions);
            try std.testing.expectEqual(@as(u32, 0), try request.context.len());
        },
        else => return error.UnexpectedEffectSite,
    }
    try resumeRequest(&state, first_decision, Action{ .tool = 7 });

    const tool = switch (try Machine.step(state, &fuel)) {
        .request => |request| request,
        else => return error.UnexpectedMachineStep,
    };
    switch (tool.value) {
        .s1 => |payload| try std.testing.expectEqual(@as(u32, 7), payload),
        else => return error.UnexpectedEffectSite,
    }
    try resumeRequest(&state, tool, @as(u32, 11));

    const second_decision = switch (try Machine.step(state, &fuel)) {
        .request => |request| request,
        else => return error.UnexpectedMachineStep,
    };
    switch (second_decision.value) {
        .s0 => |request| {
            try std.testing.expectEqual(@as(u32, 1), request.counters.turns);
            try std.testing.expectEqual(@as(u32, 1), request.counters.decisions);
            try std.testing.expectEqual(@as(u32, 1), request.counters.effect_actions);
            try std.testing.expectEqual(@as(u32, 1), try request.context.len());
            const observation = (try request.context.get(0)).?;
            switch (observation) {
                .tool => |value| try std.testing.expectEqual(@as(u32, 11), value),
            }
        },
        else => return error.UnexpectedEffectSite,
    }
    try resumeRequest(&state, second_decision, Action{ .final = 99 });

    const done = switch (try Machine.step(state, &fuel)) {
        .done => |result| result,
        else => return error.UnexpectedMachineStep,
    };
    defer done.deinit();
    try std.testing.expectEqual(@as(u32, 99), done.value().*);
}

test "compiled fail action preserves the authored runtime failure" {
    var state = try Machine.initialState(std.testing.allocator, @as(u32, 1));
    defer Machine.deinitState(state);
    var fuel: u64 = 512;
    const decision = switch (try Machine.step(state, &fuel)) {
        .request => |request| request,
        else => return error.UnexpectedMachineStep,
    };
    try resumeRequest(&state, decision, Action{ .abort = .authored_abort });
    switch (try Machine.step(state, &fuel)) {
        .failed => |failure| switch (failure) {
            .authored => |authored| try std.testing.expectEqual(
                Failure.authored_abort,
                authored,
            ),
            else => return error.UnexpectedMachineFailure,
        },
        else => return error.UnexpectedMachineStep,
    }
}
