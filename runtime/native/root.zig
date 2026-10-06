//! Compiled native environment. Deliberately separate from Agent authoring.
pub const json = @import("json.zig");
pub const values = @import("values.zig");
pub const protocol = @import("protocol.zig");
pub const registry = @import("registry.zig");
pub const Context = registry.Context;
pub const leaf = registry.leaf;
pub const question = registry.question;
pub const Declaration = registry.Declaration;
pub const Registry = registry.Registry;
pub const run = @import("host.zig").run;
pub const discovery = @import("discovery.zig");
pub const inbox = @import("inbox.zig");

test {
    _ = json;
    _ = values;
    _ = protocol;
    _ = registry;
    _ = @import("sqlite.zig");
    _ = @import("occurrence.zig");
    _ = @import("store.zig");
    _ = @import("namespace.zig");
}
