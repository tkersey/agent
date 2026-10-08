# Native single-binary applications

Build and operate **Native Single-Binary Agentic Systems v1.2**
(October 6, 2026). `repository-agent` shares a human CLI and `agent-host/1.0`
stdio interface. Native core, protocol and provider-backed reference integration
are implemented; [qualification](native-single-binary-qualification.md) records
executed subjects, and [PR #45](https://github.com/tkersey/agent/pull/45) maintains
the current delivery head, Linux evidence and serial review disposition.
The fixed-profile native application precedes the separate adaptive application.

## N0: consumer audit

The starting Agent revision is `a59e250be2a85dab1661fdad012c82fa18b5c546`.
Its unchanged dependency lock selects World
`35f11b811b03fcaa2d696265ff8d9b9c92c8fc95` and Boundary
`c49f743382257c7cf5512934ae3a2d0f56d4d4c0`. Setup authenticates their source
archives, complete inventories, Git trees, Boundary package, and existing WASM
runtime bundle. Source identity and WASM artifact identity remain distinct.

The independent API consumer is `test/consumers/native/`. It now reuses the
minimal application's emitted BPI3 rather than compiling a second toy program.
It uses public `Prepared` and `Resident` APIs within an explicit 4 MiB allocation
domain. The same executable supplies the focused native HTTPS fault probe.

```sh
node tools/agent4/setup.mjs
zig build check-native-consumer -Doptimize=safe \
  -Dworld-runtime="$PWD/.agent4/out/world-runtime/runtime"
```

The independently expected numeric result is `41`: the authored caller retains `20`,
calls a child that requests a native increment (`21`), yields, and adds the
retained value after restoration, answers the minimal application's question,
and services its cleanup. The consumer also supplies an insufficient
output buffer, checks unchanged checkpoint bytes, and then supplies the same
reply successfully. Closing the completed restored resident rejects later use.
This witness is included once in `check-native`, sharing the actual minimal
application image. It is not a production host or application policy loop.
The increment's v2 reply is optional: overflow returns no value, which the
authored child converts to application failure with cleanup. Both arithmetic
boundaries preserve the full admitted `u32` input domain without creating
unknown environmental delivery.

The initial N0 commit also passed the complete existing CI matrix on Linux:
[run 37518433037](https://github.com/tkersey/agent/actions/runs/37518433037).
That run predates the build-helper and protocol changes below.

Executed on macOS arm64 with Zig 0.17.0, safe optimization: **9/9 build steps
passed**, including the native run. A copy ran from an unrelated directory
containing spaces and Unicode, with `PATH=/nonexistent`. Binary inspection
reported Mach-O arm64 and `/usr/lib/libSystem.B.dylib`. This establishes an
embedded consumer launch, not the full source-denied deployment qualification,
Linux execution, persistence, protocol, TLS, or live-provider acceptance.

The initial build rejected an authored addition without its required overflow
failure value. The corrected program supplies that value through the existing
source primitive contract; the expected result and native assertions are unchanged.

## N1 build and discovery

The build/discovery slice at `c1019e9585c6df152b14f090ba9c2aab688bdb8f` passed
[the full Linux CI matrix](https://github.com/tkersey/agent/actions/runs/37530534951),
including the copied executable's offline demo and complete current
framing/discovery peer, plus 65 native tests. This was narrower than N1/N2
acceptance and did not include the native dependency module's own unit tests.
Those now run as a separate root: head `d1922bc` passed its native lane with
81 tests, including 13 runtime unit tests and the authored task-owner restart,
question/answer and inbox integration case. These historical slices do not
substitute for the later complete-product qualification linked above.

`build.zig` now exports `addNativeSystem`. The helper runs
`tools/native/emit.zig` on the build host, using the application's `agent.system`
definition. It emits one canonical image plus application schemas, declared
capabilities and immutable resources. The target imports only the native
environment, World, Boundary data, ordinary Agent codecs, and the application's
compiled handlers/types. A separate build-time tool binds compiler/library,
dependency, target, resource and license metadata without embedding private
build paths or a circular executable hash.

The reusable application asset value includes its type source. Supplying an
already emitted application for another target cannot silently ignore a second
definition or separately substitute a type mapping. Set
`application = .{ .emitted = first.assets }` on the second target build to share
the same generation step. Target manifests remain distinct.

The complete example source is in `examples/native-minimal/`: `types.zig`
declares its client values, `definition.zig` authors the computation and assets,
and `environment.zig` declares three static typed native handlers. The example
retains its input over an increment, yields, asks for a label and performs
authored cleanup before returning. The explicit offline demo supplies a
deterministic label through the durable task owner also used by stdio.

```sh
node tools/agent4/setup.mjs --native
zig build native-example -Doptimize=safe \
  -Dworld-runtime="$PWD/.agent4/out/world-runtime/runtime"
./zig-out/bin/agent-native-example --help
./zig-out/bin/agent-native-example describe-build
./zig-out/bin/agent-native-example demo --offline --state-dir ./demo-state
./zig-out/bin/agent-native-example serve --transport stdio --offline --state-dir ./agent-state
```

For a downstream build, use the example's own `build.zig` and `build.zig.zon`,
with the Agent dependency pointing to the admitted package. Supply the same
authenticated `-Dworld-source`, `-Dworld-runtime`, and `-Dsqlite-source` inputs
used by Agent setup (`.agent4/inputs/sqlite` is the default native source).
For example, after setup from the repository root:

```sh
agent_root="$PWD"
cd examples/native-minimal
zig build -Doptimize=safe \
  -Dworld-source="$agent_root/.agent4/inputs/world" \
  -Dworld-runtime="$agent_root/.agent4/out/world-runtime/runtime" \
  -Dsqlite-source="$agent_root/.agent4/inputs/sqlite" \
  --prefix "$agent_root/public-native" --prefix-exe-dir executables
"$agent_root/public-native/executables/agent-native-example" demo --offline --state-dir ./demo-state
```

The helper installs the executable through the caller's normal prefix and
executable directory. Linux's host-default product target is x86_64 musl;
macOS's supported product target is arm64. Explicit other product targets reject.
The native consumer audit uses the delivered ABI when that target runs on the
qualification host, including musl on Linux.

The native client mapping is `agent-client-values/1.0`: bounded text is a JSON
string, bounded bytes use unpadded canonical base64url, 64-bit integers use
canonical decimal strings, smaller integers use JSON integers, products use
closed named objects, and sums use `{tag,value}`. Optional values use JSON null.
Provider v3/v4 JSON schemas retain their existing numeric meaning. Runtime
admission checks the embedded client and wire schemas against the actual types.

The framing/parser and static registry have focused negative tests. The
independent subprocess peer exercises the copied final example executable,
offline demo, fragmented Unicode/CRLF, coalesced input, malformed/duplicate JSON,
negotiation, discovery, notification suppression, batch correlation and truncated
or oversized input. The N1 CI run above qualifies that bounded slice; N0 alone
does not establish these observations.

Supplying `--state-dir` enables the durable task service. Omitting it in `serve`
mode provides discovery only and advertises task execution as disabled. The
minimal application supports exact question/answer delivery; its message-input
flag is false because it does not poll an inbox. The shared task-owner test uses
an authored inbox application. The repository analyst uses that
same input boundary.
New messages must match the saved task's application, image and message schema.
Opening a namespace with another application permits authorized reads but cannot
acknowledge incompatible input. Queuing a compatible message does not itself
resume execution or require replacing the task's frozen launch profile.
CLI `status` and `result` use the namespace's current read authority without
loading execution configuration or credentials. Read responses retain the saved
application and schema IDs; discovery validates known current value contracts
conditionally and permits historical contracts. Mutation parameters remain bound
to the current application. Question presenters receive the admitted profile and
environment context, just as leaf handlers do.

The new stdio loop uses nonblocking pipes, bounded response reservations,
outstanding-ID tracking, an ordered writer and one environmental I/O worker.
Incomplete frames have a 30-second deadline; stalled output and shutdown have a
five-second grace budget. EOF parks and exits. A worker that cannot join by the
hard deadline is terminated with the process while its durable dispatch remains
recoverable as unknown. No background worker is allowed to outlive release of
namespace ownership. The main requested-byte budget is 64 MiB, including a
separate 16 MiB worker region and SQLite's heap; allocator/OS overhead is not an
RSS guarantee. These new transport behaviors still need the complete reference
qualification, including the controlled HTTPS provider cases.

The database has a 256 MiB page ceiling; SQLite's temporary rollback journal is
additional bounded filesystem space. A dispatched leaf reserves 16 MiB for its
reply and successor publication, retains 11 MiB after acquisition, and releases
that reservation only when World consumption commits. Every intervening mutation
checks the remaining reservations before committing, so queued admissions cannot
spend another operation's reserved capacity. Unknown delivery retains its
reservation and immutable attempt record. Positive evidence that invocation never
began permits cancellation or an explicit resume; it does not refund the attempt.

## N2 storage and input foundations

Head `52cdf12` passed the full Linux matrix, including 86 native tests, 83
independent protocol-schema cases, CLI answer replay, lost-ack process death,
unread stdout, the partial-frame deadline and a quiet connection surviving that
deadline. Later qualification includes the archive changes described below.

Human commands use the same typed task owner as stdio. `run --offline
--state-dir PATH --input-json '{"value":20}' --operation-id ID` runs until a
terminal outcome or a durable question/blocker, then prints the current typed
result/status. `status`, `result`, `resume` and `cancel` accept `--task-id ID`;
omitting it requires exactly one visible applicable task (nonterminal for resume
and cancel). They reject with exit 75 while another process owns the namespace.
Resume supports `--expected-revision N`; retransmission with the same
`--operation-id` must preserve that revision and explicit task ID. Without an
operation ID, a fresh invocation uses a new random ID. Cancellation output
reports actual cleanup status. Answer with `respond --task-id ID --question-id
ID --question-revision N --request-digest SHA256 --answer-json JSON`, retaining
the binding printed by status and the same operation ID when retransmitting.
The CLI never supplies an implicit answer or substitutes a newer question.
Execution commands return 1 for application failure and 2 for unknown, blocked,
parked or unfinished cancellation/cleanup, with the actual state in their JSON
output. Incomplete cleanup takes precedence when the application also failed.
Read-only status/result queries return 0 when the query succeeds.
Serve-mode ownership distinguishes terminal execution from settled cleanup.
Failed cleanup retains its task ID for the final `server.closed` recovery list
and exit 2, without scheduling the task again. It occupies one of the host's
16 ownership slots until that process exits; operations needing a new slot
reject with `Capacity` before durable acknowledgment when all slots are occupied.
Reopening exposes those durable results but does not resume terminal work.

`examples/native-minimal/stdio-client.mts` is an optional TypeScript subprocess
client, executed with Node 26's built-in type stripping in the existing peer
check. Node is needed only by this example client. It correlates string RPC IDs,
bounds requests and frames, delivers notifications, and parks by closing stdin.
It does not retry ambiguous operations automatically. Keep decimal counters as
strings and retain the original `client_operation_id` and parameters for retries.
`Overloaded`, `InternalError` and `StorageUnavailable` do not prove that an
operation was unadmitted: response projection can fail after durable commit.
Their `retry_same_operation_or_inspect` guidance means reuse that original
operation ID and parameters or inspect its task, never invent a new ID to retry
potential provider work.

```ts
import {AgentClient} from './examples/native-minimal/stdio-client.mts';
const client = new AgentClient('/absolute/path/agent-native-example',
  ['--offline', '--state-dir', './state'], {
    onNotification: event => { /* persist task.event's last processed seq */ },
  });
await client.initialize();
const accepted = await client.call('task.submit', {
  client_operation_id: 'my-stable-submission-id',
  application_id: 'native-minimal', profile_id: 'offline',
  input: {schema_id: 'native-minimal.input.v1', value: {value: 20}},
});
// Query task.status for the durable question. Send task.respond with its exact
// question_id, question_revision, request_digest and answer schema/value.
await client.close(); // inspect the returned process exit disposition
```

The subprocess qualification demonstrates submission, historical/live event
delivery, exact question response and independently expected typed completion
through this client. An RPC response acknowledges that method, not overall task
completion; use `task.result` and its `ready` field for the latter.

Offline `describe` returns a Draft 2020-12 `protocol_schema` document, or a
`protocol_schema_ref` when the complete description exceeds the inline budget.
Large application discovery metadata similarly uses `application.metadata_ref`. Retrieve these
immutable public descriptors through `artifact.read` without `task_id`, using
the reference's `artifact_id`, decimal `offset` and decimal `length` (1–32768).
Concatenate the base64url-decoded chunks, check their `sha256` and total length,
then parse JSON. Discovery-only launches expose only these embedded public
descriptors; task artifacts require their owning `task_id` and current grants.
Large typed results use `outcome.value_ref` with the same bounded chunk format.

For an enabled task service, `describe.profile` reports the admitted profile's
`id`, `sha256`, and aggregate `resource_identity`; select that `id` in
`task.submit`. The resource identity binds the image, frozen profile and ordered
immutable resource set used by the declared capability roles. Discovery-only
launches return `profile: null`. Profile contents, credentials and private
resource payloads are not disclosed.

Each
method's `params_schema` and `result_schema` identify definitions within that
document; request/response envelopes, protocol errors and server notifications
have definitions too. References remain local. Its content-derived URN and the
`protocol_schema_sha256` in `describe-build` bind the application-specific
schemas. Potentially full-width counters are exact bounded decimal strings.
`x-max-utf8-bytes` supplements JSON Schema's character-count bounds where the
wire contract limits UTF-8 bytes. Stateful authorization and revision checks
still occur in the task owner after value admission.

The reference store retains event history and replay receipts within the
advertised 256 MiB namespace quota; it rejects capacity exhaustion rather than
silently evicting replay protection. It does not automatically prune event
prefixes. An imported archive may retain a later contiguous event suffix.
`task.events` and `task.subscribe` then reject older cursors with `CursorExpired`,
`earliest_available_seq`, `high_water_seq`, and `recovery: read_status_or_result`.
Read `task.status`/`task.result` before choosing a cursor in the retained range.

The native peer validates captured responses/events and independent boundary
cases with `jsonschema==4.23.0` through `uv run`. This is a qualification-only
dependency; neither Python nor a schema interpreter is linked into or required
by the deployed executable.

### Checkpoint archive profile

`export-checkpoint --offline --state-dir PATH [--task-id ID] --output FILE`
writes a private `agent-native-checkpoint/1` archive without replacing an
existing file or retiring the source before publication. The file must be
outside the state namespace. `import-checkpoint --offline --state-dir NEW_PATH
--input FILE --operation-id ID` admits it atomically into a fresh namespace.
The current `offline_copy` profile requires the same principal/tenant, exact
application/image/frozen profile, ordinary record schemas, World/Boundary
revisions, compiler version, optimization and native host contract. The native
artifact identity is explicitly rebound to the importing executable, with its
source identity retained in an origin record. Current grants are independent;
neither import nor its retransmission starts work.

Native grants bind the application image, frozen profile and ordered immutable
resource references. Both dispatch and answer acquisition compare that binding
with the task's durable references; a grant for another profile or snapshot
cannot authorize the task merely because its capability name and role match.

Task IDs, question bindings, queued messages, event sequences, operation aliases,
acquired replies and spent counters travel together. Unknown or dispatching
occurrences reject export/import. Missing, changed, unreferenced or oversized
objects reject; a failed import rolls back before admission. Normal resume keeps
its existing exact native-artifact check. This profile is a controlled data
copy, not distributed custody, producer authentication or permission to run two
copies concurrently. `offline_copy` describes this transfer discipline; a settled
task may retain either an offline or live provider profile. Keep `--offline` only
for an offline task. Export and import do not require or acquire inference.

An imported applied-cancellation marker requires cancellation intent and matching
World state. For unfinished work, reapplying that control at zero steps must leave
the observation and checkpoint unchanged. Pending intent and authored cancellation
remain distinct; validation neither runs cleanup nor dispatches native work.

Repository snapshots and every interpreted provider capture's reply, replay
objects and usage travel in that same closure. Export and import reproduce the
projection from its saved request/response through the pure adapter and compare
its committed bytes and counters. Uninterpreted captures remain nonportable.
Capture completeness is derived from settled physical attempts and their compiled
handler contracts, including responses with absent usage. Not-sent attempts need
no capture. The pending-message queue must contain every queued or acquired
message exactly once and exclude consumed or not-consumed history. A saved
follow-up acknowledgment must still resolve to its message record.
Import configures adapters from the archive's digest-checked frozen resources,
without recapturing the original filesystem paths or loading archived grants.

The file starts with a 32-byte little-endian header: `AGNX0001`, u32 manifest
schema length, u32 manifest length, u32 object count, zero u32 flags, and u64
object-payload length. It then contains the existing ordinary Agent schema and
encoded `state.Archive` value, followed by immutable objects in digest order.
References carry SHA-256 and byte length. The archive includes ordinary schemas
for task/event/receipt and each record kind, so an independent reader can use the
existing value codec; canonical BPI3/PST3/PKO3 bytes are unchanged.

Limits are 256 MiB for the whole file, 64 KiB for its manifest schema, 1 MiB for
its manifest, 4,096 objects of at most 16 MiB each, 1,024 records, and 2,048 events
and operation bindings each. Existing evaluator, SQLite and 64 MiB host limits
still apply. Files are private and regular; path components and physical working
directory ancestry are checked. Publication fsyncs the file, links the complete
temporary file without replacement, and fsyncs the directory. A process crash
can leave a private temporary link; hashes establish integrity, not power-loss
guarantees beyond the selected filesystem's fsync behavior.

The optional native dependency lock selects SQLite 3.53.4. Its official archive
and amalgamation SHA3 digests were checked against
[SQLite's published download](https://www.sqlite.org/download.html) and
[release history](https://www.sqlite.org/changes.html). Setup authenticates the
archive before extracting only the declared C/header files. The native build
rechecks those files and derives the embedded public-domain notice from the
authenticated header. `setup --authoring-only` does not acquire this dependency.

SQLite is compiled into the native environment, with extension loading disabled
and an explicit 16 MiB MEMSYS5 heap. The build and running allocator consume the
same heap setting; the manifest records the actual C flags and source identity.
Linux links the selected toolchain's musl libc and embeds its license. The
database wrapper refuses an uncapped allocation fallback and verifies the linked
SQLite version.

The current namespace format is `agent-native-state/7`. Task, receipt, question,
message and event indexes reference the same hash-checked immutable object store
as checkpoints and replies. A changed record body rejects before interpretation;
foreign keys and task revision checks bind its index. Earlier development state
formats reject rather than being initialized over.

The namespace requires a private directory owned by the launching OS principal,
regular single-link files, and root/current-principal-owned ancestors that other
users cannot replace (sticky system temporary directories are allowed). Symlinks
are not followed. The reference trust boundary includes the OS administrator and
the launching principal. The database/head seal detects an older database against
its published seal and repairs the single committed-but-unsealed crash window;
it is not a claim to detect restoration of an entire old namespace and seal or
arbitrary malicious writes by the trusted OS principal. Power-loss qualification
remains separate from process-crash recovery.

Tasks bind the SHA-256 of the executing native artifact. `describe-build` reports
that observed hash and byte count separately from `embedded_manifest_sha256`;
the independent process peer compares them with the copied file. A changed binary
cannot silently resume an old task. Reading the executing artifact requires the
platform's executable-file facility (procfs on Linux) and readable executable
bytes. The manifest remains free of a circular embedded executable digest.

The native occurrence adaptation preserves READY → DISPATCHING → acquired/UNKNOWN
ordering from `runtime/mobility/custody.mjs`. UNKNOWN cannot dispatch or cancel
itself; a matching late acquired reply may settle it. Answer acquisition binds
the current question and pending request and serializes against cancellation.
Retired occurrences retain their acquired reply or cancelled-question facts.

Capturing adapters add a CAPTURED boundary before interpretation. The task owner
persists the rendered non-secret request before dispatch and exact raw response
before calling the pure interpreter. Preparation and interpretation receive only
frozen task bindings and immutable object reads. Interpretation publishes its
typed reply, replay object references and usage together in the capture record.
Restart can interpret the saved capture
without invoking the adapter again; a failed interpretation retains those bytes
and blocks the task. Captures awaiting interpretation are not exportable. This
owner mechanism is shared with the native Responses transport and the integrated
controlled-HTTPS repository witness. Live provider qualification is separate.

`agent.inbox.Profile(Message).poll(context)` is a reusable ordinary authored
effect. Its reply is either empty or an identified typed message. Its codecs
and semantic identity belong to `agent_contracts`, shared with the native
declaration. An incompatible redeclaration rejects. A single image/public-World
test covers empty and distinct Unicode-bearing messages with prepared-image reuse.
Durable queue acquisition/consumption is implemented and exercised by the
task-owner fixture. The repository application's recorded question/inbox/provider
continuation has also passed native/WASM/native parity. Current qualification is
Linux-only; the macOS observations remain bound to their historical subjects.

## Existing owners and remaining gaps

* World already supplies native `Prepared`, `Resident`, transactional drive,
  checkpoint/restore, and terminal close. N0 demonstrates no generic World
  deficiency. No World or Boundary change is currently needed.
* `src/model_invocation.zig` owns the additive v5 reference contract alongside
  the existing v3/v4 contracts. Its bounded replay artifacts use the checked
  responder. The native corpus and compatible JavaScript v3 intersection are
  qualified independently of a production JavaScript v5 host.
* `src/responders.zig` already supplies checked replay interpretation against
  the offered actions. Native normalization cannot replace that admission.
* `runtime/mobility/custodian.mjs`, `journal.mjs`, and their core own dispatch
  admission, attempt charging, acquired replies, deferred questions, unknown
  delivery, and checkpoint successor semantics. The standalone native adapter
  must preserve those semantics without opening a live multi-host database.
* The durable task/occurrence owner, authored inbox, stdio protocol/client,
  native HTTPS and snapshot tools, and fixed-profile repository analyst are
  implemented. Current Linux qualification includes clean deployment,
  the public downstream recipe, crash/restart, controlled TLS, protocol faults,
  recorded backend parity and bounded cold/warm/resource-edit measurements.
* The acceptance map names all 112 obligations. Current proof and serial-review
  completion are recorded on the PR; this runbook does not certify a later head.
  Live inference requires separate explicit authorization and operational inputs.

The [acceptance matrix](native-single-binary-acceptance.md) tracks every v1.2
obligation. Supporting N0 evidence is not a completed product acceptance row.
Run-specific component evidence does not establish full NB-001–NB-112 acceptance
or live qualification.
