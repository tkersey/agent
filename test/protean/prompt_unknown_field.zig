const agent = @import("agent");

comptime {
    _ = agent.prompt.literal(.{
        .role = .developer,
        .content = "Preserve declared instructions.",
        .contents = "An unknown field cannot be silently discarded.",
    });
}
