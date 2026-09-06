const agent = @import("agent");

comptime {
    _ = agent.skill(.{
        .id = "unknown-field",
        .description = "Reject unknown skill fields.",
        .instructions = "Reject them.",
        .role = .developer,
        .position = .before_user,
        .activation = .always,
        .actions = .{},
        .actons = .{},
    });
}
