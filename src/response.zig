/// Define a previously declared `(Bytes, Bytes) -> bool` helper. The helper
/// performs exact logical-byte equality and maps impossible index/arithmetic
/// failures through the caller's authored Failure constants.
pub fn defineMatcher(
    flow: anytype,
    matcher: anytype,
    comptime context: anytype,
) void {
    const parameters = flow.enter(matcher.entry);
    const left = parameters[0];
    const right = parameters[1];
    const left_length = flow.vectorLength(left);
    const right_length = flow.vectorLength(right);
    const lengths_match = flow.integerEqual(left_length, right_length);
    const compare = flow.block(.loop_header, .{
        @TypeOf(left).Type,
        @TypeOf(right).Type,
        u32,
        u32,
    });
    const mismatch = flow.block(.segment, .{});
    flow.branch(
        lengths_match,
        compare,
        .{
            left,
            right,
            flow.constant(u32, context.zero_index),
            left_length,
        },
        mismatch,
        .{},
    );

    _ = flow.enter(mismatch);
    flow.returnToCaller(flow.constant(bool, context.false_index));

    const state = flow.enter(compare);
    const matched = flow.block(.segment, .{});
    const inspect = flow.block(.segment, .{
        @TypeOf(left).Type,
        @TypeOf(right).Type,
        u32,
        u32,
    });
    flow.branch(
        flow.integerGreaterEqual(state[2], state[3]),
        matched,
        .{},
        inspect,
        state,
    );

    _ = flow.enter(matched);
    flow.returnToCaller(flow.constant(bool, context.true_index));

    const inspecting = flow.enter(inspect);
    const left_byte = flow.vectorGetOrFail(
        inspecting[0],
        inspecting[2],
        flow.constant(context.Failure, context.invalid_index_failure_index),
    );
    const right_byte = flow.vectorGetOrFail(
        inspecting[1],
        inspecting[2],
        flow.constant(context.Failure, context.invalid_index_failure_index),
    );
    const next = flow.block(.segment, .{
        @TypeOf(left).Type,
        @TypeOf(right).Type,
        u32,
        u32,
    });
    flow.branch(
        flow.integerEqual(left_byte, right_byte),
        next,
        inspecting,
        mismatch,
        .{},
    );

    const next_state = flow.enter(next);
    flow.jump(compare, .{
        next_state[0],
        next_state[1],
        flow.integerAddOrFail(
            next_state[2],
            flow.constant(u32, context.one_index),
            flow.constant(context.Failure, context.arithmetic_failure_index),
        ),
        next_state[3],
    });
}
