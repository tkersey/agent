const fixture = @import("react_system_fixture.zig");

fn system(comptime capacity: usize) type {
    return fixture.System(.{
        .response_bytes = 1024,
        .maximum_provider_response_bytes = 8192,
        .image_bytes = capacity,
        .schema_types = .{
            fixture.Goal,
            fixture.Result,
            fixture.Action,
            fixture.Observation,
            fixture.Failure,
        },
    }, fixture.Stateless);
}

const Valid = system(256 * 1024);
const Invalid = system(Valid.Program.image().bytes.len - 1);

comptime {
    _ = Invalid.Program.image();
}
