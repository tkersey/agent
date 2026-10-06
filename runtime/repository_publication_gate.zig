//! The gate holder becomes Git with execve: no old Git child can survive the
//! process which owns its flock. The private lock inode is provisioned once and
//! bound by repository metadata; never create, unlink, or replace it here.
//! Caller supplies a pinned executable and controlled argv/environment.
const std = @import("std");
extern "c" fn flock(c_int, c_int) c_int;
pub fn main(init: std.process.Init.Minimal) void {
    const input = init.args.vector;
    if (input.len < 5 or input.len > 120) std.c.exit(120);
    const dev = std.fmt.parseInt(u64, std.mem.span(input[2]), 10) catch std.c.exit(120);
    const ino = std.fmt.parseInt(u64, std.mem.span(input[3]), 10) catch std.c.exit(120);
    const fd = std.c.open(input[1], .{ .ACCMODE = .RDWR, .NOFOLLOW = true }, @as(std.c.mode_t, 0));
    if (fd < 0) std.c.exit(121);
    var stat: std.c.Stat = undefined;
    if (std.c.fstat(fd, &stat) != 0 or @as(u64, @intCast(stat.dev)) != dev or stat.ino != ino or stat.nlink != 1 or stat.uid != std.c.getuid() or stat.mode & std.c.S.IFMT != std.c.S.IFREG or stat.mode & 0o777 != 0o600) std.c.exit(122);
    if (flock(fd, 2 | 4) != 0) std.c.exit(123);
    if (std.c.fcntl(fd, std.c.F.SETFD, @as(c_int, 0)) < 0) std.c.exit(124);
    if (std.c.write(1, "LOCKED\n", 7) != 7) std.c.exit(125);
    var byte: [1]u8 = undefined;
    if (std.c.read(0, &byte, 1) != 1 or byte[0] != 'R') std.c.exit(0);
    var argv: [128:null]?[*:0]const u8 = @splat(null);
    for (input[4..], 0..) |arg, i| argv[i] = arg;
    _ = std.c.execve(argv[0].?, &argv, init.environ.block.slice.ptr);
    std.c.exit(126);
}
