const boundary = @import("boundary");

pub fn Cursor(comptime Bytes: type) type {
    return struct {
        bytes: Bytes,
        index: u32,
    };
}

pub fn ParsedString(comptime Bytes: type) type {
    return struct {
        cursor: Cursor(Bytes),
        value: boundary.Text(Bytes.maximum_length),
    };
}

pub fn ParsedScalar(comptime Bytes: type) type {
    return struct {
        cursor: Cursor(Bytes),
        value: u32,
    };
}

pub fn ParsedUnsigned(comptime Bytes: type) type {
    return struct {
        cursor: Cursor(Bytes),
        value: u64,
    };
}

pub fn Helpers(comptime FlowType: type, comptime Bytes: type) type {
    return struct {
        skip_whitespace: FlowType.HelperType(.{Cursor(Bytes)}, Cursor(Bytes)),
        parse_hex4: FlowType.HelperType(.{Cursor(Bytes)}, ParsedScalar(Bytes)),
        parse_utf8: FlowType.HelperType(.{Cursor(Bytes)}, ParsedScalar(Bytes)),
        parse_string: FlowType.HelperType(.{Cursor(Bytes)}, ParsedString(Bytes)),
        skip_number: FlowType.HelperType(.{Cursor(Bytes)}, Cursor(Bytes)),
        skip_value: FlowType.HelperType(.{Cursor(Bytes)}, Cursor(Bytes)),
        parse_unsigned: FlowType.HelperType(.{Cursor(Bytes)}, ParsedUnsigned(Bytes)),
    };
}

pub fn declare(flow: anytype, comptime Bytes: type) Helpers(@TypeOf(flow.*), Bytes) {
    return .{
        .skip_whitespace = flow.helper(.{Cursor(Bytes)}, Cursor(Bytes)),
        .parse_hex4 = flow.helper(.{Cursor(Bytes)}, ParsedScalar(Bytes)),
        .parse_utf8 = flow.helper(.{Cursor(Bytes)}, ParsedScalar(Bytes)),
        .parse_string = flow.helper(.{Cursor(Bytes)}, ParsedString(Bytes)),
        .skip_number = flow.helper(.{Cursor(Bytes)}, Cursor(Bytes)),
        .skip_value = flow.helper(.{Cursor(Bytes)}, Cursor(Bytes)),
        .parse_unsigned = flow.helper(.{Cursor(Bytes)}, ParsedUnsigned(Bytes)),
    };
}

pub fn define(
    flow: anytype,
    comptime Bytes: type,
    helpers: Helpers(@TypeOf(flow.*), Bytes),
    comptime context: anytype,
) void {
    defineSkipWhitespace(flow, Bytes, helpers.skip_whitespace, context);
    defineHex4(flow, Bytes, helpers.parse_hex4, context);
    defineUtf8(flow, Bytes, helpers.parse_utf8, context);
    defineString(flow, Bytes, helpers, context);
    defineSkipNumber(flow, Bytes, helpers.skip_number, context);
    defineSkipValue(flow, Bytes, helpers, context);
    defineUnsigned(flow, Bytes, helpers, context);
}

fn cursor(
    flow: anytype,
    comptime Bytes: type,
    bytes: anytype,
    index: anytype,
) @import("flow.zig").Value(Cursor(Bytes)) {
    return flow.productConstruct(Cursor(Bytes), .{ bytes, index });
}

fn malformed(flow: anytype, comptime context: anytype) void {
    flow.failValue(flow.constant(context.Failure, context.malformed_failure_index));
}

fn defineSkipWhitespace(
    flow: anytype,
    comptime Bytes: type,
    helper: anytype,
    comptime context: anytype,
) void {
    const initial = flow.enter(helper.entry)[0];
    const loop = flow.block(.loop_header, .{Cursor(Bytes)});
    flow.jump(loop, .{initial});

    const current = flow.enter(loop)[0];
    const bytes = flow.productExtract(0, current);
    const index = flow.productExtract(1, current);
    const length = flow.bytesLength(bytes);
    const done = flow.block(.segment, .{Cursor(Bytes)});
    const inspect = flow.block(.segment, .{ Bytes, u32 });
    flow.branch(
        flow.integerGreaterEqual(index, length),
        done,
        .{current},
        inspect,
        .{ bytes, index },
    );

    const inspecting = flow.enter(inspect);
    const byte = flow.bytesByteAt(
        inspecting[0],
        inspecting[1],
        flow.constant(context.Failure, context.malformed_failure_index),
    );
    const is_space = flow.integerEqual(byte, flow.constant(u8, context.space_index));
    const is_tab = flow.integerEqual(byte, flow.constant(u8, context.tab_index));
    const is_lf = flow.integerEqual(byte, flow.constant(u8, context.lf_index));
    const is_cr = flow.integerEqual(byte, flow.constant(u8, context.cr_index));
    const whitespace = flow.booleanOr(
        flow.booleanOr(is_space, is_tab),
        flow.booleanOr(is_lf, is_cr),
    );
    const advance = flow.block(.segment, .{ Bytes, u32 });
    flow.branch(
        whitespace,
        advance,
        inspecting,
        done,
        .{cursor(flow, Bytes, inspecting[0], inspecting[1])},
    );

    const advancing = flow.enter(advance);
    flow.jump(loop, .{cursor(
        flow,
        Bytes,
        advancing[0],
        flow.integerAddOrFail(
            advancing[1],
            flow.constant(u32, context.one_u32_index),
            flow.constant(context.Failure, context.arithmetic_failure_index),
        ),
    )});

    const finished = flow.enter(done)[0];
    flow.returnToCaller(finished);
}

