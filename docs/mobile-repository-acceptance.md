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

The full ecosystem profile catalog, physical allowance/storage accounting and
artifact pins, deployment dispatch integration for all repository operations,
native-runner package acquisition, and publication remain open. Per-object/import
bounds do not establish complete lifetime storage accounting.

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
current full application loop is covered above; installed helper acquisition and
the final fault/acceptance matrix remain open.

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
tests cover package import closure and existing deployment behavior; they do not
yet exercise the new check configuration through the extracted loader.

## Remaining acceptance

Remaining work includes complete deployment-loader/check-profile examples,
lifetime resource-accounting reconciliation, the complete MR-001–MR-096
mapping, inherited exact-head regressions, fault/model/mutant qualification,
matched measurements, and serial review closeout. The new prepare/proposal/review/
release deployment configurations still need their complete extracted-loader test.

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
