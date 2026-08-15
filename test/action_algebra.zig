const std = @import("std");
const agent = @import("agent");
const boundary = @import("boundary");

const Result = struct { value: u32 };
const Failure = enum { authored };
const Action = union(enum) {
    lookup: u32,
    final: Result,
    abort: Failure,
};
const Observation = union(enum) { found: bool };
const Lookup = boundary.effect.site(7, "fixture.lookup.v1", u32, bool);

const Definition = agent.define(.{
    .name = "action-order-fixture",
    .version = "1.0.0",
    .instructions = "Prove canonical Action declaration ordering.",
    .Goal = u32,
    .Action = Action,
    .Observation = Observation,
    .Result = Result,
    .Failure = Failure,
    .decision = .{
        .interface = "model.decide.v1",
        .maximum_request_bytes = 1024,
        .maximum_result_bytes = 256,
    },
    .actions = .{
        agent.action.final(.final, .{ .name = "finish", .description = "Finish." }),
        agent.action.fail(.abort, .{ .name = "abort", .description = "Abort." }),
        agent.action.effect(.lookup, .found, Lookup, .{
            .name = "lookup",
            .description = "Look up a value.",
            .class = .tool,
        }),
    },
    .budget = .{
        .maximum_turns = 3,
        .maximum_decisions = 3,
        .maximum_effect_actions = 1,
        .maximum_child_actions = 0,
    },
});

test "descriptors are projected in Action declaration order" {
    try std.testing.expectEqual(@as(usize, 3), Definition.action_count);
    try std.testing.expectEqualStrings("lookup", Definition.ActionDescriptor(0).name);
    try std.testing.expectEqual(agent.action.Kind.effect, Definition.ActionDescriptor(0).kind);
    try std.testing.expectEqualStrings("finish", Definition.ActionDescriptor(1).name);
    try std.testing.expectEqual(agent.action.Kind.final, Definition.ActionDescriptor(1).kind);
    try std.testing.expectEqual(agent.action.Kind.fail, Definition.ActionDescriptor(2).kind);
    try std.testing.expectEqual(@as(usize, 1), Definition.actionIndex("finish"));
}

test "effect descriptor retains exact typed site relation" {
    const Descriptor = Definition.ActionDescriptor(0);
    try std.testing.expect(Descriptor.Site == Lookup);
    try std.testing.expect(Descriptor.Site.Payload == u32);
    try std.testing.expect(Descriptor.Site.Resume == bool);
    try std.testing.expectEqualStrings("found", Descriptor.observation_name);
}
