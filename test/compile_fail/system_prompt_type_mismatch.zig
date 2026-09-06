const fixture = @import("react_system_fixture.zig");

const Invalid = fixture.System(fixture.representation(), fixture.WrongPrompt);

comptime {
    _ = Invalid.Program;
}
