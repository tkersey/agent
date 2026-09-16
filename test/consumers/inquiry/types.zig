//! Portable application values. Model proposals contain no evidence or authority.
const agent = @import("agent");
const Text = agent.contracts.Text;
const Vector = agent.contracts.Vector;
pub const Source = Text(4096);
pub const Reason = Text(256);
pub const Hash = Text(64);
pub const Issue = struct { text: Text(64), choices: Vector(u8, 4), label: Text(32) };
pub const Encode = struct { request: u64, choice: u8 };
pub const Step = union(enum) { issue: Issue, encode: Encode, submit: u64, abort, close, inspect };
pub const Trace = struct { mode: u8, steps: Vector(Step, 24) };
pub const Selector = enum { occurrence, accepted, issued, accepted_count, closed, current };
pub const Prediction = struct { step: u64, field: Selector, expected: u64, requirement: u8 };
pub const Probe = struct { trace: Trace, prediction: Prediction };
pub const Demand = union(enum) { probe: Probe, validate: Source, retire: Reason };
pub const Subject = struct {
    path: Text(32),
    source: Source,
    runner: Hash,
    requirements: Text(2048),
    contract: Hash,
    reusable: bool,
    target: Hash,
};
pub const Experiment = struct { kind: u8, source: Source, trace: Trace };
pub const Key = struct { subject: Subject, experiment: Experiment };
pub const Row = struct {
    operation: u8,
    occurrence: u64,
    accepted: bool,
    issued: u64,
    accepted_count: u64,
    closed: bool,
    current: u64,
    label: Text(128),
};
pub const Rows = Vector(Row, 24);
pub const Checked = struct { passed: bool, completed: u64, failed: u64, failures: Reason };
pub const Observation = union(enum) { trace: Rows, validation: Checked };
pub const Candidate = struct {
    replacement: Source,
    observation: u64,
    investigation: u64,
    version: u64,
    checks: Checked,
    contract: Hash,
    runner: Hash,
    qualification: Reason,
};
pub const Finding = union(enum) { ready: Candidate, unresolved: Reason };
pub const Found = struct { investigation: u64, finding: Finding };
pub const Record = struct { occurrence: u64, key: Key, observation: Observation, reusable: bool };
pub const InquiryOutcome = struct {
    status: u8,
    findings: []const Found,
    records: []const Record,
    acquisitions: u64,
    reuse_passes: u64,
    recipients: u64,
};
pub const Hypothesis = struct { explanation: Reason };
pub const ModelIssue = struct {
    text: Text(64),
    choice0: u8,
    choice1: u8,
    choice2: u8,
    choice3: u8,
    count: u8,
    label: Text(32),
};
pub const ModelPrediction = struct {
    mode: u8,
    step: u64,
    field: Selector,
    expected: u64,
    requirement: u8,
};
pub const Repair = struct { source: Source, observation: u64 };
pub const Revision = struct { explanation: Reason, observation: u64 };
pub const Stop = struct { reason: Reason, observation: u64 };
pub const Now = enum { now };
pub const Answer = union(enum) {
    hypothesis: Hypothesis,
    prediction: ModelPrediction,
    issue: ModelIssue,
    encode: Encode,
    submit: struct { reply: u64 },
    abort: Now,
    close: Now,
    inspect: Now,
    repair: Repair,
    revise: Revision,
    stop: Stop,
};
pub const P = agent.model_invocation.Profile(Answer, .{
    .{ .name = "hypothesis", .description = "Propose one qualified explanation of the reported behavior." },
    .{ .name = "prediction", .description = "Start a probe plan: choose mode and predict one trace row field for requirement 0..7." },
    .{ .name = "issue", .description = "Append issue(text, first count choices, label); count is 1..4." },
    .{ .name = "encode", .description = "Append encoding of an answer to an earlier issue output by zero-based step index." },
    .{ .name = "submit", .description = "Append submission of the unchanged encoded reply at an earlier encode step." },
    .{ .name = "abort", .description = "Append abort of the current request." },
    .{ .name = "close", .description = "Append permanent session close." },
    .{ .name = "inspect", .description = "Append inspection of session state." },
    .{ .name = "repair", .description = "Propose complete replacement source based on the current observation ID, or zero before any observation." },
    .{ .name = "revise", .description = "Revise the explanation based on the current observation ID; the program assigns its next version." },
    .{ .name = "stop", .description = "Conclude scoped insufficiency with the current observation ID and a reason." },
}, .{
    .model_id_bytes = 64,
    .temperature_bytes = 8,
    .maximum_messages = 7,
    .message_bytes = 8192,
    .maximum_output_items = 25,
    .call_id_bytes = 32,
    .arguments_json_bytes = 32768,
    .result_text_bytes = 256,
    .provider_response_bytes = 65536,
});
pub const Model = agent.model(.{ .name = "inquiry-investigator", .model = "fixture-model", .protocol = struct {
    pub const semantic_identity = "agent.model.protocol.openai-responses-v2";
} });
pub const Task = struct {
    subject: Subject,
    model: P.ModelId,
    investigations: u8,
    passes: u64,
    model_turns: u64,
    coalesce: bool,
    principal: u64,
    attempt: u64,
};
pub const Working = struct { explanation: Reason, observation: u64, summary: Text(4096), remaining: u64, candidate: Source };
pub const VersionResult = union(enum) { done: Finding, revised: Working };
pub const Plan = union(enum) { probe: Probe, repair: Repair, revise: Revision, stop: Stop, invalid };
pub const Live = struct { content: Source, digest: Hash };
pub const Read = union(enum) { success: Proposal, failure: Hash };
pub const Proposal = struct { path: Text(32), base: Live, candidate: Candidate, principal: u64, attempt: u64, target: Hash };
pub const Delivery = union(enum) { success: Live, conflict: Live, failure: Hash, uncertain: Hash };
pub const Receipt = struct { current: Live, proposal: Proposal };
pub const Result = union(enum) {
    delivered: Receipt,
    unresolved: Reason,
    conflict: Live,
    declined: Hash,
    invalid,
    unavailable: Hash,
    uncertain: Hash,
    no_change: Receipt,
    stopped,
};
