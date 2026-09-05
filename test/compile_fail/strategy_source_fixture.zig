const agent = @import("agent");
const boundary = @import("boundary");
const fixture = @import("react_system_fixture.zig");

pub fn Program(comptime Strategy: type, comptime invalid: enum { skill, prompt }) type {
    @setEvalBranchQuota(500_000_000);
    const Prompt = if (invalid == .prompt) struct {
        pub const prompt_role = agent.prompt.Role.system;
        pub const content = "Finish.";
    } else agent.prompt.literal(.{ .role = .system, .content = "Finish." });
    const source = .{
        .name = "invalid-direct-strategy-source",
        .version = "3.0.0",
        .Goal = fixture.Goal,
        .Action = fixture.Action,
        .Observation = fixture.Observation,
        .Result = fixture.Result,
        .Failure = fixture.Failure,
        .models = .{agent.model(.{
            .name = "primary",
            .protocol = agent.protocol.openaiResponsesV2.Profile,
            .model = "fixture-model",
            .parameters = .{},
        })},
        .prompts = .{Prompt},
        .skills = .{agent.skill(.{
            .id = "completion",
            .description = "Complete only when active.",
            .instructions = "Call done.",
            .role = .developer,
            .position = .before_user,
            .activation = .conditional,
            .actions = .{if (invalid == .skill) "dnoe" else "done"},
        })},
        .actions = .{agent.action.final(.done, .{
            .name = "done",
            .description = "Return.",
        })},
        .strategy = Strategy,
        .epistemics = fixture.Stateless,
        .failures = fixture.failures,
        .representation = fixture.representation(),
    };
    return boundary.program(source.name, Strategy.ProgramBody(source));
}
