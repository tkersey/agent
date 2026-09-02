const agent = @import("agent");
const boundary = @import("boundary");

const Goal = boundary.Text(16);
const Result = struct { value: u8 };
const ActionFailure = enum {
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
const Action = union(enum) { abort: ActionFailure };
const Observation = union(enum) { noop: void };

const Invalid = agent.system(.{
    .name = "nonproduct-action-payload",
    .version = "1.0.0",
    .Goal = Goal,
    .Action = Action,
    .Observation = Observation,
    .Result = Result,
    .Failure = ActionFailure,
    .models = .{agent.model(.{
        .name = "primary",
        .protocol = agent.protocol.openaiResponsesV2.Profile,
        .model = "fixture-model",
        .parameters = .{},
    })},
    .prompts = .{agent.prompt.literal(.{ .role = .system, .content = "Abort." })},
    .skills = .{},
    .actions = .{agent.action.fail(.abort, .{
        .name = "abort",
        .description = "Abort with one authored failure.",
    })},
    .strategy = agent.strategy.react(.{}),
    .epistemics = agent.epistemics.systemStateless(.{}),
    .failures = .{
        .arithmetic_overflow = ActionFailure.arithmetic_overflow,
        .capacity_exceeded = ActionFailure.capacity_exceeded,
        .invalid_index = ActionFailure.invalid_index,
        .invalid_utf8 = ActionFailure.invalid_utf8,
        .malformed = ActionFailure.malformed,
        .invalid_variant = ActionFailure.invalid_variant,
        .incomplete = ActionFailure.incomplete,
        .response_error = ActionFailure.response_error,
        .unsupported = ActionFailure.unsupported,
        .multiple_calls = ActionFailure.multiple_calls,
        .refusal = ActionFailure.refusal,
        .unknown_action = ActionFailure.unknown_action,
        .transport = ActionFailure.transport,
        .http = ActionFailure.http,
    },
    .representation = .{
        .response_bytes = 1024,
        .image_bytes = 64 * 1024,
        .schema_types = .{ Goal, Result, Action, Observation, ActionFailure },
    },
});

comptime {
    _ = Invalid.Program;
}
