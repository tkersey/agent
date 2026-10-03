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
The durable browser bridge, cancellation forwarding across departed/ambiguous
custodians, the approval/write variant,
source-free use archive, recovery tests and matched measurements remain required.
The full acceptance suite and serial review closeout remain unfinished.

The continuation target also executes fifteen independent `ensure` cases in
World, including `Here`, constraints, affinity, deterministic ties, unknown and
overflowing costs, malformed candidates, refusal retries, exhaustion and the
32-candidate bound. The browser consumer uses `ensure` for both legs.

## Durable reference host (browser bridge pending)

`runtime/mobility` now contains a restricted canonical JSON codec, closed signed
registration/offer/decision records, pure custody transitions, public-World
admission, a SQLite journal, the policy gateway, and the custodian. Journal methods
are privileged environmental operations; they are not user-facing RPCs. The mTLS
peer server is implemented; the durable browser-origin bridge is still pending.

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
nine host cases plus six mTLS transport cases. The host cases complete A→B→A using real
requirements and signed receipts, restarts both custodians, reconciles a lost old
acceptance before a return, rejects stale/unbound successor publication, blocks
uncertain delivery, and preserves cancellation/cleanup under revocation. The
server-only fixture case denies return before any state bytes or preflight go to
the browser host—even when the program requests a public export policy. Dispatch
negatives cover tenant, principal, complete schema, semantic role and subject.
Another privacy case retains an origin-only marker in the child's cleanup capture
and rejects export despite a public-looking current placement payload. Successful
round trips also assert that cleanup receives this captured marker at the new host.
The network cases use HTTPS with mutually authenticated, explicitly pinned peer
certificates and independent Ed25519 message keys. They exercise all staging and
decision endpoints, lost responses after acceptance, withdrawal, exact status
reconciliation, body/encoding bounds, unknown peers, private export rejection,
and artifact collection. Image cache hits transfer only the outcome. Endpoints
come from deployment configuration; the client rejects redirects and arbitrary
URLs. Both services run locally in this lane; the durable browser-origin bridge
and separate-process packaged deployment remain to be qualified.

`servePeers` exposes preflight, bounded image/outcome staging, decision, status,
withdrawal and narrowly authorized run-control endpoints. A peer certificate maps
to a configured logical host ID; no request header can choose that identity.
Staging metadata is authenticated and authorized before its body is buffered.
The client treats all HTTP errors, malformed replies and lost connections as
uncertainty, never as a refusal receipt. Test certificates are generated under an
isolated temporary directory and do not alter system trust stores. The transport
uses the platform [HTTPS](https://nodejs.org/api/https.html) and
[TLS identity checks](https://nodejs.org/api/tls.html#tlscheckserveridentityhostname-cert).

The selected foundation is Agent `b1f9d2866b5717d16339e7022a3b4d08951f0770`
and its unchanged `conformance/agent4/dependencies.lock.json`: Boundary
`65f46131f366bdd21aa98701f4110ecb801d2c8d`, World
`a48d5fd0cb2d4fcbe79bc3188f354d7d036d29f5`, ABI 3, kernel SHA-256
`9627eb1e66239119bccb4ddcd43b4f6c757180dab930a9feb276671262f735d1`.
The new runtime must qualify these exact inputs before reporting execution.