fn defineHex4(
    flow: anytype,
    comptime Bytes: type,
    helper: anytype,
    comptime context: anytype,
) void {
    const initial = flow.enter(helper.entry)[0];
    const initial_bytes = flow.productExtract(0, initial);
    const initial_index = flow.productExtract(1, initial);
    const loop = flow.block(.loop_header, .{ Bytes, u32, u32, u32 });
    flow.jump(loop, .{
        initial_bytes,
        initial_index,
        flow.constant(u32, context.zero_u32_index),
        flow.constant(u32, context.zero_u32_index),
    });

    const current = flow.enter(loop);
    const complete = flow.integerGreaterEqual(
        current[2],
        flow.constant(u32, context.four_u32_index),
    );
    const done = flow.block(.segment, .{ Bytes, u32, u32 });
    const inspect = flow.block(.segment, .{ Bytes, u32, u32, u32 });
    flow.branch(
        complete,
        done,
        .{ current[0], current[1], current[3] },
        inspect,
        current,
    );

    const inspecting = flow.enter(inspect);
    const byte = flow.bytesByteAt(
        inspecting[0],
        inspecting[1],
        flow.constant(context.Failure, context.malformed_failure_index),
    );
    const digit = flow.block(.segment, .{ Bytes, u32, u32, u32, u8 });
    const lower = flow.block(.segment, .{ Bytes, u32, u32, u32, u8 });
    const upper = flow.block(.segment, .{ Bytes, u32, u32, u32, u8 });
    const invalid = flow.block(.terminal_handoff, .{});

    const digit_in_range = flow.booleanAnd(
        flow.integerGreaterEqual(byte, flow.constant(u8, context.zero_char_index)),
        flow.integerLessEqual(byte, flow.constant(u8, context.nine_char_index)),
    );
    const classify_letter = flow.block(.segment, .{ Bytes, u32, u32, u32, u8 });
    flow.branch(
        digit_in_range,
        digit,
        .{ inspecting[0], inspecting[1], inspecting[2], inspecting[3], byte },
        classify_letter,
        .{ inspecting[0], inspecting[1], inspecting[2], inspecting[3], byte },
    );

    const letter = flow.enter(classify_letter);
    const lower_in_range = flow.booleanAnd(
        flow.integerGreaterEqual(letter[4], flow.constant(u8, context.lower_a_index)),
        flow.integerLessEqual(letter[4], flow.constant(u8, context.lower_f_index)),
    );
    const classify_upper = flow.block(.segment, .{ Bytes, u32, u32, u32, u8 });
    flow.branch(lower_in_range, lower, letter, classify_upper, letter);

    const upper_input = flow.enter(classify_upper);
    const upper_in_range = flow.booleanAnd(
        flow.integerGreaterEqual(upper_input[4], flow.constant(u8, context.upper_a_index)),
        flow.integerLessEqual(upper_input[4], flow.constant(u8, context.upper_f_index)),
    );
    flow.branch(upper_in_range, upper, upper_input, invalid, .{});

    const join = flow.block(.segment, .{ Bytes, u32, u32, u32, u32 });
    const digit_values = flow.enter(digit);
    flow.jump(join, .{
        digit_values[0],
        digit_values[1],
        digit_values[2],
        digit_values[3],
        flow.integerConvert(u32, flow.integerSubtract(
            digit_values[4],
            flow.constant(u8, context.zero_char_index),
        )),
    });

    const lower_values = flow.enter(lower);
    flow.jump(join, .{
        lower_values[0],
        lower_values[1],
        lower_values[2],
        lower_values[3],
        flow.integerAddOrFail(
            flow.integerConvert(u32, flow.integerSubtract(
                lower_values[4],
                flow.constant(u8, context.lower_a_index),
            )),
            flow.constant(u32, context.ten_u32_index),
            flow.constant(context.Failure, context.arithmetic_failure_index),
        ),
    });

    const upper_values = flow.enter(upper);
    flow.jump(join, .{
        upper_values[0],
        upper_values[1],
        upper_values[2],
        upper_values[3],
        flow.integerAddOrFail(
            flow.integerConvert(u32, flow.integerSubtract(
                upper_values[4],
                flow.constant(u8, context.upper_a_index),
            )),
            flow.constant(u32, context.ten_u32_index),
            flow.constant(context.Failure, context.arithmetic_failure_index),
        ),
    });

    const joined = flow.enter(join);
    const multiplied = flow.integerMultiplyOrFail(
        joined[3],
        flow.constant(u32, context.sixteen_u32_index),
        flow.constant(context.Failure, context.arithmetic_failure_index),
    );
    const accumulated = flow.integerAddOrFail(
        multiplied,
        joined[4],
        flow.constant(context.Failure, context.arithmetic_failure_index),
    );
    const next_index = flow.integerAddOrFail(
        joined[1],
        flow.constant(u32, context.one_u32_index),
        flow.constant(context.Failure, context.arithmetic_failure_index),
    );
    const next_count = flow.integerAddOrFail(
        joined[2],
        flow.constant(u32, context.one_u32_index),
        flow.constant(context.Failure, context.arithmetic_failure_index),
    );
    flow.jump(loop, .{ joined[0], next_index, next_count, accumulated });

    _ = flow.enter(invalid);
    malformed(flow, context);

    const finished = flow.enter(done);
    flow.returnToCaller(flow.productConstruct(ParsedScalar(Bytes), .{
        cursor(flow, Bytes, finished[0], finished[1]),
        finished[2],
    }));
}

fn defineUtf8(
    flow: anytype,
    comptime Bytes: type,
    helper: anytype,
    comptime context: anytype,
) void {
    const initial = flow.enter(helper.entry)[0];
    const bytes = flow.productExtract(0, initial);
    const index = flow.productExtract(1, initial);
    const invalid = flow.block(.terminal_handoff, .{});
    const classify = flow.block(.segment, .{ Bytes, u32, u8 });
    const lead = flow.bytesByteAt(
        bytes,
        index,
        flow.constant(context.Failure, context.malformed_failure_index),
    );
    flow.branch(
        flow.integerLessThan(lead, flow.constant(u8, context.utf8_lead_min_index)),
        invalid,
        .{},
        classify,
        .{ bytes, index, lead },
    );

    const classified = flow.enter(classify);
    const is_two = flow.integerLessEqual(
        classified[2],
        flow.constant(u8, context.utf8_two_max_index),
    );
    const two = flow.block(.segment, .{ Bytes, u32, u8 });
    const classify_three = flow.block(.segment, .{ Bytes, u32, u8 });
    flow.branch(is_two, two, classified, classify_three, classified);

    const three_input = flow.enter(classify_three);
    const is_three = flow.integerLessEqual(
        three_input[2],
        flow.constant(u8, context.utf8_three_max_index),
    );
    const three = flow.block(.segment, .{ Bytes, u32, u8 });
    const classify_four = flow.block(.segment, .{ Bytes, u32, u8 });
    flow.branch(is_three, three, three_input, classify_four, three_input);

    const four_input = flow.enter(classify_four);
    const is_four = flow.integerLessEqual(
        four_input[2],
        flow.constant(u8, context.utf8_four_max_index),
    );
    const four = flow.block(.segment, .{ Bytes, u32, u8 });
    flow.branch(is_four, four, four_input, invalid, .{});

    const joined = flow.block(.segment, .{ Bytes, u32, u32 });
    emitUtf8Case(flow, Bytes, flow.enter(two), 2, joined, invalid, context);
    emitUtf8Case(flow, Bytes, flow.enter(three), 3, joined, invalid, context);
    emitUtf8Case(flow, Bytes, flow.enter(four), 4, joined, invalid, context);

    _ = flow.enter(invalid);
    malformed(flow, context);

    const result = flow.enter(joined);
    flow.returnToCaller(flow.productConstruct(ParsedScalar(Bytes), .{
        cursor(flow, Bytes, result[0], result[1]),
        result[2],
    }));
}

