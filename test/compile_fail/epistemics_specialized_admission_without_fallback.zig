const agent = @import("agent");

const Implementation = struct {
    pub const semantic_identity = "fixture.specialized-admission-without-fallback.v1";

    pub fn emitActionAllowedKnown() void {}
};

comptime {
    _ = agent.epistemics.custom(.{
        .semantic_identity = "fixture.specialized-admission-without-fallback.v1",
        .config = {},
        .implementation = Implementation,
    });
}
