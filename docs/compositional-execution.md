# Successor migration status

Agent remains on its 4.0.0-dev.0 development line. Its authoring path now returns
Boundary stable-activation construction and emits BPI3 directly. Protected Agent
admission still runs before Boundary admission. Diagnostics and native phase
observers remain supported; observers do not enter portable images or execution.

The normal Boundary dependency is pinned to
`03da23f6066e8eb60ee646f34dc9e828220dfc28`. The downloaded archive's recomputed Git
tree matches GitHub's commit API. Source, archive, Zig-managed package and ordinary
extracted-package inventories are independently recorded in the existing lock.
The selected versions are Boundary 3.0.0-dev.0 and World 6.0.0-dev.0. World is
pinned to `58eac5241d30c88a9f07ddd33a772ac43b399e7c`; its complete runtime
inventory and default kernel are authenticated by the same lock. This is
candidate integration, not a published release.

`check-agent4` passed all 139 build steps using the normal dependency pin,
including 104 Zig tests,
35 JavaScript model/value tests, negative authoring cases, emitted application
images and source-independent author installation. Both the source-override and
normal package installation paths retain exact authentication. Use
`zig build check-agent4` for the owning authoring aggregate.

Existing inquiry, broker, review, clarification and approval constructions compile
to stable activations. Negative tests retain the same rejected programs:
second-use failures now report `UnavailableSlot`, while forged authority and
illicit cloning retain `InvalidOwnership`.

The normal ABI 3 bridge and runner support explicit caller memory budgets, including independent loading,
wrong State/image/reply rejection, cancellation during cleanup, and explicit-yield
continuation. The native peer and PST3 inspector use the current public data/runtime
APIs. Native model custody, approval, clarification, observation and callable
checks now pass all 47 tests. World handler-capture/branch counters are wired to
actual successful operations and checked against the authored branching work. `test/agent4/inquiry_runtime.mjs` passes all three owned/composition/followup
traces through native, Node and separately invoked Wasmtime, using the kernel's unchanged shared memory ceiling and checking retained-package counts at every request.
The traces preserve one experiment, two model requests, three cleanup requests,
and results 92, [(1,36),(3,56)], [(1,54),(3,74)].

The inquiry CLI and application scripts now use current invocation controls,
async request/reply codecs and tagged cancellation reasons. The stale-result CLI
test checks that real ERS3/PKO3 files exist and that the guest reports InvalidResult;
an I/O failure cannot satisfy the test. `check-agent4-integration` now passes all 136 build steps, including 47 native
tests, 83 Node tests, the repair corpus, coalescing ablation/ReAct comparison,
repeated tasks and the actual extracted-archive command/application checks.

Agent defaults each arena allowance to the authenticated kernel's shared maximum
memory ceiling (256 MiB for this build). The kernel still enforces that global
ceiling. Explicit smaller caller limits remain supported and tested. This aligns
allowances with the prior growable runtime; it is not a claim of reduced memory
use. Native peak/copy measurements and all scripted-policy assertions remain.

Still required: finish benchmark-harness migration and measured acceptance;
compile/link the reusable effectful text tool; perform the real
browser/file/browser transfer; preserve the complete approval/inquiry regressions;
finish consumer package extraction, performance comparisons, legacy retirement and
serial review closeout. The coordinated draft PRs do not claim full completion or
authorize merging or releases.
