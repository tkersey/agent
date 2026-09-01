const agent = @import("agent");
const boundary = @import("boundary");
const std = @import("std");

const Action = union(enum) { done: u32 };
const Observation = union(enum) { noop: void };
const SystemFailure = enum { rejected };
const actions = .{agent.action.final(.done, .{
    .name = "done",
    .description = "Return the exact result.",
})};

const Body = struct {
    pub const InitialArgs = u32;
    pub const Result = u32;
    pub const Failure = SystemFailure;
    pub const constants = .{};
    pub const effect_sites = .{};
    pub const schema_types = .{SystemFailure};
    pub const control_ir: boundary.ir.Program = .{
        .label = "agent-system-api-v1",
        .value_types = &.{.{ .scalar = .u32 }},
        .blocks = &.{.{
            .id = 0,
            .parameters = &.{0},
            .terminator = .{ .return_value = 0 },
        }},
        .entry = 0,
        .result_type = .{ .scalar = .u32 },
    };
};

const Implementation = struct {
    pub fn ProgramBody(comptime _: anytype) type {
        return Body;
    }
};

const System = agent.system(.{
    .name = "system-api-proof",
    .version = "3.0.0",
    .Goal = u32,
    .Action = Action,
    .Observation = Observation,
    .Result = u32,
    .Failure = SystemFailure,
    .models = .{agent.model(.{
        .name = "primary",
        .protocol = agent.protocol.openaiResponsesV1.Profile,
        .model = "test-model",
    })},
    .prompts = .{agent.prompt.literal(.{
        .role = .user,
        .content = "Return the input.",
    })},
    .skills = .{},
    .actions = actions,
    .strategy = agent.strategy.staged(.{
        .semantic_identity = "agent.strategy.system-api-proof.v1",
        .implementation = Implementation,
    }),
    .epistemics = struct {},
    .failures = .{},
    .representation = .{},
});

test "agent.system returns one ordinary unspecialized Boundary Program" {
    try std.testing.expect(System.InitialArgs == u32);
    try std.testing.expect(System.Result == u32);
    try std.testing.expect(@hasDecl(System, "Program"));
    try std.testing.expect(!@hasDecl(System, "Machine"));
    try std.testing.expect(System.Program.image().bytes.len > 0);
}

