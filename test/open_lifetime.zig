const agent = @import("agent");
const boundary = @import("boundary");
const std = @import("std");

const Goal = boundary.Text(64);
const Empty = struct {};
const ContinuePayload = struct { delta: i8 };
const Action = union(enum) { continue_work: ContinuePayload };
const Observation = union(enum) { continued: ContinuePayload };
const Failure = enum {
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

const Continue = struct {
    pub const Payload = ContinuePayload;
    pub const Observation = ContinuePayload;

    pub fn emit(flow: anytype, payload: anytype, _: anytype) agent.Value(ContinuePayload) {
        return flow.copy(payload);
    }
};

const OpenEpistemics = struct {
    pub fn MemoryType(comptime _: anytype) type {
        return void;
    }
    pub fn DecisionViewType(comptime _: anytype) type {
        return void;
    }
    pub fn schemaTypes(comptime _: anytype) @TypeOf(.{}) {
        return .{};
    }
    pub fn emitInitial(comptime _: anytype, flow: anytype, _: anytype, comptime context: anytype) agent.Value(void) {
        return flow.constant(void, context.unit_index);
    }
    pub fn emitObserve(comptime _: anytype, flow: anytype, _: anytype, _: anytype, comptime context: anytype) agent.Value(void) {
        return flow.constant(void, context.unit_index);
    }
    pub fn emitProject(comptime _: anytype, flow: anytype, memory: anytype) agent.Value(void) {
        return flow.copy(memory);
    }
    pub fn emitPrompt(comptime _: anytype, _: anytype, goal: anytype, _: anytype, comptime _: anytype) agent.Value(Goal) {
        return goal;
    }
    pub fn emitSkillActive(comptime _: anytype, flow: anytype, _: anytype, comptime _: usize, comptime context: anytype) agent.Value(bool) {
        return flow.constant(bool, context.true_index);
    }
    pub fn emitActionAllowed(comptime _: anytype, flow: anytype, _: anytype, _: anytype, comptime context: anytype) agent.Value(bool) {
        return flow.constant(bool, context.true_index);
    }
    pub fn emitFinalAllowed(comptime _: anytype, flow: anytype, _: anytype, _: anytype, comptime context: anytype) agent.Value(bool) {
        return flow.constant(bool, context.false_index);
    }
};

const System = agent.system(.{
    .name = "open-process-cycle-proof",
    .version = "3.0.0",
    .Goal = Goal,
    .Action = Action,
    .Observation = Observation,
    .Result = Empty,
    .Failure = Failure,
    .models = .{agent.model(.{
        .name = "primary",
        .protocol = agent.protocol.openaiResponsesV2.Profile,
        .model = "fixture-model-v1",
        .parameters = .{},
    })},
    .prompts = .{agent.prompt.literal(.{
        .role = .user,
        .content = "Continue forever.",
    })},
    .skills = .{agent.skill(.{
        .id = "continue",
        .description = "Continue the open process.",
        .instructions = "Select continue_work.",
        .role = .developer,
        .position = .before_user,
        .activation = .always,
        .actions = .{"continue_work"},
    })},
    .actions = .{agent.action.local(
        .continue_work,
        .continued,
        Continue,
        .{
            .name = "continue_work",
            .description = "Continue without changing Memory.",
        },
    )},
    .strategy = agent.strategy.react(.{}),
    .epistemics = agent.epistemics.system(.{
        .semantic_identity = "agent.epistemics.open-cycle.v1",
        .implementation = OpenEpistemics,
    }),
    .failures = .{
        .arithmetic_overflow = Failure.arithmetic_overflow,
        .capacity_exceeded = Failure.capacity_exceeded,
        .invalid_index = Failure.invalid_index,
        .invalid_utf8 = Failure.invalid_utf8,
        .malformed = Failure.malformed,
        .invalid_variant = Failure.invalid_variant,
        .incomplete = Failure.incomplete,
        .response_error = Failure.response_error,
        .unsupported = Failure.unsupported,
        .multiple_calls = Failure.multiple_calls,
        .refusal = Failure.refusal,
        .unknown_action = Failure.unknown_action,
        .transport = Failure.transport,
        .http = Failure.http,
    },
    .representation = .{
        .response_bytes = 1024,
        .image_bytes = 256 * 1024,
        .flow_limits = agent.FlowLimits{
            .maximum_functions = 16,
            .maximum_values = 4096,
            .maximum_blocks = 512,
            .maximum_instructions = 4096,
            .maximum_operands = 8192,
            .maximum_parameters = 4096,
            .maximum_requests = 32,
            .maximum_edge_arguments = 8192,
        },
        .schema_types = .{ Goal, Empty, ContinuePayload, Action, Observation, Failure },
    },
});

const Image = System.Program.image();
const ModelProfile = agent.model_effect.Profile(System.Source, Goal);
const Storage = boundary.process_v1.CapacityStorage(.{
    .input = 512 * 1024,
    .output = 512 * 1024,
    .state = 128 * 1024,
    .value = 64 * 1024,
    .request = 64 * 1024,
    .environment = 128 * 1024,
    .scratch = 2 * 1024 * 1024,
});

const Pending = struct { state_len: usize, request_len: usize };

fn advanceToRequest(
    instance: boundary.process_v1.Instance,
    effect_result: ?[]const u8,
    state_output: []u8,
    request_output: []u8,
) !Pending {
    const allocator = std.testing.allocator;
    const storage = try allocator.create(Storage);
    defer allocator.destroy(storage);
    storage.* = .{};
    const workspace = try allocator.create(boundary.image.ValidationWorkspace);
    defer allocator.destroy(workspace);
    workspace.* = .{};
    var current = instance;
    var result = effect_result;
    for (0..4096) |_| {
        workspace.* = .{};
        const outcome = try storage.advance(
            &Image.bytes,
            current,
            result,
            workspace,
        );
        result = null;
        switch (outcome) {
            .progressed, .explicitly_yielded => |state| {
                if (state.len > state_output.len) return error.StateCapacity;
                @memcpy(state_output[0..state.len], state);
                current = .{ .process_state = state_output[0..state.len] };
            },
            .requested => |requested| {
                if (requested.state.len > state_output.len or
                    requested.request.len > request_output.len)
                {
                    return error.StateCapacity;
                }
                @memcpy(state_output[0..requested.state.len], requested.state);
                @memcpy(request_output[0..requested.request.len], requested.request);
                return .{
                    .state_len = requested.state.len,
                    .request_len = requested.request.len,
                };
            },
            .completed, .authored_failure, .needs_capacity => return error.UnexpectedOutcome,
        }
    }
    return error.DidNotConverge;
}

fn advanceToFailure(
    state: []const u8,
    effect_result: []const u8,
) !Failure {
    const allocator = std.testing.allocator;
    const storage = try allocator.create(Storage);
    defer allocator.destroy(storage);
    storage.* = .{};
    const workspace = try allocator.create(boundary.image.ValidationWorkspace);
    defer allocator.destroy(workspace);
    workspace.* = .{};
    const state_copy = try allocator.alloc(u8, 128 * 1024);
    defer allocator.free(state_copy);
    @memcpy(state_copy[0..state.len], state);
    var current: boundary.process_v1.Instance = .{
        .process_state = state_copy[0..state.len],
    };
    var result: ?[]const u8 = effect_result;
    for (0..4096) |_| {
        workspace.* = .{};
        const outcome = try storage.advance(
            &Image.bytes,
            current,
            result,
            workspace,
        );
        result = null;
        switch (outcome) {
            .progressed, .explicitly_yielded => |next| {
                if (next.len > state_copy.len) return error.StateCapacity;
                @memcpy(state_copy[0..next.len], next);
                current = .{ .process_state = state_copy[0..next.len] };
            },
            .authored_failure => |failure| return boundary.schema.decodeExact(
                Failure,
                failure,
            ),
            .requested, .completed, .needs_capacity => return error.UnexpectedOutcome,
        }
    }
    return error.DidNotConverge;
}

fn encodeModelResult(
    request: boundary.process_v1.EffectRequest,
    response: ModelProfile.ModelResultType,
    response_output: []u8,
    result_output: []u8,
) ![]const u8 {
    const response_length = try boundary.schema.encode(
        ModelProfile.ModelResultType,
        response,
        response_output,
    );
    return boundary.process_v1.effect.encodeResult(.{
        .request_identity_digest = request.request_identity_digest,
        .resume_schema_digest = request.resume_schema_digest,
        .@"resume" = response_output[0..response_length],
    }, result_output);
}

fn outputResult(
    names: []const []const u8,
    arguments: []const []const u8,
) !ModelProfile.ModelResultType {
    if (names.len != arguments.len) return error.InvalidArguments;
    var items = ModelProfile.OutputItemsType.empty();
    for (names, arguments, 0..) |name, argument, index| {
        var call_id_buffer: [32]u8 = undefined;
        const call_id = try std.fmt.bufPrint(&call_id_buffer, "call-{d}", .{index});
        try items.push(.{ .function_call = .{
            .call_id = try ModelProfile.CallIdType.fromSlice(call_id),
            .name = try ModelProfile.ToolNameType.fromSlice(name),
            .arguments_json = try ModelProfile.ArgumentsJsonType.fromSlice(argument),
            .tool_ordinal_claim = 0,
            .decoded_action = decodedAction(argument),
        } });
    }
    return .{ .output = .{
        .items = items,
        .normalized_output_digest = [_]u8{0} ** 32,
    } };
}

fn decodedAction(argument: []const u8) ModelProfile.DecodedActionType {
    if (std.mem.eql(u8, argument, "{}")) return .{ .invalid = .missing_field };
    if (std.mem.eql(u8, argument, "{\"delta\":-128}")) {
        return .{ .decoded = .{ .continue_work = .{ .delta = -128 } } };
    }
    if (std.mem.eql(u8, argument, "{\"delta\":1}") or
        std.mem.eql(u8, argument, "{\"delta\":2}"))
    {
        return .{ .decoded = .{ .continue_work = .{
            .delta = if (std.mem.indexOfScalar(u8, argument, '2') != null) 2 else 1,
        } } };
    }
    if (std.mem.eql(u8, argument, "{\"delta\":1,\"extra\":1}")) {
        return .{ .invalid = .unknown_field };
    }
    return .{ .invalid = .malformed };
}

test "no-final system returns to byte-identical pending State" {
    var initial_args: [boundary.schema.maximumEncodedSize(Goal)]u8 = undefined;
    const initial_length = try boundary.schema.encode(
        Goal,
        try Goal.fromSlice("continue"),
        &initial_args,
    );
    var first_state: [128 * 1024]u8 = undefined;
    var first_request: [64 * 1024]u8 = undefined;
    const first = try advanceToRequest(
        .{ .initial_args = initial_args[0..initial_length] },
        null,
        &first_state,
        &first_request,
    );
    const request = try boundary.process_v1.effect.validateRequest(
        first_request[0..first.request_len],
        Image.program_transition_digest,
    );
    try std.testing.expectEqualStrings(
        agent.model_effect.semantic_identity,
        request.effect_semantic_identity,
    );

    var response_bytes: [
        boundary.schema.maximumEncodedSize(
            ModelProfile.ModelResultType,
        )
    ]u8 = undefined;
    var result_bytes: [128 * 1024]u8 = undefined;
    const response = try outputResult(
        &.{"continue_work"},
        &.{"{\"delta\":-128}"},
    );
    const effect_result = try encodeModelResult(
        request,
        response,
        &response_bytes,
        &result_bytes,
    );

    var second_state: [128 * 1024]u8 = undefined;
    var second_request: [64 * 1024]u8 = undefined;
    const second = try advanceToRequest(
        .{ .process_state = first_state[0..first.state_len] },
        effect_result,
        &second_state,
        &second_request,
    );
    try std.testing.expectEqualSlices(
        u8,
        first_state[0..first.state_len],
        second_state[0..second.state_len],
    );
    try std.testing.expectEqualSlices(
        u8,
        first_request[0..first.request_len],
        second_request[0..second.request_len],
    );
}

fn expectModelFailure(
    model_result: ModelProfile.ModelResultType,
    expected: Failure,
) !void {
    var initial_args: [boundary.schema.maximumEncodedSize(Goal)]u8 = undefined;
    const initial_length = try boundary.schema.encode(
        Goal,
        try Goal.fromSlice("continue"),
        &initial_args,
    );
    var pending_state: [128 * 1024]u8 = undefined;
    var pending_request: [64 * 1024]u8 = undefined;
    const pending = try advanceToRequest(
        .{ .initial_args = initial_args[0..initial_length] },
        null,
        &pending_state,
        &pending_request,
    );
    const request = try boundary.process_v1.effect.validateRequest(
        pending_request[0..pending.request_len],
        Image.program_transition_digest,
    );
    var response_bytes: [
        boundary.schema.maximumEncodedSize(
            ModelProfile.ModelResultType,
        )
    ]u8 = undefined;
    var result_bytes: [128 * 1024]u8 = undefined;
    const encoded = try encodeModelResult(
        request,
        model_result,
        &response_bytes,
        &result_bytes,
    );
    try std.testing.expectEqual(
        expected,
        try advanceToFailure(pending_state[0..pending.state_len], encoded),
    );
}

test "normalized model failures cannot emit a local action" {
    try expectModelFailure(
        .{ .transport_failure = .denied },
        .transport,
    );
    try expectModelFailure(
        .{ .provider_failure = .{
            .kind = .response_incomplete,
            .http_status = 200,
        } },
        .response_error,
    );
    try expectModelFailure(
        .{ .provider_failure = .{
            .kind = .http_status,
            .http_status = 429,
        } },
        .http,
    );
    try expectModelFailure(
        .{ .unsupported_response = .malformed_json },
        .unsupported,
    );
    try expectModelFailure(
        .{ .refusal = try ModelProfile.ResultTextType.fromSlice("refused") },
        .refusal,
    );
}

test "Agent rejects multiple normalized function calls" {
    try expectModelFailure(
        try outputResult(
            &.{ "continue_work", "continue_work" },
            &.{ "{\"delta\":1}", "{\"delta\":2}" },
        ),
        .multiple_calls,
    );
}

test "Agent rejects unknown actions and malformed admitted arguments" {
    try expectModelFailure(
        try outputResult(&.{"unknown"}, &.{"{}"}),
        .unknown_action,
    );
    try expectModelFailure(
        try outputResult(
            &.{"continue_work"},
            &.{"{\"delta\":1,\"extra\":1}"},
        ),
        .malformed,
    );
    try expectModelFailure(
        try outputResult(&.{"continue_work"}, &.{"{}"}),
        .malformed,
    );
}
