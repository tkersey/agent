const agent = @import("agent");
const json = agent.json;
const request = agent.request;
const boundary = @import("boundary");
const std = @import("std");

const Goal = boundary.Text(64);
const Message = boundary.Text(32);
const SetPayload = struct { value: u8 };
const FinishPayload = struct { message: Message };
const Action = union(enum) {
    set: SetPayload,
    finish: FinishPayload,
};
const Observation = union(enum) { set: u8 };
const Result = FinishPayload;
const Failure = enum {
    arithmetic,
    capacity,
    invalid_index,
};
const SliceFailure = Failure;
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
const Protocol = agent.protocol.openaiResponsesV1.Contract(4096, 2048);
const Parts = json.RequestParts(Action, actions, "slice-model-v1");

const Context = struct {
    pub const Failure = SliceFailure;
    pub const prefix_index: u16 = 0;
    pub const suffix_index: u16 = 1;
    pub const control_table_index: u16 = 2;
    pub const quote_escape_index: u16 = 3;
    pub const backslash_escape_index: u16 = 4;
    pub const zero_index: u16 = 5;
    pub const one_index: u16 = 6;
    pub const quote_index: u16 = 7;
    pub const backslash_index: u16 = 8;
    pub const control_limit_index: u16 = 9;
    pub const arithmetic_failure_index: u16 = 10;
    pub const capacity_failure_index: u16 = 11;
    pub const invalid_index_failure_index: u16 = 12;
    pub const maximum_response_bytes_index: u16 = 13;
};

fn Lowered() type {
    const Builder = agent.Flow(.{
        .schema_types = .{
            Goal,
            Protocol.Request,
            Protocol.RequestBody,
            Parts.Prefix,
            Parts.Suffix,
            request.EscapeBytes,
            request.EscapeTable,
            request.ShortEscape,
            Failure,
        },
        .limits = agent.FlowLimits{
            .maximum_values = 256,
            .maximum_blocks = 64,
            .maximum_instructions = 256,
            .maximum_operands = 512,
            .maximum_parameters = 256,
            .maximum_requests = 8,
            .maximum_edge_arguments = 512,
        },
    });
    comptime var flow = Builder.init("staged-openai-request-v1");
    const goal = flow.begin(Goal);
    flow.returnValue(request.emit(Parts, Protocol, &flow, goal, Context));
    return flow.finish(Protocol.Request);
}

const Body = struct {
    const Lowering = Lowered();
    pub const InitialArgs = Goal;
    pub const Result = Protocol.Request;
    pub const Failure = SliceFailure;
    pub const constants = .{
        Parts.prefix,
        Parts.suffix,
        request.controlEscapes(),
        request.shortEscape('"'),
        request.shortEscape('\\'),
        @as(u32, 0),
        @as(u32, 1),
        @as(u8, '"'),
        @as(u8, '\\'),
        @as(u8, 32),
        SliceFailure.arithmetic,
        SliceFailure.capacity,
        SliceFailure.invalid_index,
        @as(u32, 2048),
    };
    pub const effect_sites = boundary.effect.row(.{});
    pub const schema_types = Lowering.schema_types;
    pub const control_ir = Lowering.control_ir;
    pub const compiler_limits: boundary.ir.CompilerLimits = .{
        .maximum_values = control_ir.value_types.len,
        .maximum_blocks = control_ir.blocks.len,
        .maximum_invariant_terms = 128,
        .maximum_generated_operations = 32_768,
    };
};

const Program = boundary.program("staged-openai-request-v1", Body);
const Machine = Program.compile(.{
    .maximum_frames = 8,
    .maximum_state_bytes = 16 * 1024,
    .maximum_machine_fuel = 4096,
});

