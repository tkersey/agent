//! Private optimized SHA-256 primitive. File ownership, bounded reads and
//! before/after metadata checks remain in identity.zig. This uses the same
//! standard-library algorithm as the caller's previous inline implementation.
const std = @import("std");
const c = @import("native_c");
const Sha256 = std.crypto.hash.sha2.Sha256;

comptime {
    std.debug.assert(@sizeOf(Sha256) <= c.AGENT_NATIVE_SHA256_BYTES);
    std.debug.assert(@alignOf(Sha256) <= c.AGENT_NATIVE_SHA256_ALIGNMENT);
}

fn hasher(storage: *anyopaque) *Sha256 {
    return @ptrCast(@alignCast(storage));
}

export fn agent_native_sha256_init(storage: *anyopaque) void {
    hasher(storage).* = Sha256.init(.{});
}

export fn agent_native_sha256_update(storage: *anyopaque, bytes: [*]const u8, length: usize) void {
    hasher(storage).update(bytes[0..length]);
}

export fn agent_native_sha256_final(storage: *anyopaque, output: *[32]u8) void {
    hasher(storage).final(output);
}
