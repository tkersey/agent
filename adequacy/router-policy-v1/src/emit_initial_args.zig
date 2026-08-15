const std = @import("std");
const boundary = @import("boundary");
const definition = @import("definition.zig");

pub fn main(init: std.process.Init) !void {
    const goal = definition.Goal{
        .task = try definition.GoalText.fromSlice(
            "Upgrade the controlled path router into a deterministic method-aware router. Preserve path parameters; add HTTP-token normalization, canonical Allow ordering, exact HEAD precedence with GET fallback, static-over-parameter precedence, duplicate rejection, structured errors, and required exports. Inspect every admitted source and test document before editing. Run the full failing suite before mutation and after every approved replacement. Modify only the four writable source slots. Complete only after the full suite passes.",
        ),
        .repository = try boundary.Text(128).fromSlice("router-policy-v1"),
    };
    const required = try boundary.schema.encodedSize(definition.Goal, goal);
    const encoded = try std.heap.page_allocator.alloc(u8, required);
    defer std.heap.page_allocator.free(encoded);
    _ = try boundary.schema.encode(definition.Goal, goal, encoded);
    var output_buffer: [8 * 1024]u8 = undefined;
    var output = std.Io.File.stdout().writer(init.io, &output_buffer);
    try output.interface.writeAll(encoded);
    try output.interface.flush();
}
