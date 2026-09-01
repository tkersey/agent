const agent = @import("agent");
const boundary = @import("boundary");
const std = @import("std");

const Goal = boundary.Text(64);
const Empty = struct {};
const Action = union(enum) { continue_work: Empty };
const Observation = union(enum) { continued: Empty };
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
    pub const Payload = Empty;
    pub const Observation = Empty;

    pub fn emit(flow: anytype, _: anytype, _: anytype) agent.Value(Empty) {
        return flow.productConstruct(Empty, .{});
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
        .protocol = agent.protocol.openaiResponsesV1.Profile,
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
        .request_bytes = 4096,
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
        .schema_types = .{ Goal, Empty, Action, Observation, Failure },
    },
});

const Image = System.Program.image();
const Protocol = agent.protocol.openaiResponsesV1.Contract(4096, 1024);
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

fn encodeResponseResult(
    request: boundary.process_v1.EffectRequest,
    response: Protocol.Response,
    response_output: []u8,
    result_output: []u8,
) ![]const u8 {
    const response_length = try boundary.schema.encode(
        Protocol.Response,
        response,
        response_output,
    );
    return boundary.process_v1.effect.encodeResult(.{
        .request_identity_digest = request.request_identity_digest,
        .resume_schema_digest = request.resume_schema_digest,
        .@"resume" = response_output[0..response_length],
    }, result_output);
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
        agent.protocol.openaiResponsesV1.semantic_identity,
        request.effect_semantic_identity,
    );

    const provider_json =
        "{\"status\":\"completed\",\"error\":null,\"output\":[{" ++
        "\"type\":\"function_call\",\"status\":\"completed\"," ++
        "\"name\":\"continue_work\",\"arguments\":\"{}\"}]}";
    const response_body = try Protocol.ResponseBody.fromSlice(provider_json);
    const response: Protocol.Response = .{ .response = .{
        .http_status = 200,
        .body = response_body,
    } };
    var response_bytes: [boundary.schema.maximumEncodedSize(Protocol.Response)]u8 = undefined;
    const response_length = try boundary.schema.encode(
        Protocol.Response,
        response,
        &response_bytes,
    );
    var result_bytes: [2048]u8 = undefined;
    const effect_result = try boundary.process_v1.effect.encodeResult(.{
        .request_identity_digest = request.request_identity_digest,
        .resume_schema_digest = request.resume_schema_digest,
        .@"resume" = response_bytes[0..response_length],
    }, &result_bytes);

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

const FailureCase = struct {
    body: []const u8,
    status: u16 = 200,
    expected: Failure,
};

fn expectFailureCases(cases: []const FailureCase) !void {
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
    for (cases) |case| {
        var response_output: [boundary.schema.maximumEncodedSize(Protocol.Response)]u8 = undefined;
        var result_output: [2048]u8 = undefined;
        const body = try Protocol.ResponseBody.fromSlice(case.body);
        const result = try encodeResponseResult(
            request,
            .{ .response = .{ .http_status = case.status, .body = body } },
            &response_output,
            &result_output,
        );
        try std.testing.expectEqual(
            case.expected,
            try advanceToFailure(
                pending_state[0..pending.state_len],
                result,
            ),
        );
    }
}

fn expectTransportFailures(
    kinds: []const agent.protocol.openaiResponsesV1.TransportFailureKind,
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
    for (kinds) |kind| {
        var response_output: [boundary.schema.maximumEncodedSize(Protocol.Response)]u8 = undefined;
        var result_output: [2048]u8 = undefined;
        const result = try encodeResponseResult(
            request,
            .{ .transport_failure = .{ .kind = kind } },
            &response_output,
            &result_output,
        );
        try std.testing.expectEqual(
            Failure.transport,
            try advanceToFailure(
                pending_state[0..pending.state_len],
                result,
            ),
        );
    }
}

test "raw provider failures A cannot emit a local action" {
    try expectFailureCases(&[_]FailureCase{
        .{ .body = "{", .expected = .malformed },
        .{
            .body = "{\"status\":\"completed\",\"status\":\"completed\"," ++
                "\"error\":null,\"output\":[]}",
            .expected = .malformed,
        },
        .{
            .body = "{\"status\":\"incomplete\",\"error\":null,\"output\":[" ++
                "{\"type\":\"function_call\",\"status\":\"completed\"," ++
                "\"name\":\"continue_work\",\"arguments\":\"{}\"}]}",
            .expected = .incomplete,
        },
        .{
            .body = "{\"status\":\"completed\",\"error\":{},\"output\":[]}",
            .expected = .response_error,
        },
        .{
            .body = "{\"status\":\"completed\",\"error\":null,\"output\":[" ++
                "{\"type\":\"message\"}]}",
            .expected = .refusal,
        },
    });
}

test "raw provider failures B cannot emit a local action" {
    try expectFailureCases(&[_]FailureCase{
        .{
            .body = "{\"status\":\"completed\",\"error\":null,\"output\":[" ++
                "{\"type\":\"future_action\"}]}",
            .expected = .unsupported,
        },
        .{
            .body = "{\"status\":\"completed\",\"error\":null,\"output\":[" ++
                "{\"type\":\"function_call\",\"status\":\"completed\"," ++
                "\"name\":\"continue_work\",\"arguments\":\"{}\"}," ++
                "{\"type\":\"function_call\",\"status\":\"completed\"," ++
                "\"name\":\"continue_work\",\"arguments\":\"{}\"}]}",
            .expected = .multiple_calls,
        },
        .{
            .body = "{\"status\":\"completed\",\"error\":null,\"output\":[" ++
                "{\"type\":\"function_call\",\"status\":\"completed\"," ++
                "\"name\":\"unknown\",\"arguments\":\"{}\"}]}",
            .expected = .unknown_action,
        },
        .{
            .body = "{\"status\":\"completed\",\"error\":null,\"output\":[" ++
                "{\"type\":\"function_call\",\"status\":\"completed\"," ++
                "\"name\":\"continue_work\",\"arguments\":\"{\\\"extra\\\":1}\"}]}",
            .expected = .malformed,
        },
        .{ .body = "not-json", .status = 500, .expected = .http },
    });
    try expectTransportFailures(&.{ .denied, .response_too_large });
}

test "reordered escaped provider output remains admissible" {
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
    const provider_json =
        " { \"output\" : [ { \"arguments\" : \"{}\", " ++
        "\"name\" : \"continue\\u005fwork\", \"status\" : \"completed\", " ++
        "\"type\" : \"function_call\" } ], \"error\" : null, " ++
        "\"status\" : \"completed\" } ";
    var response_output: [boundary.schema.maximumEncodedSize(Protocol.Response)]u8 = undefined;
    var result_output: [2048]u8 = undefined;
    const result = try encodeResponseResult(
        request,
        .{ .response = .{
            .http_status = 200,
            .body = try Protocol.ResponseBody.fromSlice(provider_json),
        } },
        &response_output,
        &result_output,
    );
    var second_state: [128 * 1024]u8 = undefined;
    var second_request: [64 * 1024]u8 = undefined;
    const second = try advanceToRequest(
        .{ .process_state = first_state[0..first.state_len] },
        result,
        &second_state,
        &second_request,
    );
    try std.testing.expectEqualSlices(
        u8,
        first_state[0..first.state_len],
        second_state[0..second.state_len],
    );
}
