const std = @import("std");
const actuality = @import("repository_repair_actuality");

pub fn main(init: std.process.Init) !void {
    const bytes = actuality.Compiled.Program
        .machineV2Profile(actuality.machine_options).bytes;
    var output_buffer: [4096]u8 = undefined;
    var output = std.Io.File.stdout().writer(init.io, &output_buffer);
    try output.interface.writeAll(&bytes);
    try output.interface.flush();
}
