const agent = @import("agent");
const fixture = @import("fixture.zig");

const Action = union(enum) { first: u32, final: u32 };

comptime {
    _ = fixture.define(
        Action,
        void,
        .{
            agent.action.final(.first, .{ .name = "same", .description = "Return." }),
            agent.action.final(.final, .{ .name = "same", .description = "Return." }),
        },
        .{ .maximum_observations = 0, .overflow = .fail },
    );
}
