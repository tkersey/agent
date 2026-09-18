# Agent successor status

Agent 4.0.0-dev.0 consumes Boundary 3 and World 6 through the authenticated
[dependency lock](../conformance/agent4/dependencies.lock.json). Authoring, approval,
model/tool contracts, inquiry and reusable compiled tools remain product code.
The successor is incomplete; implementation has resumed after the authorized
archive cleanup and all linked PRs remain drafts.

Current architecture, runtime and migration instructions are in
[architecture.md](architecture.md), [agent4-runtime.md](agent4-runtime.md),
[migration_from_3.md](migration_from_3.md), and [compiled-text-tool.md](compiled-text-tool.md).

The last implementation qualification passed 159 authoring steps (112 Zig and
35 JavaScript tests) and 171 combined integration/economy/component/browser steps
(53 Zig tests, 83 Node tests and 49 inquiry scenarios), including extracted consumers
and real browser transfers. Cleanup does not change these expectations or repeat
that full matrix. Package/source authentication is refreshed for the cleaned trees.

## Current results and unresolved failures

The final kernel remains 460,851 bytes with SHA-256
`b0cee0db452b46d9cf8f3f3067c52693383d566b9670a38da778793e29de66ee`.
Inquiry, repeated-task and ReAct images remain 38,162 / 38,561 / 64,111 bytes.

Measured paired inquiry native Session peak is 2,847,222 bytes, versus BPC1's
1,853,961; ReAct is 4,239,618 versus 2,061,220. These requested working-byte counters
exclude input-file and host/output buffers and are not RSS. Both failures remain
open. Inquiry and repeated-task guest runs improved over BPC1, while ReAct guest
latency still regresses. An intermediate index guard worsened guest timings; the
retained implementation restores the entire preceding guest runtime byte inventory.
No final guest speedup is claimed from the native memory improvement.

Remaining work includes those primary-workload regressions, the rest of the accepted
workload matrix, historical consumer retirement, serial reviews and the final
requirement audit. Live-model usefulness remains unmeasured. No paid inference or
real user-data operations were used to obtain the fixture results.

The obsolete Boundary 1 / World 3 acquisition and conformance runners and their
fixed release locks are removed. Current dependency/setup tests retain archive
authentication, extraction and source-custody checks. The old repository-repair
application fixtures still need migration; removing their retired runners does
not establish successor coverage for that application.

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
