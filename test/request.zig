const agent = @import("agent");
const json = @import("agent_json");
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
    };
};

const Program = boundary.program("staged-openai-request-v1", Body);
const Machine = Program.compile(.{
    .maximum_frames = 8,
    .maximum_state_bytes = 16 * 1024,
    .maximum_machine_fuel = 4096,
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

comptime {
    _ = Observation;
    _ = Result;
}
