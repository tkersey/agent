const agent = @import("agent");
const boundary = @import("boundary");
const std = @import("std");

const Goal = boundary.Text(64);
const Result = struct { answer: Goal };
const Action = union(enum) { done: Result };
const Observation = union(enum) { noop: void };
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

const System = agent.system(.{
    .name = "clean-room-agent",
    .version = "3.0.0",
    .Goal = Goal,
    .Action = Action,
    .Observation = Observation,
    .Result = Result,
    .Failure = Failure,
    .models = .{agent.model(.{
        .name = "primary",
        .protocol = agent.protocol.openaiResponsesV2.Profile,
        .model = "clean-room-model-v1",
        .parameters = .{},
    })},
    .prompts = .{agent.prompt.literal(.{
        .role = .system,
        .content = "Return the requested bounded answer.",
    })},
    .skills = .{},
    .actions = .{agent.action.final(.done, .{
        .name = "done",
        .description = "Return the exact bounded answer.",
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
        .schema_types = .{ Goal, Result, Action, Observation, Failure },
    },
});

test "public Agent modules compile one ordinary Boundary Program" {
    try std.testing.expect(System.InitialArgs == Goal);
    try std.testing.expect(System.Result == Result);
    try std.testing.expect(System.Program.image().bytes.len > 0);
    try std.testing.expect(@hasDecl(boundary, "program"));
    try std.testing.expect(!@hasDecl(System, "run"));
}
