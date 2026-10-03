# Mobility acceptance status

This is the v1.0 section 17 matrix for the unchanged locked Boundary/World tuple
in [the mobility guide](effect-directed-mobility.md). **PASS** means the named
executed checks establish the stated bounded assertion. **PARTIAL** identifies
an uncovered part of the required row. It is not completion credit for that row.
The implementation remains in development; serial review closeout is pending.

Test paths below are under `test/agent4/` unless otherwise stated. The source-free
browser lane runs Chromium and Firefox, actual mTLS, an extracted use archive and
a separate data-host process. Its local deployment does not establish WAN or
power-loss behavior. Process-crash tests use local APFS and SQLite EXTRA.

| ID | Deciding checks / current evidence | Result |
|---|---|---|
| A01 | `test/consumers/mobility` independently builds public authoring; `mobility-images`, `mobility-approval-images` emit actual programs. | PASS |
| A02 | `mobility_host.test.mjs`: “Here executes the same typed file operation locally without a custody move”. | PASS |
| A03 | `mobility_continuation.mjs` exact parked-state/request restore; `mobility_durable_browser.test.mjs` retained task/marker through both moves. | PASS |
| A04 | Main consumer retains an owned generator, its scoped interpretation and captured protected cleanup; fresh Worker result/cleanup assertions. | PASS |
| A05 | `admission.zig` direct, recursive, higher-order and handler cases; `mobility_ensure.zig` indirect speculation; `compiled_tool.zig` reserved mobility read-role/alias rejection. | PASS |
| A06 | `mobility_host.test.mjs`: actual dispatch mismatches; file-version conflict; `mobility_approval.test.mjs` final precondition conflict. | PASS |
| A07 | `mobility_continuation.mjs` refused reply fallback; host unavailable/export-denied cases; all next actions are World requests. | PASS |
| A08 | `mobility_ensure.mjs`: fifteen cases including bounded attempts, move budget, constraints, ties and overflow. | PASS |
| A09 | `mobility_host.test.mjs`: unsupported ordinary leaf remains READY with unchanged outcome and no invented move/reply. | PASS |
| A10 | `check-mobility-native`: 24 full canonical native/WASM outcome comparisons plus independent result/cleanup oracles. | PASS |
| C01 | Host and durable browser round trips assert 0→1→2; stale source/assignment checks reject. | PASS |
| C02 | Concurrent duplicate host offers and mTLS reordered/repeated artifact/decision messages return the exact saved receipt without duplicate execution. | PASS |
| C03 | Journal collision matrix changes source, destination, outcome, state and requirements under one transfer ID; every case rejects and preserves the original decision. | PASS |
| C04 | Host/mTLS lost acceptance tests let the destination execute while source remains OFFERED. | PASS |
| C05 | mTLS withdrawal test explicitly observes unseen status while source stays OFFERED; status/network fault cases preserve the frozen outbox through restart. | PASS |
| C06 | Journal and mTLS withdrawal-before-offer tests preserve refusal through restart and delayed staging. | PASS |
| C07 | Journal acceptance cannot be reversed by refusal; mTLS cancellation after ambiguous acceptance forwards only. | PASS |
| C08 | Separate source journal handles reject rival freezes; separate target handles reject a rival offer after one target acceptance. | PASS |
| C09 | Host nonmatching predecessor case preserves the entire unresolved outbound record; valid return reconciles its exact old receipt first. | PASS |
| C10 | Host late original receipt after the return leaves the complete current run unchanged. | PASS |
| C11 | Real mTLS 202/503/redirect/malformed JSON/unknown receipt field/bad signature responses preserve unknown custody; injected timeouts and deadline tests require exact reconciliation. | PASS |
| C12 | Protocol counter bounds, pure incarnation overflow/stale epoch/retired target checks, forged lineage rejection and actual terminal-run replay rejection. | PASS |
| D01 | Journal `freeze.before_commit` leaves ACTIVE and no outbox; controller returns no publishable offer before successful freeze. | PASS |
| D02 | Journal SIGKILL after freeze commit reopens OFFERED with the exact outbox. | PASS |
| D03 | Journal artifact/accept pre-commit fault cases reopen without active target or accepted receipt. | PASS |
| D04 | SIGKILL after acceptance preserves active incoming custody; host restart restores actual saved arrival/checkpoint and completes. | PASS |
| D05 | Lost-ack journal/host tests restart source frozen and retrieve the same target decision. | PASS |
| D06 | Journal acceptance/refusal restart assertions compare exact receipt bytes. | PASS |
| D07 | Acquired reply persists through restart; old executor cannot publish and new executor consumes the saved reply. | PASS |
| D08 | Three actual World arena-exhaustion cases assert input/working/output capacity errors, preserved checkpoint/reply/occurrence and no repeated task input after recovery. | PASS |
| D09 | Two custodians concurrently attach to the same journal; one loses CAS. Existing stale version/assignment publications reject. | PASS |
| D10 | Artifact-before/after and acceptance transaction faults never publish accepted custody with missing artifacts. | PASS |
| D11 | mTLS staging/collection test retains pending, accepted recovery inputs and terminal decisions. | PASS |
| D12 | Known changed external deployment generation rejects; guide forbids silent old-backup activation and documents undetectable rollback. | PASS |
| S01 | Queued real read is durably DISPATCHING before I/O; rival dispatch and ordinary-request transfer reject; frozen source dispatch rejects. | PASS |
| S02 | Real infinite loop emits byte-identical ERQ records through four iterations; journal assigns four occurrence IDs, preserves retries, and rejects consumed attempts/old revisions. | PASS |
| S03 | `mobility_approval.test.mjs`: actual write response lost, restart and cancellation remain UNKNOWN with one mutation. | PASS |
| S04 | Eight approval cases retain exact evidence/grant across three moves, reject stale/consumed replies and revalidate the destination file. | PASS |
| S05 | Host cancellation before/after acceptance, mTLS forwarding, returning pending cancellation and private-grant cancellation cases. | PASS |
| S06 | Actual child cleanup suspends, survives custodian restart with the same occurrence, and completes once at the owner. | PASS |
| S07 | Actual-host missing cleanup binding and origin-lock pin cases reject movement before upload; journal pin guard also passes. | PASS |
| S08 | Forged destination binding observation is refused; an unconfigured program destination produces no transfer or file read. | PASS |
| S09 | Host tenant/principal/subject/schema/issuer checks plus browser wrong principal, audience, origin, session and CSRF rejection. | PASS |
| S10 | Server-only read taints retained state and denies even preflight/upload to A despite requested public policy. | PASS |
| S11 | Origin-only captured cleanup marker blocks export despite a public-looking relocation payload. | PASS |
| S12 | Both browsers scan actual private signing/TLS key material and session-token sentinels against image, all captured outcomes, payload logs, offers, receipts, process logs and decompressed use archive; local/session storage remain empty. | PASS |
| S13 | Actual target rejects malformed image/outcome, oversized state and a valid ordinary non-mobility boundary; unapproved image, wrong kernel, invalid signature and arbitrary endpoint cases reject before effects. | PASS |
| S14 | Outstanding exact receipt verifies after normal key retirement; protocol rejects compromise exemption. | PASS |
| S15 | Host revocation after placement blocks new reads but permits narrow cleanup; departed source stays retired. | PASS |
| S16 | Expired admission leaves the source frozen until durable refusal; saved acceptance survives expiry and suspended new-admission policy. | PASS |
| P01 | Extracted production modules execute with no application Zig source, emitter, Git metadata or bundled kernel; optional test directory removed. | PASS |
| P02 | Both browser engines and Node independently use kernel `9627eb1e…` from the exact authenticated runtime inventory. | PASS |
| P03 | Worker A1 terminates before delivery; data process exits and ESRCH is checked before fresh Worker A2; departed process restart executes no work. | PASS |
| P04 | Shipped browser/host controllers follow only current World outcomes; inventory and fixture oracles are absent from production control. | PASS |
| P05 | Temporary certificates/keys and isolated fixture files; deterministic human/model inputs; no paid or production operation. | PASS |
| P06 | `check-agent4` and `check-native` pass after approval placement; remaining affected integration/packaging final-candidate checks are pending. | PARTIAL |

The section 25 model passes its 28-state exploration and intentional unsafe-timeout
counterexample. The production-adjacent model additionally exercises 128 seeded
three-host traces, up to 192 random steps after bounded four-hop delayed-receipt
return prefixes. It uses the production transition core with independent custody,
monotonicity, stale-executor and occurrence oracles. This is bounded property
coverage, not an exhaustive or unbounded protocol proof; cryptography, artifacts
and storage have separate concrete tests.

The concrete fault matrix now checks before/after every journal transaction,
artifact publication, peer operation, World admission/successor calculation and
leaf result acquisition. Six points also use actual SIGKILL. mTLS cases add
artifact disconnects, malformed responses, lost decisions and message reordering.
Each checks durable ownership/dispatch eligibility and recovery or explicit
uncertainty. Database reopen, injected exceptions and process termination do not
establish arbitrary storage or power-loss safety.

Section 19 matched cold/warm/fixed/discovered/stationary measurements and bounded
operational metrics are complete; see the [performance report](mobility-performance.md).
Remaining mandatory work: final affected integration checks and serial reviews
of the completed candidate. This matrix is not a substitute for those results.