const DynamicFailure = enum {
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
const dynamic_failures = .{
    .arithmetic_overflow = DynamicFailure.arithmetic_overflow,
    .capacity_exceeded = DynamicFailure.capacity_exceeded,
    .invalid_index = DynamicFailure.invalid_index,
    .invalid_utf8 = DynamicFailure.invalid_utf8,
    .malformed = DynamicFailure.malformed,
    .invalid_variant = DynamicFailure.invalid_variant,
    .incomplete = DynamicFailure.incomplete,
    .response_error = DynamicFailure.response_error,
    .unsupported = DynamicFailure.unsupported,
    .multiple_calls = DynamicFailure.multiple_calls,
    .refusal = DynamicFailure.refusal,
    .unknown_action = DynamicFailure.unknown_action,
    .transport = DynamicFailure.transport,
    .http = DynamicFailure.http,
};
const dynamic_prompts = .{agent.prompt.literal(.{
    .role = .system,
    .content = "Static system instruction.",
})};
const dynamic_skills = .{
    agent.skill(.{
        .id = "always-skill",
        .description = "Always visible.",
        .instructions = "Always skill instruction.",
        .role = .developer,
        .position = .before_user,
        .activation = .always,
        .actions = .{"set_value"},
    }),
    agent.skill(.{
        .id = "conditional-skill",
        .description = "Conditionally visible.",
        .instructions = "Conditional skill instruction.",
        .role = .developer,
        .position = .after_user,
        .activation = .conditional,
        .actions = .{"finish"},
    }),
};
const DynamicBytes = boundary.Bytes(2048);
const DynamicProfile = agent.openai_profile.Profile(
    DynamicFailure,
    DynamicBytes,
    Action,
    actions,
    "dynamic-model-v1",
    dynamic_prompts,
    dynamic_skills,
    dynamic_failures,
    4096,
);
const DynamicProtocol = DynamicProfile.ProtocolType;
const DynamicInput = struct {
    goal: Goal,
    conditional: bool,
};

fn DynamicLowered() type {
    const Builder = agent.Flow(.{
        .schema_types = .{ DynamicInput, Goal, Action, DynamicFailure } ++
            DynamicProfile.schemaTypes(),
        .limits = agent.FlowLimits{
            .maximum_values = 512,
            .maximum_blocks = 96,
            .maximum_instructions = 512,
            .maximum_operands = 1024,
            .maximum_parameters = 512,
            .maximum_requests = 8,
            .maximum_edge_arguments = 1024,
        },
    });
    comptime var flow = Builder.init("dynamic-system-request-v1");
    const input = flow.begin(DynamicInput);
    const helpers = request.declareSystem(&flow, DynamicProfile);
    const active = [2]agent.Value(bool){
        flow.constant(bool, DynamicProfile.Context.true_index),
        flow.productExtract(1, input),
    };
    const offered = [2]agent.Value(bool){ active[0], active[1] };
    const zero = flow.constant(u32, DynamicProfile.Context.zero_u32_index);
    const one = flow.constant(u32, DynamicProfile.Context.one_u32_index);
    const two = flow.integerAdd(one, one);
    const active_mask = flow.integerBitOr(one, flow.select(active[1], two, zero));
    const offered_mask = flow.integerBitOr(one, flow.select(offered[1], two, zero));
    flow.returnValue(request.emitSystem(
        DynamicProfile,
        &flow,
        helpers,
        flow.productExtract(0, input),
        active_mask,
        offered_mask,
        DynamicProfile.Context,
    ));
    request.defineSystem(&flow, DynamicProfile, helpers, DynamicProfile.Context);
    return flow.finish(DynamicProtocol.Request);
}

const DynamicBody = struct {
    const Lowering = DynamicLowered();
    pub const InitialArgs = DynamicInput;
    pub const Result = DynamicProtocol.Request;
    pub const Failure = DynamicFailure;
    pub const constants = DynamicProfile.constantValues();
    pub const effect_sites = boundary.effect.row(.{});
    pub const schema_types = Lowering.schema_types;
    pub const control_ir = Lowering.control_ir;
    pub const compiler_limits: boundary.ir.CompilerLimits = .{
        .maximum_values = 512,
        .maximum_blocks = control_ir.blocks.len,
        .maximum_invariant_terms = 128,
        .maximum_generated_operations = 32_768,
    };
};
const DynamicMachine = boundary.program(
    "dynamic-system-request-v1",
    DynamicBody,
).compile(.{
    .maximum_frames = 8,
    .maximum_state_bytes = 32 * 1024,
    .maximum_machine_fuel = 8192,
});

test "dynamic prompt escaping is image computation" {
    try std.testing.expectEqual(
        boundary.image.evaluator_semantics_v3,
        Program.image().evaluator_semantics_version,
    );
    const goal = Goal.fromSlice("quote=\" slash=\\ line=\n utf8=é") catch unreachable;
    const state = try Machine.initialState(std.testing.allocator, goal);
    defer Machine.deinitState(state);
    var fuel: u64 = 4096;
    const done = switch (try Machine.step(state, &fuel)) {
        .done => |value| value,
        else => return error.UnexpectedMachineStep,
    };
    defer done.deinit();
    const rendered = try done.value().body.slice();
    const prefix = try Parts.prefix.slice();
    const suffix = try Parts.suffix.slice();
    try std.testing.expect(std.mem.startsWith(u8, rendered, prefix));
    try std.testing.expect(std.mem.endsWith(u8, rendered, suffix));
    try std.testing.expectEqualStrings(
        "quote=\\\" slash=\\\\ line=\\u000a utf8=é",
        rendered[prefix.len .. rendered.len - suffix.len],
    );
    try std.testing.expectEqual(@as(u32, 2048), done.value().maximum_response_bytes);
}

fn renderDynamic(conditional: bool) ![]const u8 {
    const state = try DynamicMachine.initialState(std.testing.allocator, .{
        .goal = Goal.fromSlice("dynamic task") catch unreachable,
        .conditional = conditional,
    });
    defer DynamicMachine.deinitState(state);
    var fuel: u64 = 8192;
    const done = switch (try DynamicMachine.step(state, &fuel)) {
        .done => |value| value,
        else => return error.UnexpectedMachineStep,
    };
    defer done.deinit();
    return std.testing.allocator.dupe(u8, try done.value().body.slice());
}

test "active skills determine prompt content and exact offered tools" {
    const before = try renderDynamic(false);
    defer std.testing.allocator.free(before);
    try std.testing.expect(std.mem.indexOf(u8, before, "Always skill instruction.") != null);
    try std.testing.expect(std.mem.indexOf(u8, before, "Conditional skill instruction.") == null);
    try std.testing.expect(std.mem.indexOf(u8, before, "\"name\":\"set_value\"") != null);
    try std.testing.expect(std.mem.indexOf(u8, before, "\"name\":\"finish\"") == null);

    const after = try renderDynamic(true);
    defer std.testing.allocator.free(after);
    try std.testing.expect(std.mem.indexOf(u8, after, "Always skill instruction.") != null);
    try std.testing.expect(std.mem.indexOf(u8, after, "Conditional skill instruction.") != null);
    try std.testing.expect(std.mem.indexOf(u8, after, "\"name\":\"set_value\"") != null);
    try std.testing.expect(std.mem.indexOf(u8, after, "\"name\":\"finish\"") != null);
    try std.testing.expect(std.mem.indexOf(u8, after, "dynamic task") != null);
}

comptime {
    _ = Observation;
    _ = Result;
}
