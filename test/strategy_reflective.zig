const std = @import("std");
const agent = @import("agent");
const boundary = @import("boundary");

const ToolSite = boundary.effect.site(44, "reflective.tool.v1", u32, u32);

const Failure = enum {
    budget_exhausted,
    history_overflow,
    arithmetic_overflow,
    invalid_variant,
    capacity_exceeded,
    authored_abort,
};

const Action = union(enum) {
    tool: u32,
    final: u32,
    abort: Failure,
};

const Observation = union(enum) {
    tool: u32,
};

const Definition = agent.define(.{
    .name = "reflective-fixture",
    .version = "1.0.0",
    .instructions = "Propose, reflect once, then dispatch only declared actions.",
    .Goal = u32,
    .Action = Action,
    .Observation = Observation,
    .Result = u32,
    .Failure = Failure,
    .decision = .{
        .interface = "reflective.decide.v1",
        .maximum_request_bytes = 32 * 1024,
        .maximum_result_bytes = 1024,
    },
    .actions = .{
        agent.action.effect(.tool, .tool, ToolSite, .{
            .name = "tool",
            .description = "Invoke the reflective fixture tool.",
            .class = .tool,
        }),
        agent.action.final(.final, .{
            .name = "final",
            .description = "Return the reflected result.",
        }),
        agent.action.fail(.abort, .{
            .name = "abort",
            .description = "Return an authored failure.",
        }),
    },
    .budget = .{
        .maximum_turns = 4,
        .maximum_decisions = 8,
        .maximum_effect_actions = 2,
        .maximum_child_actions = 0,
    },
});
const Epistemics = agent.epistemics.verbatim(.{
    .maximum_observations = 4,
    .overflow = .fail,
    .final = agent.final_policy.none,
});

const machine_options = .{
    .maximum_frames = 32,
    .maximum_state_bytes = 64 * 1024,
    .maximum_machine_fuel = 8192,
};
const Reflective = agent.compile(
    Definition,
    agent.strategy.reflective(.{ .reflection_rounds = 1 }),
    Epistemics,
    .{ .machine = machine_options },
);
const React = agent.compile(
    Definition,
    agent.strategy.react(.{}),
    Epistemics,
    .{ .machine = machine_options },
);
const Machine = Reflective.Machine;

fn resumeRequest(state: *Machine.State, request: Machine.Request, value: anytype) !void {
    const prepared = try Machine.prepareResume(state.*, request);
    defer Machine.deinitPreparedResume(prepared);
    try Machine.@"resume"(prepared, value);
}

test "Reflective ReAct proposes, reflects, dispatches, and specializes distinctly" {
    try std.testing.expect(!std.mem.eql(
        u8,
        &React.Machine.Manifest.machine_contract_digest,
        &Reflective.Machine.Manifest.machine_contract_digest,
    ));
    try std.testing.expect(
        React.Program.control_ir.blocks.len != Reflective.Program.control_ir.blocks.len,
    );

    var state = try Machine.initialState(std.testing.allocator, @as(u32, 5));
    defer Machine.deinitState(state);
    var fuel: u64 = 4096;

    const proposal = switch (try Machine.step(state, &fuel)) {
        .request => |request| request,
        else => return error.UnexpectedMachineStep,
    };
    switch (proposal.value) {
        .s0 => |request| {
            try std.testing.expectEqual(agent.DecisionPhase.propose, request.phase);
            try std.testing.expect(request.strategy_local == null);
            try std.testing.expectEqual(@as(u32, 0), request.counters.decisions);
        },
        else => return error.UnexpectedEffectSite,
    }
    try resumeRequest(&state, proposal, Action{ .tool = 7 });

    const reflection = switch (try Machine.step(state, &fuel)) {
        .request => |request| request,
        else => return error.UnexpectedMachineStep,
    };
    switch (reflection.value) {
        .s0 => |request| {
            try std.testing.expectEqual(agent.DecisionPhase.reflect, request.phase);
            try std.testing.expectEqual(@as(u32, 1), request.counters.decisions);
            switch (request.strategy_local.?) {
                .tool => |payload| try std.testing.expectEqual(@as(u32, 7), payload),
                else => return error.UnexpectedCandidate,
            }
        },
        else => return error.UnexpectedEffectSite,
    }
    try resumeRequest(&state, reflection, Action{ .tool = 8 });

    const tool = switch (try Machine.step(state, &fuel)) {
        .request => |request| request,
        else => return error.UnexpectedMachineStep,
    };
    switch (tool.value) {
        .s1 => |payload| try std.testing.expectEqual(@as(u32, 8), payload),
        else => return error.UnexpectedEffectSite,
    }
    try resumeRequest(&state, tool, @as(u32, 11));

    const final_proposal = switch (try Machine.step(state, &fuel)) {
        .request => |request| request,
        else => return error.UnexpectedMachineStep,
    };
    switch (final_proposal.value) {
        .s0 => |request| {
            try std.testing.expectEqual(agent.DecisionPhase.propose, request.phase);
            try std.testing.expectEqual(@as(u32, 1), request.counters.turns);
            try std.testing.expectEqual(@as(u32, 2), request.counters.decisions);
            try std.testing.expectEqual(@as(u32, 1), request.counters.effect_actions);
            try std.testing.expectEqual(@as(u32, 1), try request.context.len());
        },
        else => return error.UnexpectedEffectSite,
    }
    try resumeRequest(&state, final_proposal, Action{ .final = 99 });

    const final_reflection = switch (try Machine.step(state, &fuel)) {
        .request => |request| request,
        else => return error.UnexpectedMachineStep,
    };
    switch (final_reflection.value) {
        .s0 => |request| switch (request.strategy_local.?) {
            .final => |result| try std.testing.expectEqual(@as(u32, 99), result),
            else => return error.UnexpectedCandidate,
        },
        else => return error.UnexpectedEffectSite,
    }
    try resumeRequest(&state, final_reflection, Action{ .final = 100 });

    const done = switch (try Machine.step(state, &fuel)) {
        .done => |result| result,
        else => return error.UnexpectedMachineStep,
    };
    defer done.deinit();
    try std.testing.expectEqual(@as(u32, 100), done.value().*);
}
