const boundary = @import("boundary");

/// Agent package bootstrap version.
pub const package_version = "3.0.0";

pub const system = @import("system.zig").system;
pub const model = @import("model.zig").model;
pub const ReasoningEffort = @import("model.zig").ReasoningEffort;
pub const ReasoningSummary = @import("model.zig").ReasoningSummary;
pub const model_effect = @import("model_effect.zig");
pub const prompt = @import("prompt.zig");
pub const skill = @import("skill.zig").skill;
/// Typed action-descriptor constructors.
pub const action = @import("action.zig");
pub const action_decode = @import("action_decode.zig");
pub const json = @import("json.zig");
/// Explicit deterministic Memory, observation-fold, and DecisionView strategies.
pub const epistemics = @import("epistemics_v3.zig");
/// Compiler-only structured authoring surface for RuntimeStrategies.
pub const Flow = @import("flow.zig").Flow;
/// Compiler-only typed symbolic value.
pub const Value = @import("flow.zig").Value;
pub const FlowLimits = @import("flow.zig").Limits;
pub const FlowPhase = @import("flow.zig").Phase;
pub const request = @import("request.zig");
pub const response = @import("response.zig");
pub const staged_json = @import("staged_json.zig");
pub const openai_response = @import("openai_response.zig");
pub const openai_profile = @import("openai_profile.zig");
/// Reusable compile-time Agent 3 runtime strategies.
pub const strategy = @import("strategy_v3.zig");
/// Versioned Agent-owned model transport contracts.
pub const protocol = @import("protocol.zig");

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
