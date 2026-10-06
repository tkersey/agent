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

## Regular checks and retired coverage

Only tests reached by normal pull-request CI remain. The authoring lane runs
protocol, publication binding/journal and configuration checks. The native lane
runs custody, transport, deployment, session and catalogue regressions alongside
the native semantic tests. Source accounting and external installation also remain.

Optional browser/application matrices, model exploration, source-free comparison,
manual performance collectors and the slow economy lane have been deleted, with
unused harnesses and fixtures. The package no longer ships test oracles. Product
runtime, examples, enforcement helpers and explicitly requested external trial
launchers remain. Actual-person/two-machine/live-provider trials follow PR review.

The receipt regression uses the production journal to acquire publication evidence,
transfer custody, cancel, collect artifacts and reopen storage. Trusted admission
doubles keep this a small regular check; it is not end-to-end browser qualification.

## Acceptance map

Passed rows describe prior observations from retained proof surfaces, not a new
whole-suite run. Retired rows explicitly withdraw expensive coverage. Test names
are under test/agent4 unless stated otherwise. External lanes remain unrun.

| ID | Disposition | Deciding proof surface |
|---|---|---|
| MR-001 | Retired coverage | Optional test campaign removed; product requirement remains |
| MR-002 | Retired coverage | Optional test campaign removed; product requirement remains |
| MR-003 | Retired coverage | Optional test campaign removed; product requirement remains |
| MR-004 | Retired coverage | Optional test campaign removed; product requirement remains |
| MR-005 | Retired coverage | Expensive installed/native/mutation qualification deleted; no equivalent end-to-end claim retained |
| MR-006 | Retired coverage | Expensive installed/native/mutation qualification deleted; no equivalent end-to-end claim retained |
| MR-007 | Passed | mobility_task_catalogue.test.mjs; mobility_deployment.test.mjs — v1/v2 closed configuration |
| MR-008 | Retired coverage | Optional test campaign removed; product requirement remains |
| MR-009 | Retired coverage | Expensive installed/native/mutation qualification deleted; no equivalent end-to-end claim retained |
| MR-010 | Passed | runtime/mobility/custodian.mjs + journal.mjs — one authoritative run store |
| MR-011 | Not applicable | PR diff is Agent-only; dependency lock retains accepted Boundary/World tuple |
| MR-012 | Retired coverage | Optional test campaign removed; product requirement remains |
| MR-013 | Retired coverage | Optional test campaign removed; product requirement remains |
| MR-014 | Retired coverage | Optional test campaign removed; product requirement remains |
| MR-015 | Passed | mobility_host.test.mjs; deployment validation — missing binding and explicit failure |
| MR-016 | Passed | mobility_host.test.mjs; mobility_protocol.test.mjs — requirement/schema/subject/version checks |
| MR-017 | Retired coverage | Optional test campaign removed; product requirement remains |
| MR-018 | Retired coverage | Optional test campaign removed; product requirement remains |
| MR-019 | Retired coverage | Optional test campaign removed; product requirement remains |
| MR-020 | Passed | mobility_host.test.mjs — resource pin and unsupported cleanup prevent movement |
| MR-021 | Retired coverage | Optional test campaign removed; product requirement remains |
| MR-022 | Retired coverage | Optional test campaign removed; product requirement remains |
| MR-023 | Retired coverage | Optional test campaign removed; product requirement remains |
| MR-024 | Retired coverage | Expensive installed/native/mutation qualification deleted; no equivalent end-to-end claim retained |
| MR-025 | Retired coverage | Optional test campaign removed; product requirement remains |
| MR-026 | Retired coverage | Optional test campaign removed; product requirement remains |
| MR-027 | Retired coverage | Optional test campaign removed; product requirement remains |
| MR-028 | Retired coverage | Optional test campaign removed; product requirement remains |
| MR-029 | Retired coverage | Optional test campaign removed; product requirement remains |
| MR-030 | Retired coverage | Optional test campaign removed; product requirement remains |
| MR-031 | Retired coverage | Expensive installed/native/mutation qualification deleted; no equivalent end-to-end claim retained |
| MR-032 | Retired coverage | Expensive installed/native/mutation qualification deleted; no equivalent end-to-end claim retained |
| MR-033 | Retired coverage | Expensive installed/native/mutation qualification deleted; no equivalent end-to-end claim retained |
| MR-034 | Retired coverage | Expensive installed/native/mutation qualification deleted; no equivalent end-to-end claim retained |
| MR-035 | Retired coverage | Optional test campaign removed; product requirement remains |
| MR-036 | Retired coverage | Optional test campaign removed; product requirement remains |
| MR-037 | Retired coverage | Optional test campaign removed; product requirement remains |
| MR-038 | Retired coverage | Optional test campaign removed; product requirement remains |
| MR-039 | Retired coverage | Optional test campaign removed; product requirement remains |
| MR-040 | Retired coverage | Optional test campaign removed; product requirement remains |
| MR-041 | Retired coverage | Optional test campaign removed; product requirement remains |
| MR-042 | Retired coverage | Optional test campaign removed; product requirement remains |
| MR-043 | Retired coverage | Optional test campaign removed; product requirement remains |
| MR-044 | Retired coverage | Optional test campaign removed; product requirement remains |
| MR-045 | Retired coverage | Optional test campaign removed; product requirement remains |
| MR-046 | Retired coverage | Optional test campaign removed; product requirement remains |
| MR-047 | Retired coverage | Optional test campaign removed; product requirement remains |
| MR-048 | Retired coverage | Optional test campaign removed; product requirement remains |
| MR-049 | Passed | mobility_sessions.test.mjs — issue/redeem for existing principal |
| MR-050 | Retired coverage | Optional test campaign removed; product requirement remains |
| MR-051 | Retired coverage | Optional test campaign removed; product requirement remains |
| MR-052 | Passed | mobility_journal.test.mjs; deferred bridge crash tests — acquired answer survives restart |
| MR-053 | Retired coverage | Optional test campaign removed; product requirement remains |
| MR-054 | Retired coverage | Optional test campaign removed; product requirement remains |
| MR-055 | Retired coverage | Optional test campaign removed; product requirement remains |
| MR-056 | Retired coverage | Optional test campaign removed; product requirement remains |
| MR-057 | Passed | installed deployment clarification + retained review question tests — resumed authored investigation |
| MR-058 | Retired coverage | Optional test campaign removed; product requirement remains |
| MR-059 | Retired coverage | Expensive installed/native/mutation qualification deleted; no equivalent end-to-end claim retained |
| MR-060 | Not run — external | Not run: an actual person must perform the separately authorized qualification |
| MR-061 | Passed | model.test.mjs; installed configuration generator — real adapter and disabled inference default |
| MR-062 | Passed | model.test.mjs; model_admission.zig; retained review misuse — offered actions and normalization |
| MR-063 | Retired coverage | Optional test campaign removed; product requirement remains |
| MR-064 | Retired coverage | Optional test campaign removed; product requirement remains |
| MR-065 | Passed | mobility_journal.test.mjs; background model tests — durable pre-dispatch allowance |
| MR-066 | Passed | model.test.mjs — exact credentialed endpoint and disclosure profile restrictions |
| MR-067 | Retired coverage | Optional test campaign removed; product requirement remains |
| MR-068 | Passed | mobility_host.test.mjs — retained capture/replay label restrictions |
| MR-069 | Passed | mobility_task_catalogue.test.mjs; model bindings; export command — independent view/egress grants |
| MR-070 | Passed | installed deployment scans actual keys, ambient sentinel, all journal artifacts/transfers/logs and browser-visible persistence; inherited durable browser scans |
| MR-071 | Passed | mobility_protocol.test.mjs; mobility_host.test.mjs — issuer/key owner/program/resource admission |
| MR-072 | Passed | model.test.mjs; retained-review misuse; fixed profile selection — no unoffered authority |
| MR-073 | Passed | mobility_host.test.mjs; mobility_journal.test.mjs — lost acceptance and original decision retry |
| MR-074 | Passed | mobility_host.test.mjs — onward return and cancellation reconciliation |
| MR-075 | Passed | mobility_journal.test.mjs; model/check restart tests — acquired replies avoid redispatch |
| MR-076 | Retired coverage | Optional test campaign removed; product requirement remains |
| MR-077 | Passed | mobility_host.test.mjs — before/after World publication fault, saved reply retained |
| MR-078 | Passed | mobility_host.test.mjs; cancellation/withdrawal tests — one cleanup authority |
| MR-079 | Passed | repository_publication_journal.test.mjs; approval tests — pre-admission cancellation and retained publication |
| MR-080 | Passed | sandbox qualifier; mobility_deployment.test.mjs — kill/reap and unrelated-run progress |
| MR-081 | Passed | mobility_host.test.mjs; journal quota/fault tests — committed checkpoint/reply survives capacity failure |
| MR-082 | Retired coverage | Optional test campaign removed; product requirement remains |
| MR-083 | Passed | mobility_journal.test.mjs — corruption/generation/known rollback; no consistent-backup self-detection claim |
| MR-084 | Passed | mobility_journal.test.mjs; publication journal tests — GC roots and unresolved outcomes |
| MR-085 | Retired coverage | Expensive installed/native/mutation qualification deleted; no equivalent end-to-end claim retained |
| MR-086 | Retired coverage | Optional test campaign removed; product requirement remains |
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
