const std = @import("std");
const app = @import("router_policy_definition");

pub fn main(init: std.process.Init) !void {
    var buffer: [1024]u8 = undefined;
    var writer = std.Io.File.stdout().writer(init.io, &buffer);
    const out = &writer.interface;
    try out.print("machine_frame_bytes={d}\n", .{@sizeOf(app.Machine.FrameType)});
    try out.print("machine_maximum_segment_value_bytes={d}\n", .{app.Compiled.Program.maximum_segment_value_bytes});
    try out.print("machine_reachable_value_catalog_bytes={d}\n", .{app.Compiled.Program.reachable_value_catalog_bytes});
    try out.print("memory_bytes={d}\n", .{@sizeOf(app.Memory)});
    try out.print("decision_view_bytes={d}\n", .{@sizeOf(app.DecisionView)});
    try out.flush();
}
