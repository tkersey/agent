const agent = @import("agent");
const fixture = @import("fixture.zig");

const Action = union(enum) { abort: fixture.Failure };

comptime {
    _ = fixture.define(
        Action,
        void,
        .{agent.action.fail(.abort, .{ .name = "abort", .description = "Abort." })},
        .{ .maximum_observations = 0, .overflow = .fail },
    );
}
