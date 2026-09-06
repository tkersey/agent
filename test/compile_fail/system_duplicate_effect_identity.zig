const agent = @import("agent");
const boundary = @import("boundary");
const fixture = @import("system_fixture_v3.zig");

const Action = union(enum) { first: u32, second: bool };
const Observation = union(enum) { first: void, second: u32 };
const First = boundary.effect.site(1, "fixture.duplicate.v1", u32, void);
const Second = boundary.effect.site(2, "fixture.duplicate.v1", bool, u32);

comptime {
    _ = agent.system(.{
        .name = "duplicate-effect-identity",
        .version = "3.0.0",
        .Goal = fixture.Goal,
        .Action = Action,
        .Observation = Observation,
        .Result = fixture.Result,
        .Failure = fixture.Failure,
        .models = .{fixture.Model},
        .prompts = fixture.Prompts,
        .skills = .{},
        .actions = .{
            agent.action.effect(.first, .first, First, .{ .name = "first", .description = "First." }),
            agent.action.effect(.second, .second, Second, .{ .name = "second", .description = "Second." }),
        },
        .strategy = fixture.Strategy,
        .epistemics = agent.epistemics.systemStateless(.{}),
        .failures = .{},
        .representation = .{},
    });
}
