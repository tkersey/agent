const agent = @import("agent");
const json = agent.staged_json;
const openai = agent.openai_response;
const request_json = agent.json;
const boundary = @import("boundary");
const std = @import("std");

pub const Input = boundary.Bytes(256);
const Output = boundary.Text(256);
const ParseFailure = enum {
    arithmetic_overflow,
    capacity_exceeded,
    invalid_index,
    invalid_utf8,
    malformed,
    invalid_variant,
    incomplete,
    response_error,
    unsupported,
    multiple_calls,
    refusal,
    unknown_action,
    transport,
    http,
};

const Message = boundary.Text(32);
const SetPayload = struct { value: u8 };
pub const FinishPayload = struct { message: Message };
const Action = union(enum) {
    set: SetPayload,
    finish: FinishPayload,
};
const Observation = union(enum) { set: u8 };
const SetSite = boundary.effect.site(1, "slice.set.v1", SetPayload, u8);
const actions = .{
    agent.action.effect(.set, .set, SetSite, .{
        .name = "set_value",
        .description = "Set one bounded value.",
    }),
    agent.action.final(.finish, .{
        .name = "finish",
        .description = "Return one bounded message.",
    }),
};
pub const Prompt = boundary.Text(64);
pub const Protocol = agent.protocol.openaiResponsesV1.Contract(2048, Input.maximum_length);
const Parts = request_json.RequestParts(Action, actions, "slice-model-v1");
pub const set_response = Input.fromSlice(
    "{\"status\":\"completed\",\"error\":null,\"output\":[" ++
        "{\"arguments\":\"{\\\"value\\\":7}\",\"name\":\"set_value\"," ++
        "\"status\":\"completed\",\"type\":\"function_call\"}]}",
) catch unreachable;
pub const finish_response = Input.fromSlice(
    "{\"output\":[{\"arguments\":\"{\\\"message\\\":\\\"ok\\\"}\"," ++
        "\"name\":\"finish\",\"type\":\"function_call\"," ++
        "\"status\":\"completed\"}],\"error\":null,\"status\":\"completed\"}",
) catch unreachable;
const Seen = agent.action_decode.Seen(Action);

fn seenOne() Seen {
    var result = Seen.empty();
    result.push(false) catch unreachable;
    return result;
}

