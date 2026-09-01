const boundary = @import("boundary");
const staged = @import("staged_json.zig");

pub fn FunctionCall(comptime Bytes: type) type {
    return struct {
        name: boundary.Text(Bytes.maximum_length),
        arguments: Bytes,
    };
}

fn Item(comptime Bytes: type) type {
    return union(enum) {
        function_call: FunctionCall(Bytes),
        inert: void,
        refusal: void,
    };
}

fn ParsedItem(comptime Bytes: type) type {
    return struct {
        cursor: staged.Cursor(Bytes),
        item: Item(Bytes),
    };
}

fn ParsedCall(comptime Bytes: type) type {
    return struct {
        cursor: staged.Cursor(Bytes),
        call: FunctionCall(Bytes),
    };
}

fn ItemState(comptime Bytes: type) type {
    const Text = boundary.Text(Bytes.maximum_length);
    return struct {
        cursor: staged.Cursor(Bytes),
        seen_type: bool,
        seen_status: bool,
        seen_name: bool,
        seen_arguments: bool,
        status_completed: bool,
        type_value: Text,
        name: Text,
        arguments: Bytes,
    };
}

fn OutputState(comptime Bytes: type) type {
    return struct {
        cursor: staged.Cursor(Bytes),
        found: bool,
        call: FunctionCall(Bytes),
    };
}

fn TopState(comptime Bytes: type) type {
    return struct {
        cursor: staged.Cursor(Bytes),
        seen_status: bool,
        seen_error: bool,
        seen_output: bool,
        status_completed: bool,
        error_null: bool,
        call: FunctionCall(Bytes),
    };
}

pub fn schemaTypes(comptime Bytes: type) @TypeOf(.{
    boundary.Text(Bytes.maximum_length),
    staged.Cursor(Bytes),
    staged.ParsedScalar(Bytes),
    staged.ParsedString(Bytes),
    staged.ParsedUnsigned(Bytes),
    FunctionCall(Bytes),
    Item(Bytes),
    ParsedItem(Bytes),
    ParsedCall(Bytes),
    ItemState(Bytes),
    OutputState(Bytes),
    TopState(Bytes),
}) {
    return .{
        boundary.Text(Bytes.maximum_length),
        staged.Cursor(Bytes),
        staged.ParsedScalar(Bytes),
        staged.ParsedString(Bytes),
        staged.ParsedUnsigned(Bytes),
        FunctionCall(Bytes),
        Item(Bytes),
        ParsedItem(Bytes),
        ParsedCall(Bytes),
        ItemState(Bytes),
        OutputState(Bytes),
        TopState(Bytes),
    };
}

pub fn Helpers(comptime FlowType: type, comptime Bytes: type) type {
    return struct {
        core: staged.Helpers(FlowType, Bytes),
        parse_item: FlowType.HelperType(.{staged.Cursor(Bytes)}, ParsedItem(Bytes)),
        parse_output: FlowType.HelperType(.{staged.Cursor(Bytes)}, ParsedCall(Bytes)),
        parse_response: FlowType.HelperType(.{staged.Cursor(Bytes)}, FunctionCall(Bytes)),
    };
}

pub fn declare(flow: anytype, comptime Bytes: type) Helpers(@TypeOf(flow.*), Bytes) {
    return .{
        .core = staged.declare(flow, Bytes),
        .parse_item = flow.helper(.{staged.Cursor(Bytes)}, ParsedItem(Bytes)),
        .parse_output = flow.helper(.{staged.Cursor(Bytes)}, ParsedCall(Bytes)),
        .parse_response = flow.helper(.{staged.Cursor(Bytes)}, FunctionCall(Bytes)),
    };
}

pub fn define(
    flow: anytype,
    comptime Bytes: type,
    helpers: Helpers(@TypeOf(flow.*), Bytes),
    comptime context: anytype,
) void {
    staged.define(flow, Bytes, helpers.core, context);
    defineItem(flow, Bytes, helpers, context);
    defineOutput(flow, Bytes, helpers, context);
    defineResponse(flow, Bytes, helpers, context);
}

fn cursor(flow: anytype, comptime Bytes: type, bytes: anytype, index: anytype) @import("flow.zig").Value(staged.Cursor(Bytes)) {
    return flow.productConstruct(staged.Cursor(Bytes), .{ bytes, index });
}

fn addOne(flow: anytype, value: anytype, comptime context: anytype) @TypeOf(value) {
    return flow.integerAddOrFail(
        value,
        flow.constant(@TypeOf(value).Type, context.one_u32_index),
        flow.constant(context.Failure, context.arithmetic_failure_index),
    );
}

fn replace(
    flow: anytype,
    product: anytype,
    comptime field_index: u16,
    replacement: anytype,
) @TypeOf(product) {
    return flow.productReplace(field_index, product, replacement);
}

