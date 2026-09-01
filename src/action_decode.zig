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
    const Text = boundary.Text(Bytes.maximum_length);
    const Object = ArgumentObject(Action, Bytes);
    const parsed_object = emitObject(
        flow,
        Action,
        Bytes,
        flow.productExtract(1, call),
        core,
        context,
    );
    const call_name = flow.productExtract(0, call);
    const trailing = flow.call(core.skip_whitespace, .{parsed_object.cursor}, .{parsed_object.value});
    const complete = flow.block(.segment, .{ Text, Object });
    const malformed = flow.block(.terminal_handoff, .{});
    flow.branch(
        flow.integerEqual(
            flow.productExtract(1, trailing.value),
            flow.bytesLength(flow.productExtract(0, trailing.value)),
        ),
        complete,
        .{ call_name, trailing.carried[0] },
        malformed,
        .{},
    );
    const complete_values = flow.enter(complete);
    var name = complete_values[0];
    var object = complete_values[1];
    const join = flow.block(.segment, .{Action});
    inline for (actions, 0..) |_, action_index| {
        const matched = flow.block(.segment, .{ Text, Object });
        const next = flow.block(.segment, .{ Text, Object });
        const equal = flow.integerEqual(
            flow.textCompare(
                name,
                flow.constant(Text, context.action_name_indices[action_index]),
            ),
            flow.constant(i8, context.zero_i8_index),
        );
        flow.branch(equal, matched, .{ name, object }, next, .{ name, object });
        const values = flow.enter(matched);
        const Payload = payloadType(Action, action_index);
        const payload = emitStructProjection(
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
        name = next_values[0];
        object = next_values[1];
    }
    flow.failValue(flow.constant(context.Failure, context.unknown_action_failure_index));
    _ = flow.enter(malformed);
    flow.failValue(flow.constant(context.Failure, context.malformed_failure_index));
    return flow.enter(join)[0];
}

