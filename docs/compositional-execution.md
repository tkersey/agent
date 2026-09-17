# Successor migration status

Agent remains on its 4.0.0-dev.0 development line. Its authoring path now returns
Boundary stable-activation construction and emits BPI3 directly. Protected Agent
admission still runs before Boundary admission. Diagnostics and native phase
observers remain supported; observers do not enter portable images or execution.

The normal Boundary dependency is pinned to
`e28d5b32fbf92a7013cb18cb8c81128a9b53cd6b`. The downloaded archive's recomputed Git
tree matches GitHub's commit API. Source, archive, Zig-managed package and ordinary
extracted-package inventories are independently recorded in the existing lock.
The selected versions are Boundary 3.0.0-dev.0 and World 6.0.0-dev.0. World is
pinned to `8d55a4d0ddaebd355c9dc8a99087e5052e42e77e`; its complete runtime
inventory and default kernel are authenticated by the same lock. This is
candidate integration, not a published release.

`check-agent4` passed all 159 build steps using the normal dependency pin,
including 112 Zig tests,
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
an I/O failure cannot satisfy the test. `check-agent4-integration` now passes all 160 build steps, including 47 native
tests, 83 Node tests, the repair corpus, coalescing ablation/ReAct comparison,
repeated tasks and the actual extracted-archive command/application checks.

Agent defaults each arena allowance to the authenticated kernel's shared maximum
memory ceiling (256 MiB for this build). The kernel still enforces that global
ceiling. Explicit smaller caller limits remain supported and tested. This aligns
allowances with the prior growable runtime; it is not a claim of reduced memory
use. Native peak/copy measurements and all scripted-policy assertions remain.

Still required: complete matched-baseline runtime measurements and measured acceptance;
complete general component contracts and imported-borrow requirements;
preserve the complete approval/inquiry regressions;
finish consumer package extraction, performance comparisons, legacy retirement and
serial review closeout. The coordinated draft PRs do not claim full completion or
authorize merging or releases.

The [compiled text tool](compiled-text-tool.md) now executes from one BMO1 object
in standalone and Agent callers, including an actual model-facing local-tool
declaration. The Agent retains an unrelated owned future and checks human
occurrence identity around the tool. Real Chromium/Firefox Workers transfer the
actual checkpoint through a separate Node file-reading process and complete from
its successor. The same artifacts and leaf bindings execute from the extracted
use archive.

The tool object is 1,485 bytes; the standalone and Agent images are 1,483 and
4,224 bytes. These are fixture sizes, not full performance acceptance. The
general imported-borrow contracts remain open, alongside full performance acceptance, legacy retirement and serial
review closeout. The selected compiler/runtime pair now includes direct immediate
calls and independently admitted total branching tail clauses. Their native,
checkpoint/cancellation, Node, Wasmtime and browser checks pass, as does this
Agent integration; the local work-count reductions are not full Agent latency
or peak-memory acceptance.


The three-component reuse witness now also runs through Agent's normal compiled
local-tool path. The same 142/366/603-byte callable, private-state and
owned-suspension objects produce the two standalone Programs (839/875 bytes) and
two Agent callers (920 bytes each). The private counter yields 41 and 42; the
suspended package retains cleanup with payload 83. Standalone results are 83/166;
Agent preserves its input 100 and returns 183/184 for the two caller variants.
Cancellation after the explicit yield runs cleanup once.

`check-component-tools` emits each library object once, transports only the object
files and a link/client executable, and links all four clients from those same
bytes. Native phase observations record zero source checks/lowerings for standalone
links and exactly one for each Agent caller. Rebuilding the second Agent caller
neither invokes a component emitter nor changes any object digest. The small
unit-argument adapter is first-order data, independently admitted as BMO1; it
preserves the complete residual row. The ordinary full integration target includes
this check. Supply the authenticated `world-runtime` and `world-source` build
options, as for the other current runtime checks.

Agent now accepts explicitly bound nominal internal effects in a compiled tool's
interface, in addition to read/simulation I/O. Internal/external status and Agent
role must agree at the binding. All external declarations remain explicit and
opaque imports still reject in protected speculation. This extends composition;
it does not establish purity or general protected-component admission.


The consumer economy harness now uses current PKI3 invocation, asynchronous
request/reply codecs and PST3 graph inspection. `check-agent4-economy` runs its
three native probe tests and all seven functional lanes: direct/facade, shared
helpers, continuing conversation, multi-shot alternatives, clarification, inquiry
image identity, and the prescribed inquiry/ReAct comparison. The direct control
uses the same schema declaration order as Agent; byte equality remains required.
Only compiler phases actually emitted by stable construction are reported.

The v2 economy report records resident replay for the direct/facade, sharing,
conversation and alternatives traces. Each replay prepares once, uses the same
prescribed replies and checkpoint obligations as fresh invocation, compares exact
outcome bytes, and closes the Session with zero live working allocation. This
excludes environmental execution from replay. The 1,024-turn fixed-input witness
retains a 161-byte quiescent State after turn 8; all 1,016 subsequent quiescent
States match. This is a functional retention result, not performance acceptance.
Runtime timing, the optimized predecessor/BPC1 comparison, and the complete
specification workload matrix remain open. Default timing status stays explicitly
unmeasured.
