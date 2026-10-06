//! Compile compatible fixture constructors once; each call still gets a fresh process.
//! AGENT4_FIXTURE is an explicit build-run input. It does not alter the fixture CLI.
const std = @import("std");

pub fn main(init: std.process.Init) !void {
    const selected = init.environ_map.get("AGENT4_FIXTURE") orelse return error.ExpectedFixture;
    if (std.mem.eql(u8, selected, "native-consumer")) return @import("consumers/native/emitter.zig").main(init);
    if (std.mem.eql(u8, selected, "composed-owners")) return @import("agent4/composed_owners.zig").main(init);
    if (std.mem.eql(u8, selected, "recursive-selection")) return @import("agent4/recursive_selection.zig").main(init);
    if (std.mem.eql(u8, selected, "parser-delivery")) return @import("agent4/parser_delivery.zig").main(init);
    if (std.mem.eql(u8, selected, "parser-proposals")) return @import("agent4/parser_proposals.zig").main(init);
    if (std.mem.eql(u8, selected, "parser-schema")) return @import("agent4/parser_tools.zig").main(init);
    if (std.mem.eql(u8, selected, "agent-participant")) return @import("agent4/participant.zig").main(init);
    if (std.mem.eql(u8, selected, "agent-recursive-participant")) return @import("agent4/recursive_participant.zig").main(init);
    if (std.mem.eql(u8, selected, "agent-text-object")) return @import("agent4/text_object.zig").main(init);
    if (std.mem.eql(u8, selected, "agent-mobility-consumer")) return @import("consumers/mobility/main.zig").main(init);
    if (std.mem.eql(u8, selected, "agent-mobility-approval")) return @import("consumers/mobility/approval.zig").main(init);
    if (std.mem.eql(u8, selected, "agent-mobility-ensure")) return @import("agent4/mobility_ensure.zig").main(init);
    if (std.mem.eql(u8, selected, "agent4-inquiry-probe")) return @import("agent4/inquiry_probe.zig").main(init);
    if (std.mem.eql(u8, selected, "agent4-inquiry-broker")) return @import("agent4/inquiry_broker_probe.zig").main(init);
    if (std.mem.eql(u8, selected, "agent4-approval")) return @import("agent4/approval_probe.zig").main(init);
    return error.UnknownFixture;
}
