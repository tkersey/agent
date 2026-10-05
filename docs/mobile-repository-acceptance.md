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

The qualified Zig runner, physical allowance/storage accounting and artifact
pins, deployment dispatch integration for all repository operations, and
publication remain open. Per-object/import bounds in this slice do not establish
complete lifetime storage accounting or the final execution profile.

## Remaining acceptance

W2–W8 remain open: immutable managed Git snapshots/candidates and isolated Zig
checks; durable human answers and authenticated UI; real provider integration
and replay/budgets; exact protected publication and reconciliation; complete
application/package commands; faults/models/mutants, matched measurements and
the complete MR-001–MR-096 evidence mapping; serial review closeout.

No new application acceptance row is claimed complete from the scaffold.
Live-provider, actual-person, and two-machine qualifications are not run and
require their separately authorized inputs. No core changes, live model calls,
user-repository mutation, upstream publication, merge, or release occurred.
