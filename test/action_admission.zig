const std = @import("std");
const agent = @import("agent");
const boundary = @import("boundary");

const TestResult = struct { passed: bool };
const ReplaceRequest = struct { revision: u32 };
const ReplaceResult = struct { applied: bool };
const RunTests = boundary.effect.site(1, "repo.test.v1", void, TestResult);
const ReplaceFile = boundary.effect.site(2, "repo.replace.approved.v1", ReplaceRequest, ReplaceResult);

const Failure = enum {
    budget_exhausted,
    history_overflow,
    arithmetic_overflow,
    invalid_index,
    invalid_variant,
    capacity_exceeded,
    authored_abort,
};

const Action = union(enum) {
    run_tests: void,
    replace_file: ReplaceRequest,
    final: u32,
    abort: Failure,
};

const Observation = union(enum) {
    run_tests: TestResult,
    replace_file: ReplaceResult,
};

const Definition = agent.define(.{
    .name = "action-admission-fixture",
    .version = "1.0.0",
    .instructions = "Run the baseline test before replacing a file.",
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
            .description = "Run the fixed check.",
        }),
        agent.action.effect(.replace_file, .replace_file, ReplaceFile, .{
            .name = "replace_file",
            .description = "Replace one admitted file.",
        }),
        agent.action.final(.final, .{ .name = "final", .description = "Finish." }),
        agent.action.fail(.abort, .{ .name = "abort", .description = "Abort." }),
    },
    .budget = .{
        .maximum_turns = 6,
        .maximum_decisions = 6,
        .maximum_effect_actions = 4,
        .maximum_child_actions = 0,
    },
});

const BaselineEpistemics = struct {
    pub const semantic_identity = "fixture.baseline-action-admission.lowering.v1";

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

    pub fn emitObservePayload(
        comptime _: type,
        comptime _: void,
        flow: anytype,
        memory: anytype,
        comptime observation_index: u16,
        _: anytype,
        comptime context: anytype,
    ) agent.Value(bool) {
        if (observation_index == 0) {
            return flow.constant(bool, context.true_index);
        }
        return flow.copy(memory);
    }

    pub fn emitProject(comptime _: type, comptime _: void, flow: anytype, memory: anytype) agent.Value(bool) {
        return flow.copy(memory);
    }

    pub fn emitActionAllowed(
        comptime _: type,
        comptime _: void,
        flow: anytype,
        memory: anytype,
        action: anytype,
        comptime _: anytype,
    ) agent.Value(bool) {
        const replacing = flow.sumTagIs(1, action);
        return flow.booleanOr(flow.booleanNot(replacing), memory);
    }

    pub fn emitActionAllowedKnown(
        comptime DefinitionType: type,
        comptime config: void,
        flow: anytype,
        memory: anytype,
        comptime _: u16,
        action: anytype,
        comptime context: anytype,
    ) agent.Value(bool) {
        return emitActionAllowed(DefinitionType, config, flow, memory, action, context);
    }

    pub fn actionAlwaysAllowedKnown(comptime _: type, comptime _: void, comptime _: u16) bool {
        return false;
    }

    pub fn emitFinalAllowed(comptime _: type, comptime _: void, flow: anytype, _: anytype, _: anytype, comptime context: anytype) agent.Value(bool) {
        return flow.constant(bool, context.true_index);
    }
};

const Epistemics = agent.epistemics.custom(.{
    .semantic_identity = "fixture.baseline-action-admission.v1",
    .config = {},
    .implementation = BaselineEpistemics,
});

const DefaultEpistemicsImplementation = struct {
    pub const semantic_identity = "fixture.default-action-admission.lowering.v1";
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
    pub fn emitFinalAllowed(comptime _: type, comptime _: void, flow: anytype, _: anytype, _: anytype, comptime context: anytype) agent.Value(bool) {
        return flow.constant(bool, context.true_index);
    }
};

const DefaultEpistemics = agent.epistemics.custom(.{
    .semantic_identity = "fixture.default-action-admission.v1",
    .config = {},
    .implementation = DefaultEpistemicsImplementation,
});

const Machine = agent.compile(Definition, agent.strategy.react(.{}), Epistemics, .{
    .machine = .{
        .maximum_frames = 32,
        .maximum_state_bytes = 64 * 1024,
        .maximum_machine_fuel = 8192,
    },
}).Machine;

const DefaultMachine = agent.compile(Definition, agent.strategy.react(.{}), DefaultEpistemics, .{
    .machine = .{
        .maximum_frames = 32,
        .maximum_state_bytes = 64 * 1024,
        .maximum_machine_fuel = 8192,
    },
}).Machine;

fn nextRequest(state: Machine.State) !Machine.Request {
    var fuel: u64 = 8192;
    return switch (try Machine.step(state, &fuel)) {
        .request => |request| request,
        else => error.ExpectedRequest,
    };
}

fn resumeRequest(state: *Machine.State, request: Machine.Request, value: anytype) !void {
    const prepared = try Machine.prepareResume(state.*, request);
    defer Machine.deinitPreparedResume(prepared);
    try Machine.@"resume"(prepared, value);
}

test "typed action admission rejects replacement before baseline without emitting an effect" {
    var state = try Machine.initialState(std.testing.allocator, @as(u32, 1));
    defer Machine.deinitState(state);

    const decision = try nextRequest(state);
    try resumeRequest(&state, decision, Action{ .replace_file = .{ .revision = 1 } });

    var fuel: u64 = 8192;
    switch (try Machine.step(state, &fuel)) {
        .failed => |failure| switch (failure) {
            .authored => |authored| try std.testing.expectEqual(Failure.invalid_variant, authored),
            else => return error.ExpectedTypedAdmissionFailure,
        },
        .request => return error.ForbiddenReplacementEffectEmitted,
        else => return error.ExpectedTypedAdmissionFailure,
    }
}

test "typed action admission permits replacement after baseline observation" {
    var state = try Machine.initialState(std.testing.allocator, @as(u32, 1));
    defer Machine.deinitState(state);

    const initial_decision = try nextRequest(state);
    try resumeRequest(&state, initial_decision, Action{ .run_tests = {} });
    const test_request = try nextRequest(state);
    try resumeRequest(&state, test_request, TestResult{ .passed = false });

    const replace_decision = try nextRequest(state);
    try resumeRequest(&state, replace_decision, Action{ .replace_file = .{ .revision = 1 } });
    const replace_request = try nextRequest(state);
    switch (replace_request.value) {
        .s2 => |payload| try std.testing.expectEqual(@as(u32, 1), payload.revision),
        else => return error.ExpectedReplacementEffect,
    }
}

test "custom epistemics without action admission preserve admit-all behavior" {
    const state = try DefaultMachine.initialState(std.testing.allocator, @as(u32, 1));
    defer DefaultMachine.deinitState(state);
    var fuel: u64 = 8192;

    const decision = switch (try DefaultMachine.step(state, &fuel)) {
        .request => |request| request,
        else => return error.ExpectedDecisionRequest,
    };
    {
        const prepared = try DefaultMachine.prepareResume(state, decision);
        defer DefaultMachine.deinitPreparedResume(prepared);
        try DefaultMachine.@"resume"(prepared, Action{ .replace_file = .{ .revision = 1 } });
    }

    const replace_request = switch (try DefaultMachine.step(state, &fuel)) {
        .request => |request| request,
        else => return error.ExpectedReplacementEffect,
    };
    switch (replace_request.value) {
        .s2 => |payload| try std.testing.expectEqual(@as(u32, 1), payload.revision),
        else => return error.ExpectedReplacementEffect,
    }
}
