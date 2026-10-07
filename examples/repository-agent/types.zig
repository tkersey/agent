//! Ordinary application/model contracts shared by the emitter and native tools.
const agent = @import("agent");
const contracts = @import("agent_contracts");
pub const application_id = "repository-agent";
pub const application_version = "1.0.0";
pub const input_schema_id = "repository-agent.input.v1";
pub const output_schema_id = "repository-agent.output.v1";
pub const failure_schema_id = "repository-agent.failure.v1";
pub const message_schema_id = "repository-agent.message.v1";
pub const answer_schema_id = "repository-agent.answer.v1";
pub const bindings_identity = "agent.repository.bindings.v1";
pub const list_identity = "agent.repository.snapshot.list.v1";
pub const read_identity = "agent.repository.snapshot.read.v1";
pub const question_identity = "agent.repository.question.v1";
pub const Path = contracts.Text(256);
pub const Summary = contracts.Text(2048);
pub const Input = struct { task: Summary };
pub const Message = struct { message: Summary };
pub const Answer = Message;
pub const Question = struct { prompt: contracts.Text(512) };
pub const Failure = enum { capacity, invalid_response, invalid_evidence };
pub const Action = union(enum) {
    list: struct { prefix: Path, after: Path },
    read: struct { path: Path, start: u64, maximum: u32 },
    ask: struct { question: contracts.Text(512) },
    report: struct { summary: Summary, evidence_index: u64 },
    stop: struct { reason: contracts.Text(256) },
};
pub const P = agent.model_invocation.Profile(Action, .{
    .{ .name = "list", .description = "List a bounded page of frozen snapshot files. Use next as after when truncated." },
    .{ .name = "read", .description = "Read at most 4096 bytes from one snapshot file. Byte offsets must preserve UTF-8. Each successful read appends one evidence record, indexed from zero." },
    .{ .name = "ask", .description = "Ask the client a clarification needed to investigate the task." },
    .{ .name = "report", .description = "Finish with a bounded summary supported by one actual read, selected by its zero-based evidence_index. Do not invent missing observations." },
    .{ .name = "stop", .description = "Stop honestly when the available snapshot or evidence cannot support the requested result." },
}, .{
    .model_id_bytes = 128,
    .temperature_bytes = 32,
    .maximum_messages = 4,
    .message_bytes = 8192,
    .maximum_output_items = 8,
    .call_id_bytes = 128,
    .arguments_json_bytes = 16384,
    .result_text_bytes = 32768,
    .provider_response_bytes = 512 * 1024,
});
pub const Bindings = struct {
    profile: [32]u8,
    snapshot: [32]u8,
    files: u32,
    excluded_entries: u32,
    model: P.ModelId,
    parameters: P.ModelParameters,
    maximum_provider_response_bytes: u32,
    instructions: P.MessageText,
};
pub const ListRequest = @FieldType(Action, "list");
pub const ReadRequest = @FieldType(Action, "read");
pub const ListEntry = struct { path: Path, bytes: u64 };
pub const Listing = struct { entries: contracts.Vector(ListEntry, 32), truncated: bool, next: Path };
pub const Evidence = struct {
    snapshot: [32]u8,
    path: Path,
    sha256: contracts.Text(64),
    start: u64,
    end: u64,
    file_bytes: u64,
    content: contracts.Text(4096),
};
pub const ReadResult = union(enum) { found: Evidence, missing: Path, invalid: contracts.Text(128) };
pub const ListObservation = struct { value: Listing, model_text: P.ResultText };
pub const ReadObservation = struct { value: ReadResult, model_text: P.ResultText };
pub const EvidenceList = contracts.Vector(Evidence, 8);
pub const Output = struct {
    disposition: enum { report, no_result, refusal, capacity },
    summary: Summary,
    evidence: EvidenceList,
    model_calls: u16,
    work_calls: u16,
};
pub const State = struct {
    replay: ?agent.model_invocation.ContextReference,
    results: @FieldType(P.ReferenceRequest, "results"),
    messages: P.Messages,
    evidence: EvidenceList,
    model_calls: u16,
    work_calls: u16,
};
