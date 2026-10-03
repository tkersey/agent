# Effect-directed mobility (in development)

The public `agent.mobility` module defines the v1 placement schemas and explicit
`resolve(context, owner, input)` and `relocate(context, owner, input)` authoring
operations. These construct ordinary Boundary effects. They do not perform
network I/O or transfer custody themselves.

`ensure(context, input, failure)` compiles the default bounded placement strategy
into the program. `input` is a source value of `mobility.EnsureInput`; `failure`
is a literal of the enclosing program's failure type for checked arithmetic.
The result is `Ready { observation, remaining_moves }` or `Failed(Reason)`.
`Here` succeeds even with a zero move/attempt budget. Candidate selection enforces
host/domain constraints, rejects malformed identifiers, prefers explicit affinity,
orders known saturating cost sums before unknown costs, and breaks ties by host
ID. Refusal retries distinct hosts up to `min(budget.attempts, 32)`; successful
arrival consumes one move. The default budget is 16 moves and three attempts.
There is no implicit delay or unbounded re-resolution loop. Applications can
compose `resolve` and `relocate` for another authored strategy or backoff policy.
The host must independently enforce registered move limits and actual authority.

Both operations carry the distinct `mobility` role. Their identities are
reserved, emissions require a registered construction site, and protected
speculation cannot admit them through an allowlist. The existing opaque-tool
restrictions remain in force. `RelocationReply` has only `Arrived` and `Refused`;
unknown custody must never resume the source program.

Run `zig build check-mobility-authoring` for the current contract/admission
checks. These checks are included in `check-agent4`.

The independent consumer in `test/consumers/mobility` now moves at its own typed
relocation calls, reads a real fixture through the compiled text component,
returns to a human binding, resumes an owned child, and completes protected
cleanup. Its caller retains task ID `123` and marker `9001`; the child returns
`91`. The expected fixture result is 42 bytes and four LF newlines. Refusal takes
an authored fallback without performing the read. Cancellation at relocation
discharges the suspended child's cleanup without resuming its normal work.

`check-mobility-continuation` checks fresh resident instances and exact parked
state/request preservation. `check-mobility-browser-continuation` executes the
same 4,421-byte image in Chromium and Firefox Workers and a separate Node process.
It physically terminates the first Worker before data execution and verifies
that the data process has exited before the new Worker restores its successor.

```sh
zig build check-mobility-continuation check-mobility-browser-continuation \
  -Dworld-runtime=/absolute/authenticated/world-runtime \
  -Dworld-source=/absolute/authenticated/world-source \
  -Dworld-archive=/absolute/authenticated/world-source.tar.gz \
  -Dbrowser-tools=/absolute/locked-playwright-tools
```

These are **test scaffolds, not the durable custody reference route**. Their
synthetic arrival receipts and empty immediate-requirement lists isolate
continuation behavior; they provide no authority or custody safety evidence.
The approval/write variant, remaining recovery cases and matched measurements
remain required. The durable source-free browser lane is described below.
The full acceptance suite and serial review closeout remain unfinished.

The continuation target also executes fifteen independent `ensure` cases in
World, including `Here`, constraints, affinity, deterministic ties, unknown and
overflowing costs, malformed candidates, refusal retries, exhaustion and the
32-candidate bound. The browser consumer uses `ensure` for both legs.

`check-mobility-native` additionally invokes the native public World protocol
consumer on each exact input for the round-trip, refusal and cancellation cases.
All 24 canonical outcomes agree byte-for-byte with WASM, including the pending
request/state at each semantic boundary. The independent final-result, request
order and cleanup assertions remain in force; native agreement alone is not a
custody or authority proof. Supply the same runtime/source/archive arguments.

## Durable reference host

`runtime/mobility` now contains a restricted canonical JSON codec, closed signed
registration/offer/decision records, pure custody transitions, public-World
admission, a SQLite journal, the policy gateway, and the custodian. Journal methods
are privileged environmental operations; they are not user-facing RPCs. The mTLS
peer server and authenticated browser-origin bridge are implemented.

The custodian drives actual World outcomes, retains its resident executor between
durability boundaries, and dispatches only the current committed request. Local
grants bind tenant, principal, complete schemas, role, subject/version, scope and
audience. An image-bound conservative cleanup manifest must be supported at the
destination. Classification joins happen before results enter World; neither a
requested export policy nor a public-looking current payload lowers the label.

