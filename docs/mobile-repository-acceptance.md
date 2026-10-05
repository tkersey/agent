# Mobile Repository Agent — implementation progress

The [accepted specification](mobile-repository-agent-spec.md) governs W0–W8 and
MR-001–MR-096. This is an incomplete implementation, not a reference-qualified
application. The draft PR includes the authored investigation/review/publication
loop, authorized catalogue intake, installed images/contracts/native helpers,
and full Chromium/Firefox Worker execution. Final qualification remains open. The extracted package also passes a complete
Worker-to-native-check-to-publication test over an isolated Agent source repair: an
independent JSON boolean-bound harness fails the seeded incorrect base and passes
the proposed correction under the qualified Zig profile.

## Foundation (W0)

Started from Agent `badb05961daef233f30529a43e9f015641083dfd` (tree
`14e7122aad9cf8a4618c40853b3ae6f5c2462015`). GitHub confirmed Boundary #164,
World #62, and Agent #42 merged before this worktree was created.

The existing dependency lock and setup/verifier authenticated:

- Boundary source `c49f743382257c7cf5512934ae3a2d0f56d4d4c0` and its locked
  archive-extracted package, plus the Zig-managed package used by the build.
- World source `35f11b811b03fcaa2d696265ff8d9b9c92c8fc95`, its source archive,
  and the existing authenticated runtime delivery.
- Kernel SHA-256 `e6a982f3f13790e3dec7a5e26770549a6be8d0cb5e97a25cd97cead993f2b394`.
- Zig 0.17.0 executable SHA-256
  `18fbdb9fb852846f0e91008c5b99c9c18db1115671701c2890bf84a44ddc202d`;
  standard-library inventory SHA-256
  `8ed22c5d774cba9be2ad20c24c706ce450e5952b08d0f9d179e1b71811f60e5a`.

On Darwin arm64, `check-agent4` passed 342 build steps and 118 Zig tests,
including the external installed-authoring consumer. The selected mobility
continuation, native, journal, integration, and approval targets passed 97 build
steps. The inherited extracted-package Chromium/Firefox mobility lane passed
59 build steps. These counts exclude separately reported Node assertions.
The broader inherited `check-agent4-integration` aggregate completed 361/361
steps and 63/63 Zig tests, including its Node and packaged execution lanes. It
started on the foundation and completed while additive application work
progressed; this is regression evidence, not final application qualification.

## Authored continuation (W1)

`test/consumers/mobile_repository` uses public Agent/Boundary APIs, existing
`mobility.ensure`, model normalization, and an owned `agent.inquiry` investigator.
The 33,226-byte image owns list/read/search, staging up to four exact edits,
check selection and interpretation, clarification, human review, and completion.
No environment selects the next application action.

The fresh-World continuation test passes ten deterministic scenarios: all three
modes retain the original goal/evidence; clarification causes four real transfers;
local `Here` causes none; exhausted movement and cancellation clean up once;
invalid intake performs no effects. One scenario uses real managed Git. The model
transport is a fresh synthetic loopback endpoint on each turn; exact opaque replay
items and paired tool results survive. These are not live-model usefulness tests.

The full two-custodian suite passes 30 application/component tests, including actual managed publication,
all three application modes, read-only review questions, amendments, logical-budget
exhaustion, attempted edits during read-only review, origin restart, and cancellation
of the retained investigator. A review question preserves the candidate and check;
an amendment discards both and must check a new candidate. Physical model/check
charges persist and agree with independently expected counts. Publish completes
U→W→U→W→U with its private grant and exact managed receipt; inspect/propose leave
the ref unchanged. The final remaining-move allowance includes approval placement.

The same suite preserves the shared approval component's Chromium/Firefox tests
and all six non-passing check dispositions. All three full-application modes also
pass through real Chromium/Firefox Workers using extracted package modules and
images, after deleting the archive's optional test oracles. A failed authored
return after publication preserves the saved receipt and projects published;
presentation pending, including after restart. These use synthetic provider and
human inputs; they do not establish live-model usefulness or actual-person proof.

Reproduce this slice using the existing authenticated setup:

`check-mobile-repository-native` also runs fourteen continuation scenarios
against the native interpreter. All 163 canonical outcomes match WASM byte for
byte, including cancellation, exhausted budgets, invalid intake, and the real
repository case. Provider replies remain synthetic; this comparison does not
qualify live-model behavior. The same target additionally compares 264 actual
custody outcomes across six independent repository scenarios: all three modes,
lost publication reply, cancellation during review, and a repeated session that
proposes then publishes. These include edit preparation, check dispatch, exact
private approval and managed publication. Their existing expected-result,
unchanged-target, cleanup and cumulative-allowance assertions remain active;
agreement between interpreters is not their only oracle.

```sh
node tools/agent4/setup.mjs --work-dir "$PWD/.agent4-mobile"
zig build check-mobile-repository -Doptimize=safe \
  -Dboundary-source="$PWD/.agent4-mobile/inputs/boundary" \
  -Dworld-source="$PWD/.agent4-mobile/inputs/world" \
  -Dworld-runtime="$PWD/.agent4-mobile/out/world-runtime/runtime" \
  --prefix "$PWD/.agent4-mobile/out"
```

