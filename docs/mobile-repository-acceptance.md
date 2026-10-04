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
The broader inherited `check-agent4-integration` aggregate remains in progress
at this first slice; no aggregate pass is claimed here.

## Authored continuation (W1)

`test/consumers/mobile_repository` uses public Agent/Boundary APIs, existing
`mobility.ensure`, and an owned `agent.inquiry` investigator. Its current scope
is snapshot-bound source inspection followed by a human question. The actual
parked investigator, retained goal/evidence, outer task occurrence, and captured
cleanup cross the return move. The program threads the returned move allowance;
the human placement template cannot replenish it.

The 4,940-byte image passes nine deterministic fresh-kernel scenarios through
`check-mobile-repository`: a round trip preserving each of the three mode
values, local `Here`, exhausted return budget, cancellation with one cleanup,
and rejection of zero generation, empty goal, and excessive placement attempts
before any effects. The mode tests establish preservation only; propose and
publish behavior are not implemented yet. Leaf observations and human answers
in this first test are synthetic. It does not qualify repository I/O, custody,
browser interaction, or approval for the new application.

Reproduce this slice using the existing authenticated setup:

```sh
node tools/agent4/setup.mjs --work-dir "$PWD/.agent4-mobile"
zig build check-mobile-repository -Doptimize=safe \
  -Dworld-source="$PWD/.agent4-mobile/inputs/world" \
  -Dworld-runtime="$PWD/.agent4-mobile/out/world-runtime/runtime"
```

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
