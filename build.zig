//! Agent authoring has no World runtime dependency. Runtime checks are explicit.
pub const build = @import("build_agent4.zig").build;
