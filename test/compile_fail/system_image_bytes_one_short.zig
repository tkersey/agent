const fixture = @import("react_system_fixture.zig");

const Valid = fixture.ImageCapacitySystem(256 * 1024);
const Invalid = fixture.ImageCapacitySystem(Valid.Program.image().bytes.len - 1);

comptime {
    _ = Invalid.Program.image();
}