const Context = struct {
    pub const Failure = ParseFailure;

    pub const arithmetic_failure_index: u16 = 0;
    pub const capacity_failure_index: u16 = 1;
    pub const invalid_index_failure_index: u16 = 2;
    pub const invalid_utf8_failure_index: u16 = 3;
    pub const malformed_failure_index: u16 = 4;

    pub const zero_u32_index: u16 = 5;
    pub const one_u32_index: u16 = 6;
    pub const zero_index: u16 = zero_u32_index;
    pub const one_index: u16 = one_u32_index;
    pub const four_u32_index: u16 = 7;
    pub const ten_u32_index: u16 = 8;
    pub const sixteen_u32_index: u16 = 9;
    pub const sixty_four_u32_index: u16 = 10;
    pub const unicode_max_index: u16 = 11;
    pub const surrogate_min_index: u16 = 12;
    pub const surrogate_max_index: u16 = 13;
    pub const utf8_two_scalar_min_index: u16 = 14;
    pub const utf8_three_scalar_min_index: u16 = 15;
    pub const utf8_four_scalar_min_index: u16 = 16;
    pub const high_surrogate_min_index: u16 = 17;
    pub const high_surrogate_max_index: u16 = 18;
    pub const low_surrogate_min_index: u16 = 19;
    pub const low_surrogate_max_index: u16 = 20;
    pub const surrogate_factor_index: u16 = 21;
    pub const supplementary_base_index: u16 = 22;
    pub const invalid_escape_scalar_index: u16 = 23;
    pub const quote_scalar_index: u16 = 24;
    pub const backslash_scalar_index: u16 = 25;
    pub const slash_scalar_index: u16 = 26;
    pub const backspace_scalar_index: u16 = 27;
    pub const form_feed_scalar_index: u16 = 28;
    pub const newline_scalar_index: u16 = 29;
    pub const carriage_return_scalar_index: u16 = 30;
    pub const tab_scalar_index: u16 = 31;

    pub const space_index: u16 = 32;
    pub const control_limit_index: u16 = space_index;
    pub const tab_index: u16 = 33;
    pub const lf_index: u16 = 34;
    pub const cr_index: u16 = 35;
    pub const zero_char_index: u16 = 36;
    pub const nine_char_index: u16 = 37;
    pub const lower_a_index: u16 = 38;
    pub const lower_f_index: u16 = 39;
    pub const upper_a_index: u16 = 40;
    pub const upper_f_index: u16 = 41;
    pub const utf8_lead_min_index: u16 = 42;
    pub const utf8_two_max_index: u16 = 43;
    pub const utf8_three_max_index: u16 = 44;
    pub const utf8_four_max_index: u16 = 45;
    pub const utf8_two_bias_index: u16 = 46;
    pub const utf8_three_bias_index: u16 = 47;
    pub const utf8_four_bias_index: u16 = 48;
    pub const utf8_continuation_min_index: u16 = 49;
    pub const utf8_continuation_max_index: u16 = 50;
    pub const quote_index: u16 = 51;
    pub const backslash_index: u16 = 52;
    pub const slash_index: u16 = 53;
    pub const ascii_limit_index: u16 = 54;
    pub const lower_u_index: u16 = 55;
    pub const lower_b_index: u16 = 56;
    pub const lower_n_index: u16 = 57;
    pub const lower_r_index: u16 = 58;
    pub const lower_t_index: u16 = 59;
    pub const left_brace_index: u16 = 60;
    pub const right_brace_index: u16 = 61;
    pub const left_bracket_index: u16 = 62;
    pub const right_bracket_index: u16 = 63;
    pub const colon_index: u16 = 64;
    pub const comma_index: u16 = 65;
    pub const minus_index: u16 = 66;
    pub const plus_index: u16 = 67;
    pub const dot_index: u16 = 68;
    pub const lower_e_index: u16 = 69;
    pub const upper_e_index: u16 = 70;
    pub const lower_l_index: u16 = 71;
    pub const lower_s_index: u16 = 72;
    pub const true_index: u16 = 73;
    pub const number_zero_state_index: u16 = 74;
    pub const number_integer_state_index: u16 = 75;
    pub const number_fraction_required_state_index: u16 = 76;
    pub const number_fraction_state_index: u16 = 77;
    pub const number_exponent_start_state_index: u16 = 78;
    pub const number_exponent_sign_state_index: u16 = 79;
    pub const number_exponent_state_index: u16 = 80;
    pub const invalid_variant_failure_index: u16 = 81;
    pub const incomplete_failure_index: u16 = 82;
    pub const response_error_failure_index: u16 = 83;
    pub const unsupported_failure_index: u16 = 84;
    pub const multiple_calls_failure_index: u16 = 85;
    pub const refusal_failure_index: u16 = 86;
    pub const false_index: u16 = 87;
    pub const zero_i8_index: u16 = 88;
    pub const unit_index: u16 = 89;
    pub const empty_text_index: u16 = 90;
    pub const empty_bytes_index: u16 = 91;
    pub const empty_call_index: u16 = 92;
    pub const type_key_index: u16 = 93;
    pub const status_key_index: u16 = 94;
    pub const name_key_index: u16 = 95;
    pub const arguments_key_index: u16 = 96;
    pub const completed_value_index: u16 = 97;
    pub const function_call_value_index: u16 = 98;
    pub const reasoning_value_index: u16 = 99;
    pub const message_value_index: u16 = 100;
    pub const error_key_index: u16 = 101;
    pub const output_key_index: u16 = 102;
    pub const zero_u64_index: u16 = 103;
    pub const ten_u64_index: u16 = 104;
    pub const unknown_action_failure_index: u16 = 105;
    pub const action_name_indices = [2]u16{ 106, 107 };
    pub const payload_default_indices = [2]u16{ 108, 109 };
    pub const seen_indices = [2]u16{ 110, 110 };
    pub const field_name_indices = [2][1]u16{
        .{111},
        .{112},
    };
    pub const field_index_indices = [1]u16{zero_u32_index};
    pub const transport_failure_index: u16 = 113;
    pub const http_failure_index: u16 = 114;
    pub const prefix_index: u16 = 115;
    pub const suffix_index: u16 = 116;
    pub const control_table_index: u16 = 117;
    pub const quote_escape_index: u16 = 118;
    pub const backslash_escape_index: u16 = 119;
    pub const maximum_response_bytes_index: u16 = 120;
    pub const http_ok_index: u16 = 121;
    pub const set_result_index: u16 = 122;
};

