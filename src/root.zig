const boundary = @import("boundary");
const budget_types = @import("budget.zig");
const definition = @import("definition.zig");

/// Agent package bootstrap version.
pub const package_version = "1.1.2";

/// Define immutable typed comptime agent data and close its Action algebra.
pub const define = definition.define;
/// Typed action-descriptor constructors.
pub const action = @import("action.zig");
/// Closed compile-time final-result preconditions.
pub const final_policy = @import("final_policy.zig");
/// Compiler-only structured authoring surface for RuntimeStrategies.
pub const Flow = @import("flow.zig").Flow;
/// Compiler-only typed symbolic value.
pub const Value = @import("flow.zig").Value;
/// Reusable compile-time RuntimeStrategies.
pub const strategy = @import("strategy.zig");
/// Provider-neutral projections of the closed decision Action algebra.
pub const decision = @import("decision_contract.zig");
/// Specialize one definition and strategy into an ordinary Boundary Machine.
pub const compile = @import("compiler.zig").compile;

pub const DefinitionManifest = @import("manifest.zig").DefinitionManifest;
pub const StrategyManifest = @import("manifest.zig").StrategyManifest;
pub const Manifest = @import("manifest.zig").CompiledManifest;

pub const Counters = budget_types.Counters;
pub const Budget = budget_types.Budget;
pub const HistoryPolicy = budget_types.HistoryPolicy;
pub const HistoryOverflow = budget_types.HistoryOverflow;
pub const DecisionPhase = budget_types.DecisionPhase;

comptime {
    if (!@hasDecl(boundary, "program")) {
        @compileError("agent requires Boundary v1.3.2 program compilation");
    }
}

test "bootstrap imports the exact Boundary public compiler" {
    const std = @import("std");

    try std.testing.expect(@hasDecl(boundary, "program"));
    try std.testing.expect(@hasDecl(boundary, "ir"));
    try std.testing.expect(@hasDecl(boundary, "effect"));
    try std.testing.expect(@hasDecl(boundary, "schema"));
}
