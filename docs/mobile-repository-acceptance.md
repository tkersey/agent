# Mobile Repository Agent — acceptance

Inspect, propose and exact-approval publish modes, bounded immutable candidates,
qualified checks, retained review, repeated tasks and installed CLI/browser
operation are implemented. The [runbook](mobile-repository-operations.md) provides
setup and launch instructions. Publication changes only the configured private
managed ref, never the original checkout or upstream.

Reference checks pass on Darwin 27.2.0 arm64 with Node 26.10.0 and Zig 0.17.0.
Actual-person (MR-060), two-machine (MR-087) and live-provider (MR-088) qualification
have not run. This is not a fully complete, deployment-qualified or live-qualified
delivery. [Agent PR #44](https://github.com/tkersey/agent/pull/44) carries current
review status and is assigned to `tkersey`. No agent promotion, merge or release
was performed. No Boundary/World repair was needed; prerequisite migrations were
already merged in Boundary → World → Agent order.

## Evidence and scope

Application source `4490974298d7d2699dc5ad02415a4ceff0bd755b` (tree
`d0b49b3ca461a29ca5c2b97253c5df97cf63a503`) passed 448/448 affected build steps:
authoring, application, private approval, comparison, extracted package/browser,
163 continuation comparisons and 702 native/WASM comparisons across fourteen
custody scenarios. The subsequent helper consolidation produces byte-identical
images. Consolidation revalidation passed 67/67 and 92/92 steps, including 50
storage/capability checks and 163 continuation plus 512 native/WASM comparisons
across ten custody scenarios.

The broader aggregate passed 559/559 steps at
`330916481f46a20ad03c3e5c760d024c6b82e5d7`. Its unchanged generic runtime,
dependency, isolation, fault, mutation and inherited regression evidence retains
that scope; affected application evidence is replaced by the 448-step run. The
559-step aggregate was not rerun on 4490974. The Linux/x64-only dependency watcher
was skipped on Darwin and is not qualified here.

| Emitted artifact | Bytes | SHA-256 |
|---|---:|---|
| Task image | 36,201 | `b0ba25bb9035c5e280a6f32ee917ed77ad93c4fc0e8af5fd3c26d038ddeb1595` |
| Packaged session image | 36,718 | `e6b969e822e230f0c0360614309daf34c0feee1c7ee5ef921f0fa3ea40b055f9` |

The unchanged lock binds Boundary `c49f743382257c7cf5512934ae3a2d0f56d4d4c0`,
World `35f11b811b03fcaa2d696265ff8d9b9c92c8fc95` and World kernel
`e6a982f3f13790e3dec7a5e26770549a6be8d0cb5e97a25cd97cead993f2b394`.
Dependency postflight passed. Local compiler executable SHA-256:
`18fbdb9fb852846f0e91008c5b99c9c18db1115671701c2890bf84a44ddc202d`;
library inventory: `8ed22c5d774cba9be2ad20c24c706ce450e5952b08d0f9d179e1b71811f60e5a`.

Local records under `.agent4-mobile/out/agent4/` include the 96-row acceptance JSON,
`text-budget-qualification.log`, `final-3309164.log`, measurements and package
inventory verification. They bind actual subjects, hashes and limitations. The
accepted user specification remains a local qualification input at
`.agent4-mobile/accepted-specification.md`. Raw rounds are not versioned. Current
archive identity belongs to its package receipt; documentation changes are not
new executions of unchanged binaries.

Independent assertions check exact candidate contents, unchanged refs/checkouts,
cleanup/work counts, private approval, stale answers, actual stopped-Git exclusion,
lost replies and retained publication receipts. Real Agent source fails its
protected check before repair and passes afterward through extracted browser
execution. Twelve production-owner mutants are detected; the custody model uses
128 seeds of 192 bounded steps. These are not unbounded or power-loss proofs.

Prior images failed revision-cap and combined working-text cases. Current cases
preserve valid multi-file work, large replay, review restart/publication and refusal
before checking or approval. The 512 KiB account covers logical held text, separately
from encoding copies and provider replay. Earlier helper-alias, candidate-controlled
verdict, unknown-effect display and publication-verification defects remain covered.
Later passes do not relabel the original failed subjects.

## Measurements

At 4490974, all 576 comparison attempts passed: 36 warmups and 540 measured samples,
30 matched pairs per cell. Both profiles use the same image, task, patch, model
replies, work counts and grants. Stationary invokes actual workspace leaves through
mutual-TLS binary proxies; mobile uses real custody transfers. The Apple M2 Pro
single-machine fixture uses synthetic provider and human input.

| Cell | Mobile p50 / p95 ms | Stationary p50 / p95 ms | Paired difference p50 / p95 ms | Protocol bytes, mobile / stationary |
|---|---:|---:|---:|---:|
| base / cold / local | 1626.5 / 1715.9 | 1293.9 / 1425.4 | +324.6 / +400.1 | 91151 / 40296 |
| base / cold / metro | 1802.5 / 1998.3 | 1387.6 / 1437.3 | +406.1 / +568.7 | 91151 / 40296 |
| base / cold / wide | 2491.6 / 2592.2 | 1779.0 / 1904.0 | +699.8 / +765.2 | 91151 / 40296 |
| base / warm / local | 1556.7 / 1629.1 | 1257.0 / 1356.8 | +307.8 / +363.9 | 48811 / 40296 |
| base / warm / metro | 1717.3 / 1811.6 | 1383.7 / 1457.9 | +337.7 / +426.4 | 48811 / 40296 |
| base / warm / wide | 2335.6 / 2454.4 | 1828.7 / 1912.0 | +531.7 / +618.0 | 48811 / 40296 |
| repository / warm / local | 1541.9 / 1641.9 | 1260.1 / 1400.3 | +285.2 / +367.2 | 48811 / 40296 |
| reads / warm / local | 2494.8 / 2592.1 | 2197.1 / 2292.7 | +272.4 / +421.5 | 53246 / 97326 |
| checkpoint / warm / local | 1573.6 / 1654.9 | 1282.8 / 1357.4 | +289.1 / +368.4 | 97966 / 187757 |


Mobility was slower in every cell. Extra reads and opaque replay used about 45%
and 48% fewer protocol bytes; those savings did not offset execution/custody costs.
Cold mobile runs sent the 36,718-byte image; warm runs sent none. The larger
repository cell adds unread content, not whole-build scaling evidence.

Timing spans signed registration to terminal report. Provisioning, compilation,
process startup and teardown are excluded; first TLS setup is included. Metro/wide
cells add serial service delay of 5 ms / 10 MiB/s and 25 ms / 1 MiB/s after completed
RPCs, not packet-level WAN emulation. Bytes exclude HTTP/TLS framing. Kernel,
journal and leaf spans may nest and must not be summed. Process-resource counters
include setup/warmup. Quantiles use nearest rank; thirty samples do not provide a
precise tail guarantee. Every attempt and outlier is retained locally.

All 256 supplemental observations passed (240 measured, 16 warmups). Fresh Chromium
153.0.8010.12 and Firefox 155.0 Workers restore/drive/retire the same parked outcome.
Module/kernel loading and message cloning are included; browser startup, fixture
setup and Playwright transport are excluded.

| Checkpoint bytes | Engine | Total p50 ms | Total p95 ms | Maximum ms |
|---:|---|---:|---:|---:|
| 15,358 | Chromium | 39.2 | 40.0 | 40.3 |
| 15,358 | Firefox | 41.0 | 43.0 | 248.0 |
| 64,512 | Chromium | 42.8 | 44.1 | 44.5 |
| 64,512 | Firefox | 47.0 | 49.0 | 50.0 |


The 248 ms Firefox outlier remains. Coarse-clock zero-duration phases do not mean
zero cost. Host verification medians were 19.7/21.4 ms; different timing boundaries
prevent subtraction to infer browser overhead.

| Publication reconciliation and authored return | p50 ms | p95 ms | Maximum ms |
|---|---:|---:|---:|
| Retained custodian | 509.8 | 547.0 | 570.2 |
| Reopened custodian/journal | 554.6 | 571.1 | 572.0 |


Paired reopen-minus-retain median: +42.6 ms (p95 +69.3 ms). Whole service-process
startup and native runner qualification are excluded. Every sample reconciles one
actual publication without another model call, check or write. Earlier 0d90b80/
3309164 comparisons and 3bc8d12 attribution remain historical observations, not
new executions of this subject.

The earlier Chromium driver at 3bc8d12 recorded 30/101/122 Continue activations for
inspect/propose/publish, with 16/88/104 leaving local status unchanged. It polled
every 50 ms: these are automation costs, not minimum human gestures. Each task had
two decisions, one text fill and two submissions; all shared one login. Its 27 CLI
invocations included ten deliberate negative probes. No actual-person dwell or
full-browser speedup is claimed.

Reproduce after authenticated setup with the normal source/runtime/prefix flags:
measure-mobile-repository, then measure-mobile-repository-attribution with
-Dbrowser-tools. Run them serially. Reference targets are check-agent4,
check-agent4-integration, check-mobility, check-repository-approval,
check-mobile-repository-native, check-mobile-repository-package,
check-mobile-repository-zig and check-mobile-repository-comparison with -Doptimize=safe.
The runbook describes the installed qualification command and its source inputs.

## Acceptance map

Passed means the reference scope and exact-binary correspondence above: 92 passes,
one inapplicable conditional core-repair row and three unrun external lanes.
The local machine-readable record retains per-row subject, expected/actual result,
evidence digest, platform/storage scope and limits. Test names are under test/agent4
unless stated otherwise. External credentials, approved corpus/budget, an actual
person and identified hosts require separate authorization.

| ID | Disposition | Deciding proof surface |
|---|---|---|
| MR-001 | Passed | dependencies.test.mjs; package_commands.test.mjs — authenticated tuple and mismatch rejection |
| MR-002 | Passed | zig17.test.mjs; consumer_build.test.mjs — selected compiler/library and conflict checks |
| MR-003 | Passed | check-agent4 + check-agent4-integration — inherited aggregate plus affected requalification |
| MR-004 | Passed | mobile_repository_continuation.mjs; native agreement — public consumer, unchanged evaluator |
| MR-005 | Passed | mobile_repository_deployment.test.mjs — separate installed hosts; recovery and restart witnesses |
| MR-006 | Passed | mobile_repository_deployment.test.mjs — extracted production loader; optional archive oracles removed |
| MR-007 | Passed | mobility_task_catalogue.test.mjs; mobility_deployment.test.mjs — v1/v2 closed configuration |
| MR-008 | Passed | mobility_host.test.mjs; package_commands.test.mjs; deployment validation — artifact/schema/program rejection |
| MR-009 | Passed | mobile_repository_package.test.mjs; mobile_repository_deployment.test.mjs — extracted runtime path |
| MR-010 | Passed | runtime/mobility/custodian.mjs + journal.mjs; installed deployment — one authoritative run store |
| MR-011 | Not applicable | PR diff is Agent-only; dependency lock retains accepted Boundary/World tuple |
| MR-012 | Passed | package_commands.test.mjs; installed test paths contain spaces; final aggregate uses custom prefix |
| MR-013 | Passed | repository_publication_approval.test.mjs; installed deployment — full publish trace and exact commit |
| MR-014 | Passed | mobility_ensure.mjs; mobile_repository_continuation.mjs — Here consumes no move |
| MR-015 | Passed | mobility_host.test.mjs; deployment validation — missing binding and explicit failure |
| MR-016 | Passed | mobility_host.test.mjs; mobility_protocol.test.mjs — requirement/schema/subject/version checks |
| MR-017 | Passed | mobility_continuation.mjs; inquiry_runtime.mjs — retained caller values affect final output |
| MR-018 | Passed | repository_publication_approval.test.mjs — retained question/amendment without reinitialization |
| MR-019 | Passed | inquiry_runtime.mjs — fresh-engine transfers, cleanup(30), surviving model(27), owner counts and final 92 |
| MR-020 | Passed | mobility_host.test.mjs — resource pin and unsupported cleanup prevent movement |
| MR-021 | Passed | mobility_durable_browser.test.mjs; full browser modes — terminated old Worker and fresh assignment |
| MR-022 | Passed | mobility_durable_browser.test.mjs; mobility_browser_bridge.test.mjs — yielded/cancel controls |
| MR-023 | Passed | mobile_repository_continuation.mjs; retained review budget tests — bounded repeated ensures |
| MR-024 | Passed | mobile_repository_deployment.test.mjs — all three modes, non-publishing refs unchanged |
| MR-025 | Passed | repository_snapshot.test.mjs — frozen snapshot despite moving live branch |
| MR-026 | Passed | repository_snapshot.test.mjs — more than 32 paths, query-bound cursors |
| MR-027 | Passed | repository_snapshot.test.mjs; model tool contracts — explicit excerpts and replacement preimages |
| MR-028 | Passed | repository_snapshot.test.mjs; document owner — path/alias/mode constraints |
| MR-029 | Passed | repository_snapshot.test.mjs — SHA-1/SHA-256 four-path exact deltas |
| MR-030 | Passed | repository_snapshot.test.mjs — invalid preimages, conflicting edits and forged trees |
| MR-031 | Passed | repository_zig_sandbox.test.mjs; installed deployment — ref and original checkout unchanged |
| MR-032 | Passed | repository_zig_sandbox.test.mjs — exit/output forgery rejected; host-owned raw observations |
| MR-033 | Passed | repository_zig_sandbox.test.mjs — actual Agent repair and all three repository profiles |
| MR-034 | Passed | repository_zig_sandbox.test.mjs — native qualifier probes and unavailable fallback rejection |
| MR-035 | Passed | repository_publication_approval.test.mjs; sandbox qualifier — six non-passing dispositions |
| MR-036 | Passed | inquiry_broker_runtime.mjs; repository_publication_binding.test.mjs — exact applicability and profile binding |
| MR-037 | Passed | repository_publication_approval.test.mjs — actual private grant relocation and consumption |
| MR-038 | Passed | mobility_approval.test.mjs; publication/browser bindings — principal and occurrence rejection |
| MR-039 | Passed | repository_snapshot.test.mjs; mobility_approval.test.mjs — exact action and evidence binding |
| MR-040 | Passed | repository_publication_approval.test.mjs; snapshot proposal tests — complete diff/commit identity |
| MR-041 | Passed | repository_publication_gate.test.mjs — actual Git old-value CAS and stale proposal |
| MR-042 | Passed | repository_publication_gate.test.mjs — concurrent prepared candidates, one admission/write, loser reconciles conflict |
| MR-043 | Passed | repository_snapshot.test.mjs — direct authorized managed ref only |
| MR-044 | Passed | repository_snapshot.test.mjs — inert hooks/filters/config; fixed Git command environment |
| MR-045 | Passed | repository_publication_approval.test.mjs; journal faults — lost reply and exact reconciliation |
| MR-046 | Passed | repository_publication_gate.test.mjs — same tree under another intent does not count |
| MR-047 | Passed | repository_publication_gate.test.mjs — stopped Git survives parent, retains lock, blocks another writer |
| MR-048 | Passed | repository_publication_gate.test.mjs + journal — post-write mismatch/unavailable read retains receipt |
| MR-049 | Passed | mobility_sessions.test.mjs; installed deployment — issue/redeem for existing principal |
| MR-050 | Passed | mobility_sessions.test.mjs; mobility_browser_bridge.test.mjs — origin/CSRF/audience/revocation |
| MR-051 | Passed | mobility_reference_browser.test.mjs; application review restart — durable question |
| MR-052 | Passed | mobility_journal.test.mjs; deferred bridge crash tests — acquired answer survives restart |
| MR-053 | Passed | mobility_browser_bridge.test.mjs — same answer idempotent; conflicting answer rejected |
| MR-054 | Passed | mobility_browser_bridge.test.mjs; repeated-session tests — stale occurrence/incarnation/generation |
| MR-055 | Passed | mobility_reference_browser.test.mjs; exact-change browser tests — inert text rendering |
| MR-056 | Passed | repository_publication_approval.test.mjs — decline/amendment and fresh check/approval |
| MR-057 | Passed | installed deployment clarification + retained review question tests — resumed authored investigation |
| MR-058 | Passed | mobility_journal.test.mjs; mobility_browser_bridge.test.mjs — serialized answer/cancel races |
| MR-059 | Passed | mobile_repository_package.test.mjs + reference browser — both engines and real Workers |
| MR-060 | Not run — external | Not run: an actual person must perform the separately authorized qualification |
| MR-061 | Passed | model.test.mjs; installed configuration generator — real adapter and disabled inference default |
| MR-062 | Passed | model.test.mjs; model_admission.zig; retained review misuse — offered actions and normalization |
| MR-063 | Passed | mobility_model.test.mjs; fresh-process replay probes — no provider-session dependency |
| MR-064 | Passed | model.test.mjs; mobile_repository_continuation.mjs; opaque-replay mutant — exact replay data |
| MR-065 | Passed | mobility_journal.test.mjs; background model tests — durable pre-dispatch allowance |
| MR-066 | Passed | model.test.mjs — exact credentialed endpoint and disclosure profile restrictions |
| MR-067 | Passed | mobility_host.test.mjs — whole-state label/export denial before upload |
| MR-068 | Passed | mobility_host.test.mjs; whole-state mutant — retained capture/replay label restrictions |
| MR-069 | Passed | mobility_task_catalogue.test.mjs; model bindings; export command — independent view/egress grants |
| MR-070 | Passed | installed deployment scans actual keys, ambient sentinel, all journal artifacts/transfers/logs and browser-visible persistence; inherited durable browser scans |
| MR-071 | Passed | mobility_protocol.test.mjs; mobility_host.test.mjs — issuer/key owner/program/resource admission |
| MR-072 | Passed | model.test.mjs; retained-review misuse; fixed profile selection — no unoffered authority |
| MR-073 | Passed | mobility_host.test.mjs; mobility_journal.test.mjs — lost acceptance and original decision retry |
| MR-074 | Passed | mobility_host.test.mjs — onward return and cancellation reconciliation |
| MR-075 | Passed | mobility_journal.test.mjs; model/check restart tests — acquired replies avoid redispatch |
| MR-076 | Passed | mobility_browser_bridge.test.mjs; publication reconciliation — unknown outcomes stay distinct |
| MR-077 | Passed | mobility_host.test.mjs — before/after World publication fault, saved reply retained |
| MR-078 | Passed | mobility_host.test.mjs; cancellation/withdrawal tests — one cleanup authority |
| MR-079 | Passed | repository_publication_journal.test.mjs; approval tests — pre-admission cancellation and retained publication |
| MR-080 | Passed | sandbox qualifier; mobility_deployment.test.mjs — kill/reap and unrelated-run progress |
| MR-081 | Passed | mobility_host.test.mjs; journal quota/fault tests — committed checkpoint/reply survives capacity failure |
| MR-082 | Passed | repository_snapshot.test.mjs — retained byte/file quotas, reopened/concurrent writers, orphan files; repository_snapshot.test.mjs — finite durable slots; installed deployment — no completed scratch remains |
| MR-083 | Passed | mobility_journal.test.mjs — corruption/generation/known rollback; no consistent-backup self-detection claim |
| MR-084 | Passed | mobility_journal.test.mjs; publication journal tests — GC roots and unresolved outcomes |
| MR-085 | Passed | mobile_repository_package.test.mjs; installed deployment — no source/oracle execution fallback |
| MR-086 | Passed | check-mobile-repository-native — byte agreement plus independent expected outputs |
| MR-087 | Not run — external | Not run: separate authorized machines/storage/network and fault exercise required |
| MR-088 | Not run — external | Not run: operator-approved provider/data/budget/corpus and independent judgment required |
| MR-089 | Passed | Current-image matched comparison, 30 pairs in each of nine cells |
| MR-090 | Passed | Current-image comparison and browser/recovery attribution; explicit timing boundaries |
| MR-091 | Passed | Actual cold/warm image traffic and fresh Chromium/Firefox Worker attribution |
| MR-092 | Passed | mobile_repository_mutants.mjs; production-adjacent custody model — twelve mutants and bounded seeds |
| MR-093 | Passed | Installed template/config/validate/start/serve/cancel/export/qualifier tests; negative inputs |
| MR-094 | Passed | Exact publication receipt/proposal tests and UI disclosure — managed ref only |
| MR-095 | Passed | This map and local machine-readable 96-row record; current subject and exact artifact correspondence |
| MR-096 | Passed | PR #44 provider readback, assigned tkersey; no agent promotion, merge or release |
