const agent = @import("agent");
const boundary = @import("boundary");
const fixture = @import("system_fixture_v3.zig");

const Action = union(enum) { mutate: u32 };
const Observation = union(enum) { mutated: bool };
const Site = boundary.effect.site(1, "fixture.mutate.v1", u16, bool);

comptime {
    _ = agent.system(.{
        .name = "effect-payload-mismatch",
        .version = "3.0.0",
        .Goal = fixture.Goal,
        .Action = Action,
        .Observation = Observation,
        .Result = fixture.Result,
        .Failure = fixture.Failure,
        .models = .{fixture.Model},
        .prompts = fixture.Prompts,
        .skills = .{},
        .actions = .{agent.action.effect(.mutate, .mutated, Site, .{
            .name = "mutate",
            .description = "Mutate.",
        })},
        .strategy = fixture.Strategy,
        .epistemics = struct {},
        .failures = .{},
        .representation = .{},
    });
}
