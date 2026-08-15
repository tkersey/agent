const std = @import("std");
const agent = @import("agent");
const actuality = @import("repository_repair_actuality");

const Contract = agent.decision.contract(actuality.Compiled);

pub fn main(init: std.process.Init) !void {
    const hex = std.fmt.bytesToHex(Contract.canonical_digest, .lower);
    var output_buffer: [hex.len + 1]u8 = undefined;
    var output = std.Io.File.stdout().writer(init.io, &output_buffer);
    try output.interface.writeAll(&hex);
    try output.interface.writeByte('\n');
    try output.interface.flush();
}
