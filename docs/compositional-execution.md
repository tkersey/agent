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


The current kernel is 460,854 bytes with SHA-256
`5788520b6a11c9f59b602ec6cbebdb976116d176a7e417afc2258c08ee25968c`.
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