## Immutable repository preparation (W2, partial)

The existing repository owner now offers managed snapshot, read, list, search,
and read-window bindings. Its
private Git object adapter provisions only an explicitly selected local commit,
admits a pinned repository manifest and Git executable, and performs raw object
reads/writes without checkout, filters, hooks, replacements, or network fetch.
Preparation constructs an exact bounded tree; it never advances the delivery
ref. Candidate verification reconstructs the tree from the admitted preimages
and edit set rather than trusting a caller's candidate ID.

Seven repository tests cover real SHA-1 and SHA-256 stores; four-file
create/replace/delete deltas; more than 32 paths and bound list/search cursors;
UTF-8 excerpt boundaries; frozen reads after source branch changes; mismatched
preimages/scope/mode, binary replacements and forged trees; symlink grants,
metadata/configuration corruption; and inert filter/hook traps. Alias admission
uses a private name-lookup probe on the managed filesystem, including Unicode
cases that cannot be decided by lowercasing alone. A targeted Unicode probe
also passed. Temporary test and package paths include spaces.

`check-mobile-repository` passed 30/30 build steps. Existing document tests
passed after sharing their lexical path admission. A custom-prefix extracted
use archive imported the new adapters and passed the existing repository
execution witness: five cases, ten isolated test processes, and 99 fresh-kernel
transfers. The complete mobile image and all leaf contracts are now installed in that archive.
On macOS it also carries the qualified check launcher, loader restriction and
publication gate with inventory digests; executable helpers preserve executable
archive modes. No authoring fallback is used.

The portable query extension passes `check-mobile-repository` (42/42 steps),
including compiled request/result schema round trips against a real managed
repository. Pagination tests cover more than 32 entries, query-bound cursors,
snapshot/owner rejection, safe integer offsets, and UTF-8 byte boundaries.
The deployment loader accepts `repository-query` adapters for those five read
operations, bound to the configured repository, manifest, host, and classification.
This does not yet qualify the complete model-selected investigation loop.

The [bounded Zig profile](mobile-repository-zig-profile.md) now passes its native
qualification on Darwin 27.2.0 arm64. Nine probe cases exercise compiler reads,
pre-main code, filesystem/network/credential denial, fork/spawn/exec, scratch and
output exhaustion, memory and thread bounds, timeout, cancellation, and reaping.
An independently checked repair of Agent's real boolean JSON-size bound fails
on the incorrect private base and passes on the prepared candidate. Neither the
managed ref nor the original checkout changes. The qualifier completed 4/4 build
steps and 21 compiler/check process executions, including the two real-source
checks; helper compilation is separate. The nine probe outcomes include expected
failures and limits, not nine successful candidate checks.

The isolated base and candidate checks took 11.934 and 12.455 seconds in one
recorded cold sample, including private-volume setup/cleanup. This is not a
mobility comparison or a general latency claim. Records bind exact source,
candidate, runner/profile/toolchain/contract identities and completed checks.
A protected startup channel distinguishes isolation setup failure from a check
that actually ran; the candidate cannot retain that channel.

Three operator-selectable manifests now cover Boundary wire naturals, World
allocation budgets, and Agent JSON argument-size bounds. The qualified runner
passes each real module and rejects a compiling semantic mutation after actual
execution. Their narrow contracts, source dependencies, deployment selection and
excluded claims are documented with the manifests. Physical allowance, extracted-loader, and lifetime storage qualification are
recorded in the later sections of this report; per-object bounds alone do not
establish lifetime storage accounting.

## Durable human interaction (W3, partial)

The [deferred reply and reference session seam](mobile-repository-human.md) is
implemented in the existing custodian, journal, deployment loader and browser
client. `AWAITING` is durably registered before display. Answers are fenced by
current occurrence/version, exact question/request, authenticated identity and
audience; duplicates, cancellation and GC use the existing journal owner.

Reference operator-issued one-use logins and session cookies have passed TLS,
expiry, revocation, restart and scope tests. An extracted installed CLI issues
credentials for existing deployment grants only. Chromium and Firefox exercise
the real login and answer forms, inert source rendering, origin restart during
waiting, a fresh Worker and completion of the inherited compiled fixture.
The combined mobility journal/integration/model/browser and repository-continuation
check passed 94/94 build steps. Final deferred-record guards passed 87 journal,
model and bridge tests. These remain synthetic human tests; they do not establish the full application's
proposal/approval UI or actual-person qualification.

## Provider replay and work allowance (W4, partial)

The [provider leaf and allowance owner](mobile-repository-model.md) support an
explicit OpenAI Responses deployment profile without introducing a tool loop.
The additive v4 wire retains complete supported replay items, paired tool results,
opaque reasoning and optional usage. Existing v3 callers remain compatible.
The protected responder retains its offered set and rejects incomplete replay.
Two fresh Node adapter processes reconstruct the next request from ordinary data.

