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
a 5,333-byte peak checkpoint after warmup; three full 32-KiB documents fit the
declared prompt capacity without truncation.

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
fresh-kernel restores, and ten model/action cases, including premature finish,
denied approval, failed retesting, malformed provider arguments and budget
exhaustion. Reads and writes use actual temporary files; provider replies and
test results are synthetic. Repository listing/search and qualified test-process
adapters, complete packaged execution and end-to-end repair qualification remain
unfinished. The predecessor fixtures under `actuality/` and their independent
expectations remain until that migration is complete.

See [runtime setup](agent4-runtime.md), [migration guidance](migration_from_3.md)
and [current status](compositional-execution.md). No live-model or real-repository
repair claim is made. The [historical adequacy obstruction](../adequacy/router-policy-v1/agent-adequacy-obstruction.md)
and its exact-release minimal reproducer remain unchanged.