Publication tokens now bind the exact predecessor outcome and actual saved
control input. Only World execution creates these tokens. A structurally admitted
checkpoint cannot masquerade as a successor. The optional browser-report verifier
executes the same bounded step in the pinned kernel and compares the result;
it does not redispatch external effects. Its cost remains to be measured in the
integrated browser lane. Cancellation consumption commits with its World successor,
so recovery answers pending cleanup rather than repeatedly submitting cancellation.

The journal stores artifacts in the transaction, freezes the source with its exact
outbox, serializes target acceptance against permanent refusal, and preserves
saved receipt and arrival bytes. Epoch/revision/incarnation checks fence executor
publication. Dispatch admission, unknown occurrences, acquired replies and
classification joins use the same database. Unknown never thaws custody. A
returning host must have retired its previous custody before accepting a newer
epoch. Small replay-prevention records are retained; there is no timeout GC.
Explicit artifact collection preserves current, offered, staged and accepted
recovery references and removes only unreferenced bytes, never terminal decisions.

Acceptance hashes an immutable core first, signs the receipt containing that core
hash, then encodes arrival using the receipt hash. The core, receipt, arrival and
incoming artifacts commit atomically. This ordering has no recursive row hash.
Signing keys stay environmental. Saved verification bindings support exact
historical decisions and receipts for outstanding offers across ordinary rotation;
compromised keys do not receive that exception.

The reference store requires an owned private directory, rollback-journal mode,
`synchronous=EXTRA`, and `fullfsync=ON`. Initialization is explicit; ordinary open
refuses missing storage. The operator supplies a trusted deployment generation
independently of the database. A known mismatched generation is quarantined.
A self-consistent old backup cannot reveal its own rollback: never restore one
under a live host identity without external fencing and reconciliation. Sensitive
deployments additionally require a qualified encrypted storage boundary.

```sh
zig build check-mobility-protocol check-mobility-journal \
  -Dworld-runtime=/absolute/authenticated/world-runtime \
  -Dworld-source=/absolute/authenticated/world-source \
  -Dworld-archive=/absolute/authenticated/world-source.tar.gz
```

Six protocol tests cover RFC Unicode ordering/escaping, duplicate keys, malformed
records, signatures, key ownership/retirement and counters. Twenty journal tests
cover accepted/refused recovery, exact retries, frozen outboxes, injected storage
failure, stale executors, persisted uncertain/acquired occurrences, schema parity,
and six actual SIGKILL points around freeze, acceptance and reply-acquisition
commits. They use real admitted World bytes and isolated temporary Ed25519 keys.

