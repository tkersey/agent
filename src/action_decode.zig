const boundary = @import("boundary");
const staged = @import("staged_json.zig");

fn payloadType(comptime Action: type, comptime index: usize) type {
    return @typeInfo(Action).@"union".fields[index].type;
}

fn maximumFields(comptime Action: type) usize {
    var maximum: usize = 1;
    inline for (@typeInfo(Action).@"union".fields) |field| {
        const count = switch (@typeInfo(field.type)) {
            .@"struct" => |info| info.fields.len,
            else => 1,
        };
        maximum = @max(maximum, count);
    }
    return maximum;
}

pub fn Seen(comptime Action: type) type {
    return boundary.Vector(bool, maximumFields(Action));
}

fn ParsedValue(comptime T: type, comptime Bytes: type) type {
    return struct {
        cursor: @import("flow.zig").Value(staged.Cursor(Bytes)),
        value: @import("flow.zig").Value(T),
    };
}

pub fn emit(
    flow: anytype,
    comptime Action: type,
    comptime actions: anytype,
    comptime Bytes: type,
    call: anytype,
    core: staged.Helpers(@TypeOf(flow.*), Bytes),
    comptime context: anytype,
) @import("flow.zig").Value(Action) {
    const Text = boundary.Text(Bytes.maximum_length);
    const join = flow.block(.segment, .{Action});
    var name = flow.productExtract(0, call);
    var arguments = flow.productExtract(1, call);
    inline for (actions, 0..) |_, action_index| {
        const matched = flow.block(.segment, .{ Text, Bytes });
        const next = flow.block(.segment, .{ Text, Bytes });
        const equal = flow.integerEqual(
            flow.textCompare(
                name,
                flow.constant(Text, context.action_name_indices[action_index]),
            ),
            flow.constant(i8, context.zero_i8_index),
        );
        flow.branch(equal, matched, .{ name, arguments }, next, .{ name, arguments });
        const values = flow.enter(matched);
        const Payload = payloadType(Action, action_index);
        const parsed = emitValue(
            flow,
            Action,
            actions,
            Bytes,
            Payload,
            values[1],
            action_index,
            core,
            context,
        );
        const trailing = flow.call(core.skip_whitespace, .{parsed.cursor}, .{});
        const trailing_bytes = flow.productExtract(0, trailing.value);
        const trailing_index = flow.productExtract(1, trailing.value);
        const complete = flow.block(.segment, .{Payload});
        const malformed = flow.block(.terminal_handoff, .{});
        flow.branch(
            flow.integerEqual(trailing_index, flow.bytesLength(trailing_bytes)),
            complete,
            .{parsed.value},
            malformed,
            .{},
        );
        const payload = flow.enter(complete)[0];
        flow.jump(join, .{flow.sumConstruct(Action, action_index, payload)});
        _ = flow.enter(malformed);
        flow.failValue(flow.constant(context.Failure, context.malformed_failure_index));
        const next_values = flow.enter(next);
        name = next_values[0];
        arguments = next_values[1];
    }
    flow.failValue(flow.constant(context.Failure, context.unknown_action_failure_index));
    return flow.enter(join)[0];
}

fn emitValue(
    flow: anytype,
    comptime Action: type,
    comptime actions: anytype,
    comptime Bytes: type,
    comptime T: type,
    bytes: @import("flow.zig").Value(Bytes),
    comptime action_index: usize,
    core: staged.Helpers(@TypeOf(flow.*), Bytes),
    comptime context: anytype,
) ParsedValue(T, Bytes) {
    _ = actions;
    switch (@typeInfo(T)) {
        .@"struct" => return emitStruct(
            flow,
            Action,
            Bytes,
            T,
            bytes,
            action_index,
            core,
            context,
        ),
        else => @compileError("agent action decoder currently requires struct payloads"),
    }
}

