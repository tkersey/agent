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

/// Append one dynamic Text value using canonical JSON-string escaping.
pub fn appendEscaped(
    comptime Protocol: type,
    flow: anytype,
    initial_body: @import("flow.zig").Value(Protocol.RequestBody),
    text: anytype,
    comptime context: anytype,
) @import("flow.zig").Value(Protocol.RequestBody) {
    const Text = @TypeOf(text).Type;
    const Body = Protocol.RequestBody;
    const length = flow.textLength(text);
    const done = flow.block(.segment, .{Body});
    const loop = flow.block(.loop_header, .{ Body, Text, u32, u32 });
    const zero = flow.constant(u32, context.zero_index);
    flow.branch(
        flow.integerEqual(length, zero),
        done,
        .{initial_body},
        loop,
        .{ initial_body, text, zero, length },
    );

    const inspecting = flow.enter(loop);
    const byte = flow.textByteAt(
        inspecting[1],
        inspecting[2],
        flow.constant(context.Failure, context.invalid_index_failure_index),
    );
    const capacity_failure = flow.constant(
        context.Failure,
        context.capacity_failure_index,
    );
    const quote = flow.integerEqual(
        byte,
        flow.constant(u8, context.quote_index),
    );
    const backslash = flow.integerEqual(
        byte,
        flow.constant(u8, context.backslash_index),
    );
    const control = flow.booleanNot(
        flow.integerGreaterEqual(
            byte,
            flow.constant(u8, context.control_limit_index),
        ),
    );
    const byte_index = flow.integerConvertOrFail(
        u32,
        byte,
        flow.constant(context.Failure, context.arithmetic_failure_index),
    );
    const control_escape = flow.vectorGetOrFail(
        flow.constant(EscapeTable, context.control_table_index),
        flow.select(
            control,
            byte_index,
            flow.constant(u32, context.zero_index),
        ),
        flow.constant(context.Failure, context.invalid_index_failure_index),
    );
    const short_escape = flow.select(
        quote,
        flow.constant(ShortEscape, context.quote_escape_index),
        flow.constant(ShortEscape, context.backslash_escape_index),
    );
    const short_body = flow.bytesAppendOrFail(
        inspecting[0],
        short_escape,
        capacity_failure,
    );
    const control_body = flow.bytesAppendOrFail(
        inspecting[0],
        control_escape,
        capacity_failure,
    );
    const raw_body = flow.bytesAppendScalarOrFail(
        inspecting[0],
        byte,
        capacity_failure,
    );
    const next_body = flow.select(
        flow.booleanOr(quote, flow.booleanOr(backslash, control)),
        flow.select(control, control_body, short_body),
        raw_body,
    );
    const next_index = flow.integerAddOrFail(
        inspecting[2],
        flow.constant(u32, context.one_index),
        flow.constant(context.Failure, context.arithmetic_failure_index),
    );
    flow.branch(
        flow.integerGreaterEqual(next_index, inspecting[3]),
        done,
        .{next_body},
        loop,
        .{ next_body, inspecting[1], next_index, inspecting[3] },
    );

    return flow.enter(done)[0];
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
    const Body = Protocol.RequestBody;
    var body = flow.bytesEmpty(Body);
    body = flow.bytesAppendOrFail(
        body,
        flow.constant(Parts.Prefix, context.prefix_index),
        flow.constant(context.Failure, context.capacity_failure_index),
    );
    body = appendEscaped(Protocol, flow, body, text, context);
    body = flow.bytesAppendOrFail(
        body,
        flow.constant(Parts.Suffix, context.suffix_index),
        flow.constant(context.Failure, context.capacity_failure_index),
    );
    return flow.productConstruct(Protocol.Request, .{
        body,
        flow.constant(u32, context.maximum_response_bytes_index),
    });
}

/// Render the complete Agent 3 request from image-owned static fragments,
/// dynamic skill activation, one dynamic decision prompt, and the exact
/// offered-action set for this decision.
fn appendActiveFragments(
    comptime Profile: type,
    flow: anytype,
    initial_body: anytype,
    active_mask: @import("flow.zig").Value(u32),
    fragments: @import("flow.zig").Value(Profile.SkillFragmentsType),
    comptime context: anytype,
) @TypeOf(initial_body) {
    const Body = Profile.ProtocolType.RequestBody;
    const Fragments = Profile.SkillFragmentsType;
    const Fragment = Profile.FragmentType;
    const zero = flow.constant(u32, context.zero_u32_index);
    const one = flow.constant(u32, context.one_u32_index);
    const loop = flow.block(.loop_header, .{ Body, u32, Fragments, u32, u32, u32 });
    flow.jump(loop, .{
        initial_body,
        active_mask,
        fragments,
        zero,
        flow.vectorLength(fragments),
        one,
    });
    const state = flow.enter(loop);
    const done = flow.block(.segment, .{Body});
    const append = flow.block(.segment, .{ Body, u32, Fragments, u32, u32, u32 });
    flow.branch(
        flow.integerGreaterEqual(state[3], state[4]),
        done,
        .{state[0]},
        append,
        state,
    );
    const values = flow.enter(append);
    const enabled = flow.integerNotEqual(
        flow.integerBitAnd(values[1], values[5]),
        zero,
    );
    const fragment = flow.vectorGetOrFail(
        values[2],
        values[3],
        flow.constant(context.Failure, context.invalid_index_failure_index),
    );
    const body = flow.bytesAppendOrFail(
        values[0],
        flow.select(enabled, fragment, flow.bytesEmpty(Fragment)),
        flow.constant(context.Failure, context.capacity_failure_index),
    );
    flow.jump(loop, .{
        body,
        values[1],
        values[2],
        flow.integerAddOrFail(
            values[3],
            one,
            flow.constant(context.Failure, context.arithmetic_failure_index),
        ),
        values[4],
        flow.integerAddOrFail(
            values[5],
            values[5],
            flow.constant(context.Failure, context.arithmetic_failure_index),
        ),
    });
    return flow.enter(done)[0];
}

