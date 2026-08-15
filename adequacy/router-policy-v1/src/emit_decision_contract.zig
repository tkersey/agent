const std = @import("std");
const agent = @import("agent");
const definition = @import("definition.zig");
const options = @import("emit_contract_options");

const Contract = agent.decision.contract(definition.Compiled);

pub fn main(init: std.process.Init) !void {
    const bytes = if (options.binary) Contract.binary_bytes[0..] else Contract.json_bytes[0..];
    var output_buffer: [Contract.json_bytes.len]u8 = undefined;
    var output = std.Io.File.stdout().writer(init.io, &output_buffer);
    try output.interface.writeAll(bytes);
    try output.interface.flush();
}