fn textEquals(
    flow: anytype,
    text: anytype,
    comptime constant_index: u16,
    comptime context: anytype,
) @import("flow.zig").Value(bool) {
    return flow.integerEqual(
        flow.textCompare(
            text,
            flow.constant(@TypeOf(text).Type, constant_index),
        ),
        flow.constant(i8, context.zero_i8_index),
    );
}

fn fail(flow: anytype, comptime index: u16, comptime context: anytype) void {
    flow.failValue(flow.constant(context.Failure, index));
}

fn requireFalse(
    flow: anytype,
    condition: anytype,
    success: anytype,
    success_arguments: anytype,
    failure: anytype,
) void {
    flow.branch(condition, failure, .{}, success, success_arguments);
}

fn defineItem(
    flow: anytype,
    comptime Bytes: type,
    helpers: Helpers(@TypeOf(flow.*), Bytes),
    comptime context: anytype,
) void {
    const Text = boundary.Text(Bytes.maximum_length);
    const State = ItemState(Bytes);
    const input = flow.enter(helpers.parse_item.entry)[0];
    const bytes = flow.productExtract(0, input);
    const index = flow.productExtract(1, input);
    const malformed = flow.block(.terminal_handoff, .{});
    const begin = flow.block(.segment, .{ Bytes, u32 });
    const opening = flow.bytesByteAt(
        bytes,
        index,
        flow.constant(context.Failure, context.malformed_failure_index),
    );
    flow.branch(
        flow.integerEqual(opening, flow.constant(u8, context.left_brace_index)),
        begin,
        .{ bytes, index },
        malformed,
        .{},
    );
    const started = flow.enter(begin);
    const empty_text = flow.constant(Text, context.empty_text_index);
    const initial_state = flow.productConstruct(State, .{
        cursor(flow, Bytes, started[0], addOne(flow, started[1], context)),
        flow.constant(bool, context.false_index),
        flow.constant(bool, context.false_index),
        flow.constant(bool, context.false_index),
        flow.constant(bool, context.false_index),
        flow.constant(bool, context.false_index),
        empty_text,
        empty_text,
        flow.constant(Bytes, context.empty_bytes_index),
    });
    const loop = flow.block(.loop_header, .{State});
    flow.jump(loop, .{initial_state});

    const current = flow.enter(loop)[0];
    const spaced = flow.call(
        helpers.core.skip_whitespace,
        .{flow.productExtract(0, current)},
        .{current},
    );
    const spaced_cursor = spaced.value;
    const spaced_state = replace(
        flow,
        spaced.carried[0],
        0,
        spaced_cursor,
    );
    const spaced_bytes = flow.productExtract(0, spaced_cursor);
    const spaced_index = flow.productExtract(1, spaced_cursor);
    const byte = flow.bytesByteAt(
        spaced_bytes,
        spaced_index,
        flow.constant(context.Failure, context.malformed_failure_index),
    );
    const finalize = flow.block(.segment, .{ State, u32 });
    const member = flow.block(.segment, .{State});
    flow.branch(
        flow.integerEqual(byte, flow.constant(u8, context.right_brace_index)),
        finalize,
        .{ spaced_state, addOne(flow, spaced_index, context) },
        member,
        .{spaced_state},
    );

    const member_state = flow.enter(member)[0];
    const key = flow.call(
        helpers.core.parse_string,
        .{flow.productExtract(0, member_state)},
        .{member_state},
    );
    const key_cursor = flow.productExtract(0, key.value);
    const key_text = flow.productExtract(1, key.value);
    const after_key = flow.call(
        helpers.core.skip_whitespace,
        .{key_cursor},
        .{ key.carried[0], key_text },
    );
    const colon_cursor = after_key.value;
    const colon_bytes = flow.productExtract(0, colon_cursor);
    const colon_index = flow.productExtract(1, colon_cursor);
    const colon = flow.bytesByteAt(
        colon_bytes,
        colon_index,
        flow.constant(context.Failure, context.malformed_failure_index),
    );
    const dispatch = flow.block(.segment, .{ State, Text, staged.Cursor(Bytes) });
    flow.branch(
        flow.integerEqual(colon, flow.constant(u8, context.colon_index)),
        dispatch,
        .{
            after_key.carried[0],
            after_key.carried[1],
            cursor(flow, Bytes, colon_bytes, addOne(flow, colon_index, context)),
        },
        malformed,
        .{},
    );

    const dispatched = flow.enter(dispatch);
    const value = flow.call(
        helpers.core.skip_whitespace,
        .{dispatched[2]},
        .{ dispatched[0], dispatched[1] },
    );
    const value_state = value.carried[0];
    const value_key = value.carried[1];
    const value_cursor = value.value;
    const is_type = textEquals(flow, value_key, context.type_key_index, context);
    const type_member = flow.block(.segment, .{ State, staged.Cursor(Bytes) });
    const classify_status = flow.block(.segment, .{ State, Text, staged.Cursor(Bytes) });
    flow.branch(
        is_type,
        type_member,
        .{ value_state, value_cursor },
        classify_status,
        .{ value_state, value_key, value_cursor },
    );
    const status_input = flow.enter(classify_status);
    const is_status = textEquals(flow, status_input[1], context.status_key_index, context);
    const status_member = flow.block(.segment, .{ State, staged.Cursor(Bytes) });
    const classify_name = flow.block(.segment, .{ State, Text, staged.Cursor(Bytes) });
    flow.branch(is_status, status_member, .{ status_input[0], status_input[2] }, classify_name, status_input);
    const name_input = flow.enter(classify_name);
    const is_name = textEquals(flow, name_input[1], context.name_key_index, context);
    const name_member = flow.block(.segment, .{ State, staged.Cursor(Bytes) });
    const classify_arguments = flow.block(.segment, .{ State, Text, staged.Cursor(Bytes) });
    flow.branch(is_name, name_member, .{ name_input[0], name_input[2] }, classify_arguments, name_input);
    const arguments_input = flow.enter(classify_arguments);
    const is_arguments = textEquals(
        flow,
        arguments_input[1],
        context.arguments_key_index,
        context,
    );
    const arguments_member = flow.block(.segment, .{ State, staged.Cursor(Bytes) });
    const unknown_member = flow.block(.segment, .{ State, staged.Cursor(Bytes) });
    flow.branch(
        is_arguments,
        arguments_member,
        .{ arguments_input[0], arguments_input[2] },
        unknown_member,
        .{ arguments_input[0], arguments_input[2] },
    );

    const after_member = flow.block(.segment, .{State});
    emitStringMember(
        flow,
        Bytes,
        helpers,
        flow.enter(type_member),
        1,
        6,
        after_member,
        malformed,
        context,
    );
    emitStatusMember(
        flow,
        Bytes,
        helpers,
        flow.enter(status_member),
        after_member,
        malformed,
        context,
    );
    emitStringMember(
        flow,
        Bytes,
        helpers,
        flow.enter(name_member),
        3,
        7,
        after_member,
        malformed,
        context,
    );
    emitArgumentsMember(
        flow,
        Bytes,
        helpers,
        flow.enter(arguments_member),
        after_member,
        malformed,
        context,
    );
    const unknown = flow.enter(unknown_member);
    const skipped = flow.call(helpers.core.skip_value, .{unknown[1]}, .{unknown[0]});
    flow.jump(
        after_member,
        .{replace(flow, skipped.carried[0], 0, skipped.value)},
    );

    emitObjectDelimiter(
        flow,
        Bytes,
        helpers,
        flow.enter(after_member)[0],
        loop,
        finalize,
        malformed,
        context,
    );

    const final = flow.enter(finalize);
    emitItemFinalization(flow, Bytes, final[0], final[1], malformed, context);

    _ = flow.enter(malformed);
    fail(flow, context.malformed_failure_index, context);
}