Authoring validation passed 337/337 steps and 117 Zig tests; the final native
responder check passed 10/10 steps and 65 Zig tests. Provider/journal/bridge and
extracted-deployment checks passed 121 Node tests; the final fresh-process model
lane passed 25 tests. These establish the provider/owner seams. The current authored-loop evidence is
reported above; live-model usefulness remains unqualified.

Durable attempt, request-byte and output-token allowances are charged with the
dispatch transaction, bound to W and the signed run registration, and preserved
across restart. Background model I/O releases the run lock; unknown calls are
not repeated, and cancellation fences late replies without refunding attempts.
The authored loop also retains logical step/check allowances. Question and amendment
tests reject per-return resets and preserve complete provider replay.

## Managed publication (W5, partial)

The [publication boundary](mobile-repository-publication.md) prepares exact
commits, verifies them without object writes, records intent in the existing
occurrence, and acquires receipts with replies. A native process gate becomes
Git while retaining its lock; actual stopped-Git/parent-death tests prove that
recovery cannot race that surviving writer. Saved exact intents explain every
managed ancestor, including historical publication below a later head.

The publication adapter rechecks policy under the gate and requires exact
journal-acquired checks with current profile/runner identities. The custodian
uses a read-only reconciler for uncertain publication; it never redispatches the
write. Cancellation before admission, late cancellation, intent transaction
faults, stale requests, missing history and branch rewind have targeted coverage.

The gate/check target passed 3/3 build steps and 16 Node tests; the final adapter
receipt check passed 5/5 tests. Snapshot tests passed 8/8, and inherited custody
journal/integration checks passed 62/62 build steps. These are W5 seam checks on
the current working source, not the required end-to-end protected application.
The follow-up shared authored approval composition passes an actual W→U→W
round trip. The existing private grant survives the return placement, the exact
managed commit is published, and a fresh custodian recovers a lost reply without
repeating the check, approval, or protected publication leaf. Stale answers and
wrong principals never reach publication.

The authenticated deferred approval adapter and exact-change UI pass Chromium
and Firefox, including complete proposals larger than 64 KiB and inert rendering
of source containing HTML. Combined publication/approval and inherited custody
checks passed 91/91 build steps. Final browser/approval and prior free-text
interaction regressions passed 8/8 tests; final intent-reuse and adapter checks
passed 12/12. Full snapshot checks passed 8/8 before the additional targeted binary
provisioning case. These witnesses use deterministic human/check capabilities and
the production approval, custody, session, browser, store and publication owners.
These earlier component witnesses do not establish the actual-person lane. The
current full application loop and installed helpers are covered above; the final
fault/acceptance matrix remains open.

## Typed check dispatch

The check leaf now returns an enum status with its canonical record. The authored
approval composition preserves every non-passing status and stops before proposal
preparation. The deployed `repository-check` binding fixes one finite profile and
qualified runner and charges the existing durable W allowance before dispatch.
The publisher requires typed/canonical status agreement in acquired evidence.

The actual sandboxed Zig repair test passes through this binding while retaining
the independent failing-base and unchanged-ref/checkout assertions. All twelve
compiled approval scenarios pass, including both browsers, six non-passing
statuses, and a retained check charge after publication recovery. Nine adapter
tests and three extracted deployment/CLI regression tests pass. The extracted
earlier tests cover package import closure and existing deployment behavior.
The full v2 loader qualification below now exercises the new check configuration.

## Remaining acceptance

The [matched comparison harness](mobile-repository-comparison.md) now passes
equivalent-image/input/patch/work-count checks, actual cold/warm image-cache
checks, and proxy payload-substitution rejection. Thirty matched pairs in each
of nine cells completed with all 576 attempts retained (including warmups).
Mobility was slower in every tested cell; extra-read and opaque-replay workloads
transferred fewer bytes. The comparison report retains the raw data and scope.
Supplemental browser/recovery attribution and observed UI operation counts are
now reported separately, with exact timing boundaries and all raw observations.

Remaining work includes qualification evidence reconciliation,
lifetime resource-accounting reconciliation, the complete MR-001–MR-096
mapping, inherited exact-head regressions, complete fault qualification,
final measurement reconciliation, and serial review closeout.

Live-provider, actual-person, and two-machine qualifications are not run and
require separately authorized inputs. No core changes, live model calls,
user-repository mutation, upstream publication, merge, promotion, or release occurred.

The extracted qualification target is `check-mobile-repository-package` with
the same source/runtime/prefix flags and
`-Dbrowser-tools=/absolute/path/to/locked-playwright-tools`. It requires both
browsers and executes thirteen independently checked cases after removing the
archive's optional test oracles, including a qualified native Agent source repair.
Catalogue/next-task admission has four focused tests; the browser bridge also rejects
missing and cross-session CSRF before registration.

## Repeated authored tasks

