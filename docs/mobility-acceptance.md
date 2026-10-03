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
| A05 | `admission.zig` direct reserved identity/speculation cases; `mobility_ensure.zig` indirect case. Explicit hidden compiled-mobility case remains. | PARTIAL |
| A06 | `mobility_host.test.mjs`: actual dispatch mismatches; file-version conflict; `mobility_approval.test.mjs` final precondition conflict. | PASS |
| A07 | `mobility_continuation.mjs` refused reply fallback; host unavailable/export-denied cases; all next actions are World requests. | PASS |
| A08 | `mobility_ensure.mjs`: fifteen cases including bounded attempts, move budget, constraints, ties and overflow. | PASS |
| A09 | `mobility_host.test.mjs`: unsupported ordinary leaf remains READY with unchanged outcome and no invented move/reply. | PASS |
| A10 | `check-mobility-native`: 24 full canonical native/WASM outcome comparisons plus independent result/cleanup oracles. | PASS |
| C01 | Host and durable browser round trips assert 0→1→2; stale source/assignment checks reject. | PASS |
| C02 | Journal exact saved decisions; mTLS duplicate staging/status; executor incarnation CAS. Expanded duplicate-message schedule remains. | PARTIAL |
| C03 | Journal same-ID changed placement intent rejects; other source/destination/checkpoint/requirements collision dimensions remain. | PARTIAL |
| C04 | Host/mTLS lost acceptance tests let the destination execute while source remains OFFERED. | PASS |
| C05 | Unknown/lost-ack paths stay frozen; an explicit unseen-status-only source assertion remains. | PARTIAL |
| C06 | Journal and mTLS withdrawal-before-offer tests preserve refusal through restart and delayed staging. | PASS |
| C07 | Journal acceptance cannot be reversed by refusal; mTLS cancellation after ambiguous acceptance forwards only. | PASS |
| C08 | Journal separate handles attempt rival freezes; only one source offer succeeds. Target-side simultaneous differing offers remain. | PARTIAL |
| C09 | Host return reconciles the old lost acceptance before installing new custody. Explicit nonmatching return rejection remains. | PARTIAL |
| C10 | Host late original receipt after the return leaves the complete current run unchanged. | PASS |
| C11 | mTLS errors/encoding/bounds and lost responses preserve uncertainty; all malformed receipt/deadline cases remain. | PARTIAL |
| C12 | Protocol counters, stale executor tests and duplicate registration pass; forged lineage, terminal-run retirement and epoch variants remain. | PARTIAL |
| D01 | Journal `freeze.before_commit` leaves ACTIVE and no outbox; controller returns no publishable offer before successful freeze. | PASS |
| D02 | Journal SIGKILL after freeze commit reopens OFFERED with the exact outbox. | PASS |
| D03 | Journal artifact/accept pre-commit fault cases reopen without active target or accepted receipt. | PASS |
| D04 | SIGKILL after acceptance preserves active incoming custody; host restart restores actual saved arrival/checkpoint and completes. | PASS |
| D05 | Lost-ack journal/host tests restart source frozen and retrieve the same target decision. | PASS |
| D06 | Journal acceptance/refusal restart assertions compare exact receipt bytes. | PASS |
| D07 | Acquired reply persists through restart; old executor cannot publish and new executor consumes the saved reply. | PASS |
| D08 | Artifact bounds exist; explicit input/working/output exhaustion with unchanged authoritative input is still required. | PARTIAL |
| D09 | Journal stale incarnation publication and browser stale assignment tests; concurrent attachment schedule remains. | PARTIAL |
| D10 | Artifact-before/after and acceptance transaction faults never publish accepted custody with missing artifacts. | PASS |
| D11 | mTLS staging/collection test retains pending, accepted recovery inputs and terminal decisions. | PASS |
| D12 | Known changed external deployment generation rejects; guide forbids silent old-backup activation and documents undetectable rollback. | PASS |
| S01 | Journal dispatch blocks after freeze; unsettled occurrence blocks admission/freeze. Explicit competing schedule remains. | PARTIAL |
| S02 | Journal publication produces a fresh occurrence; exact retries preserve it. Repeated identical ERQ in a real loop remains. | PARTIAL |
| S03 | `mobility_approval.test.mjs`: actual write response lost, restart and cancellation remain UNKNOWN with one mutation. | PASS |
| S04 | Eight approval cases retain exact evidence/grant across three moves, reject stale/consumed replies and revalidate the destination file. | PASS |
| S05 | Host cancellation before/after acceptance, mTLS forwarding, returning pending cancellation and private-grant cancellation cases. | PASS |
| S06 | Captured child cleanup survives migration and runs once; restart while cleanup itself is suspended remains. | PARTIAL |
| S07 | Journal origin pin blocks freeze; explicit actual-host cleanup-unsupported case remains. | PARTIAL |
| S08 | Exact binding grants and configured peers are checked; forged observation and malicious destination payload cases remain. | PARTIAL |
| S09 | Host tenant/principal/subject/schema and browser principal/origin/session checks pass; explicit wrong audience check remains. | PARTIAL |
| S10 | Server-only read taints retained state and denies even preflight/upload to A despite requested public policy. | PASS |
| S11 | Origin-only captured cleanup marker blocks export despite a public-looking relocation payload. | PASS |
| S12 | Keys/session secrets are environmental; explicit sentinel scans across artifacts, storage and logs remain. | PARTIAL |
| S13 | Signature/schema/arbitrary endpoint/bounds checks exist; full hostile artifact and wrong-kernel execution matrix remains. | PARTIAL |
| S14 | Outstanding exact receipt verifies after normal key retirement; protocol rejects compromise exemption. | PASS |
| S15 | Host revocation after placement blocks new reads but permits narrow cleanup; departed source stays retired. | PASS |
| S16 | Saved decisions precede deadline checks in the journal; expiry and suspended-admission runtime cases remain. | PARTIAL |
| P01 | Extracted production modules execute with no application Zig source, emitter, Git metadata or bundled kernel; optional test directory removed. | PASS |
| P02 | Both browser engines and Node independently use kernel `9627eb1e…` from the exact authenticated runtime inventory. | PASS |
| P03 | Worker A1 terminates before delivery; data process exits and ESRCH is checked before fresh Worker A2; departed process restart executes no work. | PASS |
| P04 | Shipped browser/host controllers follow only current World outcomes; inventory and fixture oracles are absent from production control. | PASS |
| P05 | Temporary certificates/keys and isolated fixture files; deterministic human/model inputs; no paid or production operation. | PASS |
| P06 | `check-agent4` and `check-native` pass after approval placement; remaining affected integration/packaging final-candidate checks are pending. | PARTIAL |

Other mandatory work: the section 25 model passes its 28-state exploration and
intentional unsafe-timeout counterexample, but the section 18 production-adjacent
multi-host/epoch/occurrence/cancellation suite and full fault matrix remain.
Section 19 matched cold/warm/fixed/discovered/stationary measurements and bounded
operational metrics remain. Final validation and serial reviews must cover the
completed candidate rather than treating this matrix as a substitute for proof.
