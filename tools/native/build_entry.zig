//! The build driver reuses the existing optimized hash primitive. Standalone
//! `zig run dependencies.zig` keeps its standard-library-only bootstrap.
pub const native_hash = @import("hash_abi");
const implementation = @import("dependencies.zig");
pub const main = implementation.main;
comptime {
    _ = implementation;
}