fn emitUtf8Case(
    flow: anytype,
    comptime Bytes: type,
    values: anytype,
    comptime width: u32,
    joined: anytype,
    invalid: anytype,
    comptime context: anytype,
) void {
    var scalar = flow.integerConvert(u32, flow.integerSubtract(
        values[2],
        flow.constant(u8, switch (width) {
            2 => context.utf8_two_bias_index,
            3 => context.utf8_three_bias_index,
            4 => context.utf8_four_bias_index,
            else => unreachable,
        }),
    ));
    var next = values[1];
    inline for (1..width) |_| {
        next = flow.integerAddOrFail(
            next,
            flow.constant(u32, context.one_u32_index),
            flow.constant(context.Failure, context.arithmetic_failure_index),
        );
        const continuation = flow.bytesByteAt(
            values[0],
            next,
            flow.constant(context.Failure, context.malformed_failure_index),
        );
        const valid = flow.booleanAnd(
            flow.integerGreaterEqual(
                continuation,
                flow.constant(u8, context.utf8_continuation_min_index),
            ),
            flow.integerLessEqual(
                continuation,
                flow.constant(u8, context.utf8_continuation_max_index),
            ),
        );
        const consume = flow.block(.segment, .{ Bytes, u32, u32, u8 });
        flow.branch(valid, consume, .{ values[0], next, scalar, continuation }, invalid, .{});
        const consumed = flow.enter(consume);
        scalar = flow.integerAddOrFail(
            flow.integerMultiplyOrFail(
                consumed[2],
                flow.constant(u32, context.sixty_four_u32_index),
                flow.constant(context.Failure, context.arithmetic_failure_index),
            ),
            flow.integerConvert(u32, flow.integerSubtract(
                consumed[3],
                flow.constant(u8, context.utf8_continuation_min_index),
            )),
            flow.constant(context.Failure, context.arithmetic_failure_index),
        );
        next = consumed[1];
    }
    const next_index = flow.integerAddOrFail(
        next,
        flow.constant(u32, context.one_u32_index),
        flow.constant(context.Failure, context.arithmetic_failure_index),
    );
    const minimum = flow.constant(u32, switch (width) {
        2 => context.utf8_two_scalar_min_index,
        3 => context.utf8_three_scalar_min_index,
        4 => context.utf8_four_scalar_min_index,
        else => unreachable,
    });
    const too_small = flow.integerLessThan(scalar, minimum);
    const too_large = flow.integerGreaterThan(
        scalar,
        flow.constant(u32, context.unicode_max_index),
    );
    const surrogate = flow.booleanAnd(
        flow.integerGreaterEqual(
            scalar,
            flow.constant(u32, context.surrogate_min_index),
        ),
        flow.integerLessEqual(
            scalar,
            flow.constant(u32, context.surrogate_max_index),
        ),
    );
    const rejected = flow.booleanOr(flow.booleanOr(too_small, too_large), surrogate);
    const accepted = flow.block(.segment, .{ Bytes, u32, u32 });
    flow.branch(rejected, invalid, .{}, accepted, .{ values[0], next_index, scalar });
    const result = flow.enter(accepted);
    flow.jump(joined, result);
}

fn defineString(
    flow: anytype,
    comptime Bytes: type,
    helpers: Helpers(@TypeOf(flow.*), Bytes),
    comptime context: anytype,
) void {
    const Text = boundary.Text(Bytes.maximum_length);
    const initial = flow.enter(helpers.parse_string.entry)[0];
    const bytes = flow.productExtract(0, initial);
    const index = flow.productExtract(1, initial);
    const invalid = flow.block(.terminal_handoff, .{});
    const begin = flow.block(.segment, .{ Bytes, u32 });
    const opening = flow.bytesByteAt(
        bytes,
        index,
        flow.constant(context.Failure, context.malformed_failure_index),
    );
    flow.branch(
        flow.integerEqual(opening, flow.constant(u8, context.quote_index)),
        begin,
        .{ bytes, index },
        invalid,
        .{},
    );

    const started = flow.enter(begin);
    const loop = flow.block(.loop_header, .{ Bytes, u32, Text });
    flow.jump(loop, .{
        started[0],
        flow.integerAddOrFail(
            started[1],
            flow.constant(u32, context.one_u32_index),
            flow.constant(context.Failure, context.arithmetic_failure_index),
        ),
        flow.textEmpty(Text),
    });

    const current = flow.enter(loop);
    const length = flow.bytesLength(current[0]);
    const inspect = flow.block(.segment, .{ Bytes, u32, Text });
    flow.branch(
        flow.integerGreaterEqual(current[1], length),
        invalid,
        .{},
        inspect,
        current,
    );

    const inspecting = flow.enter(inspect);
    const byte = flow.bytesByteAt(
        inspecting[0],
        inspecting[1],
        flow.constant(context.Failure, context.malformed_failure_index),
    );
    const done = flow.block(.segment, .{ Bytes, u32, Text });
    const classify_escape = flow.block(.segment, .{ Bytes, u32, Text, u8 });
    flow.branch(
        flow.integerEqual(byte, flow.constant(u8, context.quote_index)),
        done,
        inspecting,
        classify_escape,
        .{ inspecting[0], inspecting[1], inspecting[2], byte },
    );

    const escape_input = flow.enter(classify_escape);
    const escape = flow.block(.segment, .{ Bytes, u32, Text });
    const classify_control = flow.block(.segment, .{ Bytes, u32, Text, u8 });
    flow.branch(
        flow.integerEqual(escape_input[3], flow.constant(u8, context.backslash_index)),
        escape,
        .{ escape_input[0], escape_input[1], escape_input[2] },
        classify_control,
        escape_input,
    );

    const control_input = flow.enter(classify_control);
    const is_control = flow.integerLessThan(
        control_input[3],
        flow.constant(u8, context.space_index),
    );
    const classify_ascii = flow.block(.segment, .{ Bytes, u32, Text, u8 });
    flow.branch(is_control, invalid, .{}, classify_ascii, control_input);

    const ascii_input = flow.enter(classify_ascii);
    const ascii = flow.block(.segment, .{ Bytes, u32, Text, u8 });
    const raw_utf8 = flow.block(.segment, .{ Bytes, u32, Text });
    flow.branch(
        flow.integerLessThan(
            ascii_input[3],
            flow.constant(u8, context.ascii_limit_index),
        ),
        ascii,
        ascii_input,
        raw_utf8,
        .{ ascii_input[0], ascii_input[1], ascii_input[2] },
    );

    const append = flow.block(.segment, .{ Bytes, u32, Text, u32 });
    const ascii_values = flow.enter(ascii);
    flow.jump(append, .{
        ascii_values[0],
        flow.integerAddOrFail(
            ascii_values[1],
            flow.constant(u32, context.one_u32_index),
            flow.constant(context.Failure, context.arithmetic_failure_index),
        ),
        ascii_values[2],
        flow.integerConvert(u32, ascii_values[3]),
    });

    const raw_values = flow.enter(raw_utf8);
    const decoded = flow.call(
        helpers.parse_utf8,
        .{cursor(flow, Bytes, raw_values[0], raw_values[1])},
        .{raw_values[2]},
    );
    const decoded_cursor = flow.productExtract(0, decoded.value);
    flow.jump(append, .{
        flow.productExtract(0, decoded_cursor),
        flow.productExtract(1, decoded_cursor),
        decoded.carried[0],
        flow.productExtract(1, decoded.value),
    });

    const escape_values = flow.enter(escape);
    const escaped_index = flow.integerAddOrFail(
        escape_values[1],
        flow.constant(u32, context.one_u32_index),
        flow.constant(context.Failure, context.arithmetic_failure_index),
    );
    const escaped_byte = flow.bytesByteAt(
        escape_values[0],
        escaped_index,
        flow.constant(context.Failure, context.malformed_failure_index),
    );
    emitEscape(
        flow,
        Bytes,
        helpers,
        .{ escape_values[0], escaped_index, escape_values[2], escaped_byte },
        append,
        invalid,
        context,
    );

    const appending = flow.enter(append);
    const appended = flow.textAppendScalarOrFail(
        appending[2],
        appending[3],
        flow.constant(context.Failure, context.capacity_failure_index),
        flow.constant(context.Failure, context.invalid_utf8_failure_index),
    );
    flow.jump(loop, .{ appending[0], appending[1], appended });

    _ = flow.enter(invalid);
    malformed(flow, context);

    const finished = flow.enter(done);
    flow.returnToCaller(flow.productConstruct(ParsedString(Bytes), .{
        cursor(
            flow,
            Bytes,
            finished[0],
            flow.integerAddOrFail(
                finished[1],
                flow.constant(u32, context.one_u32_index),
                flow.constant(context.Failure, context.arithmetic_failure_index),
            ),
        ),
        finished[2],
    }));
}

