const agent = @import("agent");

comptime {
    _ = agent.skill(.{
        .id = "invalid",
        .description = "Reject unknown skill fields.",
        .instructions = "Preserve the declared skill.",
        .role = .developer,
        .position = .before_user,
        .activation = .always,
        .actions = .{},
        .actons = .{},
    });
}
