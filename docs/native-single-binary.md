# Native single-binary applications

Implementation in progress against **Native Single-Binary Agentic Systems v1.2**
(October 6, 2026). The required product is `repository-agent`, with a shared
human CLI and `agent-host/1.0` stdio interface. Its implementation is under qualification.
The fixed-profile native application precedes the separate adaptive application.

## N0: consumer audit

The starting Agent revision is `a59e250be2a85dab1661fdad012c82fa18b5c546`.
Its unchanged dependency lock selects World
`35f11b811b03fcaa2d696265ff8d9b9c92c8fc95` and Boundary
`c49f743382257c7cf5512934ae3a2d0f56d4d4c0`. Setup authenticates their source
archives, complete inventories, Git trees, Boundary package, and existing WASM
runtime bundle. Source identity and WASM artifact identity remain distinct.

The first independent consumer is `test/consumers/native/`. Its host emitter
uses `agent.system` and `agent.compile`; the deployed executable imports only
`world` and `boundary_data`, and embeds the resulting BPI3. It uses public
`Prepared` and `Resident` APIs, with an explicit 4 MiB allocation domain.

```sh
node tools/agent4/setup.mjs
zig build check-native-consumer -Doptimize=safe \
  -Dworld-runtime="$PWD/.agent4/out/world-runtime/runtime"
./zig-out/bin/agent-native-consumer
```

The independent expected result is `41`: the authored caller retains `20`,
calls a child that requests a native increment (`21`), yields, and adds the
retained value after restoration. The consumer also supplies an insufficient
output buffer, checks unchanged checkpoint bytes, and then supplies the same
reply successfully. Closing the completed restored resident rejects later use.
This witness is included once in `check-native`, sharing the existing fixture
emitter compilation. It is not a production host or application policy loop.

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

## N1 implementation under qualification

The build/discovery slice at `c1019e9585c6df152b14f090ba9c2aab688bdb8f` passed
[the full Linux CI matrix](https://github.com/tkersey/agent/actions/runs/37530534951),
including the copied executable's offline demo and complete current
framing/discovery peer, plus 65 native tests. This was narrower than N1/N2
acceptance and did not include the native dependency module's own unit tests.
Those now run as a separate root: head `d1922bc` passed its native lane with
81 tests, including 13 runtime unit tests and the authored task-owner restart,
question/answer and inbox integration case. Final CLI/protocol integration is
still under qualification; these earlier results do not qualify it.

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
The helper installs the executable through the caller's normal prefix and
executable directory. Linux's host-default product target is x86_64 musl;
macOS's supported product target is arm64. Explicit other product targets reject.
The native consumer audit still uses its platform's native ABI independently.

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
an authored inbox application. The required repository analyst will use that
same input boundary.

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
deadline. The archive changes below are newer and remain under qualification.

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
output. Read-only status/result queries return 0 when the query succeeds.

`examples/native-minimal/stdio-client.mts` is an optional TypeScript subprocess
client, executed with Node 26's built-in type stripping in the existing peer
check. Node is needed only by this example client. It correlates string RPC IDs,
bounds requests and frames, delivers notifications, and parks by closing stdin.
It does not retry ambiguous operations automatically. Keep decimal counters as
strings and retain the original `client_operation_id` and parameters for retries.

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

Offline `describe` returns a Draft 2020-12 `protocol_schema` document. Each
method's `params_schema` and `result_schema` identify definitions within that
document; request/response envelopes, protocol errors and server notifications
have definitions too. References remain local. Its content-derived URN and the
`protocol_schema_sha256` in `describe-build` bind the application-specific
schemas. Potentially full-width counters are exact bounded decimal strings.
`x-max-utf8-bytes` supplements JSON Schema's character-count bounds where the
wire contract limits UTF-8 bytes. Stateful authorization and revision checks
still occur in the task owner after value admission.

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

Task IDs, question bindings, queued messages, event sequences, operation aliases,
acquired replies and spent counters travel together. Unknown or dispatching
occurrences reject export/import. Missing, changed, unreferenced or oversized
objects reject; a failed import rolls back before admission. Normal resume keeps
its existing exact native-artifact check. This profile is a controlled data
copy, not distributed custody, producer authentication or permission to run two
copies concurrently. Provider/resource archive profiles remain pending N3/N4.

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
SQLite version. This primitive is not a completed task journal.

The current namespace format is `agent-native-state/6`. Task, receipt, question,
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
typed reply and replay objects together. Restart can interpret the saved capture
without invoking the adapter again; a failed interpretation retains those bytes
and blocks the task. Captures awaiting interpretation are not exportable. This
owner mechanism is present; the Responses transport and integrated provider
qualification remain in progress.

`agent.inbox.Profile(Message).poll(context)` is a reusable ordinary authored
effect. Its reply is either empty or an identified typed message. Its codecs
and semantic identity belong to `agent_contracts`, shared with the native
declaration. An incompatible redeclaration rejects. A single image/public-World
test covers empty and distinct Unicode-bearing messages with prepared-image reuse.
Durable queue acquisition/consumption is implemented and exercised by the
task-owner fixture. Native/WASM parity and complete reference qualification remain
pending.

## Existing owners and remaining gaps

* World already supplies native `Prepared`, `Resident`, transactional drive,
  checkpoint/restore, and terminal close. N0 demonstrates no generic World
  deficiency. No World or Boundary change is currently needed.
* `src/model_invocation.zig` and `runtime/model.mjs` already own additive
  `agent.model.invoke.v4` replay records, alongside unchanged v3. Reuse and
  qualify that owner; the inline replay representation still needs assessment
  against v1.2's bounded artifact references, exact provider grammar, and native
  transport requirements. Do not create another native-only model contract.
* `src/responders.zig` already supplies checked replay interpretation against
  the offered actions. Native normalization cannot replace that admission.
* `runtime/mobility/custodian.mjs`, `journal.mjs`, and their core own dispatch
  admission, attempt charging, acquired replies, deferred questions, unknown
  delivery, and checkpoint successor semantics. The standalone native adapter
  must preserve those semantics without opening a live multi-host database.
* The build/embedding/discovery slice above is under qualification. Remaining
  product work includes the durable task/occurrence owner, authored inbox,
  complete stdio protocol and client, native HTTPS and snapshot tools, and the
  useful fixed-profile authored repository analyst.
* Qualification still requires public downstream installation, cancellation and
  crash/restart, real TLS, protocol fault/control cases, native/WASM/native state
  transfer, both final platform artifacts, and separated measurements. Live
  inference requires separate explicit authorization and operational inputs.

The [acceptance matrix](native-single-binary-acceptance.md) tracks every v1.2
obligation. Supporting N0 evidence is not a completed product acceptance row.
No native-core, protocol, reference, target, or live-qualified product claim is
made at this stage.
