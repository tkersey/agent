const std = @import("std");
const agent = @import("agent");
const boundary = @import("boundary");

const TestRequest = struct { suite: u8 };
const TestResult = struct { passed: bool };
const RunTests = boundary.effect.site(1, "repo.test.v1", TestRequest, TestResult);
const Action = union(enum) {
    run_tests: TestRequest,
    final: u32,
    abort: Failure,
};
const Observation = union(enum) { run_tests: TestResult };
const Failure = enum {
    budget_exhausted,
    history_overflow,
    arithmetic_overflow,
    invalid_index,
    invalid_variant,
    capacity_exceeded,
    authored_abort,
};

const Definition = agent.define(.{
    .name = "final-policy-positive",
    .version = "1.0.0",
    .instructions = "Return final only after a passing test observation.",
    .Goal = u32,
    .Action = Action,
    .Observation = Observation,
    .Result = u32,
    .Failure = Failure,
    .decision = .{
        .interface = "model.decide.v1",
        .maximum_request_bytes = 4096,
        .maximum_result_bytes = 1024,
    },
    .actions = .{
        agent.action.effect(.run_tests, .run_tests, RunTests, .{
            .name = "run_tests",
            .description = "Run tests.",
        }),
        agent.action.final(.final, .{ .name = "final", .description = "Finish." }),
        agent.action.fail(.abort, .{ .name = "abort", .description = "Abort." }),
    },
    .budget = .{
        .maximum_turns = 4,
        .maximum_decisions = 4,
        .maximum_effect_actions = 2,
        .maximum_child_actions = 0,
    },
    .history = .{ .maximum_observations = 2, .overflow = .fail },
    .final_policy = agent.final_policy.latestObservationBool(
        .run_tests,
        .passed,
        true,
    ),
});

const Machine = agent.compile(Definition, agent.strategy.react(.{}), .{
    .machine = .{
        .maximum_frames = 32,
        .maximum_state_bytes = 64 * 1024,
        .maximum_machine_fuel = 4096,
    },
}).Machine;

fn resumeRequest(state: *Machine.State, request: Machine.Request, value: anytype) !void {
    const prepared = try Machine.prepareResume(state.*, request);
    defer Machine.deinitPreparedResume(prepared);
    try Machine.@"resume"(prepared, value);
}

test "final policy returns after the latest test observation passes" {
    var state = try Machine.initialState(std.testing.allocator, @as(u32, 1));
    defer Machine.deinitState(state);
    var fuel: u64 = 4096;

    const decision = switch (try Machine.step(state, &fuel)) {
        .request => |request| request,
        else => return error.UnexpectedMachineStep,
    };
    try resumeRequest(&state, decision, Action{ .run_tests = .{ .suite = 0 } });
    const test_request = switch (try Machine.step(state, &fuel)) {
        .request => |request| request,
        else => return error.UnexpectedMachineStep,
    };
    try resumeRequest(&state, test_request, TestResult{ .passed = true });
    const final_decision = switch (try Machine.step(state, &fuel)) {
        .request => |request| request,
        else => return error.UnexpectedMachineStep,
    };
    try resumeRequest(&state, final_decision, Action{ .final = 42 });

    const done = switch (try Machine.step(state, &fuel)) {
        .done => |result| result,
        else => return error.UnexpectedMachineStep,
    };
    defer done.deinit();
    try std.testing.expectEqual(@as(u32, 42), done.value().*);
}
