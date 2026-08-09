const std = @import("std");
const witness = @import("witness");

pub fn main(init: std.process.Init) !void {
    const length = witness.agentMachineParityRun();
    if (length == 0) return error.AgentMachineParityFailed;
    var stdout_buffer: [256 * 1024]u8 = undefined;
    var stdout_writer = std.Io.File.stdout().writer(init.io, &stdout_buffer);
    try stdout_writer.interface.writeAll(witness.outputBytes(length));
    try stdout_writer.interface.flush();
}
