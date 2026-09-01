const agent = @import("agent");
const boundary = @import("boundary");

pub const Goal = u32;
pub const Result = u32;
pub const FailureType = enum { rejected };
pub const Failure = FailureType;
pub const Observation = union(enum) { noop: void };

const Body = struct {
    pub const InitialArgs = Goal;
    pub const Result = Goal;
    pub const Failure = FailureType;
    pub const constants = .{};
    pub const effect_sites = boundary.effect.row(.{});
    pub const schema_types = .{FailureType};
    pub const control_ir: boundary.ir.Program = .{
        .label = "agent-system-compile-fail-fixture-v3",
        .value_types = &.{.{ .scalar = .u32 }},
        .blocks = &.{.{
            .id = 0,
            .parameters = &.{0},
            .terminator = .{ .return_value = 0 },
        }},
        .entry = 0,
        .result_type = .{ .scalar = .u32 },
    };
};

const Implementation = struct {
    pub fn ProgramBody(comptime _: anytype) type {
        return Body;
    }
};

pub const Strategy = agent.strategy.staged(.{
    .semantic_identity = "agent.strategy.compile-fail-fixture.v3",
    .implementation = Implementation,
});
pub const Model = agent.model(.{
    .name = "primary",
    .protocol = agent.protocol.openaiResponsesV1.Profile,
    .model = "compile-fail-model-v1",
    .parameters = .{},
});
pub const Prompts = .{agent.prompt.literal(.{
    .role = .user,
    .content = "Compile-fail fixture.",
})};

pub fn descriptor(comptime action_name: anytype) type {
    return agent.action.final(action_name, .{
        .name = @tagName(action_name),
        .description = "Finish.",
    });
}