fn emitEscape(
    flow: anytype,
    comptime Bytes: type,
    helpers: Helpers(@TypeOf(flow.*), Bytes),
    values: anytype,
    append: anytype,
    invalid: anytype,
    comptime context: anytype,
) void {
    const classify_unicode = flow.block(.segment, .{ Bytes, u32, boundary.Text(Bytes.maximum_length), u8 });
    const simple = flow.block(.segment, .{ Bytes, u32, boundary.Text(Bytes.maximum_length), u8 });
    const is_unicode = flow.integerEqual(values[3], flow.constant(u8, context.lower_u_index));
    flow.branch(is_unicode, classify_unicode, values, simple, values);

    const simple_values = flow.enter(simple);
    const simple_scalar = simpleEscapeScalar(flow, simple_values[3], context);
    const simple_valid = flow.integerNotEqual(
        simple_scalar,
        flow.constant(u32, context.invalid_escape_scalar_index),
    );
    const simple_append = flow.block(.segment, .{ Bytes, u32, boundary.Text(Bytes.maximum_length), u32 });
    flow.branch(
        simple_valid,
        simple_append,
        .{ simple_values[0], simple_values[1], simple_values[2], simple_scalar },
        invalid,
        .{},
    );
    const simple_ready = flow.enter(simple_append);
    flow.jump(append, .{
        simple_ready[0],
        flow.integerAddOrFail(
            simple_ready[1],
            flow.constant(u32, context.one_u32_index),
            flow.constant(context.Failure, context.arithmetic_failure_index),
        ),
        simple_ready[2],
        simple_ready[3],
    });

    const unicode_values = flow.enter(classify_unicode);
    const first_hex_cursor = cursor(
        flow,
        Bytes,
        unicode_values[0],
        flow.integerAddOrFail(
            unicode_values[1],
            flow.constant(u32, context.one_u32_index),
            flow.constant(context.Failure, context.arithmetic_failure_index),
        ),
    );
    const first = flow.call(helpers.parse_hex4, .{first_hex_cursor}, .{unicode_values[2]});
    const unit = flow.productExtract(1, first.value);
    const high = flow.booleanAnd(
        flow.integerGreaterEqual(unit, flow.constant(u32, context.high_surrogate_min_index)),
        flow.integerLessEqual(unit, flow.constant(u32, context.high_surrogate_max_index)),
    );
    const low = flow.booleanAnd(
        flow.integerGreaterEqual(unit, flow.constant(u32, context.low_surrogate_min_index)),
        flow.integerLessEqual(unit, flow.constant(u32, context.low_surrogate_max_index)),
    );
    const pair = flow.block(.segment, .{ Cursor(Bytes), boundary.Text(Bytes.maximum_length), u32 });
    const scalar = flow.block(.segment, .{ Cursor(Bytes), boundary.Text(Bytes.maximum_length), u32 });
    const classify_low = flow.block(.segment, .{ Cursor(Bytes), boundary.Text(Bytes.maximum_length), u32 });
    flow.branch(
        high,
        pair,
        .{ flow.productExtract(0, first.value), first.carried[0], unit },
        classify_low,
        .{ flow.productExtract(0, first.value), first.carried[0], unit },
    );

    const low_values = flow.enter(classify_low);
    flow.branch(low, invalid, .{}, scalar, low_values);

    const pair_values = flow.enter(pair);
    const pair_cursor = pair_values[0];
    const pair_bytes = flow.productExtract(0, pair_cursor);
    const pair_index = flow.productExtract(1, pair_cursor);
    const require_u = flow.block(.segment, .{ Bytes, u32, boundary.Text(Bytes.maximum_length), u32 });
    const first_pair_byte = flow.bytesByteAt(
        pair_bytes,
        pair_index,
        flow.constant(context.Failure, context.malformed_failure_index),
    );
    flow.branch(
        flow.integerEqual(first_pair_byte, flow.constant(u8, context.backslash_index)),
        require_u,
        .{ pair_bytes, pair_index, pair_values[1], pair_values[2] },
        invalid,
        .{},
    );
    const require_u_values = flow.enter(require_u);
    const u_index = flow.integerAddOrFail(
        require_u_values[1],
        flow.constant(u32, context.one_u32_index),
        flow.constant(context.Failure, context.arithmetic_failure_index),
    );
    const second_pair_byte = flow.bytesByteAt(
        require_u_values[0],
        u_index,
        flow.constant(context.Failure, context.malformed_failure_index),
    );
    const parse_low = flow.block(.segment, .{ Bytes, u32, boundary.Text(Bytes.maximum_length), u32 });
    flow.branch(
        flow.integerEqual(second_pair_byte, flow.constant(u8, context.lower_u_index)),
        parse_low,
        .{ require_u_values[0], u_index, require_u_values[2], require_u_values[3] },
        invalid,
        .{},
    );
    const low_input = flow.enter(parse_low);
    const second = flow.call(
        helpers.parse_hex4,
        .{cursor(
            flow,
            Bytes,
            low_input[0],
            flow.integerAddOrFail(
                low_input[1],
                flow.constant(u32, context.one_u32_index),
                flow.constant(context.Failure, context.arithmetic_failure_index),
            ),
        )},
        .{ low_input[2], low_input[3] },
    );
    const low_unit = flow.productExtract(1, second.value);
    const low_valid = flow.booleanAnd(
        flow.integerGreaterEqual(low_unit, flow.constant(u32, context.low_surrogate_min_index)),
        flow.integerLessEqual(low_unit, flow.constant(u32, context.low_surrogate_max_index)),
    );
    const combine = flow.block(.segment, .{ Cursor(Bytes), boundary.Text(Bytes.maximum_length), u32, u32 });
    flow.branch(
        low_valid,
        combine,
        .{ flow.productExtract(0, second.value), second.carried[0], second.carried[1], low_unit },
        invalid,
        .{},
    );
    const combined = flow.enter(combine);
    const high_part = flow.integerMultiplyOrFail(
        flow.integerSubtract(
            combined[2],
            flow.constant(u32, context.high_surrogate_min_index),
        ),
        flow.constant(u32, context.surrogate_factor_index),
        flow.constant(context.Failure, context.arithmetic_failure_index),
    );
    const low_part = flow.integerSubtract(
        combined[3],
        flow.constant(u32, context.low_surrogate_min_index),
    );
    const pair_scalar = flow.integerAddOrFail(
        flow.integerAddOrFail(
            high_part,
            low_part,
            flow.constant(context.Failure, context.arithmetic_failure_index),
        ),
        flow.constant(u32, context.supplementary_base_index),
        flow.constant(context.Failure, context.arithmetic_failure_index),
    );
    flow.jump(scalar, .{ combined[0], combined[1], pair_scalar });

    const scalar_values = flow.enter(scalar);
    flow.jump(append, .{
        flow.productExtract(0, scalar_values[0]),
        flow.productExtract(1, scalar_values[0]),
        scalar_values[1],
        scalar_values[2],
    });
}

