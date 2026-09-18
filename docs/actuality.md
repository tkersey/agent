# Repository-repair application migration

The working-set fold, decision-view projection and four-flag completion predicate
now use current staged authoring in
[working_set.zig](../test/consumers/repository/working_set.zig), with portable
[contracts](../test/consumers/repository/types.zig). Host adapters do not update
this memory. The policy preserves role-code normalization, stale source/search
invalidation, denial behavior and revocation of passing evidence after failure.

Run the five native policy regressions, including 32 actual portable observations
with bounded checkpoint retention and authored budget termination:

```sh
zig build check-repository-working-set -Doptimize=ReleaseSafe \
  -Dworld-runtime="$PWD/.agent4/out/world-runtime"
```

The [replacement gate](../test/consumers/repository/replacement.zig) requires a
failing baseline and the latest source path/digest before requesting fresh read
evidence. Its one-shot proof binds exact-proposal approval to the authenticated
principal. Stale replies, substituted evidence and amendments cannot commit;
changed files return conflicts and uncertain delivery fails explicitly. Nine
native regressions exercise these outcomes across fresh checkpoint restores:

```sh
zig build check-repository-replacement -Doptimize=ReleaseSafe \
  -Dworld-runtime="$PWD/.agent4/out/world-runtime"
```

The [model/action loop](../test/consumers/repository/application.zig) now authors
the bounded sequence of inspection, testing, replacement and final decisions.
It renders its current working set into the model request, admits one declared
action, folds observations and enforces the completion predicate. Provider
replies remain candidate data. The flat model codec preserves all four changed
path slots. Thirty-two repeated decisions terminate at the authored budget with
a 5,371-byte peak checkpoint after warmup; three full 32-KiB documents fit the
declared prompt capacity without truncation.

Completion binds the final changed-file set to at most four distinct successful
writes, and the final source digest to the latest applied replacement. Order is
irrelevant; omitted, invented or duplicate claims fail. Repeat writes reuse a
slot. A fifth distinct target fails before reading evidence, asking approval or
writing. The program retains these facts and exposes them in its decision view.

The [filesystem adapter](../runtime/repository_delivery.mjs) reuses the document
owner's isolated-root and cooperative-writer contract. It rechecks the actual
digest during conditional delivery and preserves conflict and uncertain results.
It carries no approval or working-set state. Approval does not prevent changes
made outside that cooperative filesystem boundary.

```sh
zig build check-repository-delivery -Doptimize=ReleaseSafe \
  -Dworld-runtime="$PWD/.agent4/out/world-runtime"
```

This check covers seven filesystem cases, seven replacement cases across 18
fresh-kernel restores, and seventeen model/action cases, including premature finish,
denied approval, failed retesting, malformed provider arguments and budget
exhaustion. That policy check uses synthetic provider replies and test results.

The [repository bindings](../runtime/repository.mjs) now perform actual listing,
role-bound reads, literal search and isolated fixture tests. The caller supplies
the root, readable `paths` and a separate `writablePaths` subset (at most four).
Reading test files grants no permission to replace them. Listing returns at most 32 entries;
search returns at most eight 256-byte excerpts with explicit truncation. Missing
files and unavailable executors do not become failing-baseline observations.

```sh
zig build check-repository-application -Doptimize=ReleaseSafe \
  -Dworld-runtime="$PWD/.agent4/out/world-runtime"
```

The application check covers valid repair, failed repair, attempted early exit,
attempted external write and denied approval: ten real isolated test processes
and 99 fresh-kernel transfers. Only provider candidates are synthetic. The range
fixture executor preserves Bun equality semantics and requires a completed test
report. It runs with macOS Seatbelt or Linux Bubblewrap, with no unsandboxed
fallback; this qualification used macOS and Bun 1.4.2, not Linux. Execution is
bounded by ten seconds and 1 MiB of captured output; returned stdout/stderr each
have a 4-KiB limit and truncation flag.

The use archive includes the image, schemas, leaf adapters and actual fixture.
Its default task has zero decision allowance; a caller supplies task parameters
and explicit environmental bindings to run it. The obsolete per-application WASM
emitters, old working-set compiler and World-host/capabilities wrappers are
removed. Executor confinement, malformed-report and native-equality regressions
now run directly against the current runtime. The separate `system_closure_v1/`
distribution wrappers still await retirement.

See [runtime setup](agent4-runtime.md), [migration guidance](migration_from_3.md)
and [current status](compositional-execution.md). No live-model usefulness or repair
of user repositories is claimed. The [historical adequacy obstruction](../adequacy/router-policy-v1/agent-adequacy-obstruction.md)
and its exact-release minimal reproducer remain unchanged.
