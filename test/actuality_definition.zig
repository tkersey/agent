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
            actuality.Strategy.DecisionRequestType(actuality.Definition),
        ) <= 512 * 1024,
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

test "repository repair final policy requires passing tests" {
    try std.testing.expectEqual(
        .latest_observation_bool,
        std.meta.activeTag(actuality.Definition.final_policy),
    );
    const requirement = actuality.Definition.final_policy.latest_observation_bool;
    try std.testing.expectEqualStrings("run_tests", requirement.observation_name);
    try std.testing.expectEqualStrings("passed", requirement.field_name);
    try std.testing.expect(requirement.expected);
}
