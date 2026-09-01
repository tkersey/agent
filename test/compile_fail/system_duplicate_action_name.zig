const agent = @import("agent");
const fixture = @import("system_fixture_v3.zig");

const Action = union(enum) { first: u32, second: u32 };

comptime {
    _ = agent.system(.{
        .name = "duplicate-action-name",
        .version = "3.0.0",
        .Goal = fixture.Goal,
        .Action = Action,
        .Observation = fixture.Observation,
        .Result = fixture.Result,
        .Failure = fixture.Failure,
        .models = .{fixture.Model},
        .prompts = fixture.Prompts,
        .skills = .{},
        .actions = .{
            agent.action.final(.first, .{ .name = "same", .description = "First." }),
            agent.action.final(.second, .{ .name = "same", .description = "Second." }),
        },
        .strategy = fixture.Strategy,
        .epistemics = struct {},
        .failures = .{},
        .representation = .{},
    });
}
