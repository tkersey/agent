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
    .history = .{
        .maximum_observations = 1,
        .overflow = .drop_oldest,
    },
});

const Strategy = agent.strategy.react(.{});
const Compiled = agent.compile(Definition, Strategy, .{
    .machine = .{
        .maximum_frames = 32,
        .maximum_state_bytes = 64 * 1024,
        .maximum_machine_fuel = 4096,
    },
});
const Machine = Compiled.Machine;

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
    .history = .{
        .maximum_observations = 1,
        .overflow = .fail,
    },
});

const FailHistoryMachine = agent.compile(
    FailHistoryDefinition,
    agent.strategy.react(.{}),
    .{
        .machine = .{
            .maximum_frames = 32,
            .maximum_state_bytes = 64 * 1024,
            .maximum_machine_fuel = 4096,
        },
    },
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
            try std.testing.expectEqual(@as(u32, 1), try request.history.len());
            const observation = (try request.history.get(0)).?;
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

test "history fail policy rejects before emitting an excess effect" {
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
        .request => return error.ExcessEffectWasEmitted,
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
            try std.testing.expectEqual(@as(u32, 0), try request.history.len());
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
            try std.testing.expectEqual(@as(u32, 1), try request.history.len());
            const observation = (try request.history.get(0)).?;
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
