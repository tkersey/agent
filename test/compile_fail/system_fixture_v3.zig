const agent = @import("agent");

pub const Goal = u32;
pub const Result = u32;
pub const FailureType = enum { rejected };
pub const Failure = FailureType;
pub const Observation = union(enum) { noop: void };

pub const Strategy = agent.strategy.staged(.{
    .semantic_identity = "agent.strategy.compile-fail-fixture.v3",
});
pub const Model = agent.model(.{
    .name = "primary",
    .protocol = agent.protocol.openaiResponsesV2.Profile,
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
