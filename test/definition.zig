const std = @import("std");
const agent = @import("agent");
const boundary = @import("boundary");

const Goal = struct { subject: boundary.Text(64) };
const Result = struct { sources: u32 };
const Failure = enum { authored, budget };
const Action = union(enum) {
    lookup: u32,
    final: Result,
    abort: Failure,
};
const Observation = union(enum) { lookup: bool };
const Lookup = boundary.effect.site(0, "fixture.lookup.v1", u32, bool);

const Definition = agent.define(.{
    .name = "definition-fixture",
    .version = "1.0.0",
    .instructions = "Use one declared lookup and return a typed result.",
    .Goal = Goal,
    .Action = Action,
    .Observation = Observation,
    .Result = Result,
    .Failure = Failure,
    .decision = .{
        .interface = "model.decide.v1",
        .maximum_request_bytes = 4096,
        .maximum_result_bytes = 1024,
    },
    .actions = .{
        agent.action.effect(.lookup, .lookup, Lookup, .{
            .name = "lookup",
            .description = "Look up one fixture value.",
            .class = .tool,
        }),
        agent.action.final(.final, .{
            .name = "final",
            .description = "Return the typed result.",
        }),
        agent.action.fail(.abort, .{
            .name = "abort",
            .description = "Return an authored failure.",
        }),
    },
    .budget = .{
        .maximum_turns = 4,
        .maximum_decisions = 4,
        .maximum_effect_actions = 2,
        .maximum_child_actions = 0,
    },
    .history = .{
        .maximum_observations = 2,
        .overflow = .drop_oldest,
    },
});

test "definition retains typed immutable inputs" {
    try std.testing.expect(Definition.Goal == Goal);
    try std.testing.expect(Definition.Action == Action);
    try std.testing.expect(Definition.Observation == Observation);
    try std.testing.expect(Definition.Result == Result);
    try std.testing.expect(Definition.Failure == Failure);
    try std.testing.expectEqualStrings("model.decide.v1", Definition.decision.interface);
    try std.testing.expectEqual(@as(u32, 4), Definition.budget.maximum_turns);
    try std.testing.expectEqual(agent.HistoryOverflow.drop_oldest, Definition.history.overflow);
}
