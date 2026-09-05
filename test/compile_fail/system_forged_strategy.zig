const agent = @import("agent");
const fixture = @import("system_fixture_v3.zig");

const Action = union(enum) { done: u32 };
const Forged = struct {
    pub const system_semantic_identity = "forged";
    pub fn ProgramBody(comptime _: anytype) type {
        return void;
    }
};

comptime {
    _ = agent.system(.{
        .name = "forged-strategy",
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
        .strategy = Forged,
        .epistemics = struct {},
        .failures = .{},
        .representation = .{},
    });
}
