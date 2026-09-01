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
const Profile = agent.openai_profile.Profile(
    ProfileFailure,
    boundary.Bytes(256),
    ProfileAction,
    ProfileActions,
    "test-model",
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
