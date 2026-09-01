const boundary = @import("boundary");

pub const EscapeBytes = boundary.Bytes(6);
pub const EscapeTable = boundary.Vector(EscapeBytes, 32);
pub const ShortEscape = boundary.Bytes(2);

pub fn controlEscapes() EscapeTable {
    var table = EscapeTable.empty();
    const hex = "0123456789abcdef";
    for (0..32) |value| {
        const encoded = [_]u8{
            '\\',
            'u',
            '0',
            '0',
            hex[value >> 4],
            hex[value & 0x0f],
        };
        table.push(EscapeBytes.fromSlice(&encoded) catch unreachable) catch
            unreachable;
    }
    return table;
}

pub fn shortEscape(comptime byte: u8) ShortEscape {
    return ShortEscape.fromSlice(&.{ '\\', byte }) catch unreachable;
}

/// Render one complete request envelope around a dynamic Text prompt. The
/// caller owns constant indexes and exact authored failure values.
pub fn emit(
    comptime Parts: type,
    comptime Protocol: type,
    flow: anytype,
    text: anytype,
    comptime context: anytype,
) @import("flow.zig").Value(Protocol.Request) {
    const Text = @TypeOf(text).Type;
    const Body = Protocol.RequestBody;
    var body = flow.bytesEmpty(Body);
    body = flow.bytesAppendOrFail(
        body,
        flow.constant(Parts.Prefix, context.prefix_index),
        flow.constant(context.Failure, context.capacity_failure_index),
    );
    const length = flow.textLength(text);
    const loop = flow.block(.loop_header, .{ Body, Text, u32, u32 });
    flow.jump(loop, .{
        body,
        text,
        flow.constant(u32, context.zero_index),
        length,
    });

    const state = flow.enter(loop);
    const done = flow.block(.segment, .{Body});
    const inspect = flow.block(.segment, .{ Body, Text, u32, u32 });
    flow.branch(
        flow.integerGreaterEqual(state[2], state[3]),
        done,
        .{state[0]},
        inspect,
        state,
    );

    const inspecting = flow.enter(inspect);
    const byte = flow.textByteAt(
        inspecting[1],
        inspecting[2],
        flow.constant(context.Failure, context.invalid_index_failure_index),
    );
    const quote = flow.block(.segment, .{ Body, Text, u32, u32 });
    const classify_backslash = flow.block(.segment, .{ Body, u8, Text, u32, u32 });
    flow.branch(
        flow.integerEqual(byte, flow.constant(u8, context.quote_index)),
        quote,
        .{ inspecting[0], inspecting[1], inspecting[2], inspecting[3] },
        classify_backslash,
        .{ inspecting[0], byte, inspecting[1], inspecting[2], inspecting[3] },
    );

    const next = flow.block(.segment, .{ Body, Text, u32, u32 });
    const quote_state = flow.enter(quote);
    flow.jump(next, .{
        flow.bytesAppendOrFail(
            quote_state[0],
            flow.constant(ShortEscape, context.quote_escape_index),
            flow.constant(context.Failure, context.capacity_failure_index),
        ),
        quote_state[1],
        quote_state[2],
        quote_state[3],
    });

    const backslash_state = flow.enter(classify_backslash);
    const backslash = flow.block(.segment, .{ Body, Text, u32, u32 });
    const classify_control = flow.block(.segment, .{ Body, u8, Text, u32, u32 });
    flow.branch(
        flow.integerEqual(
            backslash_state[1],
            flow.constant(u8, context.backslash_index),
        ),
        backslash,
        .{ backslash_state[0], backslash_state[2], backslash_state[3], backslash_state[4] },
        classify_control,
        backslash_state,
    );

    const backslash_output = flow.enter(backslash);
    flow.jump(next, .{
        flow.bytesAppendOrFail(
            backslash_output[0],
            flow.constant(ShortEscape, context.backslash_escape_index),
            flow.constant(context.Failure, context.capacity_failure_index),
        ),
        backslash_output[1],
        backslash_output[2],
        backslash_output[3],
    });

    const control_state = flow.enter(classify_control);
    const control = flow.block(.segment, .{ Body, u8, Text, u32, u32 });
    const raw = flow.block(.segment, .{ Body, u8, Text, u32, u32 });
    flow.branch(
        flow.booleanNot(flow.integerGreaterEqual(
            control_state[1],
            flow.constant(u8, context.control_limit_index),
        )),
        control,
        control_state,
        raw,
        control_state,
    );

    const control_output = flow.enter(control);
    const control_escape = flow.vectorGetOrFail(
        flow.constant(EscapeTable, context.control_table_index),
        flow.integerConvertOrFail(
            u32,
            control_output[1],
            flow.constant(context.Failure, context.arithmetic_failure_index),
        ),
        flow.constant(context.Failure, context.invalid_index_failure_index),
    );
    flow.jump(next, .{
        flow.bytesAppendOrFail(
            control_output[0],
            control_escape,
            flow.constant(context.Failure, context.capacity_failure_index),
        ),
        control_output[2],
        control_output[3],
        control_output[4],
    });

    const raw_output = flow.enter(raw);
    flow.jump(next, .{
        flow.bytesAppendScalarOrFail(
            raw_output[0],
            raw_output[1],
            flow.constant(context.Failure, context.capacity_failure_index),
        ),
        raw_output[2],
        raw_output[3],
        raw_output[4],
    });

    const next_state = flow.enter(next);
    flow.jump(loop, .{
        next_state[0],
        next_state[1],
        flow.integerAddOrFail(
            next_state[2],
            flow.constant(u32, context.one_index),
            flow.constant(context.Failure, context.arithmetic_failure_index),
        ),
        next_state[3],
    });

    const completed = flow.enter(done)[0];
    const complete_body = flow.bytesAppendOrFail(
        completed,
        flow.constant(Parts.Suffix, context.suffix_index),
        flow.constant(context.Failure, context.capacity_failure_index),
    );
    return flow.productConstruct(Protocol.Request, .{
        complete_body,
        flow.constant(u32, context.maximum_response_bytes_index),
    });
}
