const agent = @import("agent");

const Invalid = agent.model(.{
    .name = "invalid",
    .protocol = agent.protocol.openaiResponsesV1.Profile,
    .model = "fixture-model-v1",
    .parameters = .{ .temperature = "0.20" },
});

comptime {
    _ = Invalid.parameters;
}