fn defineSkipNumber(
    flow: anytype,
    comptime Bytes: type,
    helper: anytype,
    comptime context: anytype,
) void {
    const initial = flow.enter(helper.entry)[0];
    const bytes = flow.productExtract(0, initial);
    const index = flow.productExtract(1, initial);
    const length = flow.bytesLength(bytes);
    const invalid = flow.block(.terminal_handoff, .{});
    const inspect_sign = flow.block(.segment, .{ Bytes, u32, u8 });
    const first = flow.bytesByteAt(
        bytes,
        index,
        flow.constant(context.Failure, context.malformed_failure_index),
    );
    flow.branch(
        flow.integerGreaterEqual(index, length),
        invalid,
        .{},
        inspect_sign,
        .{ bytes, index, first },
    );

    const sign = flow.enter(inspect_sign);
    const after_sign = flow.block(.segment, .{ Bytes, u32 });
    const first_digit = flow.block(.segment, .{ Bytes, u32 });
    flow.branch(
        flow.integerEqual(sign[2], flow.constant(u8, context.minus_index)),
        after_sign,
        .{ sign[0], sign[1] },
        first_digit,
        .{ sign[0], sign[1] },
    );

    const signed = flow.enter(after_sign);
    flow.jump(first_digit, .{
        signed[0],
        flow.integerAddOrFail(
            signed[1],
            flow.constant(u32, context.one_u32_index),
            flow.constant(context.Failure, context.arithmetic_failure_index),
        ),
    });

    const digit_input = flow.enter(first_digit);
    const digit_length = flow.bytesLength(digit_input[0]);
    const inspect_digit = flow.block(.segment, .{ Bytes, u32, u8 });
    const first_byte = flow.bytesByteAt(
        digit_input[0],
        digit_input[1],
        flow.constant(context.Failure, context.malformed_failure_index),
    );
    flow.branch(
        flow.integerGreaterEqual(digit_input[1], digit_length),
        invalid,
        .{},
        inspect_digit,
        .{ digit_input[0], digit_input[1], first_byte },
    );

    const inspected = flow.enter(inspect_digit);
    const is_digit = flow.booleanAnd(
        flow.integerGreaterEqual(inspected[2], flow.constant(u8, context.zero_char_index)),
        flow.integerLessEqual(inspected[2], flow.constant(u8, context.nine_char_index)),
    );
    const begin_loop = flow.block(.segment, .{ Bytes, u32, u8 });
    flow.branch(
        is_digit,
        begin_loop,
        .{
            inspected[0],
            inspected[1],
            flow.select(
                flow.integerEqual(inspected[2], flow.constant(u8, context.zero_char_index)),
                flow.constant(u8, context.number_zero_state_index),
                flow.constant(u8, context.number_integer_state_index),
            ),
        },
        invalid,
        .{},
    );

    const beginning = flow.enter(begin_loop);
    const loop = flow.block(.loop_header, .{ Bytes, u32, u8 });
    flow.jump(loop, .{
        beginning[0],
        flow.integerAddOrFail(
            beginning[1],
            flow.constant(u32, context.one_u32_index),
            flow.constant(context.Failure, context.arithmetic_failure_index),
        ),
        beginning[2],
    });

    const current = flow.enter(loop);
    const current_length = flow.bytesLength(current[0]);
    const eof = flow.integerGreaterEqual(current[1], current_length);
    const eof_valid = flow.booleanOr(
        flow.booleanOr(
            flow.integerEqual(current[2], flow.constant(u8, context.number_zero_state_index)),
            flow.integerEqual(current[2], flow.constant(u8, context.number_integer_state_index)),
        ),
        flow.booleanOr(
            flow.integerEqual(current[2], flow.constant(u8, context.number_fraction_state_index)),
            flow.integerEqual(current[2], flow.constant(u8, context.number_exponent_state_index)),
        ),
    );
    const done = flow.block(.segment, .{Cursor(Bytes)});
    const eof_invalid = flow.block(.terminal_handoff, .{});
    const inspect = flow.block(.segment, .{ Bytes, u32, u8 });
    const eof_result = flow.block(.segment, .{ Bytes, u32, u8, bool });
    flow.branch(eof, eof_result, .{ current[0], current[1], current[2], eof_valid }, inspect, current);

    const at_eof = flow.enter(eof_result);
    flow.branch(
        at_eof[3],
        done,
        .{cursor(flow, Bytes, at_eof[0], at_eof[1])},
        eof_invalid,
        .{},
    );

    const scanning = flow.enter(inspect);
    const byte = flow.bytesByteAt(
        scanning[0],
        scanning[1],
        flow.constant(context.Failure, context.malformed_failure_index),
    );
    const digit = flow.booleanAnd(
        flow.integerGreaterEqual(byte, flow.constant(u8, context.zero_char_index)),
        flow.integerLessEqual(byte, flow.constant(u8, context.nine_char_index)),
    );
    const dot = flow.integerEqual(byte, flow.constant(u8, context.dot_index));
    const exponent = flow.booleanOr(
        flow.integerEqual(byte, flow.constant(u8, context.lower_e_index)),
        flow.integerEqual(byte, flow.constant(u8, context.upper_e_index)),
    );
    const sign_byte = flow.booleanOr(
        flow.integerEqual(byte, flow.constant(u8, context.minus_index)),
        flow.integerEqual(byte, flow.constant(u8, context.plus_index)),
    );
    const state_zero = flow.integerEqual(
        scanning[2],
        flow.constant(u8, context.number_zero_state_index),
    );
    const state_integer = flow.integerEqual(
        scanning[2],
        flow.constant(u8, context.number_integer_state_index),
    );
    const state_fraction_required = flow.integerEqual(
        scanning[2],
        flow.constant(u8, context.number_fraction_required_state_index),
    );
    const state_fraction = flow.integerEqual(
        scanning[2],
        flow.constant(u8, context.number_fraction_state_index),
    );
    const state_exponent_start = flow.integerEqual(
        scanning[2],
        flow.constant(u8, context.number_exponent_start_state_index),
    );
    const state_exponent_sign = flow.integerEqual(
        scanning[2],
        flow.constant(u8, context.number_exponent_sign_state_index),
    );
    const state_exponent = flow.integerEqual(
        scanning[2],
        flow.constant(u8, context.number_exponent_state_index),
    );
    const invalid_zero_digit = flow.booleanAnd(state_zero, digit);
    const invalid_fraction = flow.booleanAnd(state_fraction_required, flow.booleanNot(digit));
    const invalid_exponent_start = flow.booleanAnd(
        state_exponent_start,
        flow.booleanNot(flow.booleanOr(digit, sign_byte)),
    );
    const invalid_exponent_sign = flow.booleanAnd(state_exponent_sign, flow.booleanNot(digit));
    const rejected = flow.booleanOr(
        flow.booleanOr(invalid_zero_digit, invalid_fraction),
        flow.booleanOr(invalid_exponent_start, invalid_exponent_sign),
    );
    const zero_done = flow.booleanAnd(state_zero, flow.booleanNot(flow.booleanOr(dot, exponent)));
    const integer_done = flow.booleanAnd(
        state_integer,
        flow.booleanNot(flow.booleanOr(digit, flow.booleanOr(dot, exponent))),
    );
    const fraction_done = flow.booleanAnd(
        state_fraction,
        flow.booleanNot(flow.booleanOr(digit, exponent)),
    );
    const exponent_done = flow.booleanAnd(state_exponent, flow.booleanNot(digit));
    const stopped = flow.booleanOr(
        flow.booleanOr(zero_done, integer_done),
        flow.booleanOr(fraction_done, exponent_done),
    );
    var next_state = scanning[2];
    next_state = flow.select(
        flow.booleanAnd(flow.booleanOr(state_zero, state_integer), dot),
        flow.constant(u8, context.number_fraction_required_state_index),
        next_state,
    );
    next_state = flow.select(
        flow.booleanAnd(
            flow.booleanOr(flow.booleanOr(state_zero, state_integer), state_fraction),
            exponent,
        ),
        flow.constant(u8, context.number_exponent_start_state_index),
        next_state,
    );
    next_state = flow.select(
        flow.booleanAnd(state_fraction_required, digit),
        flow.constant(u8, context.number_fraction_state_index),
        next_state,
    );
    next_state = flow.select(
        flow.booleanAnd(state_exponent_start, sign_byte),
        flow.constant(u8, context.number_exponent_sign_state_index),
        next_state,
    );
    next_state = flow.select(
        flow.booleanAnd(flow.booleanOr(state_exponent_start, state_exponent_sign), digit),
        flow.constant(u8, context.number_exponent_state_index),
        next_state,
    );
    const classify_stop = flow.block(.segment, .{ Bytes, u32, u8, bool });
    flow.branch(rejected, invalid, .{}, classify_stop, .{ scanning[0], scanning[1], next_state, stopped });

    const stop = flow.enter(classify_stop);
    const advance = flow.block(.segment, .{ Bytes, u32, u8 });
    flow.branch(
        stop[3],
        done,
        .{cursor(flow, Bytes, stop[0], stop[1])},
        advance,
        .{ stop[0], stop[1], stop[2] },
    );

    const advancing = flow.enter(advance);
    flow.jump(loop, .{
        advancing[0],
        flow.integerAddOrFail(
            advancing[1],
            flow.constant(u32, context.one_u32_index),
            flow.constant(context.Failure, context.arithmetic_failure_index),
        ),
        advancing[2],
    });

    _ = flow.enter(invalid);
    malformed(flow, context);
    _ = flow.enter(eof_invalid);
    malformed(flow, context);
    flow.returnToCaller(flow.enter(done)[0]);
}

