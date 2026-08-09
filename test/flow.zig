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
