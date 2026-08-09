const boundary = @import("boundary");
const budget_types = @import("budget.zig");
const definition = @import("definition.zig");

/// Agent package bootstrap version.
pub const package_version = "0.0.0";

/// Define immutable typed comptime agent data and close its Action algebra.
pub const define = definition.define;
/// Typed action-descriptor constructors.
pub const action = @import("action.zig");

pub const Counters = budget_types.Counters;
pub const Budget = budget_types.Budget;
pub const HistoryPolicy = budget_types.HistoryPolicy;
pub const HistoryOverflow = budget_types.HistoryOverflow;
pub const DecisionPhase = budget_types.DecisionPhase;

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
