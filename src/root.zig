const boundary = @import("boundary");
const budget_types = @import("budget.zig");
const definition = @import("definition.zig");
pub const DefinitionKind = definition.Kind;

/// Agent package bootstrap version.
pub const package_version = "2.7.0";

/// Primary open-ended Agent frontend with no universal finite horizon.
pub const process = struct {
    pub const define = definition.defineProcess;
    pub const compile = @import("compiler.zig").compileProcess;
};
/// Explicit bounded compatibility frontend preserving Agent v2 policy.
pub const episode = struct {
    pub const define = definition.defineEpisode;
    pub const compile = @import("compiler.zig").compile;
};
/// Compatibility alias for `agent.episode.define`.
pub const define = episode.define;
/// Typed action-descriptor constructors.
pub const action = @import("action.zig");
/// Compiler-only final guards used by explicit EpistemicStrategies.
pub const final_policy = @import("final_policy.zig");
/// Explicit deterministic Memory, observation-fold, and DecisionView strategies.
pub const epistemics = @import("epistemics.zig");
/// Compiler-only structured authoring surface for RuntimeStrategies.
pub const Flow = @import("flow.zig").Flow;
/// Restricted compiler-owned topology facade for custom RuntimeStrategies.
pub const RuntimeFlow = @import("runtime_flow.zig").RuntimeFlow;
pub const RuntimeTopology = @import("runtime_flow.zig").Topology;
/// Compiler-only typed symbolic value.
pub const Value = @import("flow.zig").Value;
/// Reusable compile-time RuntimeStrategies.
pub const strategy = @import("strategy.zig");
/// Provider-neutral projections of the closed decision Action algebra.
pub const decision = @import("decision_contract.zig");
/// Compatibility alias for `agent.episode.compile`.
pub const compile = episode.compile;

pub const DefinitionManifest = @import("manifest.zig").DefinitionManifest;
pub const StrategyManifest = @import("manifest.zig").StrategyManifest;
pub const EpistemicsManifest = @import("manifest.zig").EpistemicsManifest;
pub const Manifest = @import("manifest.zig").CompiledManifest;

pub const Counters = budget_types.Counters;
pub const Budget = budget_types.Budget;
pub const DecisionPhase = budget_types.DecisionPhase;

comptime {
    if (!@hasDecl(boundary, "program") or
        !@hasDecl(boundary, "image") or
        !@hasDecl(boundary, "process_v1") or
        !@hasDecl(boundary, "machine_v2"))
    {
        @compileError("agent requires Boundary v1.6.1 program image and Machine-v2 compilation");
    }
}

test "bootstrap imports the exact Boundary public compiler" {
    const std = @import("std");

    try std.testing.expect(@hasDecl(boundary, "program"));
    try std.testing.expect(@hasDecl(boundary, "ir"));
    try std.testing.expect(@hasDecl(boundary, "effect"));
    try std.testing.expect(@hasDecl(boundary, "schema"));
}
