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
JavaScript consumers including an extracted external consumer. Unchanged
authoring code retains its preceding qualification. Dependency/setup tests pass 25/25
and offline setup authenticates the complete source/runtime tuple. Current integration,
functional economy, independent native/Node/Wasmtime execution, extracted-package
consumers, component reuse and real Chromium/Firefox compiled-tool transfers pass.
The economy run is functional-only and does not establish timing acceptance.

## Current results and unresolved failures

World now borrows frame-map entries during ordinary value instructions, avoiding
a frame copy and second lookup. Control and resumption-conversion paths retain
copies; rollback coverage includes cloned resumptions. Two native windows show
about 4% improvement on retained-loop256 and 1–3% on control64, with unchanged
working peaks. The retained-loop guest improves about 15–16%; guest control64 is
inconclusive. These are local control results, not an Agent latency claim. The
kernel grows 386 bytes.

Boundary now owns large outer block catalogs with exact allocations while nested
records keep their existing arena. Budget validation, canonical bytes and identity
are unchanged; partial decode failures and caller mutation have explicit coverage.
The normal dependency tuple selects the authenticated successor sources and kernel.

Across 13 fixed scenarios and 128 paired native invocations, canonical outcomes
and transition/control/copy counters match. Inquiry/ReAct Session peaks fall from
1,952,780 / 3,084,054 to 1,866,916 / 2,739,154 bytes. Two native replay and two
initial guest-invocation windows show small mixed timing changes; no latency gain
is claimed. The kernel is 462,033 bytes with SHA-256
`070d13c899f1e084fc6b5e25223b0b938818204617e07c1ad13af9a396ebf4ad`.
Inquiry/repeated/ReAct images remain 38,162 / 38,561 / 64,111 bytes.

Native Session peaks remain above BPC1's 1,853,961 / 2,061,220 bytes. The previous
small-control regressions and ReAct guest-latency gap remain open. No paid inference or live-model usefulness claim is made.

World's suspension reclamation and tail-frame reuse remain in place. The
one-element survivor retains 8,182 native / 6,064 WASM working-live bytes at its
recorded revision, with an 86-byte checkpoint; final memory accounting must use the
final candidate. Retired slot-view records replace the separate free-index arrays.
Historical control and value measurements remain attributed in World's current
results document; they are not silently promoted to final acceptance.

## Current inquiry/ReAct comparison

Agent 1f3297b / Boundary 42a09b9 / World d075169 (BPI2 and BPC1) were compared
with Agent 4de8fff / Boundary 810ba69 / World e995dc9 (BPI3). The current emitter
used Boundary 3dc3413, whose production source is identical to its 810ba69 pin.
The predecessor runtime matches its original full file inventory and kernel
hash. Both native emitters use Zig 0.16.0 ReleaseSafe; the driver is Node 26.9.0
on M2 Pro/macOS 27.2. Native replay uses a 256 MiB working buffer; both kernels
retain their pinned 256 MiB maximum memory profile.

The original assertions passed for 13 inquiry/ReAct scenarios and a four-turn
repeated inquiry on all three formats. Successful invocations match native/Node;
paired tasks and repeated inquiry additionally match Wasmtime.
Task/result schemas are byte-identical. Model work, experiments, approval/write
counts, observed results, recipients, cache reuse, explicit retirements and cleanup
match. Repeated inquiry keeps 28 model calls, four experiments, eight cleanups,
eight templates and 16 activations. Its completed-turn boundary stays at two nodes
and one blob: 170 bytes in BPI2/BPC1 versus 174 in BPI3. Old-question rejection
checks remain enabled. Changed internal transition counts are not normalized into
a claim of identical machine execution.

Two windows rotate all 180 successful canonical inputs per format (128 comparison
inputs plus 52 repeated-task inputs). Each entry below sums per-input medians of
nine fresh invocations after three warmups. Native timing includes the complete
byte invocation; input-file loading is outside the clock. Guest timing uses each
public fresh API, including kernel setup and encoding. Reconstructed guest inputs
must re-encode byte-for-byte to their captured input, and every replay output must
match its verified capture. This is runtime replay, not whole-scenario elapsed time
or a request-tail statistic. Confirmation values follow.

