const fixture = @import("react_system_fixture.zig");

const Invalid = fixture.System(fixture.representation(), fixture.MutatingFlow);

comptime {
    _ = Invalid.Program;
}
