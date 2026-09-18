# Agent successor status

Agent 4.0.0-dev.0 consumes Boundary 3 and World 6 through the authenticated
[dependency lock](../conformance/agent4/dependencies.lock.json). Authoring, approval,
model/tool contracts, inquiry and reusable compiled tools remain product code.
The successor is incomplete; implementation has resumed after the authorized
archive cleanup and all linked PRs remain drafts.

Current architecture, runtime and migration instructions are in
[architecture.md](architecture.md), [agent4-runtime.md](agent4-runtime.md),
[migration_from_3.md](migration_from_3.md), and [compiled-text-tool.md](compiled-text-tool.md).

The pinned authoring and native checks pass 193 steps, 176 Zig tests and 35 JavaScript
tests, including an extracted external consumer. Dependency/setup tests pass 25/25
and offline setup authenticates the complete source/runtime tuple. Current integration,
functional economy, independent native/Node/Wasmtime execution, extracted-package
consumers, component reuse and real Chromium/Firefox compiled-tool transfers pass.
The economy run is functional-only and does not establish timing acceptance.

## Current results and unresolved failures

The current kernel is 460,161 bytes with SHA-256
`dbb929681cb7675affaccefbfee9fd8fc5ee579e0d76276eedab882fd35642a8`.
Inquiry, repeated-task and ReAct images remain 38,162 / 38,561 / 64,111 bytes.

World batches frame writes and pruning against admitted liveness bounds. Slot
pages remain the sole initialization authority; retained views and failed
transitions preserve their existing contracts. Two isolated native windows
confirm about 8% / 10% / 11% gains on 64/128/256 handlers against the preceding
successor. Small cases remain indeterminate. These are World controls, not an
Agent latency claim; optimized BPC1 control64 remains faster and uses less memory.

Current integration confirms inquiry/ReAct native Session peaks of 2,049,764 /
3,534,020 bytes, versus optimized BPC1's 1,853,961 / 2,061,220. Requested working
bytes exclude input-file and host/output buffers and are not RSS. The final
matched Agent timing comparison is still required. Inquiry and
repeated-task's earlier guest improvement and ReAct's remaining guest latency
gap need final requalification. No live-model usefulness claim follows from
synthetic fixture execution.

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
