const agent = @import("agent");
const boundary = @import("boundary");
const fixture = @import("system_fixture_v3.zig");

const Action = union(enum) { tool: u32 };
const Observation = union(enum) { tool: void };
const Reserved = boundary.effect.site(
    9,
    "agent.model.invoke.v2",
    u32,
    void,
);

comptime {
    _ = agent.system(.{
        .name = "reserved-model-effect",
        .version = "3.0.0",
        .Goal = fixture.Goal,
        .Action = Action,
        .Observation = Observation,
        .Result = fixture.Result,
        .Failure = fixture.Failure,
        .models = .{fixture.Model},
        .prompts = fixture.Prompts,
        .skills = .{},
        .actions = .{agent.action.effect(.tool, .tool, Reserved, .{
            .name = "tool",
            .description = "Forbidden identity.",
        })},
        .strategy = fixture.Strategy,
        .epistemics = struct {},
        .failures = .{},
        .representation = .{},
    });
}