pub fn ToolAppendState(comptime Body: type) type {
    return struct {
        body: Body,
        wrote: bool,
    };
}

fn ToolAppendResult(comptime Body: type) type {
    return struct {
        body: @import("flow.zig").Value(Body),
        wrote: @import("flow.zig").Value(bool),
    };
}

pub fn SystemHelpers(comptime FlowType: type, comptime Profile: type) type {
    const Body = Profile.ProtocolType.RequestBody;
    return struct {
        append_active: FlowType.HelperType(
            .{ Body, u32, Profile.SkillFragmentsType },
            Body,
        ),
        append_tools: FlowType.HelperType(
            .{
                Body,
                u32,
                Profile.ToolFragmentsType,
                Profile.ToolFragmentsType,
            },
            ToolAppendState(Body),
        ),
    };
}

pub fn declareSystem(
    flow: anytype,
    comptime Profile: type,
) SystemHelpers(@TypeOf(flow.*), Profile) {
    const Body = Profile.ProtocolType.RequestBody;
    return .{
        .append_active = flow.helper(
            .{ Body, u32, Profile.SkillFragmentsType },
            Body,
        ),
        .append_tools = flow.helper(
            .{
                Body,
                u32,
                Profile.ToolFragmentsType,
                Profile.ToolFragmentsType,
            },
            ToolAppendState(Body),
        ),
    };
}

pub fn defineSystem(
    flow: anytype,
    comptime Profile: type,
    helpers: SystemHelpers(@TypeOf(flow.*), Profile),
    comptime context: anytype,
) void {
    const active = flow.enter(helpers.append_active.entry);
    flow.returnToCaller(appendActiveFragments(
        Profile,
        flow,
        active[0],
        active[1],
        active[2],
        context,
    ));

    const tools = flow.enter(helpers.append_tools.entry);
    const result = appendOfferedTools(
        Profile,
        flow,
        tools[0],
        tools[1],
        tools[2],
        tools[3],
        context,
    );
    flow.returnToCaller(flow.productConstruct(
        ToolAppendState(Profile.ProtocolType.RequestBody),
        .{ result.body, result.wrote },
    ));
}

fn appendOfferedTools(
    comptime Profile: type,
    flow: anytype,
    initial_body: anytype,
    offered_mask: @import("flow.zig").Value(u32),
    tools: @import("flow.zig").Value(Profile.ToolFragmentsType),
    comma_tools: @import("flow.zig").Value(Profile.ToolFragmentsType),
    comptime context: anytype,
) ToolAppendResult(Profile.ProtocolType.RequestBody) {
    const Body = Profile.ProtocolType.RequestBody;
    const Fragments = Profile.ToolFragmentsType;
    const Fragment = Profile.FragmentType;
    const zero = flow.constant(u32, context.zero_u32_index);
    const one = flow.constant(u32, context.one_u32_index);
    const no = flow.constant(bool, context.false_index);
    const loop = flow.block(.loop_header, .{
        Body,
        u32,
        Fragments,
        Fragments,
        u32,
        u32,
        u32,
        bool,
    });
    flow.jump(loop, .{
        initial_body,
        offered_mask,
        tools,
        comma_tools,
        zero,
        flow.vectorLength(tools),
        one,
        no,
    });
    const state = flow.enter(loop);
    const done = flow.block(.segment, .{ Body, bool });
    const append = flow.block(.segment, .{
        Body,
        u32,
        Fragments,
        Fragments,
        u32,
        u32,
        u32,
        bool,
    });
    flow.branch(
        flow.integerGreaterEqual(state[4], state[5]),
        done,
        .{ state[0], state[7] },
        append,
        state,
    );
    const values = flow.enter(append);
    const enabled = flow.integerNotEqual(
        flow.integerBitAnd(values[1], values[6]),
        zero,
    );
    const first = flow.vectorGetOrFail(
        values[2],
        values[4],
        flow.constant(context.Failure, context.invalid_index_failure_index),
    );
    const subsequent = flow.vectorGetOrFail(
        values[3],
        values[4],
        flow.constant(context.Failure, context.invalid_index_failure_index),
    );
    const selected = flow.select(values[7], subsequent, first);
    const body = flow.bytesAppendOrFail(
        values[0],
        flow.select(enabled, selected, flow.bytesEmpty(Fragment)),
        flow.constant(context.Failure, context.capacity_failure_index),
    );
    flow.jump(loop, .{
        body,
        values[1],
        values[2],
        values[3],
        flow.integerAddOrFail(
            values[4],
            one,
            flow.constant(context.Failure, context.arithmetic_failure_index),
        ),
        values[5],
        flow.integerAddOrFail(
            values[6],
            values[6],
            flow.constant(context.Failure, context.arithmetic_failure_index),
        ),
        flow.booleanOr(values[7], enabled),
    });
    const result = flow.enter(done);
    return .{ .body = result[0], .wrote = result[1] };
}

