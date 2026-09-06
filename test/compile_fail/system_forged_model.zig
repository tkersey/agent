const agent = @import("agent");
const fixture = @import("system_fixture_v3.zig");

const Action = union(enum) { done: u32 };
const ForgedModel = struct {
    pub const name = "forged";
    pub const protocol = agent.protocol.openaiResponsesV2.Profile;
    pub const model_id = "";
    pub const ParametersType = @TypeOf(.{ .max_output_tokens = @as(u32, 0) });
    pub const parameters = .{ .max_output_tokens = @as(u32, 0) };
};

comptime {
    _ = agent.system(.{
        .name = "forged-model",
        .version = "3.0.0",
        .Goal = fixture.Goal,
        .Action = Action,
        .Observation = fixture.Observation,
        .Result = fixture.Result,
        .Failure = fixture.Failure,
        .models = .{ForgedModel},
        .prompts = fixture.Prompts,
        .skills = .{},
        .actions = .{fixture.descriptor(.done)},
        .strategy = fixture.Strategy,
        .epistemics = struct {},
        .failures = .{},
        .representation = .{},
    });
}
