const agent = @import("agent");
const boundary = @import("boundary");
const fixture = @import("system_fixture_v3.zig");

const Action = union(enum) { tool: u32 };
const Observation = union(enum) { tool: void };
const Noncanonical = boundary.effect.site(2, "fixture.noncanonical-site.v1", u32, void);

comptime {
    _ = agent.system(.{
        .name = "noncanonical-effect-site",
        .version = "3.0.0",
        .Goal = fixture.Goal,
        .Action = Action,
        .Observation = Observation,
        .Result = fixture.Result,
        .Failure = fixture.Failure,
        .models = .{fixture.Model},
        .prompts = fixture.Prompts,
        .skills = .{},
        .actions = .{agent.action.effect(.tool, .tool, Noncanonical, .{
            .name = "tool",
            .description = "Noncanonical site.",
        })},
        .strategy = fixture.Strategy,
        .epistemics = agent.epistemics.systemStateless(.{}),
        .failures = .{},
        .representation = .{},
    });
}
