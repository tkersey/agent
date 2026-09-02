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

pub fn ArgumentField(comptime Bytes: type) type {
    return struct {
        name: boundary.Text(Bytes.maximum_length),
        start: u32,
        end: u32,
    };
}

pub fn ArgumentFields(comptime Action: type, comptime Bytes: type) type {
    return boundary.Vector(ArgumentField(Bytes), maximumFields(Action));
}

pub fn ArgumentObject(comptime Action: type, comptime Bytes: type) type {
    return struct {
        bytes: Bytes,
        fields: ArgumentFields(Action, Bytes),
    };
}

pub fn schemaTypes(comptime Action: type, comptime Bytes: type) @TypeOf(.{
    ArgumentField(Bytes),
    ArgumentFields(Action, Bytes),
    ArgumentObject(Action, Bytes),
}) {
    return .{
        ArgumentField(Bytes),
        ArgumentFields(Action, Bytes),
        ArgumentObject(Action, Bytes),
    };
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
    var call_name = flow.productExtract(1, call);
    const NameText = @TypeOf(call_name).Type;
    var arguments = flow.productExtract(2, call);
    flow.setPhase(.agent_action_name_match);
    const join = flow.block(.segment, .{Action});
    inline for (actions, 0..) |_, action_index| {
        flow.setPhase(.agent_action_name_match);
        const matched = flow.block(.segment, .{ NameText, Bytes });
        const next = flow.block(.segment, .{ NameText, Bytes });
        const equal = flow.integerEqual(
            flow.textCompare(
                call_name,
                flow.constant(NameText, context.action_name_indices[action_index]),
            ),
            flow.constant(i8, context.zero_i8_index),
        );
        flow.branch(
            equal,
            matched,
            .{ call_name, arguments },
            next,
            .{ call_name, arguments },
        );
        const values = flow.enter(matched);
        flow.setPhase(.agent_action_argument_decode);
        const Payload = payloadType(Action, action_index);
        const payload = emitDirectObject(
            flow,
            Action,
            Bytes,
            Payload,
            values[1],
            action_index,
            core,
            context,
        );
        flow.jump(join, .{flow.sumConstruct(Action, action_index, payload)});
        const next_values = flow.enter(next);
        call_name = next_values[0];
        arguments = next_values[1];
    }
    flow.failValue(flow.constant(context.Failure, context.unknown_action_failure_index));
    return flow.enter(join)[0];
}

/// Economy-only ablation: preserve action-name matching while replacing the
/// argument decoder with each payload's canonical zero/default value. This is
/// never a valid execution strategy; it exists only to measure the exact cost
/// of strict Action JSON decoding in an otherwise identical closed system.
pub fn emitNameOnly(
    flow: anytype,
    comptime Action: type,
    comptime actions: anytype,
    comptime Bytes: type,
    call: anytype,
    comptime context: anytype,
) @import("flow.zig").Value(Action) {
    var call_name = flow.productExtract(1, call);
    const NameText = @TypeOf(call_name).Type;
    var arguments = flow.productExtract(2, call);
    const join = flow.block(.segment, .{Action});
    inline for (actions, 0..) |_, action_index| {
        flow.setPhase(.agent_action_name_match);
        const matched = flow.block(.segment, .{});
        const next = flow.block(.segment, .{ NameText, Bytes });
        const equal = flow.integerEqual(
            flow.textCompare(
                call_name,
                flow.constant(NameText, context.action_name_indices[action_index]),
            ),
            flow.constant(i8, context.zero_i8_index),
        );
        flow.branch(equal, matched, .{}, next, .{ call_name, arguments });
        _ = flow.enter(matched);
        flow.jump(join, .{flow.sumConstruct(
            Action,
            action_index,
            flow.constant(
                payloadType(Action, action_index),
                context.payload_default_indices[action_index],
            ),
        )});
        const next_values = flow.enter(next);
        call_name = next_values[0];
        arguments = next_values[1];
    }
    flow.failValue(flow.constant(context.Failure, context.unknown_action_failure_index));
    return flow.enter(join)[0];
}

