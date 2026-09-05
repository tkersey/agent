const fixture = @import("react_system_fixture.zig");

const Invalid = fixture.ImageCapacitySystem(1);

comptime {
    _ = Invalid.Program.image();
}
