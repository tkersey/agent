const agent = @import("agent");
const fixture = @import("system_fixture_v3.zig");

const Action = union(enum) { done: u32 };

comptime {
    _ = agent.system(.{
        .name = "dangling-skill-action",
        .version = "3.0.0",
        .Goal = fixture.Goal,
        .Action = Action,
        .Observation = fixture.Observation,
        .Result = fixture.Result,
        .Failure = fixture.Failure,
        .models = .{fixture.Model},
        .prompts = fixture.Prompts,
        .skills = .{agent.skill(.{
            .id = "dangling",
            .description = "References a missing action.",
            .instructions = "Use the missing action.",
            .role = .developer,
            .position = .before_user,
            .activation = .always,
            .actions = .{"missing"},
        })},
        .actions = .{fixture.descriptor(.done)},
        .strategy = fixture.Strategy,
        .epistemics = struct {},
        .failures = .{},
        .representation = .{},
    });
}
