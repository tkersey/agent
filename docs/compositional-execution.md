# Agent successor status

Agent 4.0.0-dev.0 consumes Boundary 3 and World 6 through the authenticated
[dependency lock](../conformance/agent4/dependencies.lock.json). Authoring, approval,
model/tool contracts, inquiry and reusable compiled tools remain product code.
The successor remains incomplete; all linked PRs remain drafts.

Current architecture, runtime and migration instructions are in
[architecture.md](architecture.md), [agent4-runtime.md](agent4-runtime.md),
[migration_from_3.md](migration_from_3.md), and [compiled-text-tool.md](compiled-text-tool.md).

The combined authoring/runtime check passes 229 build steps and 176 Zig tests,
plus JavaScript consumers including an extracted external source package.
Dependency/setup checks and offline authentication pass for the complete tuple.
Current integration,
functional economy, independent native/Node/Wasmtime execution, extracted-package
consumers, component reuse and real Chromium/Firefox compiled-tool transfers pass.
The economy run is functional-only and does not establish timing acceptance.

## Current matched inquiry/ReAct results

The complete BPC1 comparison measured Agent 95001fb / Boundary 6c59436 / World
9922062. Its
normal authenticated tuple is compared with the fixed Agent 1f3297b / Boundary
42a09b9 / World d075169 anchors, separately using normal BPI2 and compact BPC1.
The predecessor runtime matches its complete pinned inventory and kernel hash.
BPC1 images round-trip to byte-identical BPI2 images; all 180 predecessor outcomes
are also byte-identical across those two encodings. The inquiry, repeated-inquiry
and ReAct application sources are unchanged between Agent revisions.

All original assertions pass for 13 scenarios and four repeated inquiry turns.
Every non-physical scenario-summary field agrees across formats, including model,
experiment, approval/write, observation, recipient, reuse and cleanup behavior.
Task/result schemas are byte-identical. Repeated inquiry retains 28 model calls,
four experiments, eight cleanups, eight templates and 16 activations. Completed
turns retain two nodes and one blob, with no live resources, cells or obligations;
the checkpoint is 170 bytes in BPI2/BPC1 and 174 in BPI3. Machine transition counts
change and are reported as representation-specific work, not normalized away.

Zig 0.16.0 ReleaseSafe, Node 26.9.0 and M2 Pro/macOS 27.2 were used. Both kernels
retain their pinned 256 MiB maximum memory profile; native replay uses a fixed
256 MiB working buffer. Two windows rotate formats with no overlapping builds or
benchmarks. Each window replays 180 successful canonical inputs per format:
128 from the 13 scenarios and 52 from repeated inquiry. Every input has three
warmups and nine samples, and every output must match its verified capture.

Native clocks include full byte admission, execution and outcome production.
Guest clocks include the public fresh API's kernel admission/setup, encoding,
execution and decoding; captured input reconstruction must re-encode identically.
File loading is outside the clocks. Guest formats run in separate Node processes.
The table uses the second confirmation window and sums per-input medians. These
are runtime replay totals, not whole-scenario time or request-tail statistics.

| Scenario | Native BPI2 / BPC1 / BPI3 ms | Guest BPI2 / BPC1 / BPI3 ms | Native peak BPC1 → BPI3 bytes |
| --- | ---: | ---: | ---: |
| reset inquiry | 541.13 / 537.38 / 174.79 | 657.59 / 656.37 / 331.96 | 1,853,961 → 1,724,731 |
| reset react | 84.86 / 85.35 / 59.80 | 232.26 / 170.55 / 134.58 | 2,061,220 → 1,993,377 |
| rebinding inquiry | 539.52 / 540.68 / 175.01 | 658.75 / 654.56 / 329.66 | 1,850,451 → 1,722,378 |
| rebinding react | 84.91 / 85.41 / 59.66 | 171.16 / 170.86 / 133.96 | 2,058,801 → 1,991,823 |
| already correct inquiry | 327.58 / 326.81 / 109.17 | 395.69 / 393.02 / 202.43 | 1,808,359 → 1,694,693 |
| already correct react | 31.60 / 31.84 / 23.31 | 62.14 / 61.89 / 52.19 | 1,960,760 → 1,934,045 |
| inadequate inquiry | 285.99 / 284.45 / 93.30 | 340.82 / 339.32 / 172.90 | 1,807,413 → 1,680,009 |
| inadequate react | 21.43 / 21.58 / 15.82 | 39.78 / 39.90 / 34.79 | 1,891,577 → 1,887,839 |
| react rejects subject | 14.28 / 14.31 / 11.34 | 26.84 / 26.78 / 24.91 | 1,885,905 → 1,888,028 |
| react rejects key | 14.30 / 14.59 / 11.49 | 27.01 / 27.12 / 25.03 | 1,885,803 → 1,887,861 |
| react rejects occurrence | 14.92 / 14.93 / 11.65 | 27.95 / 28.00 / 25.36 | 1,885,983 → 1,888,095 |
| react rejects acceptance | 13.19 / 13.32 / 11.26 | 26.02 / 25.86 / 25.04 | 1,923,980 → 1,911,673 |
| react inconclusive candidate | 18.94 / 19.13 / 15.12 | 36.46 / 36.86 / 33.52 | 1,916,537 → 1,906,982 |
| repeated | 1641.65 / 1636.37 / 484.59 | 1853.93 / 1845.24 / 877.29 | 1,819,273 → 1,682,135 |

