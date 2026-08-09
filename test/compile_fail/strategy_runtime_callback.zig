const agent = @import("agent");

fn callback() void {}

const Implementation = struct {
    pub fn validate(comptime _: type, comptime _: anytype) void {}
    pub fn DecisionRequest(comptime _: type, comptime _: anytype) type {
        return u32;
    }
    pub fn StateSchemaTypes(comptime _: type, comptime _: anytype) @TypeOf(.{}) {
        return .{};
    }
    pub fn Body(comptime _: type, comptime _: anytype) type {
        return void;
    }
};

comptime {
    _ = agent.strategy.custom(.{
        .semantic_identity = "fixture.runtime-callback.v1",
        .config = .{ .callback = &callback },
        .implementation = Implementation,
        .action_coverage = .{},
    });
}