fn emitObject(
    flow: anytype,
    comptime Action: type,
    comptime Bytes: type,
    bytes: @import("flow.zig").Value(Bytes),
    core: staged.Helpers(@TypeOf(flow.*), Bytes),
    comptime context: anytype,
) ParsedValue(ArgumentObject(Action, Bytes), Bytes) {
    const Cursor = staged.Cursor(Bytes);
    const Field = ArgumentField(Bytes);
    const Fields = ArgumentFields(Action, Bytes);
    const Object = ArgumentObject(Action, Bytes);
    const zero = flow.constant(u32, context.zero_u32_index);
    const one = flow.constant(u32, context.one_u32_index);
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
    const started = flow.enter(begin);
    const initial_cursor = flow.productConstruct(Cursor, .{
        started[0],
        flow.integerAddOrFail(
            started[1],
            one,
            flow.constant(context.Failure, context.arithmetic_failure_index),
        ),
    });
    const first = flow.call(
        core.skip_whitespace,
        .{initial_cursor},
        .{flow.vectorEmpty(Fields)},
    );
    const first_byte = flow.bytesByteAt(
        flow.productExtract(0, first.value),
        flow.productExtract(1, first.value),
        flow.constant(context.Failure, context.malformed_failure_index),
    );
    const done = flow.block(.segment, .{ Cursor, Fields });
    const member = flow.block(.segment, .{ Cursor, Fields });
    flow.branch(
        flow.integerEqual(first_byte, flow.constant(u8, context.right_brace_index)),
        done,
        .{
            flow.productConstruct(Cursor, .{
                flow.productExtract(0, first.value),
                flow.integerAddOrFail(
                    flow.productExtract(1, first.value),
                    one,
                    flow.constant(context.Failure, context.arithmetic_failure_index),
                ),
            }),
            first.carried[0],
        },
        member,
        .{ first.value, first.carried[0] },
    );

    const current = flow.enter(member);
    const key = flow.call(core.parse_string, .{current[0]}, .{current[1]});
    const after_key = flow.call(
        core.skip_whitespace,
        .{flow.productExtract(0, key.value)},
        .{ key.carried[0], flow.productExtract(1, key.value) },
    );
    const colon = flow.bytesByteAt(
        flow.productExtract(0, after_key.value),
        flow.productExtract(1, after_key.value),
        flow.constant(context.Failure, context.malformed_failure_index),
    );
    const value = flow.block(.segment, .{ Cursor, Fields, boundary.Text(Bytes.maximum_length) });
    flow.branch(
        flow.integerEqual(colon, flow.constant(u8, context.colon_index)),
        value,
        .{
            flow.productConstruct(Cursor, .{
                flow.productExtract(0, after_key.value),
                flow.integerAddOrFail(
                    flow.productExtract(1, after_key.value),
                    one,
                    flow.constant(context.Failure, context.arithmetic_failure_index),
                ),
            }),
            after_key.carried[0],
            after_key.carried[1],
        },
        malformed,
        .{},
    );
    const value_state = flow.enter(value);
    const value_start = flow.call(
        core.skip_whitespace,
        .{value_state[0]},
        .{ value_state[1], value_state[2] },
    );
    const start = flow.productExtract(1, value_start.value);
    const skipped = flow.call(
        core.skip_value,
        .{value_start.value},
        .{ value_start.carried[0], value_start.carried[1], start },
    );
    const next_fields = flow.vectorPushOrFail(
        skipped.carried[0],
        flow.productConstruct(Field, .{
            skipped.carried[1],
            skipped.carried[2],
            flow.productExtract(1, skipped.value),
        }),
        flow.constant(context.Failure, context.malformed_failure_index),
    );
    const delimiter = flow.call(
        core.skip_whitespace,
        .{skipped.value},
        .{next_fields},
    );
    const delimiter_byte = flow.bytesByteAt(
        flow.productExtract(0, delimiter.value),
        flow.productExtract(1, delimiter.value),
        flow.constant(context.Failure, context.malformed_failure_index),
    );
    const comma = flow.block(.segment, .{ Bytes, u32, Fields });
    const close = flow.block(.segment, .{ Cursor, Fields, u8 });
    flow.branch(
        flow.integerEqual(delimiter_byte, flow.constant(u8, context.comma_index)),
        comma,
        .{
            flow.productExtract(0, delimiter.value),
            flow.productExtract(1, delimiter.value),
            delimiter.carried[0],
        },
        close,
        .{ delimiter.value, delimiter.carried[0], delimiter_byte },
    );
    const comma_state = flow.enter(comma);
    const next_member = flow.call(
        core.skip_whitespace,
        .{flow.productConstruct(Cursor, .{
            comma_state[0],
            flow.integerAddOrFail(
                comma_state[1],
                one,
                flow.constant(context.Failure, context.arithmetic_failure_index),
            ),
        })},
        .{comma_state[2]},
    );
    flow.jump(member, .{ next_member.value, next_member.carried[0] });
    const close_state = flow.enter(close);
    flow.branch(
        flow.integerEqual(close_state[2], flow.constant(u8, context.right_brace_index)),
        done,
        .{
            flow.productConstruct(Cursor, .{
                flow.productExtract(0, close_state[0]),
                flow.integerAddOrFail(
                    flow.productExtract(1, close_state[0]),
                    one,
                    flow.constant(context.Failure, context.arithmetic_failure_index),
                ),
            }),
            close_state[1],
        },
        malformed,
        .{},
    );
    _ = flow.enter(malformed);
    flow.failValue(flow.constant(context.Failure, context.malformed_failure_index));
    const finished = flow.enter(done);
    return .{
        .cursor = finished[0],
        .value = flow.productConstruct(Object, .{
            flow.productExtract(0, finished[0]),
            finished[1],
        }),
    };
}

