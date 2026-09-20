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

Unsupported forwarding constructors and handler fields are retired from the data
and authoring APIs. Agent's admission walker drops only the traversal of that
unconstructible field; return-function and clause protections remain. The current
World switch is exhaustive. The scoped-reader witness retains forwarding through
older-capability dispatch. All 42 example images are byte-identical; source JSON
changes only by omission of the former null fields. Wire tag 14 rejects, and the
retired handler byte remains mandatory zero. No performance gain is claimed for
this API cleanup; the measurements below retain their exact source bindings.

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

The normal tuple now selects Boundary 1b00c8c / World a20a285. Its kernel is
462,524 bytes, SHA-256
8f7b6359ddf4d63b513d8d5c17400487fde357cb487831bb2b555a449f39ee0b.
Boundary's dependency package is 1,392,930 bytes (282,310 compressed); World runtime
contents are 519,224 bytes. No paid inference or live-model quality claim is made.
The adequacy obstruction and its minimal reproducer remain intact.

Reproduce captures with `tools/agent4/capture-inquiry.mjs` and explicit frozen
source/runtime/native/inspector paths. World's `build_replay_bench.zig` supplies
native timing; use file-backed stdin (`replay-bench OUTCOME_SHA256 < INPUT`).
The temporary build graphs only install existing inquiry/native/inspection tools;
all other tracked Agent bytes match their declared revisions. Raw captures,
profiles and temporary predecessor installations are not maintained.

## Runtime follow-up qualification

