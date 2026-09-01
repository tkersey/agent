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

const DocumentSlot = enum(u16) {
    readme = 3,
    router_source = 19,
};

const CompareText = boundary.Text(16);
const CompareArgs = struct {
    left: CompareText,
    right: CompareText,
};

fn TextCompareLowered() type {
    const Builder = agent.Flow(.{ .schema_types = .{ CompareArgs, CompareText } });
    comptime var flow = Builder.init("flow-text-compare");
    const args = flow.begin(CompareArgs);
    const ordering = flow.textCompare(
        flow.productExtract(0, args),
        flow.productExtract(1, args),
    );
    flow.returnValue(ordering);
    return flow.finish(i8);
}

const TextCompareBody = struct {
    const Lowering = TextCompareLowered();
    pub const InitialArgs = CompareArgs;
    pub const Result = i8;
    pub const Failure = enum { impossible };
    pub const effect_sites = boundary.effect.row(.{});
    pub const schema_types = Lowering.schema_types;
    pub const control_ir = Lowering.control_ir;
};

const TextCompareMachine = boundary.program(
    "flow-text-compare",
    TextCompareBody,
).compile(.{
    .maximum_frames = 2,
    .maximum_state_bytes = 1024,
    .maximum_machine_fuel = 32,
});

fn EnumLowered() type {
    const Builder = agent.Flow(.{ .schema_types = .{DocumentSlot} });
    comptime var flow = Builder.init("flow-enum-to-u32");
    const slot = flow.begin(DocumentSlot);
    const slot_code = flow.enumToU32(slot);
    flow.returnValue(slot_code);
    return flow.finish(u32);
}

const EnumBody = struct {
    const Lowering = EnumLowered();
    pub const InitialArgs = DocumentSlot;
    pub const Result = u32;
    pub const Failure = enum { impossible };
    pub const effect_sites = boundary.effect.row(.{});
    pub const schema_types = Lowering.schema_types;
    pub const control_ir = Lowering.control_ir;
};

const EnumMachine = boundary.program("flow-enum-to-u32", EnumBody).compile(.{
    .maximum_frames = 2,
    .maximum_state_bytes = 1024,
    .maximum_machine_fuel = 32,
});

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

const HelperText = boundary.Text(8);
const HelperArgs = struct {
    text: HelperText,
    index: u32,
};
const HelperFailure = enum { bad_index };

const RenderText = boundary.Text(64);
const RenderPart = boundary.Text(16);
const RenderArgs = struct {
    prefix: RenderPart,
    suffix: RenderPart,
    unsigned: u16,
    signed: i16,
};
const RenderFailure = enum { capacity };

fn RenderLowered() type {
    const Builder = agent.Flow(.{
        .schema_types = .{ RenderText, RenderPart, RenderArgs, RenderFailure },
    });
    comptime var flow = Builder.init("flow-text-render");
    const args = flow.begin(RenderArgs);
    var text = flow.textEmpty(RenderText);
    const failure = flow.constant(RenderFailure, 0);
    text = flow.textAppendOrFail(text, flow.productExtract(0, args), failure);
    text = flow.textAppendOrFail(text, flow.productExtract(1, args), failure);
    text = flow.textAppendUnsignedOrFail(text, flow.productExtract(2, args), failure);
    text = flow.textAppendSignedOrFail(text, flow.productExtract(3, args), failure);
    flow.returnValue(text);
    return flow.finish(RenderText);
}

const RenderBody = struct {
    const Lowering = RenderLowered();
    pub const InitialArgs = RenderArgs;
    pub const Result = RenderText;
    pub const Failure = RenderFailure;
    pub const constants = .{RenderFailure.capacity};
    pub const effect_sites = boundary.effect.row(.{});
    pub const schema_types = Lowering.schema_types;
    pub const control_ir = Lowering.control_ir;
};

const RenderMachine = boundary.program("flow-text-render", RenderBody).compile(.{
    .maximum_frames = 2,
    .maximum_state_bytes = 2048,
    .maximum_machine_fuel = 64,
});

fn HelperLowered() type {
    const Builder = agent.Flow(.{
        .schema_types = .{ HelperArgs, HelperText, HelperFailure },
    });
    comptime var flow = Builder.init("flow-private-helper");
    const args = flow.begin(HelperArgs);
    const helper = flow.helper(.{ HelperText, u32 }, u8);
    const called = flow.call(
        helper,
        .{
            flow.productExtract(0, args),
            flow.productExtract(1, args),
        },
        .{},
    );
    flow.returnValue(called.value);

    const parameters = flow.enter(helper.entry);
    flow.returnToCaller(flow.textByteAt(
        parameters[0],
        parameters[1],
        flow.constant(HelperFailure, 0),
    ));
    return flow.finish(u8);
}