| Scenario | Native BPI2 / BPC1 / BPI3 ms | Guest BPI2 / BPC1 / BPI3 ms |
|---|---:|---:|
| paired-reset-inquiry | 536.14 / 534.57 / 193.22 | 670.19 / 669.26 / 375.86 |
| paired-reset-react | 84.59 / 84.78 / 87.49 | 177.14 / 178.13 / 204.88 |
| repeated | 1658.43 / 1652.34 / 552.92 | 1888.28 / 1884.83 / 1004.87 |

Across the four paired tasks, inquiry improves about 2.7–2.8× natively and 1.7–1.8×
in the guest; repeated inquiry improves about 3× / 1.9×. ReAct remains about 3–9%
slower natively and 14–27% slower in the guest. The five binding/inconclusive cases
remain about 13–27% / 30–39% slower. These unfavorable observations are not waived.

Complete byte-invocation peaks are higher in BPI3: reset-inquiry is
1,853,961 → 1,964,279 bytes, reset-ReAct 2,061,220 → 2,881,140, and repeated inquiry
1,819,273 → 1,973,835. These include invocation framing and must not be confused
with the preceding Session-only diagnostic counters. Main image sizes in
BPI2 / BPC1 / BPI3 are inquiry 44,338 / 40,167 / 38,162; repeated 44,684 / 40,486 /
38,561; ReAct 49,249 / 43,394 / 64,111 bytes. ReAct size, time and memory remain
concrete optimization targets; no live-model quality or paid-inference claim is made.

The small `tools/agent4/capture-inquiry.mjs` helper preserves the fixture assertions
and accepts explicit source/runtime/native/inspector inputs. Use World's existing
`build_replay_bench.zig` for native timing and file-backed stdin
(`replay-bench OUTCOME_SHA256 < INPUT`). An interrupted piped-input window stalled
in stdin reading before runtime execution; it was discarded and both final native
windows used files. Raw captures and temporary predecessor installations are removed.

## Current clarification comparison

The unchanged four-case document-clarification policy was compared using Agent
1f3297b / Boundary 42a09b9 / World d075169 (normal BPI2 and compact BPC1) against
Agent ddf4c6a / Boundary 810ba69 / World e995dc9. The predecessor runtime was
reconstructed from its pinned files and release kernel, then verified against its
original complete runtime inventory and kernel digest. Both sides ran on Node
26.9.0, Zig 0.16.0, M2 Pro/macOS 27.2, with 256 MiB per-arena test allowances.

Two windows rotate three process observations per format. A fresh-time sample
sums the 21 or 23 fresh-kernel invocations in one scenario, including their kernel
setup. Whole-scenario time includes fixture handling and file I/O. Neither is an
individual-request tail statistic. Confirmation medians are below.

| Case | BPI2 fresh ms | BPC1 fresh ms | BPI3 fresh ms | BPC1 → BPI3 scenario ms |
|---|---:|---:|---:|---:|
| divergent-active | 207.10 | 210.21 | 140.12 | 232.62 → 164.65 |
| common | 165.62 | 165.60 | 102.44 | 179.74 → 118.94 |
| clarify-first-common | 108.56 | 108.87 | 73.96 | 121.35 → 87.76 |
| clarify-first-divergent | 109.49 | 112.73 | 73.74 | 124.12 → 88.48 |

Both windows support 32–38% lower total fresh-invocation time than BPC1 for these
cases. Model calls, request/response byte counts, clarification and approval
exchanges, replacements, completed assessments, memory, resulting file hashes
and complete effect/cleanup traces match. This is a real authored Agent consumer
with prescribed model/person inputs; no paid inference or live-model quality
claim is involved. The main image is 14,355 / 13,256 / 11,939 bytes in
BPI2 / BPC1 / BPI3. Peak checkpoint sizes increase from 2,600 / 1,985 / 1,891 /
2,044 to 2,639 / 2,056 / 1,928 / 2,081 bytes in table order. This run does not
measure native working peaks or replace the remaining inquiry/ReAct comparison.

Reproduce with the existing `tools/agent4/benchmark-clarification.mjs`, explicit
Agent source/runtime/image paths and a fresh output directory for every process.

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
