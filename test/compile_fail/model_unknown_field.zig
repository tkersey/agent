const agent = @import("agent");

comptime {
    _ = agent.model(.{
        .name = "primary",
        .protocol = agent.protocol.openaiResponsesV1.Profile,
        .model = "test-model",
        .paramters = .{},
    });
}