pub fn emitSystem(
    comptime Profile: type,
    flow: anytype,
    helpers: SystemHelpers(@TypeOf(flow.*), Profile),
    text: anytype,
    active_skills: @import("flow.zig").Value(u32),
    offered_actions: @import("flow.zig").Value(u32),
    comptime context: anytype,
) @import("flow.zig").Value(Profile.ProtocolType.Request) {
    return emitSystemPrompt(
        Profile,
        flow,
        helpers,
        text,
        active_skills,
        offered_actions,
        context,
        false,
    );
}

pub fn emitSystemEscaped(
    comptime Profile: type,
    flow: anytype,
    helpers: SystemHelpers(@TypeOf(flow.*), Profile),
    escaped: anytype,
    active_skills: @import("flow.zig").Value(u32),
    offered_actions: @import("flow.zig").Value(u32),
    comptime context: anytype,
) @import("flow.zig").Value(Profile.ProtocolType.Request) {
    return emitSystemPrompt(
        Profile,
        flow,
        helpers,
        escaped,
        active_skills,
        offered_actions,
        context,
        true,
    );
}

fn emitSystemPrompt(
    comptime Profile: type,
    flow: anytype,
    helpers: SystemHelpers(@TypeOf(flow.*), Profile),
    prompt: anytype,
    active_skills: @import("flow.zig").Value(u32),
    offered_actions: @import("flow.zig").Value(u32),
    comptime context: anytype,
    comptime prompt_is_escaped: bool,
) @import("flow.zig").Value(Profile.ProtocolType.Request) {
    const Protocol = Profile.ProtocolType;
    const Body = Protocol.RequestBody;
    const capacity_failure = flow.constant(context.Failure, context.capacity_failure_index);
    var body = flow.bytesEmpty(Body);
    body = flow.bytesAppendOrFail(
        body,
        flow.constant(Body, context.system_open_index),
        capacity_failure,
    );
    body = flow.call(
        helpers.append_active,
        .{
            body,
            active_skills,
            flow.constant(Profile.SkillFragmentsType, context.skill_before_fragments_index),
        },
        .{},
    ).value;
    body = flow.bytesAppendOrFail(
        body,
        flow.constant(Body, context.user_open_index),
        capacity_failure,
    );
    body = if (prompt_is_escaped)
        flow.bytesAppendOrFail(body, prompt, capacity_failure)
    else
        appendEscaped(Protocol, flow, body, prompt, context);
    body = flow.bytesAppendOrFail(
        body,
        flow.constant(Body, context.user_close_index),
        capacity_failure,
    );
    body = flow.call(
        helpers.append_active,
        .{
            body,
            active_skills,
            flow.constant(Profile.SkillFragmentsType, context.skill_after_fragments_index),
        },
        .{},
    ).value;
    body = flow.bytesAppendOrFail(
        body,
        flow.constant(Body, context.tools_open_index),
        capacity_failure,
    );
    const tools = flow.call(
        helpers.append_tools,
        .{
            body,
            offered_actions,
            flow.constant(Profile.ToolFragmentsType, context.tool_fragments_index),
            flow.constant(Profile.ToolFragmentsType, context.comma_tool_fragments_index),
        },
        .{},
    ).value;
    const complete = flow.block(.segment, .{Body});
    const empty_catalog = flow.block(.terminal_handoff, .{});
    flow.branch(
        flow.productExtract(1, tools),
        complete,
        .{flow.productExtract(0, tools)},
        empty_catalog,
        .{},
    );
    _ = flow.enter(empty_catalog);
    flow.failValue(flow.constant(context.Failure, context.invalid_variant_failure_index));
    const accepted = flow.enter(complete)[0];
    const complete_body = flow.bytesAppendOrFail(
        accepted,
        flow.constant(Body, context.request_end_index),
        capacity_failure,
    );
    return flow.productConstruct(Protocol.Request, .{
        complete_body,
        flow.constant(u32, context.maximum_response_bytes_index),
    });
}
