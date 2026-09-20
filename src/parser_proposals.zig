//! Untrusted model proposals for consumer-directed parser construction.
//! Versions, validation, approval and delivery remain owned by the application.
const parser = @import("parser_synthesis.zig");
const contracts = @import("agent_contracts");
const model = @import("model_invocation.zig");
const Context = @import("authoring.zig").Context;
const Id = @import("boundary").computation.Id;

pub const Explanation = contracts.Text(512);
pub const SourceProposal = struct { source: parser.Code, explanation: Explanation };
pub const Experiment = struct {
    input_hex: contracts.Text(8192),
    first_chunk_bytes: u32,
    chunk_bytes: u32,
    finalize: bool,
    reason: Explanation,
};
pub const Constraint = struct {
    kind: enum(u32) { reference = 0, missing_intent = 1 },
    question: Explanation,
};
pub const Proposal = union(enum(u32)) {
    fragment: SourceProposal = 0,
    complete_candidate: SourceProposal = 1,
    experiment: Experiment = 2,
    constraint: Constraint = 3,
    unresolved: struct { reason: Explanation } = 4,
};
pub const Profile = model.Profile(Proposal, .{
    .{ .name = "fragment", .description = "Supply requested partial source construction; not a validated artifact." },
    .{ .name = "complete_candidate", .description = "Propose a complete initial/step module for independent validation." },
    .{ .name = "experiment", .description = "Propose a concrete byte/chunk trace for the current candidate." },
    .{ .name = "constraint", .description = "Request a reference observation or an explicitly unresolved task requirement." },
    .{ .name = "unresolved", .description = "State why the requested contribution cannot currently be supplied." },
}, .{
    .model_id_bytes = 128,
    .temperature_bytes = 8,
    .maximum_messages = 8,
    .message_bytes = 32768,
    .maximum_output_items = 4,
    .call_id_bytes = 128,
    .arguments_json_bytes = 65536,
    .result_text_bytes = 4096,
    .provider_response_bytes = 262144,
});

pub const instructions =
    \\Construct an incremental byte-record parser from the supplied batch source and requirements.
    \\Answer the current consumer demand. A fragment is incomplete source; a complete_candidate
    \\is a proposed initial()/step(state, chunk, endOfInput) module, never proof of acceptance.
    \\Experiments specify hex bytes, first-chunk size, later chunk size, and finalization. Tool observations are evidence;
    \\predictions and explanations are not. Do not invent successful tests or modify required checks.
    \\Request reference evidence for empirical uncertainty. Strict EOF behavior is already specified;
    \\request human intent only when the task explicitly leaves the observable EOF behavior unresolved.
    \\Do not select an implementation from a hidden template. Different correct designs are allowed.
    \\Do not claim validation, approval, target writes, or delivery. Those are separate application steps.
;

/// The existing checked responder freezes the offered set and request policy,
/// invokes the actual model effect, and interprets its normalized response.
pub fn define(c: Context, failure: Id) !Id {
    return @import("responders.zig").defineModel(Profile, c, failure, false);
}
