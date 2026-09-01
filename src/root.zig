const boundary = @import("boundary");
const budget_types = @import("budget.zig");
const definition = @import("definition.zig");

/// Agent package bootstrap version.
pub const package_version = "3.0.0";

/// Define immutable typed comptime agent data and close its Action algebra.
pub const define = definition.define;
pub const system = @import("system.zig").system;
pub const model = @import("model.zig").model;
pub const prompt = @import("prompt.zig");
pub const skill = @import("skill.zig").skill;
/// Typed action-descriptor constructors.
pub const action = @import("action.zig");
pub const action_decode = @import("action_decode.zig");
pub const json = @import("json.zig");
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
pub const FlowLimits = @import("flow.zig").Limits;
pub const request = @import("request.zig");
pub const response = @import("response.zig");
pub const staged_json = @import("staged_json.zig");
pub const openai_response = @import("openai_response.zig");
pub const openai_profile = @import("openai_profile.zig");
/// Reusable compile-time RuntimeStrategies.
pub const strategy = @import("strategy.zig");
/// Provider-neutral projections of the closed decision Action algebra.
pub const decision = @import("decision_contract.zig");
/// Versioned Agent-owned model transport contracts.
pub const protocol = @import("protocol.zig");
/// Specialize one definition, runtime strategy, and epistemic strategy into one Boundary Machine.
pub const compile = @import("compiler.zig").compile;

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
        !@hasDecl(boundary, "process_v1"))
    {
        @compileError("agent requires the Boundary 1.8 Process-capable program and BPI1 surface");
    }
}

test "bootstrap imports the exact Boundary public compiler" {
    const std = @import("std");

    try std.testing.expect(@hasDecl(boundary, "program"));
    try std.testing.expect(@hasDecl(boundary, "ir"));
    try std.testing.expect(@hasDecl(boundary, "effect"));
    try std.testing.expect(@hasDecl(boundary, "schema"));
    try std.testing.expect(@hasDecl(boundary, "process_v1"));
}
