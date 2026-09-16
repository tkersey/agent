# Successor migration status

Agent remains on its 4.0.0-dev.0 development line. Its authoring path now returns
Boundary stable-activation construction and emits BPI3 directly. Protected Agent
admission still runs before Boundary admission. Diagnostics and native phase
observers remain supported; observers do not enter portable images or execution.

The normal Boundary dependency is pinned to
`3919d7ec5ab09973b49643c96477c218d0a77f08`. The downloaded archive's recomputed Git
tree matches GitHub's commit API. Source, archive, Zig-managed package and ordinary
extracted-package inventories are independently recorded in the existing lock.
The Boundary package version is still 2.0.2 during coordinated metadata cutover;
this branch is marked candidate integration, not released compatibility.

`check-agent4` passed all 137 build steps using the normal dependency pin,
including 104 Zig tests,
35 JavaScript model/value tests, negative authoring cases, emitted application
images and source-independent author installation. Both the source-override and
normal package installation paths retain exact authentication. Use
`zig build check-agent4` for the owning authoring aggregate.

Existing inquiry, broker, review, clarification and approval constructions compile
to stable activations. Negative tests retain the same rejected programs:
second-use failures now report `UnavailableSlot`, while forged authority and
illicit cloning retain `InvalidOwnership`.

A targeted development probe ran the existing owned/composition/followup inquiry
images through fresh ABI 3 kernels at every external boundary. It preserved the
existing independent traces: one experiment, two model requests, three cleanup
requests, and results 92, [(1,36),(3,56)], and [(1,54),(3,74)]. Image sizes were
927/2050/2202 bytes. This probe used 4 MiB input/output and 32 MiB working budgets;
it did not establish default-budget capacity, retained-package counts, the native
peer, or the normal Agent runtime loader. Those are separate required checks.

Still required: migrate the loader, runner, inquiry CLI, native peer, state
inspector and integration tests to current protocols; authenticate the actual
successor World runtime and normal dependency pair; compile/link the reusable
effectful text tool; perform the real browser/file/browser transfer; preserve all
approval/inquiry regressions; finish package extraction, performance comparisons,
legacy retirement and serial review closeout. The coordinated draft PRs do not
claim full completion or authorize merging or releases.
