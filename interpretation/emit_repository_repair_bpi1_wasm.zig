const actuality = @import("repository_repair_actuality");

const output_capacity = 16 << 20;
var output_storage: [output_capacity]u8 align(16) = undefined;
var output_length: u32 = 0;

pub export fn repository_repair_bpi1_output_ptr() u32 {
    return @intCast(@intFromPtr(&output_storage));
}

pub export fn repository_repair_bpi1_output_len() u32 {
    return output_length;
}

pub export fn repository_repair_bpi1_emit() u32 {
    output_length = 0;
    output_length = @intCast(
        actuality.Compiled.Program.encodeImage(&output_storage) catch return 1,
    );
    return 0;
}