The packaged application and catalogue now use `session.bpi3`. Its bounded loop
assigns generation 1 and advances generations in World state. Initial templates
cannot supply a generation. Each task invokes the same investigation and
completion construction, releases its owned investigation, and offers the next
task with explicit allowances. No model transcript, candidate, check result or
approval is reused as the next task's state. The repository/base/grants remain
fixed; another scope or base requires a new authorized session. Custodian-wide
allowances stay cumulative.

Production deferred interaction admits only a goal and an operator-granted mode,
or a stop response. Chromium and Firefox both execute two tasks in real Workers,
export the first completed report, answer the next-task prompt through the UI,
and resume after page reload. A separate custody test restarts the origin at the
next-task prompt. The propose-then-publish witness performs two independent
checks and publishes once with fresh exact approval at generation 2. Reusing an
old answer cannot change the next task. Native/WASM comparison additionally
covers two completed tasks, early stop and rejected session bounds.

## Mutation and bounded-model qualification

`check-mobile-repository-mutants` copies tracked source to an isolated temporary
directory, verifies each clean selected oracle, changes one production owner,
runs the same oracle and restores that owner. All twelve explicit mutants are
detected by nine clean baseline oracles. Syntax/import errors, missing artifacts,
timeouts and unrelated runner failures do not count as detection. Output records
the original/mutant source hashes and the deciding counterexample. Mutations are
not applied to the working tree or shipped runtime.

| Mutant | Deciding oracle |
|---|---|
| Transport timeout becomes refusal | Source remains offered, with no takeover or cleanup. |
| Restore rebuilds initial arguments | Restored parked outcome must equal the saved continuation. |
| Stale question binding accepted | Current waiting occurrence rejects the old occurrence ID. |
| Acquired answer replaced | A different answer/reply cannot replace the settled pair. |
| Proposal checked only by summary | Principal, exact diff and commit mutations reject. |
| Git old-ref precondition removed | A ref change after validation cannot be overwritten. |
| Lost publication acknowledgment triggers dispatch | Recovery completes without repeating the protected leaf. |
| Matching tree counts as another publication | A different intent with the same tree remains unpublished. |
| Opaque reasoning removed from replay | A fresh provider receives the complete replay items. |
| Whole-state classification ignored | Private retained state cannot begin return/export. |
| Spent allowance reset | Restart cannot admit another attempt beyond the grant. |
| Incomplete check counted as passing | Even a populated check list cannot override Incomplete status. |

The production-adjacent custody model also passes 128 deterministic seeds with
192 generated steps per seed, at most four prefix hops/epochs, and explicit
answer/cancellation orderings. These are bounded witnesses, not exhaustive
coverage of every mutation, interleaving, storage failure or power-loss event.

## Publication and browser regression repairs

The check evaluator now observes raw Wasm return values outside the candidate
and computes its verdict in the host. The incorrect Agent bound fails despite
a normal process exit; the corrected bound passes. The extracted full application
has passed its native-check and browser cases with this observer.

Both browsers reproduce and now reject the former “Ready” status for an unknown
effect result. Four reference UI tests pass, including repeated Continue with
exactly one effect attempt and the existing restart/answer flow.

Confirmed publication remains recorded when subsequent verification fails or is
unavailable. Twenty-five gate/binding/journal tests cover real post-write read
failure, ref mismatch, missing tree, all three verification statuses after journal
restart, and the inherited publication faults. Actual private approval and lost
reply recovery also pass. Verification checks Git ref/object identity; additional
behavioral postchecks are not implied.

## Installed v2 deployment qualification

The extracted CLI now exposes `provision-repository` and `qualify-check` through
the existing repository and runner owners. The installed qualification provisions
a private immutable base, rejects replacement of its store, qualifies the selected
profile, initializes U and W from v2 configurations, lists and starts catalogue
tasks, issues a reference login and starts W with the installed `serve` command.
U uses the extracted loader in the test process; W runs in a separate Node process.
They communicate over real mutual TLS, and Chromium drives the shipped UI/Worker.
Optional archive test oracles and authoring sources are absent from both hosts.

All three modes pass through this route. Inspect and propose leave the managed
ref unchanged. Publish presents the exact checked change, consumes one synthetic
human approval and publishes once. Independent assertions require seven total
model calls, two checks, one publication, the exact corrected Agent source bytes,
and an unchanged original checkout. Existing deployment/serve/login regressions
also pass. The new case is included serially in `check-mobile-repository-package`
alongside its thirteen earlier application/browser/check scenarios.

This test exposed and fixed rejection of valid helper files reached through
macOS temporary-directory aliases. CLI qualification and deployment startup now
resolve their helper paths before the existing digest/identity checks. The same
case failed before normalization and completed after it.

These are two local host processes with a deterministic provider and synthetic
human input, not two machines, live inference or actual-person qualification.
The test now fills the shipped disabled-inference setup template and calls the
installed configuration generator. Production code derives the bindings and typed
inputs; the test no longer hand-builds that protocol/configuration machinery.

## Operator setup and result export

