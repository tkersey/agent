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
| A03 | `mobility_continuation.mjs` exact parked-state/request restore; `mobility_durable_browser.test.mjs` retained task/marker through both moves. The yielding consumer resumes top-level yields before work and after each move, with owned cleanup retained; Node tests also restart each yielded custodian. | PASS |
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
| C06 | Journal and mTLS withdrawal-before-offer tests preserve refusal through restart and delayed staging. Refusal replaces staging at the exact record quota. Service/direct retry resumes pending withdrawal after restart without delivering cancelled work. | PASS |
| C07 | Journal acceptance cannot be reversed by refusal; mTLS cancellation after ambiguous acceptance forwards only. The service retries pending cancellation after lost acceptance and failed withdrawal, with cleanup only at the destination. | PASS |
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
| D08 | Three actual World arena-exhaustion cases assert input/working/output capacity errors, preserved checkpoint/reply/occurrence and no repeated task input after recovery. Record-quota tests cover all six producers, exact replacement counts, atomic rollback and restart. | PASS |
| D09 | Two custodians concurrently attach to the same journal; one loses CAS. Existing stale version/assignment publications reject, including a browser successor computed from a yield before cancellation changes its assignment. | PASS |
| D10 | Artifact-before/after and acceptance transaction faults never publish accepted custody with missing artifacts. | PASS |
| D11 | mTLS staging/collection test retains pending, accepted recovery inputs and terminal decisions. | PASS |
| D12 | Known changed external deployment generation rejects; guide forbids silent old-backup activation and documents undetectable rollback. | PASS |
| S01 | Queued real read is durably DISPATCHING before I/O; rival dispatch and ordinary-request transfer reject; frozen source dispatch rejects. | PASS |
| S02 | Real infinite loop emits byte-identical ERQ records through four iterations; journal assigns four occurrence IDs, preserves retries, and rejects consumed attempts/old revisions. | PASS |
| S03 | `mobility_approval.test.mjs`: actual write response lost, restart and cancellation remain UNKNOWN with one mutation. | PASS |
| S04 | Eight approval cases retain exact evidence/grant across three moves, reject stale/consumed replies and revalidate the destination file. | PASS |
| S05 | Host cancellation before/after acceptance, mTLS forwarding, returning pending cancellation and private-grant cancellation cases. | PASS |
| S06 | Actual child cleanup suspends, survives custodian restart with the same occurrence, and completes once at the owner. | PASS |
| S07 | Actual-host missing cleanup binding, denied state/result labels and origin-lock pin cases reject movement before upload; journal pin guard also passes. | PASS |
| S08 | Forged destination binding observation is refused; an unconfigured program destination produces no transfer or file read. | PASS |
| S09 | Host tenant/principal/subject/schema/issuer checks plus browser wrong principal, audience, origin, session and CSRF rejection. HTTPS bridge tests cover session turnover and assignment reclamation with a one-assignment limit. | PASS |
| S10 | Server-only read taints retained state and denies even preflight/upload to A despite requested public policy. | PASS |
| S11 | Origin-only captured cleanup marker blocks export despite a public-looking relocation payload. | PASS |
| S12 | Both browsers scan actual private signing/TLS key material and session-token sentinels against image, all captured outcomes, payload logs, offers, receipts, process logs and decompressed use archive; local/session storage remain empty. | PASS |
| S13 | Actual target rejects malformed image/outcome, oversized state and a valid ordinary non-mobility boundary; local signed/configured image/outcome limits reject before custody admission. Oversized successors preserve the parked state and acquired reply through restart. Unapproved image, wrong kernel, invalid signature and arbitrary endpoint cases reject before effects. | PASS |
| S14 | Outstanding exact receipt verifies after normal key retirement; protocol rejects compromise exemption. | PASS |
| S15 | Host revocation after placement blocks new reads but permits narrow cleanup, including authenticated browser cancellation. Named export-policy revocation before retry, during preflight and after restart blocks new disclosure while permitting reconciliation of saved acceptance. Pending cancellation progresses after principal/export revocation and restart, and prevents delivery when it arrives during retry preflight. Departed source stays retired. | PASS |
| S16 | Expired admission leaves the source frozen until durable refusal; saved acceptance survives expiry and suspended new-admission policy. | PASS |
| P01 | Extracted production modules execute with no application Zig source, emitter, Git metadata or bundled kernel; optional test directory removed. | PASS |
| P02 | Both browser engines and Node independently use kernel `9627eb1e…` from the exact authenticated runtime inventory. | PASS |
| P03 | Worker A1 terminates before delivery; data process exits and ESRCH is checked before fresh Worker A2; departed process restart executes no work. | PASS |
| P04 | Shipped browser/host controllers follow only current World outcomes; inventory and fixture oracles are absent from production control. | PASS |
| P05 | Temporary certificates/keys and isolated fixture files; deterministic human/model inputs; no paid or production operation. | PASS |
| P06 | ReleaseSafe authoring/native (216 tests), runtime/integration, compiled tools/browser, component tools, repository delivery, dependency and package checks qualified; the source-package runner failure was recovered as described below. | PASS |

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
Remaining mandatory work: serial reviews of the completed candidate. This matrix
is not a substitute for those results.

## Regression qualification

The ReleaseSafe `check-mobility` aggregate, compiled tools/browser, component
tools, repository delivery, archive emission and lint checks passed. The broader
`check-agent4 check-native check-agent4-integration` run completed with 216/216
Zig tests passing and one failed step: the source-package authoring assertion
detected that inherited `NODE_TEST_CONTEXT` silently skipped the newly added
protocol test. Its other 94 Node cases and the remaining runtime build steps
passed. This original aggregate is recorded as failed, not relabeled green.

All seven mobility `node:test` build steps now clear that inherited context,
following the existing repository pattern. On the corrected candidate, the exact
now-deleted manifest-selected source-package rebuild passed with zero
skips (historical evidence); `NODE_TEST_CONTEXT=child-v8 zig build check-mobility` also passed. The five
downstream checks blocked by the earlier failure then passed in their original
order: dialogue, multi, document, consequence clarification (38 cases), and
independent Node/Wasmtime/native agreement (11 canonical records plus negatives).
They used the same ReleaseSafe native executable and authenticated dependencies,
with owner verification before and after. The unchanged passing observations are
reused; no assertions, cases or deadlines were weakened.

The subsequent cancellation/quota/CLI repair passed 187 Node cases across the
mobility lanes, including the extracted service's bounded failure diagnostics,
plus the native agreement and structural economy checks. Its first aggregate
invocation omitted the required browser-tools option: the other steps passed,
and the aggregate correctly failed. The missing browser lane was then run with
the locked tools and passed in Chromium and Firefox. Four additional quota
boundary cases brought the separately rerun journal suite to 72 passing tests.

The yielded-continuation repair then passed the complete ReleaseSafe
`check-mobility emit-agent4 lint` aggregate with the explicit locked browser
tools: 192 Node cases, including ordinary and yielding two-hop witnesses in both
engines, plus the native and structural checks. The new compiled yield fixture
first reproduced the missing progress. One new host assertion initially used
JSON strings instead of the local binding's bigint offsets; correcting that
oracle preserved the required exact offsets and all continuation assertions.
