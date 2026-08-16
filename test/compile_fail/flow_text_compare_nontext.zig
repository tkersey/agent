const agent = @import("agent");

fn invalidTextComparison() type {
    const Builder = agent.Flow(.{ .schema_types = .{} });
    comptime var flow = Builder.init("flow-text-compare-nontext");
    const value = flow.begin(u32);
    flow.returnValue(flow.textCompare(value, value));
    return flow.finish(i8);
}

comptime {
    _ = invalidTextComparison();
}