The workspace remap introduced at World 2a87702 supports growable
arrays while retaining the existing arena-slab resize policy. Retained bytes,
allocation accounting and failure atomicity are preserved; noncontiguous segments
are never joined. [World's current results](https://github.com/tkersey/world/blob/2a877021be71499f599c1b0cd2711982b18e5085/docs/compositional-execution.md)
show installation64 native peak falling 141,786 → 135,051 bytes and installation256
388,069 → 365,015. Guest peaks are unchanged and timings are mixed. No Agent
latency gain is inferred from those standalone measurements.

The preceding control-node comparison, World 9922062 → 58f2533, replayed the same
180 successful Agent inputs in two windows. All native and guest outcomes were
byte-identical, with unchanged complete-invocation peaks. Native times were nearly
flat to slightly lower; small guest rejection cases ranged from about 1% faster
to 3–8% slower across windows and remain indeterminate. The complete BPC1 table
and these follow-up timings remain bound to their named tuples. Final cumulative
acceptance is open; no new raw captures or evidence framework is maintained.

## Current clarification comparison

The unchanged four-case document-clarification policy was refreshed on Agent
b277743 / Boundary 6c59436 / World 2a87702 against the fixed Agent 1f3297b /
Boundary 42a09b9 / World d075169 anchors, separately using normal BPI2 and compact
BPC1. The predecessor runtime matches its original complete inventory and kernel
hash. Compact images round-trip to identical BPI2 bytes, and initial arguments are
byte-identical. The application policy source is unchanged.

Two windows rotate three isolated Node process observations per format. Zig 0.16.0
ReleaseSafe, Node 26.9.0 and M2 Pro/macOS 27.2 were held fixed. Kernels retain their
pinned 256 MiB maximum-memory profiles. No builds overlapped the timings.
Each fresh-time sample sums the 21 or 23 full fresh-kernel calls in one scenario,
including kernel setup and encoding. Whole-scenario time also includes fixture
handling and file I/O. Neither is an individual-request tail statistic. The table
shows medians from the second confirmation window.

| Case | BPI2 fresh ms | BPC1 fresh ms | BPI3 fresh ms | BPC1 → BPI3 scenario ms | BPC1 → BPI3 checkpoint bytes |
| --- | ---: | ---: | ---: | ---: | ---: |
| divergent-active | 215.01 | 211.20 | 135.13 | 237.46 → 162.79 | 2600 → 2639 |
| common | 177.65 | 171.14 | 107.17 | 188.25 → 125.52 | 1985 → 2055 |
| clarify-first-common | 113.91 | 111.68 | 71.71 | 123.89 → 86.28 | 1891 → 1928 |
| clarify-first-divergent | 112.28 | 113.28 | 71.83 | 126.31 → 88.04 | 2044 → 2081 |

Both windows support about 36–41% lower fresh-invocation time than BPC1. Across all
18 process runs, every reported field other than timing and State byte counts
agrees: model work, request/response sizes, clarification and approval exchanges,
replacements, assessments, memory, resulting file hashes and complete effect/
cleanup traces. All original fixture assertions remain enabled.

The main image is 14,355 / 13,256 / 11,435 bytes in BPI2 / BPC1 / BPI3; the
clarify-first image is 11,777 / 10,797 / 9,373. Maximum checkpoints remain 37–70
bytes larger in BPI3. This lane measures the public guest path, not native working
peaks or live-model usefulness. It uses prescribed model/person inputs and no paid
inference. Remaining World performance gaps are not waived by these gains.

Reproduce with `tools/agent4/benchmark-clarification.mjs`, explicit immutable
Agent source/runtime/image paths and a fresh output directory per process.
Temporary predecessor installations and generated measurements are removed.

## Component build costs

The build lanes were refreshed on Agent a9d1028 / Boundary 6c59436, using the normal
authenticated source override and World 2a87702 for behavior checks. Zig 0.16.0
ReleaseSafe, Node 26.9.0, M2 Pro and macOS 27.2 were held fixed. Native builds used
two separate empty local/global Zig caches. They are cache-cold observations, not
claims about OS-cold filesystem caches or all applications.

| Operation | Current observations |
| --- | ---: |
| Build component emitter and client/linker | 22.56–23.26 s |
| Warm unchanged build, including source authentication | 0.332–0.345 s |
| Controlled client-only native rebuild | 15.01–15.02 s |
| Rebuild one state component with the built emitter | 2.21–2.22 ms |
| Link immutable components without source checking/lowering | 2.43–2.52 ms |
| Compile/check one Agent client and link reused components | 2.79–2.82 ms |
| Compile the next client variant with existing tools | 2.77–2.84 ms |

Native cold/edit rows have one observation per window; warm builds have three.
Process rows give medians from two windows, each with nine rotating observations
after three warmups. They include process startup and file I/O, not request-tail
statistics. No builds or benchmarks overlapped.

The valid client edit widens the increment to u64 before adding one. Its native
build leaves the component emitter cached and byte-identical while recompiling
the client/linker. The edited executable then links the existing four BMO1 files
with no emitter available: zero component emissions, zero source checks/lowerings
for standalone links, and exactly one check/lowering per Agent client. All object
bytes remain unchanged (147 / 375 / 612 / 195 bytes). Fresh-kernel execution yields
184/185 for edited Agent clients versus 183/184 originally; standalone 83/166,
yielding, release payloads, cleanup and cancellation assertions remain unchanged.

The matched source-only installation64 producer compares Boundary 42a09b9 BPC1
with 6c59436 BPI3 through World's existing producer probe. Two windows reverse
build order and use fresh Zig caches: build plus first emission takes 16.45–17.38 s
for BPC1 and 16.62–16.89 s for BPI3. Those ranges overlap; no consistent cold-build
gain is established. The images remain 2,805 / 2,241 bytes.

For an already-built installation256 producer, two alternating process windows
(three warmups, nine samples per side) give medians 29.45 / 29.38 ms for BPC1 and
4.46 / 4.42 ms for BPI3. Complete images are 12,102 / 9,551 bytes. This emission
improvement does not account for native compiler build time.

Reproduce the component lane with `zig build build-component-tools
-Doptimize=ReleaseSafe`, isolated caches and the modes in
`test/agent4/component_runtime.mjs`. The controlled edit changes
`Application.increment` to `@as(u64, 1) + @intFromBool(...)`; it does not edit
components or the emitter. The producer lane uses World's
`test/v2/build_execution_bench.zig -Dproducer-only=true` and `producer-bench COUNT`.
These results establish component reuse and the stated build costs, not an
all-application cold-build improvement.

The September 19 amendment accepts the ten named native latency tradeoffs in
[World's current results](https://github.com/tkersey/world/blob/feat/compositional-execution/docs/compositional-execution.md#milestone-performance-disposition).
That acceptance does not cover memory, WASM or material Agent regressions. Remaining
work is the cumulative guest/Agent confirmation on Boundary 1b00c8c / World a20a285,
explicit economic dispositions, the requirement audit and serial reviews. Existing
functionality is not reopened by older status prose or optional optimization ideas.

The three rejection peaks increase by 2,058–2,123 bytes (about 0.11%); their exact
attribution and preservation on the current tuple await that confirmation.
Checkpoints grow by 18–79 bytes, with repeated completed turns retaining two nodes
and one blob and no live resources, cells or obligations in the measured fixture.
ReAct's image is 43,394 → 48,226 bytes (+4,832; +11.14%); the accepted size condition
applies specifically to installation64/128/256, not every program. Recommendation:
accept these named checkpoint/image tradeoffs if the current-tuple confirmation
preserves their bounded behavior; no user acceptance is implied yet.

Live-model usefulness remains unmeasured and is not a paid-inference closeout lane.
No real user-data operations were used to obtain these results. The adequacy
obstruction is a result for its explicitly locked historical release tuple; it is
not a current successor defect without a current reproduction.

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