fn emitStringMember(
    flow: anytype,
    comptime Bytes: type,
    helpers: Helpers(@TypeOf(flow.*), Bytes),
    values: anytype,
    comptime seen_field: u16,
    comptime value_field: u16,
    after_member: anytype,
    malformed: anytype,
    comptime context: anytype,
) void {
    const state = values[0];
    const unseen = flow.block(.segment, .{ ItemState(Bytes), staged.Cursor(Bytes) });
    requireFalse(
        flow,
        flow.productExtract(seen_field, state),
        unseen,
        values,
        malformed,
    );
    const accepted = flow.enter(unseen);
    const parsed = flow.call(
        helpers.core.parse_string,
        .{accepted[1]},
        .{accepted[0]},
    );
    var updated = replace(
        flow,
        parsed.carried[0],
        0,
        flow.productExtract(0, parsed.value),
    );
    updated = replace(
        flow,
        updated,
        seen_field,
        flow.constant(bool, context.true_index),
    );
    updated = replace(flow, updated, value_field, flow.productExtract(1, parsed.value));
    flow.jump(after_member, .{updated});
}

fn emitStatusMember(
    flow: anytype,
    comptime Bytes: type,
    helpers: Helpers(@TypeOf(flow.*), Bytes),
    values: anytype,
    after_member: anytype,
    malformed: anytype,
    comptime context: anytype,
) void {
    const unseen = flow.block(.segment, .{ ItemState(Bytes), staged.Cursor(Bytes) });
    requireFalse(
        flow,
        flow.productExtract(2, values[0]),
        unseen,
        values,
        malformed,
    );
    const accepted = flow.enter(unseen);
    const parsed = flow.call(helpers.core.parse_string, .{accepted[1]}, .{accepted[0]});
    const completed = textEquals(
        flow,
        flow.productExtract(1, parsed.value),
        context.completed_value_index,
        context,
    );
    var updated = replace(
        flow,
        parsed.carried[0],
        0,
        flow.productExtract(0, parsed.value),
    );
    updated = replace(flow, updated, 2, flow.constant(bool, context.true_index));
    updated = replace(flow, updated, 5, completed);
    flow.jump(after_member, .{updated});
}