The installed `repository-template` and `configure-repository` commands
generate both v2 configurations plus initial-task and cleanup bytes using the
installed image/schema inventory and the managed store's actual scope. The
operator supplies identities, paths, pinned peers, provider policy and limits.
No Agent image compilation, manual protocol encoding or signature editing is
required. Disabled inference emits no model binding and no runnable catalogue
entry. Existing output directories are refused. Startup still qualifies the
selected check runner independently of the supplied qualification receipt.

The extracted two-host/browser test passes all three modes from generated
configuration, with non-null reasoning parameters independently observed at the
fixture provider. It rejects invalid scope, infeasible check limits and a malformed
principal before creating output. Template copying is qualified under an archive
path containing spaces. The source-independent test retains its original exact
repair, unchanged non-publishing refs, call-count and single-publication assertions.

The installed `export` command returns the exact typed report with run/image/
program/outcome bindings and any locally retained publication receipt. The same
installed test exports each completed mode and rejects a different principal.
Exports do not advance execution or publish. Thirty-seven existing model, provider
and snapshot regression tests also pass after the parameter/configuration changes.
See [operator instructions](mobile-repository-operations.md) for the complete
command sequence and remaining validation/qualification-command limits.

## Read-only validation and clarification

`validate` shares startup preparation but stops before opening journals or
session stores. It checks configuration/runtime/contracts, key and TLS bindings,
limits and local catalogue requirements. With peer declarations and explicit
`--peers`, it verifies actual placement and workspace capabilities through the
existing authenticated, canonical preflight protocol. Peer private files are not
opened locally. The report distinguishes local evidence, declarations and live
preflight; it does not promise future availability or execute provider/tool work.
Configured native checks use their existing temporary qualification scratch.

The installed test proves validation works before custody/session directories
exist, rejects a mismatched signer and rejects an omitted clarification binding.
Authenticated peer validation leaves the registered run set unchanged and makes
no provider call. Four installed deployment/CLI regressions pass.

Generated configurations now include the previously missing
`agent.repository.human.v1` binding. The shipped UI displays the question and
source excerpt as text, and the answer resumes the retained investigation. All
three installed modes complete a real clarification round trip: ten model calls,
three answers, two checks and one separately approved publication. The fixture
explicitly grants six moves and four model attempts per run for this extra work;
the production setup default remains four moves. Six Chromium/Firefox UI cases
pass, retaining both generic and repository-question restart/rendering coverage
and the unknown-effect pause regression.

## Browser/recovery attribution and operator counts

The supplemental attribution target passed all 256 attempts (240 measured and
16 warmup), with thirty paired observations per browser/recovery cell. Fresh
production Workers reproduce the exact transferred parked outcome; all recovery
samples reconcile one publication without another check, model call or write.
The report retains the browser outlier, timer-resolution limits, source/helper
hashes and raw observations. Custodian/journal reopen is explicitly not a whole
service-process restart measurement.

The installed three-mode qualification also records actual UI controls and every
CLI invocation, including negative probes. It still passes its unchanged exact
repair, authority, reference preservation and operation-count assertions. Polling
Continues are reported as observed driver work, not a minimum human-action claim.
See the [comparison report](mobile-repository-comparison.md) and its raw records.

## Application qualification command

The installed `qualify-application` command selects fixed offline, browser and
package verifiers or an explicitly opted-in deployed/live corpus. It records source
and toolchain identities, verifier outcomes and bounded logs; failures and unrun
lanes/cases remain visible. Expected base, mode, tree and publication disposition
are fixed before case execution. The matcher rejects unrelated receipts and
publication claims embedded in declined text.

The real offline lane completed its application, publication and mutation verifiers.
Five admission/matcher tests pass, including missing opt-ins before host/output
access and a live-provider profile rejected from the deployed fixture lane. The
extracted deployment test exercises a real qualifier-created run with no person:
its wait deadline returns incomplete, leaves the run active and uncancelled, and
marks the following case not run. The regular three-mode browser workflow then
still passes against the same workspace.

No live model, actual person or two-machine corpus was executed. A complete external
evidence packet also requires workspace metrics/usage and the operator’s independent
judgment; origin metrics and structural contract matches do not establish a model
success rate or discharge every acceptance row. See the operator documentation
for fresh-origin, service, opt-in and wait-deadline behavior.

## Acceptance-ID audit inventory

This inventory identifies the deciding proof surfaces; it is not a blanket pass.
`Final run pending` means the named checks exist and have scoped evidence above,
but the final source subject and full assertion coverage still require reconciliation.
External rows are explicitly not run. No row is upgraded merely by a green aggregate.