The tested crash profile is macOS 27.2 arm64, local APFS, Node v26.10.0 and SQLite
3.53.4. Process termination and transactional fault injection do **not** establish
power-loss durability, network-filesystem safety, storage-rollback detection, or
the complete protocol fault matrix. See the [Node SQLite API](https://nodejs.org/api/sqlite.html),
[SQLite synchronization semantics](https://www.sqlite.org/pragma.html#pragma_synchronous),
and [RFC 8785](https://www.rfc-editor.org/rfc/rfc8785.html) for the underlying interfaces.

`check-mobility-integration` uses the same dependency arguments and currently runs
seventeen host cases plus seven mTLS transport cases. The host cases complete A→B→A using real
requirements and signed receipts, restarts both custodians, reconciles a lost old
acceptance before a return, rejects stale/unbound successor publication, blocks
uncertain delivery, and preserves cancellation/cleanup under revocation. The
server-only fixture case denies return before any state bytes or preflight go to
the browser host—even when the program requests a public export policy. Dispatch
negatives cover tenant, principal, complete schema, semantic role and subject.
Another privacy case retains an origin-only marker in the child's cleanup capture
and rejects export despite a public-looking current placement payload. Successful
round trips also assert that cleanup receives this captured marker at the new host.
Additional application cases execute an authorized local `Here` without a move,
take authored fallback for an unavailable destination, carry an actual file-version
conflict back to presentation, and leave an unsupported ordinary leaf parked
without inventing a relocation or reply.
The network cases use HTTPS with mutually authenticated, explicitly pinned peer
certificates and independent Ed25519 message keys. They exercise all staging and
decision endpoints, lost responses after acceptance, withdrawal, exact status
reconciliation, body/encoding bounds, unknown peers, private export rejection,
and artifact collection. Image cache hits transfer only the outcome. Endpoints
come from deployment configuration; the client rejects redirects and arbitrary
URLs. Both services run locally in this transport lane; the browser lane below
also exercises a separate data-host process from an extracted package.

`servePeers` exposes preflight, bounded image/outcome staging, decision, status,
withdrawal and narrowly authorized run-control endpoints. A peer certificate maps
to a configured logical host ID; no request header can choose that identity.
Staging metadata is authenticated and authorized before its body is buffered.
The client treats all HTTP errors, malformed replies and lost connections as
uncertainty, never as a refusal receipt. Test certificates are generated under an
isolated temporary directory and do not alter system trust stores. The transport
uses the platform [HTTPS](https://nodejs.org/api/https.html) and
[TLS identity checks](https://nodejs.org/api/tls.html#tlscheckserveridentityhostname-cert).

Cancellation during unknown custody first obtains a serialized withdrawal
decision. Refusal resumes only cancellation at the source; acceptance forwards
the request to the owner through authenticated control. Forwarding is bounded
and a failed delivery remains a durable pending intent. A returning custodian
retains an earlier unresolved cancellation. Neither forwarding nor cancellation
reactivates a departed epoch.

`check-mobility-browser` runs Chromium and Firefox against the durable origin
bridge and actual mTLS peers. The deployer supplies session authentication;
there is no permissive default. State access checks principal, tenant and audience.
Mutations check the exact origin/port and session CSRF token. Assignments have
fresh nonces and exact epoch/revision/incarnation bindings. Old tabs cannot
publish into later assignments. The Worker receives only approved image/state,
the pinned kernel identity, and saved control input. The host's resident World
instance verifies the reported successor before journal publication.

This lane builds and extracts the existing `agent4-use-archive` format, removes
its optional test oracles, and loads both hosts' production modules from the
extracted tree. Application Zig source, emitters and a bundled WASM kernel are
absent. The separately supplied runtime is fully authenticated before import.
The data host runs the shipped CLI in a separate Node process with no compiler
on its PATH. Worker A1 terminates before transfer delivery; the data process exits
before fresh Worker A2 restores the actual incoming checkpoint. Restarting that
data service leaves its departed run inert. Both engines preserve captured
cleanup, perform three real file reads and one close, and display the actual
typed presentation (42 bytes, four newlines) through the shipped browser client.
Missing sessions, wrong principal/origin, CSRF failures and stale assignments
remain negative checks. All keys/certificates are temporary test provisioning
outside the archive. These are local processes using real mTLS, not a measured
two-machine network deployment.

`zig build check-mobility-model` runs the specification's exact section 25 Python
model with `uv run --no-project`. It explores 28 states and finds the required
two-custodian counterexample when timeout takeover is deliberately enabled. This
small model omits real storage, cryptography, continuation data and multiple
epochs; it is not a proof of the implementation or the full fault matrix.

## Running the reference deployment

The use archive now includes `runtime/mobility`, the CLI and generic browser
client. It contains no signing keys, session credentials, TLS private keys or
World kernel. Supply the independently authenticated locked World runtime and
deployment-approved image, typed arguments and schemas. The existing inventory
locates and hashes artifacts; it never chooses the next application action.

Copy [the deployment example](mobility-deployment.example.json) outside the
archive and fill its paths and approved image/program/subject identities. Paths
are relative to that configuration file. Protect it and its private-key files
with local permissions. `keys` binds Ed25519 public keys to issuers/hosts; `peers`
binds logical host IDs to configured HTTPS endpoints and TLS certificate pins.
Message-signing keys and TLS keys are separate. `deployments` specifies tenant,
principal, destination, cleanup and export grants. `bindings` selects only
installed adapters, complete schema files, subject/version and allowed state
labels. The text adapter rechecks the actual file version on every read.
`fixed-reply` is an explicitly synthetic typed leaf adapter: it authorizes an
exact input digest and returns configured bytes, with no phase counter. It is
used by the isolated witness, not as a production human or model provider.

Set `execution` to `node` for a data executor and `browser` for a browser's durable
origin custodian. The latter does not drive application steps in the service
pump. Choose a private local journal directory and an externally maintained
`deploymentGeneration`; never derive that generation from a restored database.
The default journal bounds are 256 MiB of artifact bytes per tenant and 10,000
records per bounded table. Accepted/refused decisions and their verification
bindings are retained indefinitely; the journal's explicit artifact collector
deletes only unreferenced large bytes. Operators must monitor capacity. No
timeout deletes a decision or releases ambiguous custody.

```sh
# NODE is an absolute path to the qualified Node executable; CONFIG is local.
"$NODE" runtime/mobility/cli.mjs init "$CONFIG"
"$NODE" runtime/mobility/cli.mjs start "$CONFIG" run-registration.json program.bpi3 initial.args
"$NODE" runtime/mobility/cli.mjs serve "$CONFIG"
```

`init` is an explicit new-storage operation. An issuer creates `run-registration`
with `signRecord('run', record, issuerPrivateKey)` from `protocol.mjs`, using a
fresh `runId(issuer)` and the deployment-approved image/program/runtime and
principal/tenant tuple. Neither the CLI nor a peer can mint that authority from
an uploaded image. Start the initial run only at its registered initial host;
incoming hosts learn it through authenticated transfer, without replaying args.

For a browser origin, embed `openDeployment(CONFIG)` and pass its custodian to
`serveBrowser` with the verified `runtimePath` and `kernelBytes`, HTTPS key/cert,
the exact public origin, audience and an `authenticate(request)` function. This
function must validate the deployment's existing session and return
`{sessionId, principal, tenant, audiences}` or null. There is no default identity
or unauthenticated login. The reference client keeps assignment/CSRF data only
in memory; provision the session through the deployment's secure authentication
flow. Open the origin, enter the run ID and select **Connect**. **Continue** drives
the current typed outcome; after a move, the old Worker terminates. Connect again
after custody returns to create a fresh assignment. **Cancel** records intent at
the custodian and follows the same cleanup protocol. Closing a tab is physical
executor loss, not semantic cancellation.

Stop the peer service before local mutation/recovery commands. These commands
print metadata and receipts, not private captured values:

```sh
"$NODE" runtime/mobility/cli.mjs status "$CONFIG" "$RUN"
"$NODE" runtime/mobility/cli.mjs retry "$CONFIG" "$TRANSFER"
"$NODE" runtime/mobility/cli.mjs receipt "$CONFIG" "$TRANSFER"
"$NODE" runtime/mobility/cli.mjs withdraw "$CONFIG" "$TRANSFER"
"$NODE" runtime/mobility/cli.mjs cancel "$CONFIG" "$RUN" 'User cancelled'
"$NODE" runtime/mobility/cli.mjs recover "$CONFIG"
```

`ACTIVE` authorizes only the current incarnation and occurrence; incoming active
custody can wait for an executor. `OFFERED` is frozen, including after timeout.
`DEPARTED` cannot execute at its old epoch. `TERMINAL` has no next application
step. Retry preserves the exact signed offer. `accepted` and `refused` require a
matching saved signed receipt; `unknown` means the source remains frozen. A
pending cancellation at departed custody is a separate delivery question.
Recovery converts interrupted dispatch to unknown delivery without redispatch.

If the journal is lost, ordinary `serve`/`recover` fails closed; do **not** run
`init` under the same live identity as a recovery shortcut. A known rollback
generation mismatch is quarantined. Reconcile and fence externally before
provisioning a replacement host identity/generation. Ordinary key rotation keeps
old public verification bindings for historical decisions and outstanding
offers; mark compromised keys as compromised rather than retired. Neither a
rotation nor a failed local retirement grants a second custodian.

For two machines, provision the same locked runtime and approved image/contracts
on each, distinct host signing/TLS keys, mutual CA trust and exact certificate
pins. Set each peer URL to the other's reachable HTTPS service and restrict
network access to configured peers. Put the file adapter and its local filesystem
grant only on the data host; put the authenticated human origin on the other.
Use a persistent qualified local filesystem for each journal. An origin or peer
that stores checkpoint bytes is inside their confidentiality boundary. The local
acceptance lane does not establish power-loss durability or WAN performance.

The selected foundation is Agent `b1f9d2866b5717d16339e7022a3b4d08951f0770`
and its unchanged `conformance/agent4/dependencies.lock.json`: Boundary
`65f46131f366bdd21aa98701f4110ecb801d2c8d`, World
`a48d5fd0cb2d4fcbe79bc3188f354d7d036d29f5`, ABI 3, kernel SHA-256
`9627eb1e66239119bccb4ddcd43b4f6c757180dab930a9feb276671262f735d1`.
The new runtime must qualify these exact inputs before reporting execution.
