//! Pinned macOS launcher for the Zig inquiry profile. Resource attributes are
//! applied to the final image, not to sandbox-exec (exec resets memory limits).
//! The injected constructor denies subsequent exec/fork before candidate code.
const std = @import("std");
extern "c" fn posix_spawnattr_setjetsam_ext(*std.c.posix_spawnattr_t, c_short, c_int, c_int, c_int) c_int;

fn bound(value: [*:0]const u8, maximum: u32) u32 {
    const parsed = std.fmt.parseInt(u32, std.mem.span(value), 10) catch std.c.exit(120);
    if (parsed == 0 or parsed > maximum) std.c.exit(120);
    return parsed;
}
fn limit(resource: std.c.rlimit_resource, value: u64) void {
    if (std.c.setrlimit(resource, &.{ .cur = value, .max = value }) != 0) std.c.exit(121);
}
pub fn main(init: std.process.Init.Minimal) void {
    const input = init.args.vector;
    if (input.len < 6 or input.len > 126) std.c.exit(120);
    const memory = bound(input[1], 4096);
    const cpu = bound(input[2], 120);
    const file_bytes = bound(input[3], 1024 * 1024 * 1024);
    const library = std.mem.span(input[4]);
    if (library.len == 0 or library[0] != '/' or std.mem.indexOfScalar(u8, library, ':') != null) std.c.exit(120);
    limit(.CORE, 0);
    limit(.CPU, cpu);
    limit(.FSIZE, file_bytes);
    limit(.NOFILE, 128);
    var attrs: std.c.posix_spawnattr_t = undefined;
    if (std.c.posix_spawnattr_init(&attrs) != 0) std.c.exit(122);
    if (std.c.posix_spawnattr_setflags(&attrs, .{ .SETEXEC = true }) != 0) std.c.exit(122);
    // XNU spawn_internal.h: SET and active/inactive fatal footprint limits.
    if (posix_spawnattr_setjetsam_ext(&attrs, @bitCast(@as(u16, 0x800c)), 10, @intCast(memory), @intCast(memory)) != 0) std.c.exit(122);
    var argv: [128:null]?[*:0]const u8 = @splat(null);
    for (input[5..], 0..) |arg, i| argv[i] = arg;
    var insertion: [4096]u8 = undefined;
    const dyld = std.fmt.bufPrintSentinel(&insertion, "DYLD_INSERT_LIBRARIES={s}", .{library}, 0) catch std.c.exit(120);
    var env: [8:null]?[*:0]const u8 = @splat(null);
    env[0] = "TZ=UTC";
    env[1] = dyld.ptr;
    var count: usize = 2;
    for (init.environ.block.slice) |entry| {
        const text = std.mem.span(entry.?);
        if (std.mem.startsWith(u8, text, "TMPDIR=") or std.mem.startsWith(u8, text, "ZIG_LOCAL_CACHE_DIR=") or std.mem.startsWith(u8, text, "ZIG_GLOBAL_CACHE_DIR=") or std.mem.startsWith(u8, text, "AGENT_CHECK_SANDBOX_PROFILE=") or std.mem.startsWith(u8, text, "AGENT_CHECK_READY_NONCE=")) {
            if (count == env.len) std.c.exit(120);
            env[count] = entry;
            count += 1;
        }
    }
    var pid: std.c.pid_t = undefined;
    _ = std.c.posix_spawn(&pid, argv[0].?, null, &attrs, &argv, &env);
    std.c.exit(123); // SETEXEC must not return; no weaker launch path exists.
}
