//! Flat model proposals. Every action remains untrusted application input.
const agent = @import("agent");
const Text = agent.contracts.Text;
pub const Edit = struct { operation: enum { create, replace, delete }, path: Text(256), old_digest: Text(64), content: Text(32768) };
pub const Action = union(enum) {
    list: struct { prefix: Text(256), after: Text(2048) },
    read: struct { path: Text(256), offset: u64 },
    search: struct { query: Text(256), prefix: Text(256), after: Text(2048) },
    edit: Edit,
    check: struct {},
    ask: struct { question: Text(4096) },
    finish: struct { summary: Text(4096) },
};
pub const P = agent.model_invocation.Profile(Action, .{
    .{ .name = "list", .description = "List frozen admitted paths; continue with the returned cursor." },
    .{ .name = "read", .description = "Read a bounded UTF-8 window from the frozen snapshot at a byte offset." },
    .{ .name = "search", .description = "Search literal text in admitted paths; preserve truncation and pagination limits." },
    .{ .name = "edit", .description = "Stage one exact create/replace/delete against the frozen base. Use its observed SHA256 hex digest, or empty for create. Empty content for delete. Replaces a previously staged edit at this path. At most four paths." },
    .{ .name = "check", .description = "Prepare the exact staged candidate and run the operator-selected independent check. Does not publish." },
    .{ .name = "ask", .description = "Ask the authenticated person for clarification, retaining this investigation." },
    .{ .name = "finish", .description = "Return an honest summary. A changed candidate must have a passing check. Only the selected publish mode may subsequently request exact human approval." },
}, .{
    .model_id_bytes = 128,
    .temperature_bytes = 16,
    .maximum_messages = 3,
    .message_bytes = 128 * 1024,
    .maximum_output_items = 16,
    .call_id_bytes = 128,
    .arguments_json_bytes = 256 * 1024,
    .result_text_bytes = 128 * 1024,
    .provider_response_bytes = 2 * 1024 * 1024,
});
pub const Configuration = struct { model: P.ModelId, parameters: P.ModelParameters };
pub const Results = @FieldType(P.ReplayRequest, "results");
pub const State = struct {
    replay: P.ReplayBytes,
    results: Results,
    remaining_steps: u16,
    remaining_checks: u16,
    remaining_revisions: u16,
    remaining_moves: u32,
    edits: agent.contracts.Vector(Edit, 4),
    candidate: Text(2 * 1024 * 1024),
    validation: Text(2 * 1024 * 1024),
    passed: bool,
    view_only: bool,
    guidance: Text(4096),
};
