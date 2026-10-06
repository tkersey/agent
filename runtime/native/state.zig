//! Ordinary, versioned environmental records. World continuations remain the
//! existing BPI3/PST3/PKO3 artifacts, never native pointers or application phases.
const contracts = @import("agent_contracts");
const occurrence = @import("occurrence.zig");
pub const Digest = occurrence.Digest;
pub const TaskId = occurrence.TaskId;
pub const Name = contracts.Text(128);
pub const Reason = contracts.Text(256);
pub const Reference = struct { digest: Digest, bytes: u64 };
pub const Outcome = enum { progressed, yielded, requested, completed, failed, cancelled };
pub const Schedule = enum { queued, active, parked };
pub const Blocker = enum { missing_capability, denied, capacity, missing_artifact, incompatible_profile, unavailable_environment };

pub const Task = struct {
    id: TaskId,
    application_id: Name,
    input_schema_id: Name,
    output_schema_id: Name,
    failure_schema_id: Name,
    message_schema_id: Name,
    principal: Name,
    tenant: Name,
    profile_id: Name,
    profile: Reference,
    image: Reference,
    runtime_identity: Digest,
    input: Reference,
    checkpoint: Reference,
    outcome: Reference,
    outcome_kind: Outcome,
    current_occurrence: ?Digest,
    revision: u64,
    execution_revision: u64,
    schedule: Schedule,
    cancellation: ?Reason,
    cancellation_applied: bool,
    blocker: ?Blocker,
    result: ?Reference,
    client_result: ?Reference,
    result_artifact: ?Digest,
    event_floor: u64,
    event_high: u64,
    next_message: u64,
    messages: contracts.Vector(Digest, 16),
    inference_attempts: u32,
    inference_request_bytes: u64,
    inference_output_tokens: u64,
    evidence_bytes: u64,

    pub fn terminal(task: Task) bool {
        return switch (task.outcome_kind) {
            .completed, .failed, .cancelled => true,
            else => false,
        };
    }
};

pub const Method = enum { submit, message, respond, cancel, @"resume" };
pub const Disposition = enum { accepted, queued, answer_acquired, cancellation_requested, resumed };
pub const Receipt = struct {
    id: Digest,
    client_operation_id: Name,
    method: Method,
    request_digest: Digest,
    task: TaskId,
    revision: u64,
    disposition: Disposition,
    message: ?Digest = null,
    question: ?Digest = null,
};

pub const Question = struct {
    id: Digest,
    task: TaskId,
    occurrence: Digest,
    revision: u64,
    request_digest: Digest,
    pending_digest: Digest,
    answer_schema_id: Name,
    answer_schema_digest: Digest,
    request: Reference,
    prompt: Reference,
    answer: ?Reference,
    receipt: ?Receipt,
    retired: bool,
};

pub const MessageDisposition = enum { queued, acquired, consumed, not_consumed };
pub const Message = struct {
    id: Digest,
    task: TaskId,
    ordinal: u64,
    schema_id: Name,
    value: Reference,
    disposition: MessageDisposition,
    occurrence: ?Digest,
};

pub const EventType = enum {
    accepted,
    input_required,
    input_accepted,
    message_queued,
    message_consumed,
    message_not_consumed,
    cancellation_requested,
    parked,
    resumed,
    blocked,
    delivery_unknown,
    completed,
    failed,
    cancelled,
};
pub const Event = struct {
    task: TaskId,
    seq: u64,
    revision: u64,
    kind: EventType,
    /// An admitted public projection. Raw provider captures and checkpoints do
    /// not enter this field or acquire artifact-read permission by their digest.
    data: contracts.Bytes(48 * 1024),
};

pub const Artifact = struct {
    id: Digest,
    task: ?TaskId,
    value: Reference,
    media_type: contracts.Text(128),
    schema_id: ?Name,
};

pub const CaptureDisposition = enum { complete, definitely_not_sent, unknown };
pub const Capture = struct {
    task: TaskId,
    occurrence: Digest,
    attempt: Digest,
    request: Reference,
    response: ?Reference,
    disposition: CaptureDisposition,
};