fn emitStruct(
    flow: anytype,
    comptime Action: type,
    comptime Bytes: type,
    comptime T: type,
    bytes: @import("flow.zig").Value(Bytes),
    comptime action_index: usize,
    core: staged.Helpers(@TypeOf(flow.*), Bytes),
    comptime context: anytype,
) ParsedValue(T, Bytes) {
    const Text = boundary.Text(Bytes.maximum_length);
    const SeenType = Seen(Action);
    const fields = @typeInfo(T).@"struct".fields;
    const zero = flow.constant(u32, context.zero_u32_index);
    const initial_cursor = flow.productConstruct(staged.Cursor(Bytes), .{ bytes, zero });
    const opening = flow.bytesByteAt(
        bytes,
        zero,
        flow.constant(context.Failure, context.malformed_failure_index),
    );
    const begin = flow.block(.segment, .{ Bytes, u32 });
    const malformed = flow.block(.terminal_handoff, .{});
    flow.branch(
        flow.integerEqual(opening, flow.constant(u8, context.left_brace_index)),
        begin,
        .{ bytes, zero },
        malformed,
        .{},
    );
    _ = initial_cursor;
    const started = flow.enter(begin);
    const loop = flow.block(.loop_header, .{ staged.Cursor(Bytes), SeenType, T });
    flow.jump(loop, .{
        flow.productConstruct(staged.Cursor(Bytes), .{
            started[0],
            flow.integerAddOrFail(
                started[1],
                flow.constant(u32, context.one_u32_index),
                flow.constant(context.Failure, context.arithmetic_failure_index),
            ),
        }),
        flow.constant(SeenType, context.seen_indices[action_index]),
        flow.constant(T, context.payload_default_indices[action_index]),
    });
    const current = flow.enter(loop);
    const spaced = flow.call(core.skip_whitespace, .{current[0]}, .{ current[1], current[2] });
    const cursor_value = spaced.value;
    const cursor_bytes = flow.productExtract(0, cursor_value);
    const cursor_index = flow.productExtract(1, cursor_value);
    const byte = flow.bytesByteAt(
        cursor_bytes,
        cursor_index,
        flow.constant(context.Failure, context.malformed_failure_index),
    );
    const finalize = flow.block(.segment, .{ staged.Cursor(Bytes), SeenType, T });
    const member = flow.block(.segment, .{ staged.Cursor(Bytes), SeenType, T });
    flow.branch(
        flow.integerEqual(byte, flow.constant(u8, context.right_brace_index)),
        finalize,
        .{
            flow.productConstruct(staged.Cursor(Bytes), .{
                cursor_bytes,
                flow.integerAddOrFail(
                    cursor_index,
                    flow.constant(u32, context.one_u32_index),
                    flow.constant(context.Failure, context.arithmetic_failure_index),
                ),
            }),
            spaced.carried[0],
            spaced.carried[1],
        },
        member,
        .{ cursor_value, spaced.carried[0], spaced.carried[1] },
    );
    const member_values = flow.enter(member);
    const key = flow.call(core.parse_string, .{member_values[0]}, .{ member_values[1], member_values[2] });
    const after_key = flow.call(
        core.skip_whitespace,
        .{flow.productExtract(0, key.value)},
        .{ key.carried[0], key.carried[1], flow.productExtract(1, key.value) },
    );
    const colon_cursor = after_key.value;
    const colon_bytes = flow.productExtract(0, colon_cursor);
    const colon_index = flow.productExtract(1, colon_cursor);
    const colon = flow.bytesByteAt(
        colon_bytes,
        colon_index,
        flow.constant(context.Failure, context.malformed_failure_index),
    );
    const dispatch = flow.block(.segment, .{ staged.Cursor(Bytes), SeenType, T, Text });
    flow.branch(
        flow.integerEqual(colon, flow.constant(u8, context.colon_index)),
        dispatch,
        .{
            flow.productConstruct(staged.Cursor(Bytes), .{
                colon_bytes,
                flow.integerAddOrFail(
                    colon_index,
                    flow.constant(u32, context.one_u32_index),
                    flow.constant(context.Failure, context.arithmetic_failure_index),
                ),
            }),
            after_key.carried[0],
            after_key.carried[1],
            after_key.carried[2],
        },
        malformed,
        .{},
    );
    const after_value = flow.block(.segment, .{ staged.Cursor(Bytes), SeenType, T });
    var dispatch_values = flow.enter(dispatch);
    inline for (fields, 0..) |field, field_index| {
        const matched = flow.block(.segment, .{ staged.Cursor(Bytes), SeenType, T });
        const next = flow.block(.segment, .{ staged.Cursor(Bytes), SeenType, T, Text });
        const equal = flow.integerEqual(
            flow.textCompare(
                dispatch_values[3],
                flow.constant(Text, context.field_name_indices[action_index][field_index]),
            ),
            flow.constant(i8, context.zero_i8_index),
        );
        flow.branch(
            equal,
            matched,
            .{ dispatch_values[0], dispatch_values[1], dispatch_values[2] },
            next,
            dispatch_values,
        );
        const values = flow.enter(matched);
        const unseen = flow.block(.segment, .{ staged.Cursor(Bytes), SeenType, T });
        flow.branch(
            flow.vectorGetOrFail(
                values[1],
                flow.constant(u32, context.field_index_indices[field_index]),
                flow.constant(context.Failure, context.invalid_index_failure_index),
            ),
            malformed,
            .{},
            unseen,
            values,
        );
        const accepted = flow.enter(unseen);
        const parsed = emitField(
            flow,
            Bytes,
            field.type,
            accepted[0],
            core,
            context,
        );
        const seen = flow.vectorSet(
            accepted[1],
            flow.constant(u32, context.field_index_indices[field_index]),
            flow.constant(bool, context.true_index),
        );
        const value = flow.productReplace(field_index, accepted[2], parsed.value);
        flow.jump(after_value, .{ parsed.cursor, seen, value });
        dispatch_values = flow.enter(next);
    }
    flow.jump(malformed, .{});

    const delimited = flow.enter(after_value);
    const after_ws = flow.call(core.skip_whitespace, .{delimited[0]}, .{ delimited[1], delimited[2] });
    const delimiter_cursor = after_ws.value;
    const delimiter_bytes = flow.productExtract(0, delimiter_cursor);
    const delimiter_index = flow.productExtract(1, delimiter_cursor);
    const delimiter = flow.bytesByteAt(
        delimiter_bytes,
        delimiter_index,
        flow.constant(context.Failure, context.malformed_failure_index),
    );
    const comma = flow.block(.segment, .{ Bytes, u32, SeenType, T });
    const close = flow.block(.segment, .{ Bytes, u32, SeenType, T, u8 });
    flow.branch(
        flow.integerEqual(delimiter, flow.constant(u8, context.comma_index)),
        comma,
        .{ delimiter_bytes, delimiter_index, after_ws.carried[0], after_ws.carried[1] },
        close,
        .{ delimiter_bytes, delimiter_index, after_ws.carried[0], after_ws.carried[1], delimiter },
    );
    const next_member = flow.enter(comma);
    flow.jump(loop, .{
        flow.productConstruct(staged.Cursor(Bytes), .{
            next_member[0],
            flow.integerAddOrFail(
                next_member[1],
                flow.constant(u32, context.one_u32_index),
                flow.constant(context.Failure, context.arithmetic_failure_index),
            ),
        }),
        next_member[2],
        next_member[3],
    });
    const closing = flow.enter(close);
    flow.branch(
        flow.integerEqual(closing[4], flow.constant(u8, context.right_brace_index)),
        finalize,
        .{
            flow.productConstruct(staged.Cursor(Bytes), .{
                closing[0],
                flow.integerAddOrFail(
                    closing[1],
                    flow.constant(u32, context.one_u32_index),
                    flow.constant(context.Failure, context.arithmetic_failure_index),
                ),
            }),
            closing[2],
            closing[3],
        },
        malformed,
        .{},
    );
    const finished = flow.enter(finalize);
    var all_seen = flow.constant(bool, context.true_index);
    inline for (fields, 0..) |_, field_index| {
        all_seen = flow.booleanAnd(
            all_seen,
            flow.vectorGetOrFail(
                finished[1],
                flow.constant(u32, context.field_index_indices[field_index]),
                flow.constant(context.Failure, context.invalid_index_failure_index),
            ),
        );
    }
    const done = flow.block(.segment, .{ staged.Cursor(Bytes), T });
    flow.branch(all_seen, done, .{ finished[0], finished[2] }, malformed, .{});
    _ = flow.enter(malformed);
    flow.failValue(flow.constant(context.Failure, context.malformed_failure_index));
    const result = flow.enter(done);
    return .{ .cursor = result[0], .value = result[1] };
}

