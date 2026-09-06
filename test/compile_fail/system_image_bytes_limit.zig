const fixture = @import("react_system_fixture.zig");

const Invalid = fixture.System(.{
    .response_bytes = 1024,
    .maximum_provider_response_bytes = 8192,
    .image_bytes = 1,
    .schema_types = .{ fixture.Goal, fixture.Result, fixture.Action, fixture.Observation, fixture.Failure },
}, fixture.Stateless);

comptime {
    _ = Invalid.Program.image();
}