| ID | Current disposition | Deciding evidence / remaining scope |
|---|---|---|
| MR-001 | Final run pending | dependencies.test.mjs; package_commands.test.mjs — authenticated tuple and mismatch rejection |
| MR-002 | Final run pending | zig17.test.mjs; consumer_build.test.mjs — selected compiler/library and conflict checks |
| MR-003 | Final run pending | check-agent4 + check-agent4-integration — final aggregate not yet executed |
| MR-004 | Final run pending | mobile_repository_continuation.mjs; native agreement — public consumer, unchanged evaluator |
| MR-005 | Final run pending | mobile_repository_deployment.test.mjs — separate installed hosts; recovery witnesses still need final correlation |
| MR-006 | Final run pending | mobile_repository_deployment.test.mjs — extracted production loader; optional archive oracles removed |
| MR-007 | Final run pending | mobility_task_catalogue.test.mjs; mobility_deployment.test.mjs — v1/v2 closed configuration |
| MR-008 | Final run pending | mobility_host.test.mjs; package_commands.test.mjs; deployment validation — artifact/schema/program rejection |
| MR-009 | Final run pending | mobile_repository_package.test.mjs; mobile_repository_deployment.test.mjs — extracted runtime path |
| MR-010 | Final run pending | runtime/mobility/custodian.mjs + journal.mjs; installed deployment — one authoritative run store |
| MR-011 | No core repair introduced | PR diff is Agent-only; dependency lock retains accepted Boundary/World tuple |
| MR-012 | Final run pending | package_commands.test.mjs; installed test paths contain spaces; final aggregate uses custom prefix |
| MR-013 | Final run pending | repository_publication_approval.test.mjs; installed deployment — full publish trace and exact commit |
| MR-014 | Final run pending | mobility_ensure.mjs; mobile_repository_continuation.mjs — Here consumes no move |
| MR-015 | Final run pending | mobility_host.test.mjs; deployment validation — missing binding and explicit failure |
| MR-016 | Final run pending | mobility_host.test.mjs; mobility_protocol.test.mjs — requirement/schema/subject/version checks |
| MR-017 | Final run pending | mobility_continuation.mjs; inquiry_runtime.mjs — retained caller values affect final output |
| MR-018 | Final run pending | repository_publication_approval.test.mjs — retained question/amendment without reinitialization |
| MR-019 | Final run pending | inquiry_runtime.mjs — fresh-engine transfers, cleanup(30), surviving model(27), owner counts and final 92 |
| MR-020 | Final run pending | mobility_host.test.mjs — resource pin and unsupported cleanup prevent movement |
| MR-021 | Final run pending | mobility_durable_browser.test.mjs; full browser modes — terminated old Worker and fresh assignment |
| MR-022 | Final run pending | mobility_durable_browser.test.mjs; mobility_browser_bridge.test.mjs — yielded/cancel controls |
| MR-023 | Final run pending | mobile_repository_continuation.mjs; retained review budget tests — bounded repeated ensures |
| MR-024 | Final run pending | mobile_repository_deployment.test.mjs — all three modes, non-publishing refs unchanged |
| MR-025 | Final run pending | repository_snapshot.test.mjs — frozen snapshot despite moving live branch |
| MR-026 | Final run pending | repository_snapshot.test.mjs — more than 32 paths, query-bound cursors |
| MR-027 | Final run pending | repository_snapshot.test.mjs; model tool contracts — explicit excerpts and replacement preimages |
| MR-028 | Final run pending | repository_snapshot.test.mjs; document owner — path/alias/mode constraints |
| MR-029 | Final run pending | repository_snapshot.test.mjs — SHA-1/SHA-256 four-path exact deltas |
| MR-030 | Final run pending | repository_snapshot.test.mjs — invalid preimages, conflicting edits and forged trees |
| MR-031 | Final run pending | repository_zig_sandbox.test.mjs; installed deployment — ref and original checkout unchanged |
| MR-032 | Final run pending | repository_zig_sandbox.test.mjs — exit/output forgery rejected; host-owned raw observations |
| MR-033 | Final run pending | repository_zig_sandbox.test.mjs — actual Agent repair and all three repository profiles |
| MR-034 | Final run pending | repository_zig_sandbox.test.mjs — native qualifier probes and unavailable fallback rejection |
| MR-035 | Final run pending | repository_publication_approval.test.mjs; sandbox qualifier — six non-passing dispositions |
| MR-036 | Final run pending | inquiry_broker_runtime.mjs; repository_check_binding.test.mjs — exact applicability and profile binding |
| MR-037 | Final run pending | repository_publication_approval.test.mjs — actual private grant relocation and consumption |
| MR-038 | Final run pending | mobility_approval.test.mjs; publication/browser bindings — principal and occurrence rejection |
| MR-039 | Final run pending | repository_snapshot.test.mjs; mobility_approval.test.mjs — exact action and evidence binding |
| MR-040 | Final run pending | repository_publication_approval.test.mjs; snapshot proposal tests — complete diff/commit identity |
| MR-041 | Final run pending | repository_publication_gate.test.mjs — actual Git old-value CAS and stale proposal |
| MR-042 | Final run pending | repository_publication_gate.test.mjs — concurrent prepared candidates, one admission/write, loser reconciles conflict |
| MR-043 | Final run pending | repository_snapshot.test.mjs — direct authorized managed ref only |
| MR-044 | Final run pending | repository_snapshot.test.mjs — inert hooks/filters/config; fixed Git command environment |
| MR-045 | Final run pending | repository_publication_approval.test.mjs; journal faults — lost reply and exact reconciliation |
| MR-046 | Final run pending | repository_publication_gate.test.mjs — same tree under another intent does not count |
| MR-047 | Final run pending | repository_publication_gate.test.mjs — stopped Git survives parent, retains lock, blocks another writer |
| MR-048 | Final run pending | repository_publication_gate.test.mjs + journal — post-write mismatch/unavailable read retains receipt |
| MR-049 | Final run pending | mobility_sessions.test.mjs; installed deployment — issue/redeem for existing principal |
| MR-050 | Final run pending | mobility_sessions.test.mjs; mobility_browser_bridge.test.mjs — origin/CSRF/audience/revocation |
| MR-051 | Final run pending | mobility_reference_browser.test.mjs; application review restart — durable question |
| MR-052 | Final run pending | mobility_journal.test.mjs; deferred bridge crash tests — acquired answer survives restart |
| MR-053 | Final run pending | mobility_browser_bridge.test.mjs — same answer idempotent; conflicting answer rejected |
| MR-054 | Final run pending | mobility_browser_bridge.test.mjs; repeated-session tests — stale occurrence/incarnation/generation |
| MR-055 | Final run pending | mobility_reference_browser.test.mjs; exact-change browser tests — inert text rendering |
| MR-056 | Final run pending | repository_publication_approval.test.mjs — decline/amendment and fresh check/approval |
| MR-057 | Final run pending | installed deployment clarification + retained review question tests — resumed authored investigation |
| MR-058 | Final run pending | mobility_journal.test.mjs; mobility_browser_bridge.test.mjs — serialized answer/cancel races |
| MR-059 | Final run pending | mobile_repository_package.test.mjs + reference browser — both engines and real Workers |
| MR-060 | Not run — external | Not run: an actual person must perform the separately authorized qualification |
| MR-061 | Final run pending | model.test.mjs; installed configuration generator — real adapter and disabled inference default |
| MR-062 | Final run pending | model.test.mjs; model_admission.zig; retained review misuse — offered actions and normalization |
| MR-063 | Final run pending | mobility_model.test.mjs; fresh-process replay probes — no provider-session dependency |
| MR-064 | Final run pending | model.test.mjs; mobile_repository_continuation.mjs; opaque-replay mutant — exact replay data |
| MR-065 | Final run pending | mobility_journal.test.mjs; background model tests — durable pre-dispatch allowance |
| MR-066 | Final run pending | model.test.mjs — exact credentialed endpoint and disclosure profile restrictions |
| MR-067 | Final run pending | mobility_host.test.mjs — whole-state label/export denial before upload |
| MR-068 | Final run pending | mobility_host.test.mjs; whole-state mutant — retained capture/replay label restrictions |
| MR-069 | Final run pending | mobility_task_catalogue.test.mjs; model bindings; export command — independent view/egress grants |
| MR-070 | Final run pending | installed deployment scans actual keys, ambient sentinel, all journal artifacts/transfers/logs and browser-visible persistence; inherited durable browser scans |
| MR-071 | Final run pending | mobility_protocol.test.mjs; mobility_host.test.mjs — issuer/key owner/program/resource admission |
| MR-072 | Final run pending | model.test.mjs; retained-review misuse; fixed profile selection — no unoffered authority |
| MR-073 | Final run pending | mobility_host.test.mjs; mobility_journal.test.mjs — lost acceptance and original decision retry |
| MR-074 | Final run pending | mobility_host.test.mjs — onward return and cancellation reconciliation |
| MR-075 | Final run pending | mobility_journal.test.mjs; model/check restart tests — acquired replies avoid redispatch |
| MR-076 | Final run pending | mobility_browser_bridge.test.mjs; publication reconciliation — unknown outcomes stay distinct |
| MR-077 | Final run pending | mobility_host.test.mjs — before/after World publication fault, saved reply retained |
| MR-078 | Final run pending | mobility_host.test.mjs; cancellation/withdrawal tests — one cleanup authority |
| MR-079 | Final run pending | repository_publication_journal.test.mjs; approval tests — pre-admission cancellation and retained publication |
| MR-080 | Final run pending | sandbox qualifier; mobility_deployment.test.mjs — kill/reap and unrelated-run progress |
| MR-081 | Final run pending | mobility_host.test.mjs; journal quota/fault tests — committed checkpoint/reply survives capacity failure |
| MR-082 | Final run pending | repository_snapshot.test.mjs — retained byte/file quotas, reopened/concurrent writers, orphan files; repository_scratch.test.mjs — finite durable slots; installed deployment — no completed scratch remains |
| MR-083 | Final run pending | mobility_journal.test.mjs — corruption/generation/known rollback; no consistent-backup self-detection claim |
| MR-084 | Final run pending | mobility_journal.test.mjs; publication journal tests — GC roots and unresolved outcomes |
| MR-085 | Final run pending | mobile_repository_package.test.mjs; installed deployment — no source/oracle execution fallback |
| MR-086 | Final run pending | check-mobile-repository-native — byte agreement plus independent expected outputs |
| MR-087 | Not run — external | Not run: separate authorized machines/storage/network and fault exercise required |
| MR-088 | Not run — external | Not run: operator-approved provider/data/budget/corpus and independent judgment required |
| MR-089 | Passed at recorded frozen revisions | Frozen 0d90b80 comparison report — identical image/args/work/authority, all 576 attempts |
| MR-090 | Passed at recorded frozen revisions | Comparison and attribution reports — separately scoped phases and excluded human/provider dwell |
| MR-091 | Passed at recorded frozen revisions | Comparison cache proof + frozen 3bc8d12 browser attribution — actual cold/warm image traffic and Worker costs |
| MR-092 | Final run pending | mobile_repository_mutants.mjs; production-adjacent custody model — twelve mutants and bounded seeds |
| MR-093 | Final run pending | Installed template/config/validate/start/serve/cancel/export/qualifier tests; negative inputs |
| MR-094 | Final run pending | Exact publication receipt/proposal tests and UI disclosure — managed ref only |
| MR-095 | Open — final reconciliation | This map is an audit inventory; final exact-head disposition remains open |
| MR-096 | Final run pending | Live PR #44 readback: draft, assigned tkersey, exact current head; no merge/release authorization |

