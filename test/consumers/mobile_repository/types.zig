//! Ordinary portable application data. Resource identities confer no authority.
const agent = @import("agent");
const Text = agent.contracts.Text;
const Vector = agent.contracts.Vector;
pub const Identifier = Text(128);
pub const Path = Text(256);
pub const Oid = Text(64);
pub const Digest = [32]u8;
pub const Mode = enum { inspect, propose, publish };
pub const Failure = enum { invalid_task, placement_failed };
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
};
pub const Cleanup = struct { task_id: u64, generation: u64 };
pub const Question = struct { task_id: u64, generation: u64, goal: Text(4096), evidence: Evidence };
pub const Answer = Text(4096);
pub const Finding = struct { goal: Text(4096), evidence: Evidence, answer: Answer };
pub const Found = struct { occurrence: u64, finding: Finding };
pub const Report = struct {
    task_id: u64,
    generation: u64,
    mode: Mode,
    remaining_moves: u32,
    findings: []const Found,
};
pub const SNAPSHOT = "agent.repository.snapshot.v1";
pub const READ = "agent.repository.read.v1";
pub const HUMAN = "agent.repository.human.v1";
pub const RELEASE = "agent.repository.investigation-release.v1";
