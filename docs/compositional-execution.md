# Agent successor status

Agent 4.0.0-dev.0 consumes Boundary 3 and World 6 through the authenticated
[dependency lock](../conformance/agent4/dependencies.lock.json). Authoring, approval,
model/tool contracts, inquiry and reusable compiled tools remain product code.
The successor is incomplete; implementation has resumed after the authorized
archive cleanup and all linked PRs remain drafts.

Current architecture, runtime and migration instructions are in
[architecture.md](architecture.md), [agent4-runtime.md](agent4-runtime.md),
[migration_from_3.md](migration_from_3.md), and [compiled-text-tool.md](compiled-text-tool.md).

The normal pinned authoring check passes 159 steps, 112 Zig tests and 35 JavaScript
tests, including an extracted external consumer. Dependency/setup tests pass 24/24
and offline setup authenticates the complete source/runtime tuple. Current integration,
functional economy, independent native/Node/Wasmtime execution, extracted-package
consumers, component reuse and real Chromium/Firefox compiled-tool transfers pass.
The economy run is functional-only and does not establish timing acceptance.

## Current results and unresolved failures

The current kernel is 459,815 bytes with SHA-256
`c2dc18506ae8d13b2199a9eb5e3153af392ec25640a60384b5007c4e20ed6005`.
Inquiry, repeated-task and ReAct images remain 38,162 / 38,561 / 64,111 bytes.

Boundary now frees temporary flow-analysis storage and uses bounded FIFO worklists.
Across 13 unchanged scenarios, paired inquiry native Session peak falls from
2,847,222 to 2,367,460 bytes; ReAct falls from 4,239,618 to 3,656,504. BPC1 remains
lower at 1,853,961 and 2,061,220 respectively, so both gaps remain open. These
requested working-byte counters exclude input-file and host/output buffers and
are not RSS. Native/Node outcomes, work counts, authority and cleanup checks agree.

Five paired guest windows overlap substantially; no guest-speed gain is claimed.
Inquiry/repeated-task's preceding BPC1 improvement and ReAct's remaining guest
latency gap need final requalification. Compact predecessor storage on 64-bit
hosts reduces control128/256 peaks to
353,313 / 715,953 bytes, removing the preceding successor's peak increase. The
32-bit builder is unchanged: applying compact construction there regressed guest
timing. Canonical set nodes now occupy 24 rather than 32 bytes on both targets;
their exact cardinality follows from the payload and bounds without a cached count.
Type validation also reuses its existing exportability table for borrow checking;
this removes one repeated derivation without changing measured working peaks.
The current kernel passes Wasmtime and real Chromium/Firefox qualification,
including the compiled tool's actual browser/server/browser continuation transfer.

Remaining work includes those primary-workload regressions, the rest of the accepted
workload matrix, historical consumer retirement, serial reviews and the final
requirement audit. Live-model usefulness remains unmeasured. No paid inference or
real user-data operations were used to obtain the fixture results.

The obsolete Boundary 1 / World 3 acquisition and conformance runners and their
fixed release locks are removed. Current dependency/setup tests retain archive
authentication, extraction and source-custody checks. The old repository-repair
working-set fold and evidence guards now have staged successor implementations
and five native regressions, including 32 portable observations. The full
repository-repair application and adapters still need migration; see [actuality.md](actuality.md).

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
