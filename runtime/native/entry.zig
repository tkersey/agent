//! Shared executable front end. Application code supplies only compiled adapters.
const std = @import("std");
const native = @import("agent_native");
const environment = @import("environment");
const types = @import("application_types");

pub fn main(init: std.process.Init) void {
    const code = native.run(types, environment, init, .{
        .image = @embedFile("native_image"),
        .application = @embedFile("native_application"),
        .manifest = @embedFile("native_manifest"),
    }) catch 74;
    if (code != 0) std.process.exit(code);
}