const ProfileFailure = enum {
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
const ProfileText = boundary.Text(32);
const ProfileAction = union(enum) {
    set: struct { value: u8 },
    finish: struct { message: ProfileText },
};
const ProfileActions = .{
    agent.action.final(.set, .{ .name = "set_value", .description = "Set." }),
    agent.action.final(.finish, .{ .name = "finish", .description = "Finish." }),
};
const ProfileModels = .{agent.model(.{
    .name = "primary",
    .protocol = agent.protocol.openaiResponsesV1.Profile,
    .model = "test-model",
    .parameters = .{},
})};
const Profile = agent.openai_profile.Profile(
    ProfileFailure,
    boundary.Bytes(256),
    ProfileAction,
    ProfileActions,
    ProfileModels,
    .{},
    .{},
    .{
        .arithmetic_overflow = ProfileFailure.arithmetic_overflow,
        .capacity_exceeded = ProfileFailure.capacity_exceeded,
        .invalid_index = ProfileFailure.invalid_index,
        .invalid_utf8 = ProfileFailure.invalid_utf8,
        .malformed = ProfileFailure.malformed,
        .invalid_variant = ProfileFailure.invalid_variant,
        .incomplete = ProfileFailure.incomplete,
        .response_error = ProfileFailure.response_error,
        .unsupported = ProfileFailure.unsupported,
        .multiple_calls = ProfileFailure.multiple_calls,
        .refusal = ProfileFailure.refusal,
        .unknown_action = ProfileFailure.unknown_action,
        .transport = ProfileFailure.transport,
        .http = ProfileFailure.http,
    },
    2048,
);

test "OpenAI profile derives action and field constants from one algebra" {
    const values = comptime Profile.constantValues();
    try std.testing.expectEqualStrings(
        "set_value",
        try values[Profile.Context.action_name_indices[0]].slice(),
    );
    try std.testing.expectEqualStrings(
        "message",
        try values[Profile.Context.field_name_indices[1][0]].slice(),
    );
    try std.testing.expectEqual(@as(u8, 0), values[
        Profile.Context.payload_default_indices[0]
    ].value);
    try std.testing.expectEqual(@as(u32, 1), try values[
        Profile.Context.seen_indices[1]
    ].len());
}

const AlternateGoal = boundary.Text(64);
const AlternateResult = struct { answer: AlternateGoal };
const AlternateAction = union(enum) { done: AlternateResult };
const AlternateObservation = union(enum) { noop: void };
const AlternateFailure = enum {
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
const alternate_actions = .{agent.action.final(.done, .{
    .name = "done",
    .description = "Return the exact bounded answer.",
})};
const alternate_models = .{agent.model(.{
    .name = "primary",
    .protocol = agent.protocol.openaiResponsesV1.Profile,
    .model = "alternate-model-v1",
    .parameters = .{},
})};
const alternate_prompts = .{agent.prompt.literal(.{
    .role = .system,
    .content = "Return the requested bounded answer.",
})};
const alternate_skills = .{agent.skill(.{
    .id = "completion",
    .description = "Complete the bounded task.",
    .instructions = "Call done with the requested answer.",
    .role = .developer,
    .position = .before_user,
    .activation = .always,
    .actions = .{"done"},
})};
const alternate_failures = .{
    .arithmetic_overflow = AlternateFailure.arithmetic_overflow,
    .capacity_exceeded = AlternateFailure.capacity_exceeded,
    .invalid_index = AlternateFailure.invalid_index,
    .invalid_utf8 = AlternateFailure.invalid_utf8,
    .malformed = AlternateFailure.malformed,
    .invalid_variant = AlternateFailure.invalid_variant,
    .incomplete = AlternateFailure.incomplete,
    .response_error = AlternateFailure.response_error,
    .unsupported = AlternateFailure.unsupported,
    .multiple_calls = AlternateFailure.multiple_calls,
    .refusal = AlternateFailure.refusal,
    .unknown_action = AlternateFailure.unknown_action,
    .transport = AlternateFailure.transport,
    .http = AlternateFailure.http,
};
const alternate_representation = .{
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
    .schema_types = .{ AlternateGoal, AlternateResult, AlternateAction, AlternateObservation, AlternateFailure },
};

fn AlternateStagedBody() type {
    const Builder = agent.Flow(.{
        .schema_types = .{ AlternateGoal, AlternateResult, AlternateFailure },
        .limits = agent.FlowLimits{
            .maximum_values = 8,
            .maximum_blocks = 4,
            .maximum_instructions = 8,
            .maximum_operands = 8,
            .maximum_parameters = 8,
            .maximum_requests = 1,
            .maximum_edge_arguments = 8,
        },
    });
    comptime var flow = Builder.init("alternate-system-staged-v1");
    const goal = flow.begin(AlternateGoal);
    flow.returnValue(flow.productConstruct(AlternateResult, .{goal}));
    const Lowering = flow.finish(AlternateResult);
    return struct {
        pub const InitialArgs = AlternateGoal;
        pub const Result = AlternateResult;
        pub const Failure = AlternateFailure;
        pub const constants = .{};
        pub const effect_sites = boundary.effect.row(.{});
        pub const schema_types = Lowering.schema_types;
        pub const control_ir = Lowering.control_ir;
    };
}

const AlternateImplementation = struct {
    pub fn ProgramBody(comptime _: anytype) type {
        return AlternateStagedBody();
    }
};

fn alternateSystem(comptime Strategy: type) type {
    return agent.system(.{
        .name = "alternate-system-proof",
        .version = "3.0.0",
        .Goal = AlternateGoal,
        .Action = AlternateAction,
        .Observation = AlternateObservation,
        .Result = AlternateResult,
        .Failure = AlternateFailure,
        .models = alternate_models,
        .prompts = alternate_prompts,
        .skills = alternate_skills,
        .actions = alternate_actions,
        .strategy = Strategy,
        .epistemics = agent.epistemics.systemStateless(.{}),
        .failures = alternate_failures,
        .representation = alternate_representation,
    });
}

test "one complete source admits default and alternate staged strategies" {
    const React = alternateSystem(agent.strategy.react(.{}));
    const Staged = alternateSystem(agent.strategy.staged(.{
        .semantic_identity = "agent.strategy.alternate-system-proof.v1",
        .implementation = AlternateImplementation,
    }));
    try std.testing.expectEqual(React.Goal, Staged.Goal);
    try std.testing.expectEqual(React.Action, Staged.Action);
    try std.testing.expectEqual(React.Result, Staged.Result);
    try std.testing.expect(!std.mem.eql(
        u8,
        &React.Program.image().bytes,
        &Staged.Program.image().bytes,
    ));
    try std.testing.expect(!@hasDecl(React, "Machine"));
    try std.testing.expect(!@hasDecl(Staged, "Machine"));
}
