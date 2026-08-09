const agent = @import("agent");
const fixture = @import("fixture.zig");

const Action = union(enum) { final: u32, abort: u32 };

comptime {
    _ = fixture.define(
        Action,
        void,
        .{
            agent.action.final(.final, .{ .name = "final", .description = "Return." }),
            agent.action.fail(.abort, .{ .name = "abort", .description = "Abort." }),
        },
        .{ .maximum_observations = 0, .overflow = .fail },
    );
}
