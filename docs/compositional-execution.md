# Agent successor status

Agent 4.0.0-dev.0 consumes Boundary 3 and World 6 through the authenticated
[dependency lock](../conformance/agent4/dependencies.lock.json). Authoring, approval,
model/tool contracts, inquiry and reusable compiled tools remain product code.
The successor is incomplete; implementation has resumed after the authorized
archive cleanup and all linked PRs remain drafts.

Current architecture, runtime and migration instructions are in
[architecture.md](architecture.md), [agent4-runtime.md](agent4-runtime.md),
[migration_from_3.md](migration_from_3.md), and [compiled-text-tool.md](compiled-text-tool.md).

Current runtime integration passes 182 build steps and 64 Zig tests, plus
JavaScript consumers including an extracted external consumer. The unchanged
authoring source retains its prior qualification. Dependency/setup tests pass 25/25
and offline setup authenticates the complete source/runtime tuple. Current integration,
functional economy, independent native/Node/Wasmtime execution, extracted-package
consumers, component reuse and real Chromium/Firefox compiled-tool transfers pass.
The economy run is functional-only and does not establish timing acceptance.

## Current results and unresolved failures

World removes its separate free-view index arrays by linking retired view records.
Generation checks still reject stale handles, and retirement/reuse allocate
nothing. Small controls lose two allocations and 272 peak working bytes; scalar
peak falls 4,662 → 4,390 bytes. Timing changes are small and mixed, including
a slight retained-loop slowdown; this is a storage reduction, not a general
speedup. The current kernel is 122 bytes smaller. Current host qualification uses
Node 26.9.0, recorded explicitly in the dependency lock.

World now reuses direct same-function tail frames without initialized ownership
custody. Simultaneous arguments, stale-local clearing and copy-on-write views
preserve retained continuations. The 256-iteration retained-loop control improves
about 14–16% natively and 6–8% through fresh WASM in paired windows. Native peak
falls 28,681 → 22,701 bytes and allocations 1,615 → 589. This is not an Agent
latency claim; the kernel grows 675 bytes.

World now reclaims unreachable storage before returning a yield or request. A
one-element survivor from a 1 MiB input retains 8,182 working bytes rather than
1,056,327, with the same 86-byte checkpoint. Live aliases, repeated export,
restoration and allocation-failure rollback have regression coverage. Checkpoint
export remains read-only. The actual WASM resident API retains 6,064 working-live
bytes across the same input sizes; reserved linear memory remains separately
chargeable. This correctness fix adds about 1–5% to several tested
suspension-heavy native controls; its performance cost remains open.

The current kernel is 460,732 bytes with SHA-256
`61ac21c775cdf08fe9425bf21de9966ed1cd169c156911401ff1e19913d4a44f`.
Inquiry, repeated-task and ReAct images remain 38,162 / 38,561 / 64,111 bytes.

Boundary now uses compact analysis-set storage on 64-bit native hosts while
preserving full-width members and immutable overlay roots. Across 13 fixed
scenarios and 128 paired native invocations, outcomes and transition/control/copy
counters match. Inquiry/ReAct native Session peaks fall from 2,049,764 /
3,534,020 to 1,952,780 / 3,084,054 bytes. Full invocation framing raises those
peaks to 2,050,143 / 3,226,040. These are requested working bytes, not RSS.

The two final native replay windows show no material latency regression; inquiry
changes remain below 1%, with modest ReAct gains. The all-target tagged layout
slowed sampled guest inquiry/ReAct by about 3% / 7%, so wasm32 retains its
previous storage. The later suspension-reclamation change adds 18 kernel bytes. No guest latency or memory gain is
claimed from the native specialization.

Native Session peaks remain above optimized BPC1's 1,853,961 / 2,061,220 bytes.
Inquiry and repeated-task's earlier guest improvement and ReAct's remaining guest
latency gap need final requalification. No live-model usefulness claim follows
from synthetic fixture execution.

## Component build costs

