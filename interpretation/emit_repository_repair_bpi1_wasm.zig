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
    const image = actuality.Compiled.Program.image();
    output_length = 0;
    if (image.bytes.len > output_storage.len) return 1;
    @memcpy(output_storage[0..image.bytes.len], &image.bytes);
    output_length = @intCast(image.bytes.len);
    return 0;
}