fn emitStructProjection(
    flow: anytype,
    comptime Action: type,
    comptime Bytes: type,
    comptime T: type,
    object: @import("flow.zig").Value(ArgumentObject(Action, Bytes)),
    comptime action_index: usize,
    core: staged.Helpers(@TypeOf(flow.*), Bytes),
    comptime context: anytype,
) @import("flow.zig").Value(T) {
    const fields = switch (@typeInfo(T)) {
        .@"struct" => |info| info.fields,
        else => @compileError("agent action decoder currently requires struct payloads"),
    };
    const Field = ArgumentField(Bytes);
    const Fields = ArgumentFields(Action, Bytes);
    const object_bytes = flow.productExtract(0, object);
    const object_fields = flow.productExtract(1, object);
    var expected_count = flow.constant(u32, context.zero_u32_index);
    inline for (fields) |_| {
        expected_count = flow.integerAdd(expected_count, flow.constant(u32, context.one_u32_index));
    }
    const count_ok = flow.block(.segment, .{ Bytes, Fields });
    const malformed = flow.block(.terminal_handoff, .{});
    flow.branch(
        flow.integerEqual(flow.vectorLength(object_fields), expected_count),
        count_ok,
        .{ object_bytes, object_fields },
        malformed,
        .{},
    );
    const accepted = flow.enter(count_ok);
    var result = flow.constant(T, context.payload_default_indices[action_index]);
    inline for (fields, 0..) |field, field_index| {
        const loop = flow.block(.loop_header, .{ Bytes, Fields, u32, u32, T });
        flow.jump(loop, .{
            accepted[0],
            accepted[1],
            flow.constant(u32, context.zero_u32_index),
            flow.vectorLength(accepted[1]),
            result,
        });
        const state = flow.enter(loop);
        const inspect = flow.block(.segment, .{ Bytes, Fields, u32, u32, T });
        flow.branch(
            flow.integerGreaterEqual(state[2], state[3]),
            malformed,
            .{},
            inspect,
            state,
        );
        const inspecting = flow.enter(inspect);
        const candidate = flow.vectorGetOrFail(
            inspecting[1],
            inspecting[2],
            flow.constant(context.Failure, context.invalid_index_failure_index),
        );
        const found = flow.block(.segment, .{ Bytes, Field, T });
        const next = flow.block(.segment, .{ Bytes, Fields, u32, u32, T });
        const equal = flow.integerEqual(
            flow.textCompare(
                flow.productExtract(0, candidate),
                flow.constant(
                    boundary.Text(Bytes.maximum_length),
                    context.field_name_indices[action_index][field_index],
                ),
            ),
            flow.constant(i8, context.zero_i8_index),
        );
        flow.branch(
            equal,
            found,
            .{ inspecting[0], candidate, inspecting[4] },
            next,
            inspecting,
        );
        const next_state = flow.enter(next);
        flow.jump(loop, .{
            next_state[0],
            next_state[1],
            flow.integerAddOrFail(
                next_state[2],
                flow.constant(u32, context.one_u32_index),
                flow.constant(context.Failure, context.arithmetic_failure_index),
            ),
            next_state[3],
            next_state[4],
        });
        const selected = flow.enter(found);
        const parsed = emitField(
            flow,
            Bytes,
            field.type,
            flow.productConstruct(staged.Cursor(Bytes), .{
                selected[0],
                flow.productExtract(1, selected[1]),
            }),
            core,
            context,
        );
        const valid = flow.block(.segment, .{T});
        flow.branch(
            flow.integerEqual(
                flow.productExtract(1, parsed.cursor),
                flow.productExtract(2, selected[1]),
            ),
            valid,
            .{flow.productReplace(field_index, selected[2], parsed.value)},
            malformed,
            .{},
        );
        result = flow.enter(valid)[0];
    }
    const done = flow.block(.segment, .{T});
    flow.jump(done, .{result});
    _ = flow.enter(malformed);
    flow.failValue(flow.constant(context.Failure, context.malformed_failure_index));
    return flow.enter(done)[0];
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