fn defineSkipValue(
    flow: anytype,
    comptime Bytes: type,
    helpers: Helpers(@TypeOf(flow.*), Bytes),
    comptime context: anytype,
) void {
    const initial = flow.enter(helpers.skip_value.entry)[0];
    const leading = flow.call(helpers.skip_whitespace, .{initial}, .{});
    const bytes = flow.productExtract(0, leading.value);
    const index = flow.productExtract(1, leading.value);
    const length = flow.bytesLength(bytes);
    const invalid = flow.block(.terminal_handoff, .{});
    const classify = flow.block(.segment, .{ Bytes, u32, u8 });
    const first = flow.bytesByteAt(
        bytes,
        index,
        flow.constant(context.Failure, context.malformed_failure_index),
    );
    flow.branch(
        flow.integerGreaterEqual(index, length),
        invalid,
        .{},
        classify,
        .{ bytes, index, first },
    );

    const classified = flow.enter(classify);
    const string_value = flow.block(.segment, .{Cursor(Bytes)});
    const classify_object = flow.block(.segment, .{ Bytes, u32, u8 });
    flow.branch(
        flow.integerEqual(classified[2], flow.constant(u8, context.quote_index)),
        string_value,
        .{cursor(flow, Bytes, classified[0], classified[1])},
        classify_object,
        classified,
    );
    const parsed_string = flow.call(
        helpers.parse_string,
        .{flow.enter(string_value)[0]},
        .{},
    );
    const done = flow.block(.segment, .{Cursor(Bytes)});
    flow.jump(done, .{flow.productExtract(0, parsed_string.value)});

    const object_input = flow.enter(classify_object);
    const object = flow.block(.segment, .{ Bytes, u32 });
    const classify_array = flow.block(.segment, .{ Bytes, u32, u8 });
    flow.branch(
        flow.integerEqual(object_input[2], flow.constant(u8, context.left_brace_index)),
        object,
        .{ object_input[0], object_input[1] },
        classify_array,
        object_input,
    );

    const array_input = flow.enter(classify_array);
    const array = flow.block(.segment, .{ Bytes, u32 });
    const classify_literal = flow.block(.segment, .{ Bytes, u32, u8 });
    flow.branch(
        flow.integerEqual(array_input[2], flow.constant(u8, context.left_bracket_index)),
        array,
        .{ array_input[0], array_input[1] },
        classify_literal,
        array_input,
    );

    const literal_input = flow.enter(classify_literal);
    const literal_true = flow.block(.segment, .{ Bytes, u32 });
    const classify_false = flow.block(.segment, .{ Bytes, u32, u8 });
    flow.branch(
        flow.integerEqual(literal_input[2], flow.constant(u8, context.lower_t_index)),
        literal_true,
        .{ literal_input[0], literal_input[1] },
        classify_false,
        literal_input,
    );
    const false_input = flow.enter(classify_false);
    const literal_false = flow.block(.segment, .{ Bytes, u32 });
    const classify_null = flow.block(.segment, .{ Bytes, u32, u8 });
    flow.branch(
        flow.integerEqual(false_input[2], flow.constant(u8, context.lower_f_index)),
        literal_false,
        .{ false_input[0], false_input[1] },
        classify_null,
        false_input,
    );
    const null_input = flow.enter(classify_null);
    const literal_null = flow.block(.segment, .{ Bytes, u32 });
    const classify_number = flow.block(.segment, .{ Bytes, u32, u8 });
    flow.branch(
        flow.integerEqual(null_input[2], flow.constant(u8, context.lower_n_index)),
        literal_null,
        .{ null_input[0], null_input[1] },
        classify_number,
        null_input,
    );
    const number_input = flow.enter(classify_number);
    const number = flow.block(.segment, .{Cursor(Bytes)});
    const number_start = flow.booleanOr(
        flow.integerEqual(number_input[2], flow.constant(u8, context.minus_index)),
        flow.booleanAnd(
            flow.integerGreaterEqual(number_input[2], flow.constant(u8, context.zero_char_index)),
            flow.integerLessEqual(number_input[2], flow.constant(u8, context.nine_char_index)),
        ),
    );
    flow.branch(
        number_start,
        number,
        .{cursor(flow, Bytes, number_input[0], number_input[1])},
        invalid,
        .{},
    );
    const skipped_number = flow.call(helpers.skip_number, .{flow.enter(number)[0]}, .{});
    flow.jump(done, .{skipped_number.value});

    emitLiteral(
        flow,
        Bytes,
        flow.enter(literal_true),
        &.{ context.lower_t_index, context.lower_r_index, context.lower_u_index, context.lower_e_index },
        done,
        invalid,
        context,
    );
    emitLiteral(
        flow,
        Bytes,
        flow.enter(literal_false),
        &.{ context.lower_f_index, context.lower_a_index, context.lower_l_index, context.lower_s_index, context.lower_e_index },
        done,
        invalid,
        context,
    );
    emitLiteral(
        flow,
        Bytes,
        flow.enter(literal_null),
        &.{ context.lower_n_index, context.lower_u_index, context.lower_l_index, context.lower_l_index },
        done,
        invalid,
        context,
    );

    emitObject(flow, Bytes, helpers, flow.enter(object), done, invalid, context);
    emitArray(flow, Bytes, helpers, flow.enter(array), done, invalid, context);

    _ = flow.enter(invalid);
    malformed(flow, context);
    flow.returnToCaller(flow.enter(done)[0]);
}

