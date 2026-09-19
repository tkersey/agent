//! Independent object producer; never transported to the link-only test area.
const std = @import("std");
const examples = @import("boundary").source.component_examples;
pub fn main(init: std.process.Init) !void {
    var args = std.process.Args.Iterator.init(init.minimal.args);
    _ = args.next();
    const name = args.next() orelse return error.ExpectedComponent;
    const kind = std.meta.stringToEnum(examples.Kind, name) orelse return error.InvalidComponent;
    if (args.next() != null) return error.UnexpectedArgument;
    const bytes = try examples.emit(init.gpa, kind);
    defer init.gpa.free(bytes);
    var buffer: [4096]u8 = undefined;
    var output = std.Io.File.stdout().writer(init.io, &buffer);
    try output.interface.writeAll(bytes);
    try output.interface.flush();
}
