const std = @import("std");
const boundary = @import("boundary");
const actuality = @import("repository_repair_actuality");

pub fn main(init: std.process.Init) !void {
    const goal = actuality.Goal{
        .task = try actuality.GoalText.fromSlice(
            "Fix the repository so the complete test suite passes. Inspect the source and tests before editing. Do not modify tests or package metadata. Only one source file may be replaced. Run the tests before and after the approved mutation, then return a typed summary.",
        ),
        .repository = try boundary.Text(128).fromSlice("repository-repair-v1"),
    };
    const required = try boundary.schema.encodedSize(actuality.Goal, goal);
    const encoded = try std.heap.page_allocator.alloc(u8, required);
    defer std.heap.page_allocator.free(encoded);
    _ = try boundary.schema.encode(actuality.Goal, goal, encoded);
    var output_buffer: [4096]u8 = undefined;
    var output = std.Io.File.stdout().writer(init.io, &output_buffer);
    try output.interface.writeAll(encoded);
    try output.interface.flush();
}