Test paths above are under `test/agent4/` unless a build target or runtime owner is named.
MR-019 uses the actual inquiry primitive shared by the application: cleanup of one
retained child leaves another executable, with package counts inspected after each
fresh-engine transfer. MR-042 composes the separately qualified private-approval
owner with the process-gated, real-Git concurrent publication witness. MR-070 is a
bounded sentinel check, including raw/hex/base64url key seeds and PEM forms; it is
not a universal detector. Intentional one-use login delivery is excluded from logs,
and HttpOnly authentication cookies are distinct from script-visible persistence.

The current audit pass executed `check-mobile-repository-package` and
`check-inquiry-probe` together against the authenticated tuple. Both installed
package cases and the retained inquiry traces passed. The application case scans
all stored artifact bytes and transfer offers/receipts from both actual journals,
process/command logs, rendered text and script-visible storage against actual
signing/TLS private-key representations and a host-only ambient key sentinel.
The fixture provider independently rejects any Authorization header or sentinel
in its request body. The separate real-Git concurrent-candidate test also passed:
the winner admitted once, the loser never reached admission, and later read-only
reconciliation reported conflict without another ref update.


## Retained storage accounting

A source-head `da4a657` probe prepared four valid candidates without a journal.
Each tree used 32,801 bytes under a 65,536-byte per-tree limit, while retained
uncompressed Git objects grew from 201 to 131,405 bytes. This distinguished the
per-tree bound from the missing lifetime account; it did not claim that the tree
limit was itself a store-wide quota.

