const builtin = @import("builtin");
const std = @import("std");

pub fn main(init: std.process.Init.Minimal) void {
    const args = init.args.toSlice(std.heap.page_allocator) catch @panic("cannot read test arguments");
    if (args.len != 2) @panic("selective test runner requires one name substring");
    var matched: usize = 0;
    var failed: usize = 0;
    var leaked: usize = 0;
    for (builtin.test_functions) |test_fn| {
        if (std.mem.indexOf(u8, test_fn.name, args[1]) == null) continue;
        matched += 1;
        std.testing.allocator_instance = .{};
        std.testing.environ = init.environ;
        if (test_fn.func()) |_| {} else |_| failed += 1;
        if (std.testing.allocator_instance.deinit() == .leak) leaked += 1;
    }
    if (matched == 0 or failed != 0 or leaked != 0) std.process.exit(1);
}