fn emitLiteral(
    flow: anytype,
    comptime Bytes: type,
    values: anytype,
    comptime expected_indices: []const u16,
    done: anytype,
    invalid: anytype,
    comptime context: anytype,
) void {
    var valid = flow.constant(bool, context.true_index);
    var index = values[1];
    inline for (expected_indices) |constant_index| {
        const byte = flow.bytesByteAt(
            values[0],
            index,
            flow.constant(context.Failure, context.malformed_failure_index),
        );
        valid = flow.booleanAnd(
            valid,
            flow.integerEqual(byte, flow.constant(u8, constant_index)),
        );
        index = flow.integerAddOrFail(
            index,
            flow.constant(u32, context.one_u32_index),
            flow.constant(context.Failure, context.arithmetic_failure_index),
        );
    }
    flow.branch(
        valid,
        done,
        .{cursor(flow, Bytes, values[0], index)},
        invalid,
        .{},
    );
}

fn emitObject(
    flow: anytype,
    comptime Bytes: type,
    helpers: Helpers(@TypeOf(flow.*), Bytes),
    values: anytype,
    done: anytype,
    invalid: anytype,
    comptime context: anytype,
) void {
    const loop = flow.block(.loop_header, .{Cursor(Bytes)});
    flow.jump(loop, .{cursor(
        flow,
        Bytes,
        values[0],
        flow.integerAddOrFail(
            values[1],
            flow.constant(u32, context.one_u32_index),
            flow.constant(context.Failure, context.arithmetic_failure_index),
        ),
    )});
    const current = flow.enter(loop)[0];
    const spaced = flow.call(helpers.skip_whitespace, .{current}, .{});
    const bytes = flow.productExtract(0, spaced.value);
    const index = flow.productExtract(1, spaced.value);
    const byte = flow.bytesByteAt(
        bytes,
        index,
        flow.constant(context.Failure, context.malformed_failure_index),
    );
    const parse_member = flow.block(.segment, .{Cursor(Bytes)});
    flow.branch(
        flow.integerEqual(byte, flow.constant(u8, context.right_brace_index)),
        done,
        .{cursor(
            flow,
            Bytes,
            bytes,
            flow.integerAddOrFail(
                index,
                flow.constant(u32, context.one_u32_index),
                flow.constant(context.Failure, context.arithmetic_failure_index),
            ),
        )},
        parse_member,
        .{spaced.value},
    );
    const key = flow.call(helpers.parse_string, .{flow.enter(parse_member)[0]}, .{});
    const after_key = flow.call(
        helpers.skip_whitespace,
        .{flow.productExtract(0, key.value)},
        .{},
    );
    const colon_bytes = flow.productExtract(0, after_key.value);
    const colon_index = flow.productExtract(1, after_key.value);
    const colon = flow.bytesByteAt(
        colon_bytes,
        colon_index,
        flow.constant(context.Failure, context.malformed_failure_index),
    );
    const parse_value = flow.block(.segment, .{Cursor(Bytes)});
    flow.branch(
        flow.integerEqual(colon, flow.constant(u8, context.colon_index)),
        parse_value,
        .{cursor(
            flow,
            Bytes,
            colon_bytes,
            flow.integerAddOrFail(
                colon_index,
                flow.constant(u32, context.one_u32_index),
                flow.constant(context.Failure, context.arithmetic_failure_index),
            ),
        )},
        invalid,
        .{},
    );
    const value = flow.call(helpers.skip_value, .{flow.enter(parse_value)[0]}, .{});
    const after_value = flow.call(helpers.skip_whitespace, .{value.value}, .{});
    const delimiter_bytes = flow.productExtract(0, after_value.value);
    const delimiter_index = flow.productExtract(1, after_value.value);
    const delimiter = flow.bytesByteAt(
        delimiter_bytes,
        delimiter_index,
        flow.constant(context.Failure, context.malformed_failure_index),
    );
    const comma = flow.block(.segment, .{ Bytes, u32 });
    const classify_close = flow.block(.segment, .{ Bytes, u32, u8 });
    flow.branch(
        flow.integerEqual(delimiter, flow.constant(u8, context.comma_index)),
        comma,
        .{ delimiter_bytes, delimiter_index },
        classify_close,
        .{ delimiter_bytes, delimiter_index, delimiter },
    );
    const close = flow.enter(classify_close);
    flow.branch(
        flow.integerEqual(close[2], flow.constant(u8, context.right_brace_index)),
        done,
        .{cursor(
            flow,
            Bytes,
            close[0],
            flow.integerAddOrFail(
                close[1],
                flow.constant(u32, context.one_u32_index),
                flow.constant(context.Failure, context.arithmetic_failure_index),
            ),
        )},
        invalid,
        .{},
    );
    const next = flow.enter(comma);
    const next_spaced = flow.call(helpers.skip_whitespace, .{cursor(
        flow,
        Bytes,
        next[0],
        flow.integerAddOrFail(
            next[1],
            flow.constant(u32, context.one_u32_index),
            flow.constant(context.Failure, context.arithmetic_failure_index),
        ),
    )}, .{});
    const next_byte = flow.bytesByteAt(
        flow.productExtract(0, next_spaced.value),
        flow.productExtract(1, next_spaced.value),
        flow.constant(context.Failure, context.malformed_failure_index),
    );
    const next_member = flow.block(.segment, .{Cursor(Bytes)});
    flow.branch(
        flow.integerEqual(next_byte, flow.constant(u8, context.right_brace_index)),
        invalid,
        .{},
        next_member,
        .{next_spaced.value},
    );
    flow.jump(loop, flow.enter(next_member));
}