The BPI2 reset-ReAct guest total varies from 170.72 to 232.26 ms between windows;
BPC1 is 171.47 / 170.55 ms and BPI3 134.48 / 134.58 ms. The improvement claims
below use the compact BPC1 comparator, not that slower BPI2 observation.

Both windows show paired inquiry about 3× faster natively and 2× in the guest;
ReAct is 26–30% faster natively and 13–22% in the guest. Repeated inquiry improves
about 3.4× / 2.1×. These measurements supersede the earlier ReAct and rejection-case
latency regressions. They do not establish universal non-regression.

Three rejection cases retain 2,058–2,123 bytes more peak memory than BPC1. The other
scenario peaks are lower. Reset inquiry allocates 102,202,499 → 83,315,245 bytes;
reset ReAct 62,555,152 → 61,326,169; repeated inquiry 212,133,017 → 177,311,733.
These are complete invocation allocations, distinct from Session-only counters.
Reset inquiry blob copies fall from 6,308,439 to 733,515 bytes; reset ReAct from
5,709,609 to 591,854. Maximum scenario checkpoints grow by 18–79 bytes: reset
inquiry is 48,999 → 49,025 bytes and reset ReAct 67,681 → 67,699 bytes.
Normal BPI2 / BPC1 / BPI3 image sizes are inquiry 44,338 / 40,167 / 36,756,
repeated 44,684 / 40,486 / 37,137, and ReAct 49,249 / 43,394 / 48,226 bytes.
ReAct remains larger than BPC1; the specification's separate installation-image
condition is satisfied, not replaced by a universal image-size claim.

The normal tuple now selects Boundary 6c59436 / World 58f2533. Its kernel is
462,400 bytes, SHA-256
3beae29e2b4f74de5248c636319c3f31fbdd28fab632314b9b1dd7c83c066c49.
Boundary's dependency package is 1,390,465 bytes (281,831 compressed); World runtime
contents are 519,100 bytes. No paid inference or live-model quality claim is made.
The adequacy obstruction and its minimal reproducer remain intact.

Reproduce captures with `tools/agent4/capture-inquiry.mjs` and explicit frozen
source/runtime/native/inspector paths. World's `build_replay_bench.zig` supplies
native timing; use file-backed stdin (`replay-bench OUTCOME_SHA256 < INPUT`).
The temporary build graphs only install existing inquiry/native/inspection tools;
all other tracked Agent bytes match their declared revisions. Raw captures,
profiles and temporary predecessor installations are not maintained.

## Control-node reuse confirmation

World 58f2533 reuses consumed continuation nodes and exclusively active controls.
Captured callers and cloned multi-shot frames retain their custody; no authored
work or cleanup is omitted. [World's results](https://github.com/tkersey/world/blob/58f2533a276749f85c9f439d1e1d8fa2a822b1a1/docs/compositional-execution.md#control-node-reuse-confirmation)
record lower installation peaks and the remaining BPC1 gap.

The normal tuple passes 229 build steps, 176 Zig tests, all six integration groups,
extracted consumers and compiled-tool browser transfer. Fresh captures retain all
original assertions. Two replay windows compare World 9922062 and 58f2533 on the
same 180 successful inputs: every native and guest output is byte-identical, with
unchanged complete-invocation peaks. The clocks and sample units match those above.
Reset inquiry allocation falls 83,315,245 → 82,915,942 bytes; reset ReAct
61,326,169 → 61,117,684; repeated inquiry 177,311,733 → 176,463,054.

Native timings are nearly unchanged to slightly lower. Small guest rejection-case
totals move in opposite directions between windows, from about 1% faster to 3–8%
slower; those observations remain indeterminate. No additional Agent latency gain
is claimed for node reuse. The full BPC1 table above remains explicitly bound to
its measured tuple; final cumulative acceptance is still open.

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
[World’s current results](https://github.com/tkersey/world/blob/9922062038109b918723f255709fefa8ea81c631/docs/compositional-execution.md#remaining-acceptance-work): about 15.5 s
versus 16.5 s with fresh Zig caches, while the full compiler/evaluator probe stays
near 23 s on both versions. This does not establish all-application build gains.

Remaining work includes the reported peak-memory costs, the separate World
small-case/control gaps, final clarification/build confirmation, serial reviews
and the final requirement audit. Live-model usefulness remains unmeasured. No paid inference or
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