fn emitArgumentsMember(
    flow: anytype,
    comptime Bytes: type,
    helpers: Helpers(@TypeOf(flow.*), Bytes),
    values: anytype,
    after_member: anytype,
    malformed: anytype,
    comptime context: anytype,
) void {
    const unseen = flow.block(.segment, .{ ItemState(Bytes), staged.Cursor(Bytes) });
    requireFalse(
        flow,
        flow.productExtract(4, values[0]),
        unseen,
        values,
        malformed,
    );
    const accepted = flow.enter(unseen);
    const parsed = flow.call(helpers.core.parse_string, .{accepted[1]}, .{accepted[0]});
    var updated = replace(
        flow,
        parsed.carried[0],
        0,
        flow.productExtract(0, parsed.value),
    );
    updated = replace(flow, updated, 4, flow.constant(bool, context.true_index));
    updated = replace(
        flow,
        updated,
        8,
        flow.textToBytes(Bytes, flow.productExtract(1, parsed.value)),
    );
    flow.jump(after_member, .{updated});
}

fn emitObjectDelimiter(
    flow: anytype,
    comptime Bytes: type,
    helpers: Helpers(@TypeOf(flow.*), Bytes),
    state: anytype,
    loop: anytype,
    finalize: anytype,
    malformed: anytype,
    comptime context: anytype,
) void {
    const spaced = flow.call(
        helpers.core.skip_whitespace,
        .{flow.productExtract(0, state)},
        .{state},
    );
    const cursor_value = spaced.value;
    const bytes = flow.productExtract(0, cursor_value);
    const index = flow.productExtract(1, cursor_value);
    const byte = flow.bytesByteAt(
        bytes,
        index,
        flow.constant(context.Failure, context.malformed_failure_index),
    );
    const comma = flow.block(.segment, .{ @TypeOf(state).Type, Bytes, u32 });
    const classify_close = flow.block(.segment, .{ @TypeOf(state).Type, Bytes, u32, u8 });
    flow.branch(
        flow.integerEqual(byte, flow.constant(u8, context.comma_index)),
        comma,
        .{ spaced.carried[0], bytes, index },
        classify_close,
        .{ spaced.carried[0], bytes, index, byte },
    );
    const next = flow.enter(comma);
    flow.jump(
        loop,
        .{replace(
            flow,
            next[0],
            0,
            cursor(flow, Bytes, next[1], addOne(flow, next[2], context)),
        )},
    );
    const close = flow.enter(classify_close);
    flow.branch(
        flow.integerEqual(close[3], flow.constant(u8, context.right_brace_index)),
        finalize,
        .{ close[0], addOne(flow, close[2], context) },
        malformed,
        .{},
    );
}

fn emitItemFinalization(
    flow: anytype,
    comptime Bytes: type,
    state: anytype,
    index: anytype,
    malformed: anytype,
    comptime context: anytype,
) void {
    const require_type = flow.block(.segment, .{ ItemState(Bytes), u32 });
    flow.branch(flow.productExtract(1, state), require_type, .{ state, index }, malformed, .{});
    const typed = flow.enter(require_type);
    const type_value = flow.productExtract(6, typed[0]);
    const is_call = textEquals(flow, type_value, context.function_call_value_index, context);
    const call = flow.block(.segment, .{ ItemState(Bytes), u32 });
    const classify_reasoning = flow.block(.segment, .{ ItemState(Bytes), u32, boundary.Text(Bytes.maximum_length) });
    flow.branch(is_call, call, typed, classify_reasoning, .{ typed[0], typed[1], type_value });
    const reasoning = flow.enter(classify_reasoning);
    const is_reasoning = textEquals(flow, reasoning[2], context.reasoning_value_index, context);
    const inert = flow.block(.segment, .{u32});
    const classify_message = flow.block(.segment, .{ u32, boundary.Text(Bytes.maximum_length) });
    flow.branch(is_reasoning, inert, .{reasoning[1]}, classify_message, .{ reasoning[1], reasoning[2] });
    const message = flow.enter(classify_message);
    const is_message = textEquals(flow, message[1], context.message_value_index, context);
    const refusal = flow.block(.segment, .{u32});
    const unsupported = flow.block(.terminal_handoff, .{});
    flow.branch(is_message, refusal, .{message[0]}, unsupported, .{});

    const required = flow.enter(call);
    const all_present = flow.booleanAnd(
        flow.booleanAnd(flow.productExtract(2, required[0]), flow.productExtract(3, required[0])),
        flow.booleanAnd(flow.productExtract(4, required[0]), flow.productExtract(5, required[0])),
    );
    const call_ready = flow.block(.segment, .{ ItemState(Bytes), u32 });
    flow.branch(all_present, call_ready, required, malformed, .{});
    const ready = flow.enter(call_ready);
    flow.returnToCaller(flow.productConstruct(ParsedItem(Bytes), .{
        cursor(flow, Bytes, flow.productExtract(0, flow.productExtract(0, ready[0])), ready[1]),
        flow.sumConstruct(Item(Bytes), 0, flow.productConstruct(FunctionCall(Bytes), .{
            flow.productExtract(7, ready[0]),
            flow.productExtract(8, ready[0]),
        })),
    }));
    const inert_value = flow.enter(inert)[0];
    flow.returnToCaller(flow.productConstruct(ParsedItem(Bytes), .{
        cursor(flow, Bytes, flow.productExtract(0, flow.productExtract(0, state)), inert_value),
        flow.sumConstruct(Item(Bytes), 1, flow.constant(void, context.unit_index)),
    }));
    const refusal_value = flow.enter(refusal)[0];
    flow.returnToCaller(flow.productConstruct(ParsedItem(Bytes), .{
        cursor(flow, Bytes, flow.productExtract(0, flow.productExtract(0, state)), refusal_value),
        flow.sumConstruct(Item(Bytes), 2, flow.constant(void, context.unit_index)),
    }));
    _ = flow.enter(unsupported);
    fail(flow, context.unsupported_failure_index, context);
}

