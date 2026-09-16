const std = @import("std");
const boundary = @import("boundary");
const agent = @import("agent");
const world = @import("world");
const witness = @import("callable.zig");

test "static-code callable preserves actual World observations and branch work" {
    const allocator = std.testing.allocator;
    var prior_functions: ?usize = null;
    var prior_schemas: ?usize = null;
    for ([_]usize{ 1, 8, 64 }) |count| {
        var raw_builder = boundary.computation.Builder.init(allocator);
        defer raw_builder.deinit();
        var agent_builder = boundary.computation.Builder.init(allocator);
        defer agent_builder.deinit();
        var raw_registry = agent.admission.Registry.init(allocator);
        defer raw_registry.deinit();
        var agent_registry = agent.admission.Registry.init(allocator);
        defer agent_registry.deinit();
        const original = try witness.build(&raw_builder, &raw_registry, .interned, count);
        const changed = try witness.build(&agent_builder, &agent_registry, .static_code, count);
        try std.testing.expectError(error.SpeculativeEffect, agent.admission.verify(allocator, original, &raw_registry));
        try agent.admission.verify(allocator, changed, &agent_registry);
        var raw = try boundary.source.construct(allocator, original);
        defer raw.deinit();
        var selected = try boundary.source.construct(allocator, changed);
        defer selected.deinit();
        var raw_stats: world.Statistics = .{};
        var selected_stats: world.Statistics = .{};
        const invocation_image_0 = try allocator.alloc(u8, try boundary.data_v2.program_image.encodedLength(raw.program));
        defer allocator.free(invocation_image_0);
        _ = try boundary.data_v2.program_image.encode(allocator, raw.program, invocation_image_0);
        var before = observed: {
            const instance: boundary.data_v2.invocation.Instance = .{ .initial_args = &.{} };
            var session = switch (instance) {
                .initial_args => |args| try world.Session.initImage(allocator, invocation_image_0, args),
                .state => |state| try world.Session.restoreImage(allocator, invocation_image_0, state),
            };
            defer session.deinit();
            session.statistics = &raw_stats;
            session.store.statistics = &raw_stats.storage;
            _ = try world.invocation.advance(&session, .none, null);
            break :observed try world.invocation.finish(allocator, &session, true);
        };
        defer before.deinit();
        const invocation_image_1 = try allocator.alloc(u8, try boundary.data_v2.program_image.encodedLength(selected.program));
        defer allocator.free(invocation_image_1);
        _ = try boundary.data_v2.program_image.encode(allocator, selected.program, invocation_image_1);
        var after = observed: {
            const instance: boundary.data_v2.invocation.Instance = .{ .initial_args = &.{} };
            var session = switch (instance) {
                .initial_args => |args| try world.Session.initImage(allocator, invocation_image_1, args),
                .state => |state| try world.Session.restoreImage(allocator, invocation_image_1, state),
            };
            defer session.deinit();
            session.statistics = &selected_stats;
            session.store.statistics = &selected_stats.storage;
            _ = try world.invocation.advance(&session, .none, null);
            break :observed try world.invocation.finish(allocator, &session, true);
        };
        defer after.deinit();
        try std.testing.expect(before.record == .completed);
        try std.testing.expect(after.record == .completed);
        try std.testing.expectEqualSlices(u8, &.{}, before.record.completed);
        try std.testing.expectEqualSlices(u8, before.record.completed, after.record.completed);
        try std.testing.expectEqual(count, selected_stats.multi_templates);
        try std.testing.expectEqual(count * 2, selected_stats.branch_activations);
        try std.testing.expectEqual(raw_stats.transitions, selected_stats.transitions);
        try std.testing.expectEqual(raw_stats.multi_templates, selected_stats.multi_templates);
        try std.testing.expectEqual(raw_stats.branch_activations, selected_stats.branch_activations);
        if (prior_functions) |expected| try std.testing.expectEqual(expected, selected.program.functions.len);
        if (prior_schemas) |expected| try std.testing.expectEqual(expected, selected.program.schemas.len);
        prior_functions = selected.program.functions.len;
        prior_schemas = selected.program.schemas.len;
        std.debug.print("callable installs={d} original_bytes={d} selected_bytes={d} " ++
            "functions={d} schemas={d} transitions={d} templates={d} branches={d}\n", .{
            count,                                                              try boundary.data_v2.program_image.encodedLength(raw.program),
            try boundary.data_v2.program_image.encodedLength(selected.program), selected.program.functions.len,
            selected.program.schemas.len,                                       selected_stats.transitions,
            selected_stats.multi_templates,                                     selected_stats.branch_activations,
        });
    }
}
