const agent = @import("agent");
const fixture = @import("system_fixture_v3.zig");

const Action = union(enum) { done: u32 };

comptime {
    _ = agent.system(.{
        .name = "unknown-field",
        .version = "3.0.0",
        .Goal = fixture.Goal,
        .Action = Action,
        .Observation = fixture.Observation,
        .Result = fixture.Result,
        .Failure = fixture.Failure,
        .models = .{fixture.Model},
        .prompts = fixture.Prompts,
        .skills = .{},
        .actions = .{fixture.descriptor(.done)},
        .strategy = fixture.Strategy,
        .epistemics = struct {},
        .failures = .{},
        .representation = .{},
        .host_agent_loop = true,
    });
}