fn Lowered() type {
    const Cursor = json.Cursor(Input);
    const ParsedScalar = json.ParsedScalar(Input);
    const ParsedString = json.ParsedString(Input);
    const ParsedUnsigned = json.ParsedUnsigned(Input);
    const Builder = agent.Flow(.{
        .schema_types = .{
            Input,
            Output,
            ParseFailure,
            Cursor,
            ParsedScalar,
            ParsedString,
            ParsedUnsigned,
        },
        .limits = agent.FlowLimits{
            .maximum_functions = 8,
            .maximum_values = 2048,
            .maximum_blocks = 512,
            .maximum_instructions = 4096,
            .maximum_operands = 8192,
            .maximum_parameters = 4096,
            .maximum_requests = 1,
            .maximum_edge_arguments = 8192,
        },
    });
    comptime var flow = Builder.init("agent-staged-json-string-v1");
    const input = flow.begin(Input);
    const helpers = json.declare(&flow, Input);
    const leading = flow.call(
        helpers.skip_whitespace,
        .{flow.productConstruct(Cursor, .{
            input,
            flow.constant(u32, Context.zero_u32_index),
        })},
        .{},
    );
    const parsed = flow.call(
        helpers.parse_string,
        .{leading.value},
        .{},
    );
    const value_skipped = flow.call(
        helpers.skip_value,
        .{leading.value},
        .{flow.productExtract(1, parsed.value)},
    );
    const skipped = flow.call(
        helpers.skip_whitespace,
        .{value_skipped.value},
        value_skipped.carried,
    );
    const trailing = flow.integerNotEqual(
        flow.productExtract(1, skipped.value),
        flow.bytesLength(flow.productExtract(0, skipped.value)),
    );
    const malformed = flow.block(.terminal_handoff, .{});
    const done = flow.block(.segment, .{Output});
    flow.branch(trailing, malformed, .{}, done, skipped.carried);
    _ = flow.enter(malformed);
    flow.failValue(flow.constant(ParseFailure, Context.malformed_failure_index));
    flow.returnValue(flow.enter(done)[0]);
    json.define(&flow, Input, helpers, Context);
    return flow.finish(Output);
}

const Body = struct {
    const Lowering = Lowered();
    pub const InitialArgs = Input;
    pub const Result = Output;
    pub const Failure = ParseFailure;
    pub const constants = .{
        ParseFailure.arithmetic_overflow,
        ParseFailure.capacity_exceeded,
        ParseFailure.invalid_index,
        ParseFailure.invalid_utf8,
        ParseFailure.malformed,
        @as(u32, 0),
        @as(u32, 1),
        @as(u32, 4),
        @as(u32, 10),
        @as(u32, 16),
        @as(u32, 64),
        @as(u32, 0x10ffff),
        @as(u32, 0xd800),
        @as(u32, 0xdfff),
        @as(u32, 0x80),
        @as(u32, 0x800),
        @as(u32, 0x10000),
        @as(u32, 0xd800),
        @as(u32, 0xdbff),
        @as(u32, 0xdc00),
        @as(u32, 0xdfff),
        @as(u32, 0x400),
        @as(u32, 0x10000),
        @as(u32, 0xffffffff),
        @as(u32, '"'),
        @as(u32, '\\'),
        @as(u32, '/'),
        @as(u32, 8),
        @as(u32, 12),
        @as(u32, '\n'),
        @as(u32, '\r'),
        @as(u32, '\t'),
        @as(u8, ' '),
        @as(u8, '\t'),
        @as(u8, '\n'),
        @as(u8, '\r'),
        @as(u8, '0'),
        @as(u8, '9'),
        @as(u8, 'a'),
        @as(u8, 'f'),
        @as(u8, 'A'),
        @as(u8, 'F'),
        @as(u8, 0xc2),
        @as(u8, 0xdf),
        @as(u8, 0xef),
        @as(u8, 0xf4),
        @as(u8, 0xc0),
        @as(u8, 0xe0),
        @as(u8, 0xf0),
        @as(u8, 0x80),
        @as(u8, 0xbf),
        @as(u8, '"'),
        @as(u8, '\\'),
        @as(u8, '/'),
        @as(u8, 0x80),
        @as(u8, 'u'),
        @as(u8, 'b'),
        @as(u8, 'n'),
        @as(u8, 'r'),
        @as(u8, 't'),
        @as(u8, '{'),
        @as(u8, '}'),
        @as(u8, '['),
        @as(u8, ']'),
        @as(u8, ':'),
        @as(u8, ','),
        @as(u8, '-'),
        @as(u8, '+'),
        @as(u8, '.'),
        @as(u8, 'e'),
        @as(u8, 'E'),
        @as(u8, 'l'),
        @as(u8, 's'),
        true,
        @as(u8, 1),
        @as(u8, 2),
        @as(u8, 3),
        @as(u8, 4),
        @as(u8, 5),
        @as(u8, 6),
        @as(u8, 7),
        ParseFailure.invalid_variant,
        ParseFailure.incomplete,
        ParseFailure.response_error,
        ParseFailure.unsupported,
        ParseFailure.multiple_calls,
        ParseFailure.refusal,
        false,
        @as(i8, 0),
        @as(void, {}),
        Output.empty(),
        Input.empty(),
        openai.FunctionCall(Input){
            .name = Output.empty(),
            .arguments = Input.empty(),
        },
        Output.fromSlice("type") catch unreachable,
        Output.fromSlice("status") catch unreachable,
        Output.fromSlice("name") catch unreachable,
        Output.fromSlice("arguments") catch unreachable,
        Output.fromSlice("completed") catch unreachable,
        Output.fromSlice("function_call") catch unreachable,
        Output.fromSlice("reasoning") catch unreachable,
        Output.fromSlice("message") catch unreachable,
        Output.fromSlice("error") catch unreachable,
        Output.fromSlice("output") catch unreachable,
        @as(u64, 0),
        @as(u64, 10),
        ParseFailure.unknown_action,
        Output.fromSlice("set_value") catch unreachable,
        Output.fromSlice("finish") catch unreachable,
        SetPayload{ .value = 0 },
        FinishPayload{ .message = Message.empty() },
        seenOne(),
        Output.fromSlice("value") catch unreachable,
        Output.fromSlice("message") catch unreachable,
        ParseFailure.transport,
        ParseFailure.http,
        Parts.prefix,
        Parts.suffix,
        agent.request.controlEscapes(),
        agent.request.shortEscape('"'),
        agent.request.shortEscape('\\'),
        @as(u32, Input.maximum_length),
        @as(u16, 200),
        FinishPayload{ .message = Message.fromSlice("set") catch unreachable },
    };
    pub const effect_sites = .{};
    pub const schema_types = Lowering.schema_types;
    pub const control_ir = Lowering.control_ir;
    pub const compiler_limits: boundary.ir.CompilerLimits = .{
        .maximum_values = control_ir.value_types.len,
        .maximum_blocks = control_ir.blocks.len,
        .maximum_constructors = 256,
        .maximum_environment_fields = 128,
        .maximum_invariant_terms = 128,
        .maximum_generated_operations = 32_768,
    };
};

