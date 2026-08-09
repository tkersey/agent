const std = @import("std");
const agent = @import("agent");
const boundary = @import("boundary");

const First = boundary.effect.site(0, "flow.first.v1", u32, u32);
const Second = boundary.effect.site(1, "flow.second.v1", u32, u32);

fn Lowered() type {
    const Builder = agent.Flow(.{ .schema_types = .{} });
    comptime var flow = Builder.init("flow-linear-effects");
    const initial = flow.begin(u32);
    const first = flow.perform(First, initial, .{initial});
    const second = flow.perform(Second, first.value, first.carried);
    flow.returnValue(second.value);
    return flow.finish(u32);
}

const Body = struct {
    const Lowering = Lowered();
    pub const InitialArgs = u32;
    pub const Result = u32;
    pub const Failure = enum { authored };
    pub const effect_sites = boundary.effect.row(.{ First, Second });
    pub const schema_types = Lowering.schema_types;
    pub const control_ir = Lowering.control_ir;
};

const Program = boundary.program("flow-linear-effects", Body);
const Machine = Program.compile(.{
    .maximum_frames = 8,
    .maximum_state_bytes = 4096,
    .maximum_machine_fuel = 128,
});

const AuthoredFailure = enum(u8) {
    budget_exhausted,
    aborted,
};

fn FailureLowered() type {
    const Builder = agent.Flow(.{ .schema_types = .{AuthoredFailure} });
    comptime var flow = Builder.init("flow-authored-failure");
    const failure = flow.begin(AuthoredFailure);
    flow.failValue(failure);
    return flow.finish(void);
}

const FailureBody = struct {
    const Lowering = FailureLowered();
    pub const InitialArgs = AuthoredFailure;
    pub const Result = void;
    pub const Failure = AuthoredFailure;
    pub const effect_sites = boundary.effect.row(.{});
    pub const schema_types = Lowering.schema_types;
    pub const control_ir = Lowering.control_ir;
};

const FailureProgram = boundary.program("flow-authored-failure", FailureBody);
const FailureMachine = FailureProgram.compile(.{
    .maximum_frames = 2,
    .maximum_state_bytes = 1024,
    .maximum_machine_fuel = 32,
});

fn BranchLowered() type {
    const Builder = agent.Flow(.{ .schema_types = .{} });
    comptime var flow = Builder.init("flow-typed-branch");
    const input = flow.begin(u32);
    const when_zero = flow.block(.terminal_handoff, .{});
    const when_nonzero = flow.block(.terminal_handoff, .{u32});
    const is_zero = flow.compareEqZero(input);
    flow.branch(is_zero, when_zero, .{}, when_nonzero, .{input});

    _ = flow.enter(when_zero);
    const fallback = flow.constant(u32, 0);
    flow.returnValue(fallback);

    const nonzero = flow.enter(when_nonzero);
    flow.returnValue(nonzero[0]);
    return flow.finish(u32);
}

const BranchBody = struct {
    const Lowering = BranchLowered();
    pub const InitialArgs = u32;
    pub const Result = u32;
    pub const Failure = enum { impossible };
    pub const constants = .{@as(u32, 42)};
    pub const effect_sites = boundary.effect.row(.{});
    pub const schema_types = Lowering.schema_types;
    pub const control_ir = Lowering.control_ir;
};

const BranchMachine = boundary.program("flow-typed-branch", BranchBody).compile(.{
    .maximum_frames = 2,
    .maximum_state_bytes = 1024,
    .maximum_machine_fuel = 32,
});

test "Flow assigns values, continuations, and resume placeholders" {
    try std.testing.expectEqual(@as(usize, 3), Body.control_ir.blocks.len);
    try std.testing.expectEqual(@as(usize, 5), Body.control_ir.value_types.len);
    try std.testing.expectEqual(boundary.ir.BlockRole.after_handler, Body.control_ir.blocks[1].role);

    const state = try Machine.initialState(std.testing.allocator, @as(u32, 3));
    defer Machine.deinitState(state);
    var fuel: u64 = 64;

    const first = switch (try Machine.step(state, &fuel)) {
        .request => |request| request,
        else => return error.UnexpectedMachineStep,
    };
    switch (first.value) {
        .s0 => |payload| try std.testing.expectEqual(@as(u32, 3), payload),
        else => return error.UnexpectedEffectSite,
    }
    {
        const prepared = try Machine.prepareResume(state, first);
        defer Machine.deinitPreparedResume(prepared);
        try Machine.@"resume"(prepared, @as(u32, 7));
    }

    const second = switch (try Machine.step(state, &fuel)) {
        .request => |request| request,
        else => return error.UnexpectedMachineStep,
    };
    switch (second.value) {
        .s1 => |payload| try std.testing.expectEqual(@as(u32, 7), payload),
        else => return error.UnexpectedEffectSite,
    }
    {
        const prepared = try Machine.prepareResume(state, second);
        defer Machine.deinitPreparedResume(prepared);
        try Machine.@"resume"(prepared, @as(u32, 9));
    }

    const done = switch (try Machine.step(state, &fuel)) {
        .done => |result| result,
        else => return error.UnexpectedMachineStep,
    };
    defer done.deinit();
    try std.testing.expectEqual(@as(u32, 9), done.value().*);
}

test "Flow preserves an authored failure value through Boundary Machine ABI v2" {
    const state = try FailureMachine.initialState(
        std.testing.allocator,
        AuthoredFailure.aborted,
    );
    defer FailureMachine.deinitState(state);
    var fuel: u64 = 8;

    switch (try FailureMachine.step(state, &fuel)) {
        .failed => |failure| switch (failure) {
            .authored => |authored| try std.testing.expectEqual(
                AuthoredFailure.aborted,
                authored,
            ),
            else => return error.UnexpectedMachineFailure,
        },
        else => return error.UnexpectedMachineStep,
    }
}

test "Flow branches with typed successor parameters" {
    inline for (.{
        .{ @as(u32, 0), @as(u32, 42) },
        .{ @as(u32, 7), @as(u32, 7) },
    }) |fixture| {
        const state = try BranchMachine.initialState(std.testing.allocator, fixture[0]);
        defer BranchMachine.deinitState(state);
        var fuel: u64 = 16;
        const done = switch (try BranchMachine.step(state, &fuel)) {
            .done => |result| result,
            else => return error.UnexpectedMachineStep,
        };
        defer done.deinit();
        try std.testing.expectEqual(fixture[1], done.value().*);
    }
}
