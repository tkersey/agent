const agent = @import("agent");
const fixture = @import("system_fixture_v3.zig");

const Action = union(enum) { done: u32 };
const ForgedPrompt = struct {
    pub const prompt_role = agent.prompt.Role.user;
    pub const content = "forged";
};

comptime {
    _ = agent.system(.{
        .name = "forged-prompt",
        .version = "3.0.0",
        .Goal = fixture.Goal,
        .Action = Action,
        .Observation = fixture.Observation,
        .Result = fixture.Result,
        .Failure = fixture.Failure,
        .models = .{fixture.Model},
        .prompts = .{ForgedPrompt},
        .skills = .{},
        .actions = .{fixture.descriptor(.done)},
        .strategy = fixture.Strategy,
        .epistemics = agent.epistemics.systemStateless(.{}),
        .failures = .{},
        .representation = .{},
    });
}