fn defineOutput(
    flow: anytype,
    comptime Bytes: type,
    helpers: Helpers(@TypeOf(flow.*), Bytes),
    comptime context: anytype,
) void {
    const State = OutputState(Bytes);
    const input = flow.enter(helpers.parse_output.entry)[0];
    const bytes = flow.productExtract(0, input);
    const index = flow.productExtract(1, input);
    const malformed = flow.block(.terminal_handoff, .{});
    const multiple = flow.block(.terminal_handoff, .{});
    const refusal = flow.block(.terminal_handoff, .{});
    const begin = flow.block(.segment, .{ Bytes, u32 });
    const opening = flow.bytesByteAt(
        bytes,
        index,
        flow.constant(context.Failure, context.malformed_failure_index),
    );
    flow.branch(
        flow.integerEqual(opening, flow.constant(u8, context.left_bracket_index)),
        begin,
        .{ bytes, index },
        malformed,
        .{},
    );
    const started = flow.enter(begin);
    const initial = flow.productConstruct(State, .{
        cursor(flow, Bytes, started[0], addOne(flow, started[1], context)),
        flow.constant(bool, context.false_index),
        flow.constant(FunctionCall(Bytes), context.empty_call_index),
    });
    const loop = flow.block(.loop_header, .{State});
    flow.jump(loop, .{initial});

    const current = flow.enter(loop)[0];
    const spaced = flow.call(
        helpers.core.skip_whitespace,
        .{flow.productExtract(0, current)},
        .{current},
    );
    const spaced_cursor = spaced.value;
    const spaced_bytes = flow.productExtract(0, spaced_cursor);
    const spaced_index = flow.productExtract(1, spaced_cursor);
    const byte = flow.bytesByteAt(
        spaced_bytes,
        spaced_index,
        flow.constant(context.Failure, context.malformed_failure_index),
    );
    const finalize = flow.block(.segment, .{ State, u32 });
    const parse_item = flow.block(.segment, .{State});
    flow.branch(
        flow.integerEqual(byte, flow.constant(u8, context.right_bracket_index)),
        finalize,
        .{ spaced.carried[0], addOne(flow, spaced_index, context) },
        parse_item,
        .{replace(flow, spaced.carried[0], 0, spaced_cursor)},
    );

    const item_input = flow.enter(parse_item)[0];
    const parsed = flow.call(
        helpers.parse_item,
        .{flow.productExtract(0, item_input)},
        .{item_input},
    );
    const item = flow.productExtract(1, parsed.value);
    const item_cursor = flow.productExtract(0, parsed.value);
    const call_item = flow.block(.segment, .{ State, Item(Bytes), staged.Cursor(Bytes) });
    const classify_inert = flow.block(.segment, .{ State, Item(Bytes), staged.Cursor(Bytes) });
    flow.branch(
        flow.sumTagIs(0, item),
        call_item,
        .{ parsed.carried[0], item, item_cursor },
        classify_inert,
        .{ parsed.carried[0], item, item_cursor },
    );
    const inert_input = flow.enter(classify_inert);
    const after_item = flow.block(.segment, .{State});
    const refusal_item = flow.block(.segment, .{});
    flow.branch(
        flow.sumTagIs(1, inert_input[1]),
        after_item,
        .{replace(flow, inert_input[0], 0, inert_input[2])},
        refusal_item,
        .{},
    );
    _ = flow.enter(refusal_item);
    flow.jump(refusal, .{});

    const call_values = flow.enter(call_item);
    const accept_call = flow.block(.segment, .{ State, Item(Bytes), staged.Cursor(Bytes) });
    flow.branch(
        flow.productExtract(1, call_values[0]),
        multiple,
        .{},
        accept_call,
        call_values,
    );
    const accepted = flow.enter(accept_call);
    const call = flow.sumExtractOrFail(
        0,
        accepted[1],
        flow.constant(context.Failure, context.invalid_variant_failure_index),
    );
    var updated = replace(flow, accepted[0], 0, accepted[2]);
    updated = replace(flow, updated, 1, flow.constant(bool, context.true_index));
    updated = replace(flow, updated, 2, call);
    flow.jump(after_item, .{updated});

    const after = flow.enter(after_item)[0];
    const delimited = flow.call(
        helpers.core.skip_whitespace,
        .{flow.productExtract(0, after)},
        .{after},
    );
    const delimiter_cursor = delimited.value;
    const delimiter_bytes = flow.productExtract(0, delimiter_cursor);
    const delimiter_index = flow.productExtract(1, delimiter_cursor);
    const delimiter = flow.bytesByteAt(
        delimiter_bytes,
        delimiter_index,
        flow.constant(context.Failure, context.malformed_failure_index),
    );
    const comma = flow.block(.segment, .{ State, Bytes, u32 });
    const classify_close = flow.block(.segment, .{ State, Bytes, u32, u8 });
    flow.branch(
        flow.integerEqual(delimiter, flow.constant(u8, context.comma_index)),
        comma,
        .{ delimited.carried[0], delimiter_bytes, delimiter_index },
        classify_close,
        .{ delimited.carried[0], delimiter_bytes, delimiter_index, delimiter },
    );
    const next = flow.enter(comma);
    flow.jump(loop, .{replace(
        flow,
        next[0],
        0,
        cursor(flow, Bytes, next[1], addOne(flow, next[2], context)),
    )});
    const close = flow.enter(classify_close);
    flow.branch(
        flow.integerEqual(close[3], flow.constant(u8, context.right_bracket_index)),
        finalize,
        .{ close[0], addOne(flow, close[2], context) },
        malformed,
        .{},
    );

    const final = flow.enter(finalize);
    const ready = flow.block(.segment, .{ State, u32 });
    flow.branch(flow.productExtract(1, final[0]), ready, final, malformed, .{});
    const result = flow.enter(ready);
    const final_cursor = flow.productExtract(0, result[0]);
    flow.returnToCaller(flow.productConstruct(ParsedCall(Bytes), .{
        cursor(flow, Bytes, flow.productExtract(0, final_cursor), result[1]),
        flow.productExtract(2, result[0]),
    }));

    _ = flow.enter(malformed);
    fail(flow, context.malformed_failure_index, context);
    _ = flow.enter(multiple);
    fail(flow, context.multiple_calls_failure_index, context);
    _ = flow.enter(refusal);
    fail(flow, context.refusal_failure_index, context);
}

