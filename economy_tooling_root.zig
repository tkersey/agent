const boundary = @import("boundary");

pub const system = @import("src/system.zig").system;
pub const model = @import("src/model.zig").model;
pub const prompt = @import("src/prompt.zig");
pub const skill = @import("src/skill.zig").skill;
pub const action = @import("src/action.zig");
pub const epistemics = @import("src/epistemics_v3.zig");
pub const strategy = @import("src/strategy_v3.zig");
pub const protocol = @import("src/protocol.zig");
pub const Value = @import("src/flow.zig").Value;
pub const FlowLimits = @import("src/flow.zig").Limits;
pub const FlowPhase = @import("src/flow.zig").Phase;
pub const ReactBody = @import("src/system_compiler.zig").ReactBody;
pub const ReactBodyNoToolEconomy =
    @import("src/system_compiler.zig").ReactBodyNoToolEconomy;
pub const ReactBodyActionDecodeAblation =
    @import("src/system_compiler.zig").ReactBodyActionDecodeAblation;

comptime {
    if (!@hasDecl(boundary, "program")) {
        @compileError("Agent economy tooling requires Boundary program compilation");
    }
}
