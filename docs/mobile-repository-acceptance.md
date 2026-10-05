# Mobile Repository Agent — implementation progress

The [accepted specification](mobile-repository-agent-spec.md) governs W0–W8 and
MR-001–MR-096. This is an incomplete implementation, not a reference-qualified
application. The draft PR exposes the first substantive authored slice.

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
`mobility.ensure`, and an owned `agent.inquiry` investigator. Its current scope
is snapshot-bound source inspection followed by a human question. The actual
parked investigator, retained goal/evidence, outer task occurrence, and captured
cleanup cross the return move. The program threads the returned move allowance;
the human placement template cannot replenish it.

The 4,940-byte image passes ten deterministic fresh-kernel scenarios through
`check-mobile-repository`: a round trip preserving each of the three mode
values, local `Here`, exhausted return budget, cancellation with one cleanup,
and rejection of zero generation, empty goal, and excessive placement attempts
before any effects, plus the same round trip through real managed Git snapshot
and read leaves. The mode tests establish preservation only; propose and
publish behavior are not implemented yet. Human answers remain synthetic.
These checks do not qualify custody, browser interaction, or approval for the
new application.

Reproduce this slice using the existing authenticated setup:

```sh
node tools/agent4/setup.mjs --work-dir "$PWD/.agent4-mobile"
zig build check-mobile-repository -Doptimize=safe \
  -Dworld-source="$PWD/.agent4-mobile/inputs/world" \
  -Dworld-runtime="$PWD/.agent4-mobile/out/world-runtime/runtime"
```

## Immutable repository preparation (W2, partial)

The existing repository owner now offers managed snapshot/read bindings. Its
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
transfers. The complete mobile application is not yet installed in that archive.

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
lane passed 25 tests. These establish the provider/owner seams, not the complete
Mobile Repository investigation loop or live-model usefulness.

Durable attempt, request-byte and output-token allowances are charged with the
dispatch transaction, bound to W and the signed run registration, and preserved
across restart. Background model I/O releases the run lock; unknown calls are
not repeated, and cancellation fences late replies without refunding attempts.
Complete authored model/investigation/revision composition and logical work
allowances are still open.

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
They do not establish the full investigation application or actual-person lane.
Complete application integration, installed helper acquisition, and the remaining
fault/acceptance matrix are still open.

## Remaining acceptance

W2–W8 remain open: complete repository/check deployment integration;
complete application integration of durable answers and authenticated UI; real provider integration
and replay/budgets; exact protected publication and reconciliation; complete
application/package commands; faults/models/mutants, matched measurements and
the complete MR-001–MR-096 evidence mapping; serial review closeout.

No new application acceptance row is claimed complete from the scaffold.
Live-provider, actual-person, and two-machine qualifications are not run and
require their separately authorized inputs. No core changes, live model calls,
user-repository mutation, upstream publication, merge, or release occurred.