fn defineResponse(
    flow: anytype,
    comptime Bytes: type,
    helpers: Helpers(@TypeOf(flow.*), Bytes),
    comptime context: anytype,
) void {
    const Text = boundary.Text(Bytes.maximum_length);
    const State = TopState(Bytes);
    const input = flow.enter(helpers.parse_response.entry)[0];
    const leading = flow.call(helpers.core.skip_whitespace, .{input}, .{});
    const bytes = flow.productExtract(0, leading.value);
    const index = flow.productExtract(1, leading.value);
    const malformed = flow.block(.terminal_handoff, .{});
    const incomplete = flow.block(.terminal_handoff, .{});
    const response_error = flow.block(.terminal_handoff, .{});
    const begin = flow.block(.segment, .{ Bytes, u32 });
    const opening = flow.bytesByteAt(
        bytes,
        index,
        flow.constant(context.Failure, context.malformed_failure_index),
    );
    flow.branch(
        flow.integerEqual(opening, flow.constant(u8, context.left_brace_index)),
        begin,
        .{ bytes, index },
        malformed,
        .{},
    );
    const started = flow.enter(begin);
    const initial = flow.productConstruct(State, .{
        cursor(flow, Bytes, started[0], addOne(flow, started[1], context)),
        flow.constant(bool, context.false_index),
        flow.constant(bool, context.false_index),
        flow.constant(bool, context.false_index),
        flow.constant(bool, context.false_index),
        flow.constant(bool, context.false_index),
        flow.constant(FunctionCall(Bytes), context.empty_call_index),
    });
    const loop = flow.block(.loop_header, .{State});
    flow.jump(loop, .{initial});

    const current = flow.enter(loop)[0];
    const spaced = flow.call(
        helpers.core.skip_whitespace,
        .{flow.productExtract(0, current)},
        .{current},
    );
    const spaced_cursor = spaced.value;
    const spaced_bytes = flow.productExtract(0, spaced_cursor);
    const spaced_index = flow.productExtract(1, spaced_cursor);
    const byte = flow.bytesByteAt(
        spaced_bytes,
        spaced_index,
        flow.constant(context.Failure, context.malformed_failure_index),
    );
    const finalize = flow.block(.segment, .{ State, u32 });
    const member = flow.block(.segment, .{State});
    flow.branch(
        flow.integerEqual(byte, flow.constant(u8, context.right_brace_index)),
        finalize,
        .{ spaced.carried[0], addOne(flow, spaced_index, context) },
        member,
        .{replace(flow, spaced.carried[0], 0, spaced_cursor)},
    );

    const member_state = flow.enter(member)[0];
    const key = flow.call(
        helpers.core.parse_string,
        .{flow.productExtract(0, member_state)},
        .{member_state},
    );
    const key_cursor = flow.productExtract(0, key.value);
    const key_text = flow.productExtract(1, key.value);
    const after_key = flow.call(
        helpers.core.skip_whitespace,
        .{key_cursor},
        .{ key.carried[0], key_text },
    );
    const colon_cursor = after_key.value;
    const colon_bytes = flow.productExtract(0, colon_cursor);
    const colon_index = flow.productExtract(1, colon_cursor);
    const colon = flow.bytesByteAt(
        colon_bytes,
        colon_index,
        flow.constant(context.Failure, context.malformed_failure_index),
    );
    const dispatch = flow.block(.segment, .{ State, Text, staged.Cursor(Bytes) });
    flow.branch(
        flow.integerEqual(colon, flow.constant(u8, context.colon_index)),
        dispatch,
        .{
            after_key.carried[0],
            after_key.carried[1],
            cursor(flow, Bytes, colon_bytes, addOne(flow, colon_index, context)),
        },
        malformed,
        .{},
    );

    const dispatched = flow.enter(dispatch);
    const value = flow.call(
        helpers.core.skip_whitespace,
        .{dispatched[2]},
        .{ dispatched[0], dispatched[1] },
    );
    const value_state = value.carried[0];
    const value_key = value.carried[1];
    const value_cursor = value.value;
    const status_member = flow.block(.segment, .{ State, staged.Cursor(Bytes) });
    const classify_error = flow.block(.segment, .{ State, Text, staged.Cursor(Bytes) });
    flow.branch(
        textEquals(flow, value_key, context.status_key_index, context),
        status_member,
        .{ value_state, value_cursor },
        classify_error,
        .{ value_state, value_key, value_cursor },
    );
    const error_input = flow.enter(classify_error);
    const error_member = flow.block(.segment, .{ State, staged.Cursor(Bytes) });
    const classify_output = flow.block(.segment, .{ State, Text, staged.Cursor(Bytes) });
    flow.branch(
        textEquals(flow, error_input[1], context.error_key_index, context),
        error_member,
        .{ error_input[0], error_input[2] },
        classify_output,
        error_input,
    );
    const output_input = flow.enter(classify_output);
    const output_member = flow.block(.segment, .{ State, staged.Cursor(Bytes) });
    const unknown_member = flow.block(.segment, .{ State, staged.Cursor(Bytes) });
    flow.branch(
        textEquals(flow, output_input[1], context.output_key_index, context),
        output_member,
        .{ output_input[0], output_input[2] },
        unknown_member,
        .{ output_input[0], output_input[2] },
    );

    const after_member = flow.block(.segment, .{State});
    emitTopStatus(
        flow,
        Bytes,
        helpers,
        flow.enter(status_member),
        after_member,
        malformed,
        context,
    );
    emitTopError(
        flow,
        Bytes,
        flow.enter(error_member),
        after_member,
        malformed,
        response_error,
        context,
    );
    emitTopOutput(
        flow,
        Bytes,
        helpers,
        flow.enter(output_member),
        after_member,
        malformed,
        context,
    );
    const unknown = flow.enter(unknown_member);
    const skipped = flow.call(helpers.core.skip_value, .{unknown[1]}, .{unknown[0]});
    flow.jump(
        after_member,
        .{replace(flow, skipped.carried[0], 0, skipped.value)},
    );

    emitObjectDelimiter(
        flow,
        Bytes,
        helpers,
        flow.enter(after_member)[0],
        loop,
        finalize,
        malformed,
        context,
    );

    const final = flow.enter(finalize);
    const all_seen = flow.booleanAnd(
        flow.productExtract(1, final[0]),
        flow.booleanAnd(flow.productExtract(2, final[0]), flow.productExtract(3, final[0])),
    );
    const seen = flow.block(.segment, .{ State, u32 });
    flow.branch(all_seen, seen, final, malformed, .{});
    const seen_values = flow.enter(seen);
    const valid_status = flow.block(.segment, .{ State, u32 });
    flow.branch(
        flow.productExtract(4, seen_values[0]),
        valid_status,
        seen_values,
        incomplete,
        .{},
    );
    const valid = flow.enter(valid_status);
    const valid_error = flow.block(.segment, .{ State, u32 });
    flow.branch(
        flow.productExtract(5, valid[0]),
        valid_error,
        valid,
        response_error,
        .{},
    );
    const error_checked = flow.enter(valid_error);
    const closing_cursor = flow.productExtract(0, error_checked[0]);
    const after_close = cursor(
        flow,
        Bytes,
        flow.productExtract(0, closing_cursor),
        error_checked[1],
    );
    const trailing = flow.call(
        helpers.core.skip_whitespace,
        .{after_close},
        .{error_checked[0]},
    );
    const trailing_bytes = flow.productExtract(0, trailing.value);
    const trailing_index = flow.productExtract(1, trailing.value);
    const done = flow.block(.segment, .{State});
    flow.branch(
        flow.integerEqual(trailing_index, flow.bytesLength(trailing_bytes)),
        done,
        trailing.carried,
        malformed,
        .{},
    );
    flow.returnToCaller(flow.productExtract(6, flow.enter(done)[0]));

    _ = flow.enter(malformed);
    fail(flow, context.malformed_failure_index, context);
    _ = flow.enter(incomplete);
    fail(flow, context.incomplete_failure_index, context);
    _ = flow.enter(response_error);
    fail(flow, context.response_error_failure_index, context);
}

