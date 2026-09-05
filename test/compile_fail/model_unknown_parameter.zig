const agent = @import("agent");

const Invalid = agent.model(.{
    .name = "invalid",
    .protocol = agent.protocol.openaiResponsesV2.Profile,
    .model = "fixture-model-v1",
    .parameters = .{ .provider_magic = @as(u32, 1) },
});

comptime {
    _ = Invalid.parameters;
}
