const agent = @import("agent");

comptime {
    _ = agent.prompt.literal(.{
        .role = .developer,
        .content = "Reject unknown prompt fields.",
        .contents = "This must not be silently discarded.",
    });
}