fn emitDirectObject(
    flow: anytype,
    comptime Action: type,
    comptime Bytes: type,
    comptime Payload: type,
    bytes: @import("flow.zig").Value(Bytes),
    comptime action_index: usize,
    core: staged.Helpers(@TypeOf(flow.*), Bytes),
    comptime context: anytype,
) @import("flow.zig").Value(Payload) {
    const Cursor = staged.Cursor(Bytes);
    const Text = boundary.Text(Bytes.maximum_length);
    const SeenType = Seen(Action);
    const zero = flow.constant(u32, context.zero_u32_index);
    const malformed = flow.block(.terminal_handoff, .{});
    const initial = flow.productConstruct(Cursor, .{ bytes, zero });
    const leading = flow.call(core.skip_whitespace, .{initial}, .{});
    const opening = flow.bytesByteAt(
        flow.productExtract(0, leading.value),
        flow.productExtract(1, leading.value),
        flow.constant(context.Failure, context.malformed_failure_index),
    );
    const begin = flow.block(.segment, .{Cursor});
    flow.branch(
        flow.integerEqual(opening, flow.constant(u8, context.left_brace_index)),
        begin,
        .{leading.value},
        malformed,
        .{},
    );
    const started = flow.enter(begin)[0];
    const after_open = flow.call(
        core.skip_whitespace,
        .{flow.productConstruct(Cursor, .{
            flow.productExtract(0, started),
            flow.integerAddOrFail(
                flow.productExtract(1, started),
                flow.constant(u32, context.one_u32_index),
                flow.constant(context.Failure, context.arithmetic_failure_index),
            ),
        })},
        .{
            flow.constant(Payload, context.payload_default_indices[action_index]),
            flow.constant(SeenType, context.seen_indices[action_index]),
        },
    );
    const first_byte = flow.bytesByteAt(
        flow.productExtract(0, after_open.value),
        flow.productExtract(1, after_open.value),
        flow.constant(context.Failure, context.malformed_failure_index),
    );
    const done = flow.block(.segment, .{ Cursor, Payload, SeenType });
    const member = flow.block(.loop_header, .{ Cursor, Payload, SeenType });
    flow.branch(
        flow.integerEqual(
            first_byte,
            flow.constant(u8, context.right_brace_index),
        ),
        done,
        .{
            flow.productConstruct(Cursor, .{
                flow.productExtract(0, after_open.value),
                flow.integerAddOrFail(
                    flow.productExtract(1, after_open.value),
                    flow.constant(u32, context.one_u32_index),
                    flow.constant(context.Failure, context.arithmetic_failure_index),
                ),
            }),
            after_open.carried[0],
            after_open.carried[1],
        },
        member,
        .{ after_open.value, after_open.carried[0], after_open.carried[1] },
    );

    const current = flow.enter(member);
    const key = flow.call(
        core.parse_string,
        .{current[0]},
        .{ current[1], current[2] },
    );
    const after_key = flow.call(
        core.skip_whitespace,
        .{flow.productExtract(0, key.value)},
        .{ key.carried[0], key.carried[1], flow.productExtract(1, key.value) },
    );
    const colon = flow.bytesByteAt(
        flow.productExtract(0, after_key.value),
        flow.productExtract(1, after_key.value),
        flow.constant(context.Failure, context.malformed_failure_index),
    );
    const value_start = flow.block(.segment, .{ Cursor, Payload, SeenType, Text });
    flow.branch(
        flow.integerEqual(colon, flow.constant(u8, context.colon_index)),
        value_start,
        .{
            flow.productConstruct(Cursor, .{
                flow.productExtract(0, after_key.value),
                flow.integerAddOrFail(
                    flow.productExtract(1, after_key.value),
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
    const value_state = flow.enter(value_start);
    const value_cursor = flow.call(
        core.skip_whitespace,
        .{value_state[0]},
        .{ value_state[1], value_state[2], value_state[3] },
    );
    const member_done = flow.block(.segment, .{ Cursor, Payload, SeenType });
    var candidate_cursor = value_cursor.value;
    var candidate_payload = value_cursor.carried[0];
    var candidate_seen = value_cursor.carried[1];
    var candidate_key = value_cursor.carried[2];
    inline for (@typeInfo(Payload).@"struct".fields, 0..) |field, field_index| {
        const matched = flow.block(.segment, .{ Cursor, Payload, SeenType });
        const next = flow.block(.segment, .{ Cursor, Payload, SeenType, Text });
        flow.branch(
            flow.integerEqual(
                flow.textCompare(
                    candidate_key,
                    flow.constant(
                        Text,
                        context.field_name_indices[action_index][field_index],
                    ),
                ),
                flow.constant(i8, context.zero_i8_index),
            ),
            matched,
            .{ candidate_cursor, candidate_payload, candidate_seen },
            next,
            .{
                candidate_cursor,
                candidate_payload,
                candidate_seen,
                candidate_key,
            },
        );
        const matched_values = flow.enter(matched);
        const already_seen = flow.vectorGetOrFail(
            matched_values[2],
            flow.constant(u32, context.field_index_indices[field_index]),
            flow.constant(context.Failure, context.invalid_index_failure_index),
        );
        const parse = flow.block(.segment, .{ Cursor, Payload, SeenType });
        flow.branch(
            already_seen,
            malformed,
            .{},
            parse,
            matched_values,
        );
        const parse_values = flow.enter(parse);
        const parsed = emitField(
            flow,
            Bytes,
            field.type,
            parse_values[0],
            flow.productExtract(field_index, parse_values[1]),
            core,
            context,
        );
        flow.jump(member_done, .{
            parsed.cursor,
            flow.productReplace(field_index, parse_values[1], parsed.value),
            flow.vectorSet(
                parse_values[2],
                flow.constant(u32, context.field_index_indices[field_index]),
                flow.constant(bool, context.true_index),
            ),
        });
        const next_values = flow.enter(next);
        candidate_cursor = next_values[0];
        candidate_payload = next_values[1];
        candidate_seen = next_values[2];
        candidate_key = next_values[3];
    }
    flow.jump(malformed, .{});

    const completed_member = flow.enter(member_done);
    const after_value = flow.call(
        core.skip_whitespace,
        .{completed_member[0]},
        .{ completed_member[1], completed_member[2] },
    );
    const delimiter = flow.bytesByteAt(
        flow.productExtract(0, after_value.value),
        flow.productExtract(1, after_value.value),
        flow.constant(context.Failure, context.malformed_failure_index),
    );
    const close = flow.block(.segment, .{ Cursor, Payload, SeenType });
    const comma = flow.block(.segment, .{ Cursor, Payload, SeenType, u8 });
    flow.branch(
        flow.integerEqual(delimiter, flow.constant(u8, context.right_brace_index)),
        close,
        .{ after_value.value, after_value.carried[0], after_value.carried[1] },
        comma,
        .{
            after_value.value,
            after_value.carried[0],
            after_value.carried[1],
            delimiter,
        },
    );
    const close_values = flow.enter(close);
    flow.jump(done, .{
        flow.productConstruct(Cursor, .{
            flow.productExtract(0, close_values[0]),
            flow.integerAddOrFail(
                flow.productExtract(1, close_values[0]),
                flow.constant(u32, context.one_u32_index),
                flow.constant(context.Failure, context.arithmetic_failure_index),
            ),
        }),
        close_values[1],
        close_values[2],
    });
    const comma_values = flow.enter(comma);
    const is_comma = flow.integerEqual(
        comma_values[3],
        flow.constant(u8, context.comma_index),
    );
    const after_comma = flow.block(.segment, .{ Cursor, Payload, SeenType });
    flow.branch(
        is_comma,
        after_comma,
        .{ comma_values[0], comma_values[1], comma_values[2] },
        malformed,
        .{},
    );
    const comma_state = flow.enter(after_comma);
    const next_member = flow.call(
        core.skip_whitespace,
        .{flow.productConstruct(Cursor, .{
            flow.productExtract(0, comma_state[0]),
            flow.integerAddOrFail(
                flow.productExtract(1, comma_state[0]),
                flow.constant(u32, context.one_u32_index),
                flow.constant(context.Failure, context.arithmetic_failure_index),
            ),
        })},
        .{ comma_state[1], comma_state[2] },
    );
    const next_byte = flow.bytesByteAt(
        flow.productExtract(0, next_member.value),
        flow.productExtract(1, next_member.value),
        flow.constant(context.Failure, context.malformed_failure_index),
    );
    const valid_member = flow.block(.segment, .{ Cursor, Payload, SeenType });
    flow.branch(
        flow.integerEqual(next_byte, flow.constant(u8, context.right_brace_index)),
        malformed,
        .{},
        valid_member,
        .{ next_member.value, next_member.carried[0], next_member.carried[1] },
    );
    flow.jump(member, flow.enter(valid_member));

    const finished = flow.enter(done);
    var all_seen = flow.constant(bool, context.true_index);
    inline for (@typeInfo(Payload).@"struct".fields, 0..) |_, field_index| {
        all_seen = flow.booleanAnd(
            all_seen,
            flow.vectorGetOrFail(
                finished[2],
                flow.constant(u32, context.field_index_indices[field_index]),
                flow.constant(context.Failure, context.invalid_index_failure_index),
            ),
        );
    }
    const trailing = flow.call(core.skip_whitespace, .{finished[0]}, .{finished[1]});
    const accepted = flow.block(.segment, .{Payload});
    flow.branch(
        flow.booleanAnd(
            all_seen,
            flow.integerEqual(
                flow.productExtract(1, trailing.value),
                flow.bytesLength(flow.productExtract(0, trailing.value)),
            ),
        ),
        accepted,
        .{trailing.carried[0]},
        malformed,
        .{},
    );
    _ = flow.enter(malformed);
    flow.failValue(flow.constant(context.Failure, context.malformed_failure_index));
    return flow.enter(accepted)[0];
}

fn emitField(
    flow: anytype,
    comptime Bytes: type,
    comptime T: type,
    cursor_value: @import("flow.zig").Value(staged.Cursor(Bytes)),
    default_value: @import("flow.zig").Value(T),
    core: staged.Helpers(@TypeOf(flow.*), Bytes),
    comptime context: anytype,
) ParsedValue(T, Bytes) {
    if (comptime @typeInfo(T) == .int) {
        if (comptime @typeInfo(T).int.signedness == .unsigned) {
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
        const leading = flow.call(core.skip_whitespace, .{cursor_value}, .{});
        const bytes = flow.productExtract(0, leading.value);
        const index = flow.productExtract(1, leading.value);
        const first = flow.bytesByteAt(
            bytes,
            index,
            flow.constant(context.Failure, context.malformed_failure_index),
        );
        const negative = flow.integerEqual(first, flow.constant(u8, context.minus_index));
        const positive = flow.block(.segment, .{staged.Cursor(Bytes)});
        const negative_start = flow.block(.segment, .{ Bytes, u32, T });
        flow.branch(
            negative,
            negative_start,
            .{
                bytes,
                flow.integerAddOrFail(
                    index,
                    flow.constant(u32, context.one_u32_index),
                    flow.constant(context.Failure, context.arithmetic_failure_index),
                ),
                default_value,
            },
            positive,
            .{leading.value},
        );
        const parsed = flow.call(core.parse_unsigned, .{flow.enter(positive)[0]}, .{});
        const positive_value = flow.integerConvertOrFail(
            T,
            flow.productExtract(1, parsed.value),
            flow.constant(context.Failure, context.arithmetic_failure_index),
        );
        const joined = flow.block(.segment, .{ staged.Cursor(Bytes), T });
        flow.jump(joined, .{ flow.productExtract(0, parsed.value), positive_value });

        const negative_values = flow.enter(negative_start);
        const loop = flow.block(.loop_header, .{ Bytes, u32, T, bool });
        flow.jump(loop, .{
            negative_values[0],
            negative_values[1],
            negative_values[2],
            flow.constant(bool, context.false_index),
        });
        const current = flow.enter(loop);
        const done = flow.block(.segment, .{ Bytes, u32, T, bool });
        const inspect = flow.block(.segment, .{ Bytes, u32, T, bool });
        flow.branch(
            flow.integerGreaterEqual(current[1], flow.bytesLength(current[0])),
            done,
            current,
            inspect,
            current,
        );
        const inspecting = flow.enter(inspect);
        const byte = flow.bytesByteAt(
            inspecting[0],
            inspecting[1],
            flow.constant(context.Failure, context.malformed_failure_index),
        );
        const digit = flow.booleanAnd(
            flow.integerGreaterEqual(byte, flow.constant(u8, context.zero_char_index)),
            flow.integerLessEqual(byte, flow.constant(u8, context.nine_char_index)),
        );
        const consume = flow.block(.segment, .{ Bytes, u32, T, u8 });
        flow.branch(
            digit,
            consume,
            .{ inspecting[0], inspecting[1], inspecting[2], byte },
            done,
            inspecting,
        );
        const consumed = flow.enter(consume);
        const digit_value = flow.integerConvert(
            T,
            flow.integerSubtract(consumed[3], flow.constant(u8, context.zero_char_index)),
        );
        const accumulated = flow.integerSubtractOrFail(
            flow.integerMultiplyOrFail(
                consumed[2],
                flow.integerConvert(T, flow.constant(u64, context.ten_u64_index)),
                flow.constant(context.Failure, context.arithmetic_failure_index),
            ),
            digit_value,
            flow.constant(context.Failure, context.arithmetic_failure_index),
        );
        flow.jump(loop, .{
            consumed[0],
            flow.integerAddOrFail(
                consumed[1],
                flow.constant(u32, context.one_u32_index),
                flow.constant(context.Failure, context.arithmetic_failure_index),
            ),
            accumulated,
            flow.constant(bool, context.true_index),
        });
        const finished = flow.enter(done);
        const valid_negative = flow.block(.segment, .{ staged.Cursor(Bytes), T });
        const invalid_negative = flow.block(.terminal_handoff, .{});
        flow.branch(
            finished[3],
            valid_negative,
            .{ flow.productConstruct(staged.Cursor(Bytes), .{ finished[0], finished[1] }), finished[2] },
            invalid_negative,
            .{},
        );
        flow.jump(joined, flow.enter(valid_negative));
        _ = flow.enter(invalid_negative);
        flow.failValue(flow.constant(context.Failure, context.malformed_failure_index));
        const result = flow.enter(joined);
        return .{
            .cursor = result[0],
            .value = result[1],
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