fn emitArray(
    flow: anytype,
    comptime Bytes: type,
    helpers: Helpers(@TypeOf(flow.*), Bytes),
    values: anytype,
    done: anytype,
    invalid: anytype,
    comptime context: anytype,
) void {
    const loop = flow.block(.loop_header, .{Cursor(Bytes)});
    flow.jump(loop, .{cursor(
        flow,
        Bytes,
        values[0],
        flow.integerAddOrFail(
            values[1],
            flow.constant(u32, context.one_u32_index),
            flow.constant(context.Failure, context.arithmetic_failure_index),
        ),
    )});
    const current = flow.enter(loop)[0];
    const spaced = flow.call(helpers.skip_whitespace, .{current}, .{});
    const bytes = flow.productExtract(0, spaced.value);
    const index = flow.productExtract(1, spaced.value);
    const byte = flow.bytesByteAt(
        bytes,
        index,
        flow.constant(context.Failure, context.malformed_failure_index),
    );
    const parse_value = flow.block(.segment, .{Cursor(Bytes)});
    flow.branch(
        flow.integerEqual(byte, flow.constant(u8, context.right_bracket_index)),
        done,
        .{cursor(
            flow,
            Bytes,
            bytes,
            flow.integerAddOrFail(
                index,
                flow.constant(u32, context.one_u32_index),
                flow.constant(context.Failure, context.arithmetic_failure_index),
            ),
        )},
        parse_value,
        .{spaced.value},
    );
    const value = flow.call(helpers.skip_value, .{flow.enter(parse_value)[0]}, .{});
    const after_value = flow.call(helpers.skip_whitespace, .{value.value}, .{});
    const delimiter_bytes = flow.productExtract(0, after_value.value);
    const delimiter_index = flow.productExtract(1, after_value.value);
    const delimiter = flow.bytesByteAt(
        delimiter_bytes,
        delimiter_index,
        flow.constant(context.Failure, context.malformed_failure_index),
    );
    const comma = flow.block(.segment, .{ Bytes, u32 });
    const classify_close = flow.block(.segment, .{ Bytes, u32, u8 });
    flow.branch(
        flow.integerEqual(delimiter, flow.constant(u8, context.comma_index)),
        comma,
        .{ delimiter_bytes, delimiter_index },
        classify_close,
        .{ delimiter_bytes, delimiter_index, delimiter },
    );
    const close = flow.enter(classify_close);
    flow.branch(
        flow.integerEqual(close[2], flow.constant(u8, context.right_bracket_index)),
        done,
        .{cursor(
            flow,
            Bytes,
            close[0],
            flow.integerAddOrFail(
                close[1],
                flow.constant(u32, context.one_u32_index),
                flow.constant(context.Failure, context.arithmetic_failure_index),
            ),
        )},
        invalid,
        .{},
    );
    const next = flow.enter(comma);
    const next_spaced = flow.call(helpers.skip_whitespace, .{cursor(
        flow,
        Bytes,
        next[0],
        flow.integerAddOrFail(
            next[1],
            flow.constant(u32, context.one_u32_index),
            flow.constant(context.Failure, context.arithmetic_failure_index),
        ),
    )}, .{});
    const next_byte = flow.bytesByteAt(
        flow.productExtract(0, next_spaced.value),
        flow.productExtract(1, next_spaced.value),
        flow.constant(context.Failure, context.malformed_failure_index),
    );
    const next_value = flow.block(.segment, .{Cursor(Bytes)});
    flow.branch(
        flow.integerEqual(next_byte, flow.constant(u8, context.right_bracket_index)),
        invalid,
        .{},
        next_value,
        .{next_spaced.value},
    );
    flow.jump(loop, flow.enter(next_value));
}

fn defineUnsigned(
    flow: anytype,
    comptime Bytes: type,
    helpers: Helpers(@TypeOf(flow.*), Bytes),
    comptime context: anytype,
) void {
    const input = flow.enter(helpers.parse_unsigned.entry)[0];
    const leading = flow.call(helpers.skip_whitespace, .{input}, .{});
    const bytes = flow.productExtract(0, leading.value);
    const index = flow.productExtract(1, leading.value);
    const length = flow.bytesLength(bytes);
    const invalid = flow.block(.terminal_handoff, .{});
    const inspect = flow.block(.segment, .{ Bytes, u32, u8 });
    const first = flow.bytesByteAt(
        bytes,
        index,
        flow.constant(context.Failure, context.malformed_failure_index),
    );
    flow.branch(
        flow.integerGreaterEqual(index, length),
        invalid,
        .{},
        inspect,
        .{ bytes, index, first },
    );
    const inspected = flow.enter(inspect);
    const digit = flow.booleanAnd(
        flow.integerGreaterEqual(inspected[2], flow.constant(u8, context.zero_char_index)),
        flow.integerLessEqual(inspected[2], flow.constant(u8, context.nine_char_index)),
    );
    const begin = flow.block(.segment, .{ Bytes, u32, u8 });
    flow.branch(digit, begin, inspected, invalid, .{});
    const beginning = flow.enter(begin);
    const loop = flow.block(.loop_header, .{ Bytes, u32, u64 });
    flow.jump(loop, .{
        beginning[0],
        beginning[1],
        flow.constant(u64, context.zero_u64_index),
    });
    const current = flow.enter(loop);
    const current_length = flow.bytesLength(current[0]);
    const done = flow.block(.segment, .{ Bytes, u32, u64 });
    const read = flow.block(.segment, .{ Bytes, u32, u64 });
    flow.branch(
        flow.integerGreaterEqual(current[1], current_length),
        done,
        current,
        read,
        current,
    );
    const reading = flow.enter(read);
    const byte = flow.bytesByteAt(
        reading[0],
        reading[1],
        flow.constant(context.Failure, context.malformed_failure_index),
    );
    const is_digit = flow.booleanAnd(
        flow.integerGreaterEqual(byte, flow.constant(u8, context.zero_char_index)),
        flow.integerLessEqual(byte, flow.constant(u8, context.nine_char_index)),
    );
    const consume = flow.block(.segment, .{ Bytes, u32, u64, u8 });
    flow.branch(is_digit, consume, .{ reading[0], reading[1], reading[2], byte }, done, reading);
    const consumed = flow.enter(consume);
    const digit_value = flow.integerConvert(u64, flow.integerSubtract(
        consumed[3],
        flow.constant(u8, context.zero_char_index),
    ));
    const accumulated = flow.integerAddOrFail(
        flow.integerMultiplyOrFail(
            consumed[2],
            flow.constant(u64, context.ten_u64_index),
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
    });
    const finished = flow.enter(done);
    flow.returnToCaller(flow.productConstruct(ParsedUnsigned(Bytes), .{
        cursor(flow, Bytes, finished[0], finished[1]),
        finished[2],
    }));
    _ = flow.enter(invalid);
    malformed(flow, context);
}

fn simpleEscapeScalar(
    flow: anytype,
    byte: anytype,
    comptime context: anytype,
) @import("flow.zig").Value(u32) {
    var result = flow.constant(u32, context.invalid_escape_scalar_index);
    inline for (.{
        .{ context.quote_index, context.quote_scalar_index },
        .{ context.backslash_index, context.backslash_scalar_index },
        .{ context.slash_index, context.slash_scalar_index },
        .{ context.lower_b_index, context.backspace_scalar_index },
        .{ context.lower_f_index, context.form_feed_scalar_index },
        .{ context.lower_n_index, context.newline_scalar_index },
        .{ context.lower_r_index, context.carriage_return_scalar_index },
        .{ context.lower_t_index, context.tab_scalar_index },
    }) |mapping| {
        result = flow.select(
            flow.integerEqual(byte, flow.constant(u8, mapping[0])),
            flow.constant(u32, mapping[1]),
            result,
        );
    }
    return result;
}
