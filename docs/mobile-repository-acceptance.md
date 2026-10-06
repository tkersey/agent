# Mobile Repository Agent — acceptance

Inspect, propose and exact-approval publish modes, bounded immutable candidates,
qualified checks, retained review, repeated tasks and installed CLI/browser
operation are implemented. The [runbook](mobile-repository-operations.md) provides
setup and launch instructions. Publication changes only the configured private
managed ref, never the original checkout or upstream.

Prior reference checks ran on Darwin 27.2.0 arm64 with Node 26.10.0 and Zig 0.17.0.
Actual-person (MR-060), two-machine (MR-087) and live-provider (MR-088) qualification
have not run. This is not a fully complete, deployment-qualified or live-qualified
delivery. [Agent PR #44](https://github.com/tkersey/agent/pull/44) carries current
review status and is assigned to `tkersey`. No agent promotion, merge or release
was performed. No Boundary/World repair was needed; prerequisite migrations were
already merged in Boundary → World → Agent order.

## Retained coverage and deliberate reductions

The expensive extracted-package journeys (including installed two-host/browser
execution), native Zig sandbox end-to-end suite, and twelve-mutant campaign have
been deleted. Previous passing runs are historical evidence, not retained
qualification. The acceptance rows below marked retired no longer have that
coverage; reduced coverage is intentional.

Existing timing logs recorded 192.120 seconds for the package suite and 120.511
seconds for native Zig qualification, excluding build dependencies. Earlier
installed deployment alone took 405.287 seconds. No new exhaustive run was used
to choose these cuts.

Focused tests remain for snapshot integrity, publication admission and journal
recovery, check binding and missing-input rejection, custody, provider selection,
and qualification input admission. Authored application continuations and approval
regressions remain. Shared product images, native enforcement helpers, repository
fixtures and runtime sandbox probes are retained where execution still needs them.

## Acceptance map

Passed rows describe prior observations from retained proof surfaces, not a new
whole-suite run. Retired rows explicitly withdraw expensive coverage. Test names
are under test/agent4 unless stated otherwise. External lanes remain unrun.

| ID | Disposition | Deciding proof surface |
|---|---|---|
| MR-001 | Passed | dependencies.test.mjs; package_commands.test.mjs — authenticated tuple and mismatch rejection |
| MR-002 | Passed | zig17.test.mjs; retained consumer_build.test.mjs authentication checks — source-package rebuild removed |
| MR-003 | Passed | check-agent4 + check-agent4-integration — inherited aggregate plus affected requalification |
| MR-004 | Passed | mobile_repository_continuation.mjs; native agreement — public consumer, unchanged evaluator |
| MR-005 | Retired coverage | Expensive installed/native/mutation qualification deleted; no equivalent end-to-end claim retained |
| MR-006 | Retired coverage | Expensive installed/native/mutation qualification deleted; no equivalent end-to-end claim retained |
| MR-007 | Passed | mobility_task_catalogue.test.mjs; mobility_deployment.test.mjs — v1/v2 closed configuration |
| MR-008 | Passed | mobility_host.test.mjs; package_commands.test.mjs; deployment validation — artifact/schema/program rejection |
| MR-009 | Retired coverage | Expensive installed/native/mutation qualification deleted; no equivalent end-to-end claim retained |
| MR-010 | Passed | runtime/mobility/custodian.mjs + journal.mjs — one authoritative run store |
| MR-011 | Not applicable | PR diff is Agent-only; dependency lock retains accepted Boundary/World tuple |
| MR-012 | Passed | package_commands.test.mjs; archive paths contain spaces; retained command checks |
| MR-013 | Passed | repository_publication_approval.test.mjs — full publish trace and exact commit |
| MR-014 | Passed | mobility_ensure.mjs; mobile_repository_continuation.mjs — Here consumes no move |
| MR-015 | Passed | mobility_host.test.mjs; deployment validation — missing binding and explicit failure |
| MR-016 | Passed | mobility_host.test.mjs; mobility_protocol.test.mjs — requirement/schema/subject/version checks |
| MR-017 | Passed | mobility_continuation.mjs; inquiry_runtime.mjs — retained caller values affect final output |
| MR-018 | Passed | repository_publication_approval.test.mjs — retained question/amendment without reinitialization |
| MR-019 | Passed | inquiry_runtime.mjs — fresh-engine transfers, cleanup(30), surviving model(27), owner counts and final 92 |
| MR-020 | Passed | mobility_host.test.mjs — resource pin and unsupported cleanup prevent movement |
| MR-021 | Passed | mobility_durable_browser.test.mjs — terminated old Worker and fresh assignment; installed package journeys removed |
| MR-022 | Passed | mobility_durable_browser.test.mjs; mobility_browser_bridge.test.mjs — yielded/cancel controls |
| MR-023 | Passed | mobile_repository_continuation.mjs; retained review budget tests — bounded repeated ensures |
| MR-024 | Retired coverage | Expensive installed/native/mutation qualification deleted; no equivalent end-to-end claim retained |
| MR-025 | Passed | repository_snapshot.test.mjs — frozen snapshot despite moving live branch |
| MR-026 | Passed | repository_snapshot.test.mjs — more than 32 paths, query-bound cursors |
| MR-027 | Passed | repository_snapshot.test.mjs; model tool contracts — explicit excerpts and replacement preimages |
| MR-028 | Passed | repository_snapshot.test.mjs; document owner — path/alias/mode constraints |
| MR-029 | Passed | repository_snapshot.test.mjs — SHA-1/SHA-256 four-path exact deltas |
| MR-030 | Passed | repository_snapshot.test.mjs — invalid preimages, conflicting edits and forged trees |
| MR-031 | Retired coverage | Expensive installed/native/mutation qualification deleted; no equivalent end-to-end claim retained |
| MR-032 | Retired coverage | Expensive installed/native/mutation qualification deleted; no equivalent end-to-end claim retained |
| MR-033 | Retired coverage | Expensive installed/native/mutation qualification deleted; no equivalent end-to-end claim retained |
| MR-034 | Retired coverage | Expensive installed/native/mutation qualification deleted; no equivalent end-to-end claim retained |
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
| MR-049 | Passed | mobility_sessions.test.mjs — issue/redeem for existing principal |
| MR-050 | Passed | mobility_sessions.test.mjs; mobility_browser_bridge.test.mjs — origin/CSRF/audience/revocation |
| MR-051 | Passed | mobility_reference_browser.test.mjs; application review restart — durable question |
| MR-052 | Passed | mobility_journal.test.mjs; deferred bridge crash tests — acquired answer survives restart |
| MR-053 | Passed | mobility_browser_bridge.test.mjs — same answer idempotent; conflicting answer rejected |
| MR-054 | Passed | mobility_browser_bridge.test.mjs; repeated-session tests — stale occurrence/incarnation/generation |
| MR-055 | Passed | mobility_reference_browser.test.mjs; exact-change browser tests — inert text rendering |
| MR-056 | Passed | repository_publication_approval.test.mjs — decline/amendment and fresh check/approval |
| MR-057 | Passed | installed deployment clarification + retained review question tests — resumed authored investigation |
| MR-058 | Passed | mobility_journal.test.mjs; mobility_browser_bridge.test.mjs — serialized answer/cancel races |
| MR-059 | Retired coverage | Expensive installed/native/mutation qualification deleted; no equivalent end-to-end claim retained |
| MR-060 | Not run — external | Not run: an actual person must perform the separately authorized qualification |
| MR-061 | Passed | model.test.mjs; installed configuration generator — real adapter and disabled inference default |
| MR-062 | Passed | model.test.mjs; model_admission.zig; retained review misuse — offered actions and normalization |
| MR-063 | Passed | mobility_model.test.mjs; fresh-process replay probes — no provider-session dependency |
| MR-064 | Passed | model.test.mjs; mobile_repository_continuation.mjs — exact replay data |
| MR-065 | Passed | mobility_journal.test.mjs; background model tests — durable pre-dispatch allowance |
| MR-066 | Passed | model.test.mjs — exact credentialed endpoint and disclosure profile restrictions |
| MR-067 | Passed | mobile_repository_continuation.mjs — known return denial before source/model; mobility_host.test.mjs — actual whole-state export enforcement |
| MR-068 | Passed | mobility_host.test.mjs — retained capture/replay label restrictions |
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
| MR-082 | Passed | repository_snapshot.test.mjs — retained byte/file quotas, reopened/concurrent writers, orphan files; repository_snapshot.test.mjs — finite durable slots — no completed scratch remains |
| MR-083 | Passed | mobility_journal.test.mjs — corruption/generation/known rollback; no consistent-backup self-detection claim |
| MR-084 | Passed | mobility_journal.test.mjs; publication journal tests — GC roots and unresolved outcomes |
| MR-085 | Retired coverage | Expensive installed/native/mutation qualification deleted; no equivalent end-to-end claim retained |
| MR-086 | Passed | check-mobile-repository-native — byte agreement plus independent expected outputs |
| MR-087 | Not run — external | Not run: separate authorized machines/storage/network and fault exercise required |
| MR-088 | Not run — external | Not run: operator-approved provider/data/budget/corpus and independent judgment required |
| MR-089 | Not applicable — removed | Measurement collection and observations removed at the user’s request |
| MR-090 | Not applicable — removed | Measurement collection and observations removed at the user’s request |
| MR-091 | Not applicable — removed | Measurement collection and observations removed at the user’s request |
| MR-092 | Retired coverage | Expensive installed/native/mutation qualification deleted; no equivalent end-to-end claim retained |
| MR-093 | Passed | Installed template/config/validate/start/serve/cancel/export/qualifier tests; negative inputs |
| MR-094 | Passed | Exact publication receipt/proposal tests and UI disclosure — managed ref only |
| MR-095 | Passed | This map and local machine-readable 96-row record; current subject and exact artifact correspondence |
| MR-096 | Passed | PR #44 provider readback, assigned tkersey; no agent promotion, merge or release |
