//! Portable repository-repair contracts, migrated from the retained predecessor fixture.
const contracts = @import("agent").contracts;

pub const Path = contracts.Text(256);
pub const GoalText = contracts.Text(2048);
pub const QueryText = contracts.Text(256);
pub const ExcerptText = contracts.Text(256);
pub const FileText = contracts.Text(32 * 1024);
pub const ProcessText = contracts.Text(4 * 1024);
pub const SummaryText = contracts.Text(4096);
pub const DigestHex = contracts.Text(64);

pub const Goal = struct {
    task: GoalText,
    repository: contracts.Text(128),
};

pub const EntryKind = enum { file, directory };
pub const TreeEntry = struct {
    path: Path,
    kind: EntryKind,
    byte_length: u32,
};
pub const CompactTreeEntry = struct {
    path: Path,
    kind: EntryKind,
};
pub const ListResult = struct {
    entries: contracts.Vector(CompactTreeEntry, 32),
    truncated: bool,
};
pub const CompactListing = ListResult;

pub const DocumentRole = enum { package, source, @"test" };
pub const ReadRequest = struct {
    role: DocumentRole,
    path: Path,
};
pub const ReadResult = struct {
    role: DocumentRole,
    role_code: u8,
    path: Path,
    sha256: DigestHex,
    contents: FileText,
};

pub const SearchRequest = struct {
    query: QueryText,
    path_prefix: Path,
};
pub const SearchHit = struct {
    path: Path,
    line: u32,
    excerpt: ExcerptText,
};
pub const SearchResult = struct {
    hits: contracts.Vector(SearchHit, 8),
    truncated: bool,
};
pub const CompactSearchHit = SearchHit;
pub const CompactSearch = SearchResult;

pub const TestSuite = enum { default };
pub const TestRequest = struct { suite: TestSuite };
pub const SourceVersion = struct { path: Path, sha256: DigestHex };
pub const TestInvocation = struct { request: TestRequest, expected_source: ?SourceVersion };
pub const TestResult = struct {
    exit_code: i32,
    passed: bool,
    stdout: ProcessText,
    stderr: ProcessText,
    stdout_truncated: bool,
    stderr_truncated: bool,
};
pub const CompactTestResult = struct {
    exit_code: i32,
    passed: bool,
    stdout_truncated: bool,
    stderr_truncated: bool,
};

pub const ReplaceRequest = struct {
    path: Path,
    expected_sha256: DigestHex,
    replacement: FileText,
    rationale: SummaryText,
};
pub const ReplaceApplied = struct {
    path: Path,
    old_sha256: DigestHex,
    new_sha256: DigestHex,
    already_applied: bool,
};
pub const ReplaceDenied = struct { reason: contracts.Text(256) };
pub const ReplaceConflict = struct {
    path: Path,
    expected_sha256: DigestHex,
    actual_sha256: DigestHex,
};
pub const ReplaceOutcome = union(enum) {
    applied: ReplaceApplied,
    denied: ReplaceDenied,
    conflict: ReplaceConflict,
};

pub const ReplacementSummary = ?ReplaceOutcome;
pub const Memory = struct {
    listing: ?CompactListing,
    package_document: ?ReadResult,
    source_document: ?ReadResult,
    test_document: ?ReadResult,
    latest_search: ?CompactSearch,
    latest_test: ?CompactTestResult,
    replacement: ReplacementSummary,
    failing_test_observed: bool,
    mutation_applied: bool,
    passing_test_observed: bool,
    // Successful mutation evidence has a different lifetime from the latest outcome.
    applied_source: ?SourceVersion,
};
pub const DecisionEvidence = struct {
    failing_test_observed: bool,
    mutation_applied: bool,
    passing_test_observed: bool,
};
pub const DecisionView = struct {
    listing: ?CompactListing,
    package_document: ?ReadResult,
    source_document: ?ReadResult,
    test_document: ?ReadResult,
    latest_search: ?CompactSearch,
    latest_test: ?CompactTestResult,
    replacement: ReplacementSummary,
    evidence: DecisionEvidence,
};

pub const FinalResult = struct {
    summary: SummaryText,
    changed_files: contracts.Vector(Path, 4),
    tests_passed: bool,
    final_source_sha256: DigestHex,
};

pub const Failure = enum {
    budget_exhausted,
    arithmetic_overflow,
    invalid_index,
    invalid_variant,
    capacity_exceeded,
    authored_abort,
    uncertain_delivery,
};

pub const Action = union(enum) {
    list_repository: void,
    read_file: ReadRequest,
    search_text: SearchRequest,
    run_tests: TestRequest,
    replace_file: ReplaceRequest,
    final: FinalResult,
    abort: Failure,
};

pub const Observation = union(enum) {
    list_repository: ListResult,
    read_file: ReadResult,
    search_text: SearchResult,
    run_tests: TestResult,
    replace_file: ReplaceOutcome,
};
