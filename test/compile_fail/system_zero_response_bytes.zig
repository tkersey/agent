const agent = @import("agent");
const boundary = @import("boundary");

const Goal = boundary.Text(16);
const Result = struct { value: u8 };
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
const Action = union(enum) { done: Result };
const Observation = union(enum) { noop: void };

const Invalid = agent.system(.{
    .name = "zero-response-bytes",
    .version = "1.0.0",
    .Goal = Goal,
    .Action = Action,
    .Observation = Observation,
    .Result = Result,
    .Failure = Failure,
    .models = .{agent.model(.{
        .name = "primary",
        .protocol = agent.protocol.openaiResponsesV2.Profile,
        .model = "fixture-model",
        .parameters = .{},
    })},
    .prompts = .{agent.prompt.literal(.{ .role = .system, .content = "Done." })},
    .skills = .{},
    .actions = .{agent.action.final(.done, .{
        .name = "done",
        .description = "Return.",
    })},
    .strategy = agent.strategy.react(.{}),
    .epistemics = agent.epistemics.systemStateless(.{}),
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
        .response_bytes = 0,
        .maximum_provider_response_bytes = 4096,
        .image_bytes = 64 * 1024,
        .schema_types = .{ Goal, Result, Action, Observation, Failure },
    },
});

comptime {
    _ = Invalid.Program;
}
