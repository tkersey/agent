const agent = @import("agent");

const Implementation = struct {
    pub const lowering_complexity: usize = 0;
};
comptime {
    _ = agent.epistemics.custom(.{
        .semantic_identity = "fixture.zero-lowering-complexity.v1",
        .config = {},
        .implementation = Implementation,
    });
}
