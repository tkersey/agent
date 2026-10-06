//! Native semantic checks with one shared World/Agent module graph.
test {
    _ = @import("agent_native");
    _ = @import("bounded_history.zig");
    _ = @import("decision_scopes.zig");
    _ = @import("model_admission.zig");
    _ = @import("model_custody.zig");
    _ = @import("observation.zig");
    _ = @import("approval_equality.zig");
    _ = @import("callable_runtime.zig");
    _ = @import("clarification.zig");
    _ = @import("terminology.zig");
}
