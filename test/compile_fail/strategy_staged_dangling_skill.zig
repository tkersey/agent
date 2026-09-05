const agent = @import("agent");
const fixture = @import("strategy_source_fixture.zig");

comptime {
    _ = fixture.Program(agent.strategy.staged(.{
        .semantic_identity = "fixture.staged.v1",
    }), .skill).image();
}
