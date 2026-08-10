const std = @import("std");
const boundary = @import("boundary");
const actuality = @import("repository_repair_actuality");

const Context = struct {
    init: std.process.Init,
    err: ?anyerror = null,
};

pub fn main(init: std.process.Init) !void {
    var context = Context{ .init = init };
    const thread = try std.Thread.spawn(
        .{ .stack_size = 512 * 1024 * 1024 },
        run,
        .{&context},
    );
    thread.join();
    if (context.err) |err| return err;
}

fn run(context: *Context) void {
    runInner(context.init) catch |err| {
        context.err = err;
    };
}

fn runInner(init: std.process.Init) !void {
    const goal = actuality.Goal{
        .task = try actuality.GoalText.fromSlice(
            "Fix the repository so the complete test suite passes. Inspect the source and tests before editing. Do not modify tests or package metadata. Only one source file may be replaced. Run the tests before and after the approved mutation, then return a typed summary.",
        ),
        .repository = try boundary.Text(128).fromSlice("repository-repair-v1"),
    };
    const state = try actuality.Machine.initialState(std.heap.page_allocator, goal);
    defer actuality.Machine.deinitState(state);
    var fuel: u64 = 100_000;
    const effect = switch (try actuality.Machine.step(state, &fuel)) {
        .request => |request| request,
        else => return error.ExpectedDecisionRequest,
    };
    const request = switch (effect.value) {
        .s0 => |value| value,
        else => return error.ExpectedDecisionSite,
    };
    const required = try boundary.schema.encodedSize(@TypeOf(request), request);
    const encoded = try std.heap.page_allocator.alloc(u8, required);
    defer std.heap.page_allocator.free(encoded);
    _ = try boundary.schema.encode(@TypeOf(request), request, encoded);
    var output_buffer: [4096]u8 = undefined;
    var output = std.Io.File.stdout().writer(init.io, &output_buffer);
    try output.interface.writeAll(encoded);
    try output.interface.flush();
}
