const agent = @import("agent");

comptime {
    _ = agent.model(.{
        .name = "invalid",
        .protocol = struct {
            pub const semantic_identity = agent.model_invocation.protocol_identity;
        },
        .model = "fixture-model",
        .parameters = .{ .provider_magic = @as(u32, 1) },
    });
}
