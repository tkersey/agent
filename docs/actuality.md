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

The predecessor fixtures under `actuality/` and their independent expectations
remain until the full application migration is complete. The model/action loop,
repository listing/read/search/test adapters, conditional filesystem delivery and
full end-to-end repair still require migration and qualification. The staged
completion predicate alone grants no write authority. The replacement adapter
must check the actual file digest again atomically with delivery; approval does
not prevent changes made outside the application.

See [runtime setup](agent4-runtime.md), [migration guidance](migration_from_3.md)
and [current status](compositional-execution.md). No live-model or real-repository
repair claim is made. The [historical adequacy obstruction](../adequacy/router-policy-v1/agent-adequacy-obstruction.md)
and its exact-release minimal reproducer remain unchanged.
