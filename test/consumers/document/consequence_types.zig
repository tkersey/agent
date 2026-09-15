//! Portable data for the opt-in controlled terminology application.
const agent = @import("agent");
pub const terminology = @import("terminology.zig");
pub const Content = terminology.Content;
pub const Path = agent.contracts.Text(32);
pub const Reason = agent.contracts.Text(64);
pub const Observation = struct { content: Content, digest: Reason };
pub const Request = struct {
    path: Path,
    old_term: Content,
    replacement_term: Content,
    require_scope: bool,
    allow_archive: bool,
    attempt: u64,
};
pub const Proposal = struct {
    path: Path,
    base: Observation,
    replacement: Content,
    provenance: u64,
    required_principal: u64,
    reason: Reason,
};
pub const Read = union(enum) { success: Observation, failure: Reason };
pub const Operation = union(enum) {
    success: Observation,
    conflict: Observation,
    failure: Reason,
    uncertain: Reason,
};
pub const Action = struct {
    operation: enum { no_change, replace },
    proposal: Proposal,
    task: Request,
    policy_id: u64,
};
pub const Consequences = struct { changes_archive: bool };
pub const Context = struct { task: Request, base: Observation, turn: u64 };
pub const Known = struct { consequences: Consequences, action: Action };
pub const Assessed = union(enum) { known: Known, unavailable, rejected, inconclusive };
pub const Evaluation = struct { id: u64, assessed: Assessed };
pub const Group = struct { id: u64, known: Known, members: []const u64 };
pub const Choice = struct { reason: u8, groups: []const Group };
pub const Classification = union(enum) { common: Group, choice: Choice, unresolved: []const Evaluation };
pub const NonAction = union(enum) { incomplete: []const Evaluation, other, unsure, unoffered };
pub const Resolution = union(enum) {
    common: Group,
    selected: Group,
    unresolved: NonAction,
    aborted,
    closed,
};
pub const Receipt = struct { by_choice: bool, supported: [2]bool };
pub const Memory = struct { next_turn: u64, receipt: ?Receipt };
pub const Reply = union(enum) {
    changed: Receipt,
    no_change: Receipt,
    unresolved: NonAction,
    conflict: Observation,
    failed: Reason,
    uncertain: Reason,
    declined: Reason,
    invalid,
    unresolved_approval,
    aborted,
};
pub const Option = struct {
    id: u64,
    members: []const u64,
    action: Action,
    changes_archive: bool,
    meaning: agent.contracts.Text(128),
};
pub const Question = struct {
    context: Context,
    reason: u8,
    prompt: agent.contracts.Text(256),
    options: []const Option,
};
pub const ModelProposal = struct {
    status: enum { known, unavailable, needs_information },
    replacement: Content,
};
pub const Model = agent.model(.{
    .name = "document-terminology-assessor",
    .model = "fixture-model",
    .protocol = struct {
        pub const semantic_identity = "agent.model.protocol.openai-responses-v2";
    },
});
pub const P = agent.model_invocation.Profile(union(enum) { proposal: ModelProposal }, .{.{ .name = "proposal", .description = "Propose the exact literal terminology edit." }}, .{
    .model_id_bytes = 32,
    .temperature_bytes = 8,
    .maximum_messages = 6,
    .message_bytes = 512,
    .maximum_output_items = 4,
    .call_id_bytes = 32,
    .arguments_json_bytes = 4096,
    .result_text_bytes = 64,
    .provider_response_bytes = 8192,
});
pub const Environment = struct { model: P.ModelId, scope: P.MessageText };
pub const default_request: Request = .{
    .path = .{ .bytes = "document.txt" },
    .old_term = .{ .bytes = "customer" },
    .replacement_term = .{ .bytes = "client" },
    .require_scope = false,
    .allow_archive = true,
    .attempt = 1,
};
