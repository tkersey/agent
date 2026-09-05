const agent = @import("agent");

comptime {
    _ = agent.epistemics.system(.{
        .semantic_identity = "agent.epistemics.unknown-field.v1",
        .implementation = struct {},
        .implementaton = struct {},
    });
}
