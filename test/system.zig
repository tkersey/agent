const agent = @import("agent");
const boundary = @import("boundary");
const std = @import("std");

test "agent.system returns one ordinary unspecialized Boundary Program" {
    try std.testing.expect(AlternateStaged.InitialArgs == AlternateGoal);
    try std.testing.expect(AlternateStaged.Result == AlternateResult);
    try std.testing.expect(@hasDecl(AlternateStaged, "Program"));
    try std.testing.expect(!@hasDecl(AlternateStaged, "Machine"));
    try std.testing.expect(AlternateStaged.Program.image().bytes.len > 0);
}

test "tool schemas distinguish Text byte and character bounds" {
    const Text = boundary.Text(17);
    const schema = &agent.toolSchema(struct { value: Text }).value;
    try std.testing.expect(std.mem.indexOf(
        u8,
        schema,
        "UTF-8 encoding must not exceed 17 bytes",
    ) != null);
    try std.testing.expect(std.mem.indexOf(
        u8,
        schema,
        "\"maxLength\":17",
    ) != null);
}

const AlternateGoal = boundary.Text(64);
const AlternateResult = struct { answer: AlternateGoal };
const AlternateAction = union(enum) {
    done: AlternateResult,
    again: AlternateResult,
};
const AlternateObservation = union(enum) { noop: void };
const AlternateFailure = enum {
    overflow,
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
const alternate_actions = .{
    agent.action.final(.done, .{
        .name = "done",
        .description = "Return the exact bounded answer.",
    }),
    agent.action.final(.again, .{
        .name = "again",
        .description = "Return another exact bounded answer.",
    }),
};
const alternate_models = .{agent.model(.{
    .name = "primary",
    .protocol = agent.protocol.openaiResponsesV2.Profile,
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
    .arithmetic_overflow = AlternateFailure.overflow,
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
    .response_bytes = 1024,
    .maximum_provider_response_bytes = 8192,
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

const AlternateReact = alternateSystem(agent.strategy.react(.{}));
const AlternateStaged = alternateSystem(agent.strategy.staged(.{
    .semantic_identity = "agent.strategy.alternate-system-proof.v1",
}));
const FailureActionTag = enum(u32) { abort = 7 };
const FailureAction = union(FailureActionTag) { abort: AlternateFailure };
const FailureSystem = agent.system(.{
    .name = "authored-failure-system-proof",
    .version = "3.0.0",
    .Goal = AlternateGoal,
    .Action = FailureAction,
    .Observation = AlternateObservation,
    .Result = AlternateResult,
    .Failure = AlternateFailure,
    .models = alternate_models,
    .prompts = alternate_prompts,
    .skills = .{},
    .actions = .{agent.action.fail(.abort, .{
        .name = "abort",
        .description = "Return one typed authored failure.",
    })},
    .strategy = agent.strategy.react(.{}),
    .epistemics = agent.epistemics.systemStateless(.{}),
    .failures = alternate_failures,
    .representation = .{
        .response_bytes = 1024,
        .maximum_provider_response_bytes = 8192,
        .image_bytes = 256 * 1024,
        .flow_limits = alternate_representation.flow_limits,
        .schema_types = .{
            AlternateGoal,
            AlternateResult,
            FailureAction,
            AlternateObservation,
            AlternateFailure,
        },
    },
});

test "alternate staged identity preserves the canonical closed runtime" {
    try std.testing.expectEqual(AlternateReact.Goal, AlternateStaged.Goal);
    try std.testing.expectEqual(AlternateReact.Action, AlternateStaged.Action);
    try std.testing.expectEqual(AlternateReact.Result, AlternateStaged.Result);
    try std.testing.expect(std.mem.eql(
        u8,
        &AlternateReact.Program.image().bytes,
        &AlternateStaged.Program.image().bytes,
    ));
    try std.testing.expect(AlternateStaged.Source.strategy.repeat_after_observation);
    try std.testing.expect(AlternateStaged.Source.strategy.allow_completion);
    try std.testing.expect(!@hasDecl(AlternateReact, "Machine"));
    try std.testing.expect(!@hasDecl(AlternateStaged, "Machine"));
}

test "canonical systems encode authored failure actions" {
    try std.testing.expect(FailureSystem.Program.image().bytes.len > 0);
}