fn emitField(
    flow: anytype,
    comptime Bytes: type,
    comptime T: type,
    cursor_value: @import("flow.zig").Value(staged.Cursor(Bytes)),
    core: staged.Helpers(@TypeOf(flow.*), Bytes),
    comptime context: anytype,
) ParsedValue(T, Bytes) {
    if (comptime @typeInfo(T) == .int) {
        const parsed = flow.call(core.parse_unsigned, .{cursor_value}, .{});
        return .{
            .cursor = flow.productExtract(0, parsed.value),
            .value = flow.integerConvertOrFail(
                T,
                flow.productExtract(1, parsed.value),
                flow.constant(context.Failure, context.arithmetic_failure_index),
            ),
        };
    }
    if (comptime boundary.schema.isTextType(T)) {
        const parsed = flow.call(core.parse_string, .{cursor_value}, .{});
        const text = flow.productExtract(1, parsed.value);
        return .{
            .cursor = flow.productExtract(0, parsed.value),
            .value = flow.textCopyOrFail(
                T,
                text,
                flow.constant(u32, context.zero_u32_index),
                flow.textLength(text),
                flow.constant(context.Failure, context.capacity_failure_index),
                flow.constant(context.Failure, context.invalid_utf8_failure_index),
            ),
        };
    }
    @compileError("agent action decoder field type is not implemented: " ++ @typeName(T));
}
