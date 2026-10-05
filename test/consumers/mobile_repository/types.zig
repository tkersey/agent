//! Ordinary portable application data. Resource identities confer no authority.
const agent = @import("agent");
const Text = agent.contracts.Text;
const Vector = agent.contracts.Vector;
pub const Identifier = Text(128);
pub const Path = Text(256);
pub const Oid = Text(64);
pub const Digest = [32]u8;
pub const Mode = enum { inspect, propose, publish };
pub const Failure = enum { invalid_task, placement_failed, invalid_model, capacity_exceeded, budget_exhausted };
pub const SnapshotRequest = struct { repository: Identifier, base: Oid };
pub const Snapshot = struct {
    repository: Identifier,
    provisioning_generation: Identifier,
    object_format: enum { sha1, sha256 },
    base: Oid,
    tree: Oid,
    manifest: Digest,
    scope_manifest: Digest,
    classification: Vector(Identifier, 16),
    resource_owner: Identifier,
};
pub const ReadRequest = struct { snapshot: Snapshot, path: Path };
pub const Cursor = Text(2048);
pub const ListRequest = struct { snapshot: Snapshot, prefix: Path, after: Cursor };
pub const FileEntry = struct { path: Path, mode: Text(6), oid: Oid, bytes: u64, digest: Digest };
pub const Listing = struct { snapshot_manifest: Digest, entries: Vector(FileEntry, 32), cursor: Cursor, total: u64 };
pub const SearchRequest = struct { snapshot: Snapshot, query: Text(256), prefix: Path, after: Cursor };
pub const SearchHit = struct { path: Path, digest: Digest, line: u64, excerpt: Text(256), truncated: bool };
pub const SearchResult = struct { snapshot_manifest: Digest, entries: Vector(SearchHit, 32), cursor: Cursor, truncated: bool };
pub const ReadWindowRequest = struct { snapshot: Snapshot, path: Path, offset: u64, maximum: u32 };
pub const ReadWindow = struct { evidence: Evidence, offset: u64, next_offset: u64, bytes: u64 };
pub const Evidence = struct {
    snapshot_manifest: Digest,
    path: Path,
    content_digest: Digest,
    content: Text(32768),
    truncated: bool,
};
pub const Task = struct {
    task_id: u64,
    generation: u64,
    mode: Mode,
    goal: Text(4096),
    repository: Identifier,
    base: Oid,
    initial_path: Path,
    workspace: agent.mobility.EnsureInput,
    human: agent.mobility.EnsureInput,
    model: @import("model.zig").Configuration,
    maximum_steps: u16,
    maximum_checks: u16,
    principal: u64,
};
pub const Cleanup = struct { task_id: u64, generation: u64 };
pub const Question = struct { task_id: u64, generation: u64, goal: Text(4096), evidence: Evidence, question: Text(4096), remaining_moves: u32 };
pub const ClarificationReply = struct { answer: Answer, remaining_moves: u32 };
pub const ReviewOutcome = struct { proposal: Text(2 * 1024 * 1024), publication: Publication };
pub const ReviewAction = union(enum) { done: ReviewOutcome, question: Text(4096), amend: Text(4096) };
pub const ReviewReply = struct { action: ReviewAction, remaining_moves: u32 };
pub const Reply = union(enum) { clarification: ClarificationReply, review: ReviewReply };
pub const Demand = union(enum) { clarification: Question, review: Finding };
pub const ReviewInput = struct { task_id: u64, generation: u64, mode: Mode, summary: Answer, proposal: Text(2 * 1024 * 1024) };
pub const ReviewAnswer = union(enum) { finish, decline: Text(4096), question: Text(4096), amend: Text(4096) };
pub const Answer = Text(4096);
pub const Finding = struct { goal: Text(4096), evidence: Evidence, answer: Answer, candidate: Text(2 * 1024 * 1024), validation: Text(2 * 1024 * 1024), remaining_moves: u32, proposal: Text(2 * 1024 * 1024), publication: Publication };
pub const Preparation = struct { snapshot: Snapshot, edits: @FieldType(@import("model.zig").State, "edits") };
pub const Found = struct { occurrence: u64, finding: Finding };
pub const Publication = union(enum) { none, approval: @import("publication.zig").Result };
pub const Report = struct {
    task_id: u64,
    generation: u64,
    mode: Mode,
    remaining_moves: u32,
    findings: []const Found,
    proposal: Text(2 * 1024 * 1024),
    publication: Publication,
};
pub const SNAPSHOT = "agent.repository.snapshot.v1";
// Fresh per-task allowances come from this immutable session template.
// Custodian-wide limits are independent and never reset between tasks.
pub const Session = struct { task: Task, maximum_tasks: u16 };
pub const NextTask = struct { report: Report, next_generation: u64, maximum_steps: u16, maximum_checks: u16, maximum_moves: u32 };
pub const NextTaskAnswer = union(enum) { stop, start: struct { goal: Text(4096), mode: Mode } };
pub const NEXT_TASK = "agent.repository.next-task.v1";
pub const READ = "agent.repository.read.v1";
pub const LIST = "agent.repository.list.v1";
pub const SEARCH = "agent.repository.search.v1";
pub const READ_WINDOW = "agent.repository.read-window.v1";
pub const HUMAN = "agent.repository.human.v1";
pub const RELEASE = "agent.repository.investigation-release.v1";
