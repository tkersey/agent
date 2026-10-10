//! Compatible public authoring contracts. Private and alternate-module roots stay separate.
test {
    _ = @import("agent4/authoring_tests.zig");
    _ = @import("agent4/catalogs.zig");
    _ = @import("agent4/participant.zig");
    _ = @import("agent4/composed_owners.zig");
    _ = @import("agent4/recursive_participant.zig");
    _ = @import("agent4/selection.zig");
}