const HelperBody = struct {
    const Lowering = HelperLowered();
    pub const InitialArgs = HelperArgs;
    pub const Result = u8;
    pub const Failure = HelperFailure;
    pub const constants = .{HelperFailure.bad_index};
    pub const effect_sites = boundary.effect.row(.{});
    pub const schema_types = Lowering.schema_types;
    pub const control_ir = Lowering.control_ir;
};

const HelperProgram = boundary.program("flow-private-helper", HelperBody);
const HelperMachine = HelperProgram.compile(.{
    .maximum_frames = 4,
    .maximum_state_bytes = 2048,
    .maximum_machine_fuel = 64,
});

test "Flow assigns values, continuations, and resume placeholders" {
    try std.testing.expectEqual(@as(usize, 0), Body.control_ir.functions.len);
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

test "Flow lowers private typed helpers and authored Text byte projection" {
    try std.testing.expectEqual(@as(usize, 2), HelperBody.control_ir.functions.len);
    try std.testing.expectEqual(@as(u16, 0), HelperBody.control_ir.blocks[0].function_id);
    try std.testing.expectEqual(@as(u16, 1), HelperBody.control_ir.blocks[1].function_id);
    try std.testing.expectEqual(
        boundary.image.evaluator_semantics_v3,
        HelperProgram.image().evaluator_semantics_version,
    );

    inline for (.{
        .{ @as(u32, 0), @as(u8, 0xc3) },
        .{ @as(u32, 1), @as(u8, 0xa9) },
        .{ @as(u32, 2), @as(u8, '"') },
    }) |fixture| {
        const state = try HelperMachine.initialState(
            std.testing.allocator,
            .{
                .text = HelperText.fromSlice("é\"") catch unreachable,
                .index = fixture[0],
            },
        );
        defer HelperMachine.deinitState(state);
        var fuel: u64 = 64;
        const done = switch (try HelperMachine.step(state, &fuel)) {
            .done => |value| value,
            else => return error.UnexpectedMachineStep,
        };
        defer done.deinit();
        try std.testing.expectEqual(fixture[1], done.value().*);
    }

    const state = try HelperMachine.initialState(
        std.testing.allocator,
        .{
            .text = HelperText.fromSlice("é\"") catch unreachable,
            .index = 3,
        },
    );
    defer HelperMachine.deinitState(state);
    var fuel: u64 = 64;
    switch (try HelperMachine.step(state, &fuel)) {
        .failed => |failure| switch (failure) {
            .authored => |value| try std.testing.expectEqual(
                HelperFailure.bad_index,
                value,
            ),
            else => return error.UnexpectedMachineFailure,
        },
        else => return error.UnexpectedMachineStep,
    }
}

test "Flow renders dynamic Text and exact signed integers" {
    const state = try RenderMachine.initialState(std.testing.allocator, .{
        .prefix = RenderPart.fromSlice("count=") catch unreachable,
        .suffix = RenderPart.fromSlice("") catch unreachable,
        .unsigned = 42,
        .signed = -7,
    });
    defer RenderMachine.deinitState(state);
    var fuel: u64 = 64;
    const done = switch (try RenderMachine.step(state, &fuel)) {
        .done => |value| value,
        else => return error.UnexpectedMachineStep,
    };
    defer done.deinit();
    try std.testing.expectEqualStrings("count=42-7", try done.value().slice());
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

test "Flow projects portable enum values to canonical u32 tags" {
    inline for (.{ DocumentSlot.readme, DocumentSlot.router_source }) |slot| {
        const state = try EnumMachine.initialState(std.testing.allocator, slot);
        defer EnumMachine.deinitState(state);
        var fuel: u64 = 8;
        const done = switch (try EnumMachine.step(state, &fuel)) {
            .done => |result| result,
            else => return error.UnexpectedMachineStep,
        };
        defer done.deinit();
        try std.testing.expectEqual(
            @as(u32, @intCast(@intFromEnum(slot))),
            done.value().*,
        );
    }
}

test "Flow lowers canonical Text comparison" {
    try std.testing.expectEqual(
        boundary.ir.InstructionOperation.text_compare,
        TextCompareBody.control_ir.blocks[0].instructions[2].operation,
    );

    inline for (.{
        .{ "alpha", "alpha", @as(i8, 0) },
        .{ "alpha", "beta", @as(i8, -1) },
        .{ "beta", "alpha", @as(i8, 1) },
    }) |fixture| {
        const state = try TextCompareMachine.initialState(
            std.testing.allocator,
            .{
                .left = try CompareText.fromSlice(fixture[0]),
                .right = try CompareText.fromSlice(fixture[1]),
            },
        );
        defer TextCompareMachine.deinitState(state);
        var fuel: u64 = 16;
        const done = switch (try TextCompareMachine.step(state, &fuel)) {
            .done => |result| result,
            else => return error.UnexpectedMachineStep,
        };
        defer done.deinit();
        try std.testing.expectEqual(fixture[2], done.value().*);
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
