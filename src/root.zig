const boundary = @import("boundary");

/// Agent package bootstrap version.
pub const package_version = "0.0.0";

comptime {
    if (!@hasDecl(boundary, "program")) {
        @compileError("agent requires Boundary v1.0.0 program compilation");
    }
}

test "bootstrap imports the exact Boundary public compiler" {
    const std = @import("std");

    try std.testing.expect(@hasDecl(boundary, "program"));
    try std.testing.expect(@hasDecl(boundary, "ir"));
    try std.testing.expect(@hasDecl(boundary, "effect"));
    try std.testing.expect(@hasDecl(boundary, "schema"));
}
