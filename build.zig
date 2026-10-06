//! Agent authoring has no World runtime dependency. Runtime checks are explicit.
pub const build = @import("build_agent4.zig").build;
pub const addNativeSystem = @import("build_native.zig").addNativeSystem;
pub const NativeAssets = @import("build_native.zig").Assets;