fn emitTopStatus(
    flow: anytype,
    comptime Bytes: type,
    helpers: Helpers(@TypeOf(flow.*), Bytes),
    values: anytype,
    after_member: anytype,
    malformed: anytype,
    comptime context: anytype,
) void {
    const unseen = flow.block(.segment, .{ TopState(Bytes), staged.Cursor(Bytes) });
    requireFalse(flow, flow.productExtract(1, values[0]), unseen, values, malformed);
    const accepted = flow.enter(unseen);
    const parsed = flow.call(helpers.core.parse_string, .{accepted[1]}, .{accepted[0]});
    var updated = replace(
        flow,
        parsed.carried[0],
        0,
        flow.productExtract(0, parsed.value),
    );
    updated = replace(flow, updated, 1, flow.constant(bool, context.true_index));
    updated = replace(
        flow,
        updated,
        4,
        textEquals(
            flow,
            flow.productExtract(1, parsed.value),
            context.completed_value_index,
            context,
        ),
    );
    flow.jump(after_member, .{updated});
}

fn emitTopError(
    flow: anytype,
    comptime Bytes: type,
    values: anytype,
    after_member: anytype,
    malformed: anytype,
    response_error: anytype,
    comptime context: anytype,
) void {
    const unseen = flow.block(.segment, .{ TopState(Bytes), staged.Cursor(Bytes) });
    requireFalse(flow, flow.productExtract(2, values[0]), unseen, values, malformed);
    const accepted = flow.enter(unseen);
    const bytes = flow.productExtract(0, accepted[1]);
    var index = flow.productExtract(1, accepted[1]);
    var valid = flow.constant(bool, context.true_index);
    inline for (.{
        context.lower_n_index,
        context.lower_u_index,
        context.lower_l_index,
        context.lower_l_index,
    }) |constant_index| {
        const byte = flow.bytesByteAt(
            bytes,
            index,
            flow.constant(context.Failure, context.malformed_failure_index),
        );
        valid = flow.booleanAnd(
            valid,
            flow.integerEqual(byte, flow.constant(u8, constant_index)),
        );
        index = addOne(flow, index, context);
    }
    const null_value = flow.block(.segment, .{ TopState(Bytes), Bytes, u32 });
    flow.branch(valid, null_value, .{ accepted[0], bytes, index }, response_error, .{});
    const null_values = flow.enter(null_value);
    var updated = replace(
        flow,
        null_values[0],
        0,
        cursor(flow, Bytes, null_values[1], null_values[2]),
    );
    updated = replace(flow, updated, 2, flow.constant(bool, context.true_index));
    updated = replace(flow, updated, 5, flow.constant(bool, context.true_index));
    flow.jump(after_member, .{updated});
}

fn emitTopOutput(
    flow: anytype,
    comptime Bytes: type,
    helpers: Helpers(@TypeOf(flow.*), Bytes),
    values: anytype,
    after_member: anytype,
    malformed: anytype,
    comptime context: anytype,
) void {
    const unseen = flow.block(.segment, .{ TopState(Bytes), staged.Cursor(Bytes) });
    requireFalse(flow, flow.productExtract(3, values[0]), unseen, values, malformed);
    const accepted = flow.enter(unseen);
    const parsed = flow.call(helpers.parse_output, .{accepted[1]}, .{accepted[0]});
    var updated = replace(
        flow,
        parsed.carried[0],
        0,
        flow.productExtract(0, parsed.value),
    );
    updated = replace(flow, updated, 3, flow.constant(bool, context.true_index));
    updated = replace(flow, updated, 6, flow.productExtract(1, parsed.value));
    flow.jump(after_member, .{updated});
}