The managed-object owner now enforces independent provisioned byte/file limits,
including abandoned temporary objects, under the existing native writer gate.
Cold import uses its exclusively reserved directory. Every later new blob, tree,
and proposal commit crosses the same gate; read-only verification does not write.
Default object limits are 256 MiB of regular-file lengths and 65,536 files. Lower
limits are supported. Existing objects can be reused at capacity; quota refusal
never deletes recovery data or advances the managed ref. Store metadata is v2,
and generated preparation/proposal adapters bind the pinned writer helper.

Scratch allocation has four persistent directory slots per configured root,
including qualification canaries. Atomic directory creation owns capacity across
processes and restarts. A failed or uncertain allocation retains its slot; only
post-reap, successful detach/cleanup releases it. Legacy scratch blocks new
allocation until reconciled. The runner contract records the slot count. The
[operator documentation](mobile-repository-zig-profile.md) states separate
object, journal, and conservative scratch bounds, including what the byte account
excludes. No age-based GC or shared journal-ceiling increase was introduced.

The object tests cover capacity across reopen, idempotent reuse, independent
writers, abandoned files, read-only admission, and unchanged managed refs. The
scratch allocator tests cover twelve concurrent claims for four slots, repeated
fresh-caller refusal, explicit release/reuse, symlinks, and legacy retention.
`check-mobile-repository check-repository-publication-gate` passes on the final
resource implementation: 22 storage/configuration tests, 28 publication tests,
and the authored continuation scenarios. The native profile qualification also
passes, including the real Boundary/World/Agent positive and mutated cases and
zero remaining scratch slots after repeated completed checks.

The extracted workflow passes all three modes and the thirteen nested browser,
publication and native-check cases. It also asserts zero completed scratch
remains after service shutdown. That archive preceded the final two-name Git
reservation and early helper-identity check; those corrections have the focused
object/gate proof above. Final exact-head aggregate/package qualification and
serial review closure remain pending. The existing performance reports retain
their explicitly frozen subjects; they are not new timing claims for this writer.