const Program = boundary.program("agent-staged-json-string-v1", Body);
const Machine = Program.compile(.{
    .maximum_frames = 16,
    .maximum_state_bytes = 256 * 1024,
    .maximum_machine_fuel = 1_000_000,
});

const ObservedSetEpistemics = struct {
    pub fn MemoryType(comptime _: anytype) type {
        return bool;
    }
    pub fn DecisionViewType(comptime _: anytype) type {
        return bool;
    }
    pub fn schemaTypes(comptime _: anytype) @TypeOf(.{}) {
        return .{};
    }
    pub fn emitInitial(comptime _: anytype, flow: anytype, _: anytype, comptime context: anytype) agent.Value(bool) {
        return flow.constant(bool, context.false_index);
    }
    pub fn emitObserve(comptime _: anytype, flow: anytype, _: anytype, _: anytype, comptime context: anytype) agent.Value(bool) {
        return flow.constant(bool, context.true_index);
    }
    pub fn emitProject(comptime _: anytype, flow: anytype, memory: anytype) agent.Value(bool) {
        return flow.copy(memory);
    }
    pub fn emitPrompt(comptime source: anytype, _: anytype, goal: anytype, _: anytype, comptime _: anytype) agent.Value(source.Goal) {
        return goal;
    }
    pub fn emitActionAllowed(comptime _: anytype, flow: anytype, _: anytype, _: anytype, comptime context: anytype) agent.Value(bool) {
        return flow.constant(bool, context.true_index);
    }
    pub fn emitSkillActive(comptime _: anytype, flow: anytype, _: anytype, comptime _: usize, comptime context: anytype) agent.Value(bool) {
        return flow.constant(bool, context.true_index);
    }
    pub fn emitFinalAllowed(comptime _: anytype, _: anytype, memory: anytype, _: anytype, comptime _: anytype) agent.Value(bool) {
        return memory;
    }
};

