const flow_module = @import("flow.zig");

fn payloadType(comptime Action: type, comptime index: usize) type {
    return @typeInfo(Action).@"union".fields[index].type;
}

pub fn emit(
    flow: anytype,
    comptime Profile: type,
    comptime Action: type,
    comptime actions: anytype,
    call: anytype,
    comptime context: anytype,
) flow_module.Value(Action) {
    var call_name = flow.productExtract(1, call);
    const NameText = @TypeOf(call_name).Type;
    var ordinal = flow.productExtract(3, call);
    var decode_result = flow.productExtract(4, call);
    const malformed = flow.block(.terminal_handoff, .{});
    const join = flow.block(.segment, .{Action});
    inline for (actions, 0..) |_, action_index| {
        flow.setPhase(.agent_action_name_match);
        const matched = flow.block(.segment, .{ u32, Profile.DecodedActionType });
        const next = flow.block(.segment, .{ NameText, u32, Profile.DecodedActionType });
        const expected_tool = flow.vectorGetOrFail(
            flow.constant(Profile.ToolsType, Profile.tool_declarations_index),
            flow.constant(u32, context.action_index_indices[action_index]),
            flow.constant(context.Failure, context.invalid_index_failure_index),
        );
        flow.branch(
            flow.integerEqual(
                flow.textCompare(call_name, flow.productExtract(2, expected_tool)),
                flow.constant(i8, context.zero_i8_index),
            ),
            matched,
            .{ ordinal, decode_result },
            next,
            .{ call_name, ordinal, decode_result },
        );
        const matched_values = flow.enter(matched);
        flow.setPhase(.agent_action_argument_decode);
        const decoded = flow.sumExtractOrFail(
            0,
            matched_values[1],
            flow.constant(context.Failure, context.malformed_failure_index),
        );
        const valid = flow.booleanAnd(
            flow.integerEqual(
                matched_values[0],
                flow.constant(u32, context.action_index_indices[action_index]),
            ),
            flow.sumTagIs(action_index, decoded),
        );
        flow.branch(valid, join, .{decoded}, malformed, .{});
        const next_values = flow.enter(next);
        call_name = next_values[0];
        ordinal = next_values[1];
        decode_result = next_values[2];
    }
    flow.failValue(flow.constant(context.Failure, context.unknown_action_failure_index));
    _ = flow.enter(malformed);
    flow.failValue(flow.constant(context.Failure, context.malformed_failure_index));
    return flow.enter(join)[0];
}

pub fn emitNameOnly(
    flow: anytype,
    comptime Profile: type,
    comptime Action: type,
    comptime actions: anytype,
    call: anytype,
    comptime context: anytype,
) flow_module.Value(Action) {
    var call_name = flow.productExtract(1, call);
    const NameText = @TypeOf(call_name).Type;
    const join = flow.block(.segment, .{Action});
    inline for (actions, 0..) |_, action_index| {
        const matched = flow.block(.segment, .{});
        const next = flow.block(.segment, .{NameText});
        const expected_tool = flow.vectorGetOrFail(
            flow.constant(Profile.ToolsType, Profile.tool_declarations_index),
            flow.constant(u32, context.action_index_indices[action_index]),
            flow.constant(context.Failure, context.invalid_index_failure_index),
        );
        flow.branch(
            flow.integerEqual(
                flow.textCompare(call_name, flow.productExtract(2, expected_tool)),
                flow.constant(i8, context.zero_i8_index),
            ),
            matched,
            .{},
            next,
            .{call_name},
        );
        _ = flow.enter(matched);
        flow.jump(join, .{flow.sumConstruct(
            Action,
            action_index,
            flow.constant(
                payloadType(Action, action_index),
                context.payload_default_indices[action_index],
            ),
        )});
        call_name = flow.enter(next)[0];
    }
    flow.failValue(flow.constant(context.Failure, context.unknown_action_failure_index));
    return flow.enter(join)[0];
}
