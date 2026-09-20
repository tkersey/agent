//! Public staged Agent authoring; runtime execution belongs to World.
pub const package_version = "4.0.0-dev.0";
pub const Context = @import("authoring.zig").Context;
pub const system = @import("authoring.zig").system;
pub const compile = @import("authoring.zig").compile;
pub const compileObserved = @import("authoring.zig").compileObserved;
pub const CompileStage = @import("authoring.zig").CompileStage;
pub const CompileOptions = @import("authoring.zig").CompileOptions;
pub const contracts = @import("agent_contracts");
pub const admission = @import("admission.zig");
pub const catalogs = @import("catalogs.zig");
pub const callable = @import("callable.zig");
pub const participant = @import("participant.zig");
pub const observation = @import("observation.zig");
pub const responders = @import("responders.zig");
pub const decision = @import("decision.zig");
pub const interaction = @import("interaction.zig");
pub const dialogue = @import("dialogue.zig");
pub const inquiry = @import("inquiry.zig");
pub const scopes = @import("scopes.zig");
pub const sets = @import("sets.zig");
pub const approval = @import("approval.zig");
pub const tools = @import("tools.zig");
pub const deliberation = @import("deliberation.zig");
pub const clarification = @import("clarification.zig");
pub const value_equality = @import("value_equality.zig");
pub const model_invocation = @import("model_invocation.zig");
pub const conversation = @import("conversation.zig");
pub const react = @import("react.zig");
pub const model = @import("model.zig").model;
pub const prompt = @import("prompt.zig");
pub const skill = @import("skill.zig").skill;

comptime {
    const boundary = @import("boundary");
    if (!@hasDecl(boundary, "computation") or !@hasDecl(boundary, "data") or
        !@hasDecl(boundary, "program") or !@hasDecl(boundary.program, "compileObserved") or
        !@hasField(boundary.computation.Compiled, "flow"))
        @compileError("Agent requires the coordinated Boundary stable-activation compiler and data API");
}