pub const ClosedSystem = agent.system(.{
    .name = "closed-turn",
    .version = "3.0.0",
    .Goal = Prompt,
    .Action = Action,
    .Observation = Observation,
    .Result = FinishPayload,
    .Failure = ParseFailure,
    .models = .{agent.model(.{
        .name = "primary",
        .protocol = agent.protocol.openaiResponsesV1.Profile,
        .model = "slice-model-v1",
        .parameters = .{},
    })},
    .prompts = .{agent.prompt.literal(.{
        .role = .user,
        .content = "Act on the supplied task using exactly one offered action.",
    })},
    .skills = .{agent.skill(.{
        .id = "closed-turn-proof",
        .description = "Exercise the closed model and typed action boundary.",
        .instructions = "Select one admitted typed action.",
        .role = .developer,
        .position = .before_user,
        .activation = .always,
        .actions = .{ "set_value", "finish" },
    })},
    .actions = actions,
    .strategy = agent.strategy.react(.{}),
    .epistemics = agent.epistemics.system(.{
        .semantic_identity = "agent.epistemics.observed-set-proof.v1",
        .implementation = ObservedSetEpistemics,
    }),
    .failures = .{
        .arithmetic_overflow = ParseFailure.arithmetic_overflow,
        .capacity_exceeded = ParseFailure.capacity_exceeded,
        .invalid_index = ParseFailure.invalid_index,
        .invalid_utf8 = ParseFailure.invalid_utf8,
        .malformed = ParseFailure.malformed,
        .invalid_variant = ParseFailure.invalid_variant,
        .incomplete = ParseFailure.incomplete,
        .response_error = ParseFailure.response_error,
        .unsupported = ParseFailure.unsupported,
        .multiple_calls = ParseFailure.multiple_calls,
        .refusal = ParseFailure.refusal,
        .unknown_action = ParseFailure.unknown_action,
        .transport = ParseFailure.transport,
        .http = ParseFailure.http,
    },
    .representation = .{
        .request_bytes = 2048,
        .response_bytes = Input.maximum_length,
        .flow_limits = agent.FlowLimits{
            .maximum_functions = 16,
            .maximum_values = 5000,
            .maximum_blocks = 320,
            .maximum_instructions = 4096,
            .maximum_operands = 8192,
            .maximum_parameters = 4096,
            .maximum_requests = 32,
            .maximum_edge_arguments = 8192,
        },
        .schema_types = .{
            Prompt,
            Action,
            Observation,
            FinishPayload,
            ParseFailure,
            SetPayload,
            Message,
        },
    },
});

pub const OpenAIProgram = ClosedSystem.Program;

fn expectParsed(source: []const u8, expected: []const u8) !void {
    const state = try Machine.initialState(
        std.testing.allocator,
        try Input.fromSlice(source),
    );
    defer Machine.deinitState(state);
    var fuel: u64 = 1_000_000;
    const done = for (0..4096) |_| {
        switch (try Machine.step(state, &fuel)) {
            .done => |value| break value,
            .yielded => fuel = 1_000_000,
            .failed => |failure| {
                std.debug.print("unexpected parser failure: {any}\n", .{failure});
                return error.UnexpectedMachineOutcome;
            },
            else => return error.UnexpectedMachineOutcome,
        }
    } else return error.ParserDidNotConverge;
    defer done.deinit();
    try std.testing.expectEqualStrings(expected, try done.value().slice());
}

fn expectMalformed(source: []const u8) !void {
    const state = try Machine.initialState(
        std.testing.allocator,
        try Input.fromSlice(source),
    );
    defer Machine.deinitState(state);
    var fuel: u64 = 1_000_000;
    for (0..4096) |_| {
        switch (try Machine.step(state, &fuel)) {
            .failed => |failure| switch (failure) {
                .authored => |value| {
                    try std.testing.expectEqual(ParseFailure.malformed, value);
                    return;
                },
                else => return error.UnexpectedMachineOutcome,
            },
            .yielded => fuel = 1_000_000,
            else => return error.UnexpectedMachineOutcome,
        }
    }
    return error.ParserDidNotConverge;
}

test "staged JSON string parser decodes escapes and UTF-8" {
    try expectParsed("\"plain\"", "plain");
    try expectParsed("\"quote=\\\"\"", "quote=\"");
    try expectParsed("\"line=\\n\"", "line=\n");
    try expectParsed("\"latin=\\u00e9\"", "latin=é");
    try expectParsed("\"emoji=\\ud83d\\ude00\"", "emoji=😀");
    try expectParsed("\"raw=é\"", "raw=é");
    try expectParsed(
        "  \"quote=\\\" slash=\\/ line=\\n latin=\\u00e9 emoji=\\ud83d\\ude00 raw=é\" \n",
        "quote=\" slash=/ line=\n latin=é emoji=😀 raw=é",
    );
}

test "staged JSON string parser rejects malformed encodings" {
    try expectMalformed("\"\\ud800\"");
    try expectMalformed("\"\\udc00\"");
    try expectMalformed("\"\\u12x4\"");
    try expectMalformed("\"line\nbreak\"");
    try expectMalformed("\"trailing\" x");
    try expectMalformed(&.{ '"', 0xc0, 0x80, '"' });
}
