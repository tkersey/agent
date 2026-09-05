const agent = @import("agent");
const fixture = @import("system_fixture_v3.zig");

const Action = union(enum) { done: u32 };
const ForgedSkill = struct {
    pub const id = "forged";
    pub const description = "forged";
    pub const instructions = "forged";
    pub const role = agent.prompt.Role.developer;
    pub const position = agent.skill(.{
        .id = "witness",
        .description = "witness",
        .instructions = "witness",
        .role = .developer,
        .position = .before_user,
        .activation = .always,
        .actions = .{},
    }).position;
    pub const activation = agent.skill(.{
        .id = "witness",
        .description = "witness",
        .instructions = "witness",
        .role = .developer,
        .position = .before_user,
        .activation = .always,
        .actions = .{},
    }).activation;
    pub const actions = .{"done"};
};

comptime {
    _ = agent.system(.{
        .name = "forged-skill",
        .version = "3.0.0",
        .Goal = fixture.Goal,
        .Action = Action,
        .Observation = fixture.Observation,
        .Result = fixture.Result,
        .Failure = fixture.Failure,
        .models = .{fixture.Model},
        .prompts = fixture.Prompts,
        .skills = .{ForgedSkill},
        .actions = .{fixture.descriptor(.done)},
        .strategy = fixture.Strategy,
        .epistemics = agent.epistemics.systemStateless(.{}),
        .failures = .{},
        .representation = .{},
    });
}
