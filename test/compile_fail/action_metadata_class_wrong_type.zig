const agent = @import("agent");

const ForeignClass = enum { tool };

comptime {
    const Descriptor = agent.action.final(.final, .{
        .name = "finish",
        .description = "Finish.",
        .class = ForeignClass.tool,
    });
    _ = Descriptor.class;
}
