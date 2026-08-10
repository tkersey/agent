const std = @import("std");
const agent = @import("agent");
const boundary = @import("boundary");

const ListResult = struct { count: u32 };
const ListRepository = boundary.effect.site(
    1,
    "repo.list.v1",
    void,
    ListResult,
);
const Action = union(enum) {
    list_repository: void,
    final: u32,
    abort: Failure,
};
const Observation = union(enum) { list_repository: ListResult };
const Failure = enum {
    budget_exhausted,
    history_overflow,
    arithmetic_overflow,
    invalid_variant,
    capacity_exceeded,
    authored_abort,
};

const Definition = agent.define(.{
    .name = "void-effect-action",
    .version = "1.0.0",
    .instructions = "List the repository, then return the observed count.",
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
        agent.action.effect(
            .list_repository,
            .list_repository,
            ListRepository,
            .{ .name = "list_repository", .description = "List repository." },
        ),
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

test "void effect Action lowers to one ordinary unit request" {
    var state = try Machine.initialState(std.testing.allocator, @as(u32, 1));
    defer Machine.deinitState(state);
    var fuel: u64 = 4096;

    const decision = switch (try Machine.step(state, &fuel)) {
        .request => |request| request,
        else => return error.UnexpectedMachineStep,
    };
    try resumeRequest(&state, decision, Action{ .list_repository = {} });

    const list_request = switch (try Machine.step(state, &fuel)) {
        .request => |request| request,
        else => return error.UnexpectedMachineStep,
    };
    try resumeRequest(&state, list_request, ListResult{ .count = 3 });

    const final_decision = switch (try Machine.step(state, &fuel)) {
        .request => |request| request,
        else => return error.UnexpectedMachineStep,
    };
    try resumeRequest(&state, final_decision, Action{ .final = 3 });

    const done = switch (try Machine.step(state, &fuel)) {
        .done => |result| result,
        else => return error.UnexpectedMachineStep,
    };
    defer done.deinit();
    try std.testing.expectEqual(@as(u32, 3), done.value().*);
}
