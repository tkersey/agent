//! Compile compatible fixture constructors once; each call still gets a fresh process.
//! AGENT4_FIXTURE is an explicit build-run input. It does not alter the fixture CLI.
const std = @import("std");

pub fn main(init: std.process.Init) !void {
    const selected = init.environ_map.get("AGENT4_FIXTURE") orelse return error.ExpectedFixture;
    if (std.mem.eql(u8, selected, "parser-construction")) return @import("consumers/incremental-parser/main.zig").main(init);
    if (std.mem.eql(u8, selected, "repository-application")) return @import("consumers/repository/main.zig").main(init);
    if (std.mem.eql(u8, selected, "agent4-inquiry-application")) return @import("consumers/inquiry/main.zig").main(init);
    if (std.mem.eql(u8, selected, "agent4-review")) return @import("consumers/review/main.zig").main(init);
    if (std.mem.eql(u8, selected, "agent4-document")) return @import("consumers/document/main.zig").main(init);
    return error.UnknownFixture;
}