The existing `build-component-tools` and `component_runtime.mjs` witness was
measured in an isolated copy of Agent 08b6185, using Boundary 3b8a69f and the
normal authenticated source override. Zig 0.16.0 ReleaseSafe, Node 26.9.0,
Apple M2 Pro and macOS 27.2 were used. These new Node process measurements are
separate from the earlier Node 26.8.2 runtime qualification.

| Operation | Observed elapsed time |
|---|---:|
| Build both tools with empty local/global Zig caches | 22.49 s |
| Warm unchanged native build, including source authentication | 0.343 s |
| Native client-only source edit and rebuild | 14.95 s |
| Rebuild one state component with the existing emitter | 2.24 ms |
| Link immutable components without source checking/lowering | 2.57 ms |
| Compile/check one Agent client and link reused components | 2.82 ms |
| Compile the next client variant with existing tools | 2.81 ms |

Native build rows are single observations, not statistical speed claims or
OS-cold filesystem measurements. Process rows are medians of nine rotating
observations after three warmups and include process startup and file I/O.
The client source edit adds one to its authored result: fresh WASM execution of
the fixture produces 184/185 instead of 183/184. Standalone results remain 83/166,
and yield, cleanup and cancellation expectations pass before and after the edit.

The native build log shows the component emitter cached while only the client/link
executable recompiles. Its executable bytes and all four BMO1 objects remain
unchanged (147 / 375 / 612 / 195 bytes). Link-only modes observe zero source checks
and lowerings; each Agent-client mode observes exactly one of each. No unchanged
component is re-emitted during the client edit. Thus component reuse removes
repeated component compilation, but native client recompilation still costs
seconds. The millisecond linker does not account for or excuse that cost.

Reproduce with `zig build build-component-tools -Doptimize=ReleaseSafe`, isolated
local/global caches, then the emitted `agent4-component-objects` and
`agent4-component-link` modes exercised in `test/agent4/component_runtime.mjs`.
The controlled edit changes `Application.increment` by one in
`test/agent4/component_link.zig` without editing the emitter or components.
The matched source-only emitter comparison is now available in
[World’s current results](https://github.com/tkersey/world/blob/8fb2ff862be79621ebfee79f6b748458aca75deb/docs/compositional-execution.md#matched-native-build-costs): about 15.5 s
versus 16.5 s with fresh Zig caches, while the full compiler/evaluator probe stays
near 23 s on both versions. This does not establish all-application build gains.

Remaining work includes those primary-workload regressions, the rest of the accepted
workload matrix, serial reviews and the final
requirement audit. Live-model usefulness remains unmeasured. No paid inference or
real user-data operations were used to obtain the fixture results.

The obsolete Boundary 1 / World 3 acquisition and conformance runners and their
fixed release locks are removed. Current dependency/setup tests retain archive
authentication, extraction and source-custody checks. The old repository-repair
working-set fold, evidence guards and bounded model/action loop now use staged
successor implementations. Fresh-kernel execution covers actual listing, reads,
search, conditional writes and isolated fixture tests, including failed repairs
and denied approval. The superseded repository producers and distribution
wrappers are removed; see [actuality.md](actuality.md).
The unsupported Agent 1–3 DSL fixtures, toy consumers and per-application WASM
runners are retired. Current authoring admission, portable value, model, scoped
control and consumer tests retain their supported obligations. Authored budget
ordering and drop-oldest history have a current fresh-restoration regression.

The existing economy tools and substantive regression fixtures remain available.
Generated measurements, duplicated qualification receipts and historical experiment
dumps have been removed. Existing defect records retain historical provenance at
their recorded Git revisions. The adequacy obstruction and its minimal reproducer
remain under `adequacy/router-policy-v1/`.

Linked drafts: [Boundary #152](https://github.com/tkersey/boundary/pull/152),
[World #54](https://github.com/tkersey/world/pull/54),
[Agent #32](https://github.com/tkersey/agent/pull/32).
No merge, promotion or release is authorized. Current-tree deletion does not purge
historical Git objects.
