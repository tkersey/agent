const boundary = @import("boundary");

pub const system = @import("system.zig").system;
pub const model = @import("model.zig").model;
pub const prompt = @import("prompt.zig");
pub const skill = @import("skill.zig").skill;
pub const action = @import("action.zig");
pub const epistemics = @import("epistemics_v3.zig");
pub const strategy = @import("strategy_v3.zig");
pub const protocol = @import("protocol.zig");
pub const Value = @import("flow.zig").Value;
pub const FlowLimits = @import("flow.zig").Limits;
pub const FlowPhase = @import("flow.zig").Phase;
pub const ReactBody = @import("system_compiler.zig").ReactBody;
pub const ReactBodyActionDecodeAblation =
    @import("system_compiler.zig").ReactBodyActionDecodeAblation;

comptime {
    if (!@hasDecl(boundary, "program")) {
        @compileError("Agent economy tooling requires Boundary program compilation");
    }
}
