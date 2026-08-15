const agent = @import("agent");
comptime {
    _ = agent.epistemics.verbatim(.{
        .maximum_observations = @as(u64, 1) << 32,
        .overflow = .fail,
        .final = agent.final_policy.none,
    });
}
