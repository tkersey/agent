const std = @import("std");
const agent = @import("agent");
const actuality = @import("repository_repair_actuality");

const Contract = agent.decision.jsonContract(actuality.Compiled);

pub fn main(init: std.process.Init) !void {
    var output_buffer: [Contract.json_schema_bytes.len]u8 = undefined;
    var output = std.Io.File.stdout().writer(init.io, &output_buffer);
    try output.interface.writeAll(&Contract.json_schema_bytes);
    try output.interface.flush();
}
