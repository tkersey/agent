const fixture = @import("react_system_fixture.zig");

const Invalid = fixture.SystemWithFailures(
    fixture.representation(),
    fixture.Stateless,
    .{
        .arithmetic_overflow = fixture.Failure.arithmetic_overflow,
        .capacity_exceeded = fixture.Failure.capacity_exceeded,
        .invalid_index = fixture.Failure.invalid_index,
        .invalid_utf8 = fixture.Failure.invalid_utf8,
        .malformed = fixture.Failure.malformed,
        .invalid_variant = fixture.Failure.invalid_variant,
        .incomplete = fixture.Failure.incomplete,
        .response_error = fixture.Failure.response_error,
        .unsupported = fixture.Failure.unsupported,
        .multiple_calls = fixture.Failure.multiple_calls,
        .refusal = fixture.Failure.refusal,
        .unknown_action = fixture.Failure.unknown_action,
        .transport = fixture.Failure.transport,
        .http = fixture.Failure.http,
        .policy_deneid = fixture.Failure.invalid_variant,
    },
);

comptime {
    _ = Invalid.Program;
}
