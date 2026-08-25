const std = @import("std");
const actuality = @import("repository_repair_actuality");

pub fn main(init: std.process.Init) !void {
    const args = try init.minimal.args.toSlice(init.arena.allocator());
    if (args.len != 2) return error.InvalidArguments;

    var output_buffer: [4096]u8 = undefined;
    var output = std.Io.File.stdout().writer(init.io, &output_buffer);
    if (std.mem.eql(u8, args[1], "bpi1")) {
        const bytes = actuality.Compiled.Program.image().bytes;
        try output.interface.writeAll(&bytes);
    } else if (std.mem.eql(u8, args[1], "mv2p1")) {
        const bytes = actuality.Compiled.Program
            .machineV2Profile(actuality.machine_options).bytes;
        try output.interface.writeAll(&bytes);
    } else {
        return error.InvalidArguments;
    }
    try output.interface.flush();
}
