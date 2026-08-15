const std = @import("std");
const boundary = @import("boundary");
const actuality = @import("repository_repair_actuality");

test "repository repair actuality definition is closed and bounded" {
    const Program = actuality.Compiled.Program;
    try std.testing.expectEqual(@as(usize, 7), actuality.Definition.action_count);
    try std.testing.expectEqual(@as(usize, 6), actuality.Compiled.ActionSites.len);
    try std.testing.expectEqual(
        Program.control_ir.value_types.len,
        Program.compiler_limits.maximum_values,
    );
    try std.testing.expectEqual(
        Program.control_ir.blocks.len,
        Program.compiler_limits.maximum_blocks,
    );
    try std.testing.expect(
        comptime boundary.schema.maximumEncodedSize(actuality.Action) <= 64 * 1024,
    );
    try std.testing.expect(
        comptime boundary.schema.maximumEncodedSize(
            actuality.Compiled.DecisionSite.Payload,
        ) <= 160 * 1024,
    );
    try std.testing.expectEqualStrings(
        "model.decide.v1",
        actuality.Compiled.DecisionSite.semantic_identity,
    );
    try std.testing.expectEqualStrings(
        "repo.list.v1",
        actuality.Compiled.ActionSites[1].semantic_identity,
    );
    try std.testing.expectEqualStrings(
        "repo.replace.approved.v1",
        actuality.Compiled.ActionSites[5].semantic_identity,
    );
}

test "repository repair uses explicit working-set epistemics" {
    try std.testing.expectEqualStrings(
        "agent.epistemics.repository-working-set.v1",
        actuality.Epistemics.semantic_identity,
    );
    try std.testing.expect(actuality.Epistemics.MemoryType(actuality.Definition) == actuality.Memory);
    try std.testing.expect(actuality.Epistemics.DecisionViewType(actuality.Definition) == actuality.DecisionView);
}

test "repository repair ENF schema maxima fit the reduced runtime envelope" {
    const State = actuality.Compiled.State;
    const Turn = actuality.Compiled.DecisionSite.Payload;
    const memory_bytes = comptime boundary.schema.maximumEncodedSize(actuality.Memory);
    const view_bytes = comptime boundary.schema.maximumEncodedSize(actuality.DecisionView);
    const state_bytes = comptime boundary.schema.maximumEncodedSize(State);
    const turn_bytes = comptime boundary.schema.maximumEncodedSize(Turn);

    try std.testing.expect(memory_bytes <= 160 * 1024);
    try std.testing.expect(view_bytes <= 160 * 1024);
    try std.testing.expect(state_bytes <= 192 * 1024);
    try std.testing.expect(turn_bytes <= 192 * 1024);
}
