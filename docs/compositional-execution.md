# Agent successor status

Agent 4.0.0-dev.0 consumes Boundary 3 and World 6 through the authenticated
[dependency lock](../conformance/agent4/dependencies.lock.json). Authoring, approval,
model/tool contracts, inquiry and reusable compiled tools remain product code.
All linked PRs remain drafts; their live review/readiness status is authoritative.

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

The cumulative confirmation measures Agent production 9cad6d0 / Boundary 1b00c8c /
World a20a285, using the normal authenticated dependency tuple. Subsequent Agent
changes affect this result document only. It is compared with fixed Agent 1f3297b / Boundary
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
| paired-reset-inquiry | 554.71 / 552.96 / 174.13 | 687.53 / 686.61 / 327.36 | 1,853,961 → 1,724,731 |
| paired-reset-react | 87.68 / 88.09 / 59.83 | 179.38 / 178.72 / 139.45 | 2,061,220 → 1,993,377 |
| paired-rebinding-inquiry | 554.34 / 552.86 / 174.62 | 684.53 / 685.22 / 327.14 | 1,850,451 → 1,722,378 |
| paired-rebinding-react | 87.52 / 88.11 / 60.21 | 179.34 / 178.64 / 139.75 | 2,058,801 → 1,991,823 |
| paired-already-correct-inquiry | 335.25 / 334.51 / 108.68 | 413.97 / 412.03 / 200.88 | 1,808,359 → 1,694,693 |
| paired-already-correct-react | 32.52 / 32.49 / 23.63 | 65.44 / 64.73 / 54.50 | 1,960,760 → 1,934,045 |
| paired-inadequate-inquiry | 291.29 / 289.84 / 92.95 | 357.78 / 355.41 / 171.22 | 1,807,413 → 1,680,009 |
| paired-inadequate-react | 22.00 / 22.07 / 15.99 | 41.86 / 41.61 / 36.17 | 1,891,577 → 1,887,839 |
| react-rejects-subject | 14.67 / 14.76 / 11.41 | 28.21 / 28.03 / 25.80 | 1,885,905 → 1,888,028 |
| react-rejects-key | 14.76 / 14.96 / 11.50 | 28.33 / 28.40 / 26.11 | 1,885,803 → 1,887,861 |
| react-rejects-occurrence | 15.37 / 15.38 / 11.64 | 29.32 / 29.14 / 26.19 | 1,885,983 → 1,888,095 |
| react-rejects-acceptance | 13.64 / 13.74 / 11.24 | 27.58 / 27.27 / 25.94 | 1,923,980 → 1,911,673 |
| react-inconclusive-candidate | 19.77 / 19.81 / 15.27 | 38.75 / 38.24 / 35.00 | 1,916,537 → 1,906,982 |
| repeated | 1671.51 / 1662.61 / 480.30 | 1942.56 / 1936.80 / 934.42 | 1,819,273 → 1,682,135 |

Both predeclared windows preserve substantial consumer gains against compact BPC1:
paired inquiry is about 3.1–3.2× faster natively and 2.0–2.1× in the guest;
paired ReAct is about 27–32% faster natively and 13–22% in the guest. Repeated
inquiry improves about 3.45× natively and 2.07–2.25× in the guest. All 180 current
inputs per window reproduce their qualified capture bytes; all 180 BPI2/BPC1
outcomes are byte-identical. Nonphysical scenario fields, template counts and
activation counts agree across formats. No assertion or application policy changed.

The small native occurrence/acceptance rejection totals were 16.94/15.21 ms in the
first window versus BPC1 15.37/13.59, but 11.64/11.24 versus 15.38/13.74 in the
second. Their direction is mixed across the two windows; no uniform native
non-regression or stable improvement is claimed for those cases. The cause of the
first-window variation is unresolved. Every guest rejection case is faster than
BPC1 in both windows. These are full captured-input replay totals, not whole
scenario times or per-request tail statistics.

Three rejection cases retain 2,058–2,123 bytes more peak memory than BPC1. The other
scenario peaks are lower. Reset inquiry allocates 102,202,499 → 80,107,943 bytes;
reset ReAct 62,555,152 → 57,363,085; repeated inquiry 212,133,017 → 170,178,530.
These are complete invocation allocations, distinct from Session-only counters.
Some smaller cases allocate more cumulatively despite lower timing: inadequate
ReAct 14,258,359 → 14,380,897 bytes; subject/key/occurrence/acceptance rejection
9,542,025/9,634,266/9,881,764/9,546,801 →
10,277,944/10,311,230/10,454,757/10,305,402; inconclusive
13,316,382 → 13,841,420. Cumulative allocation is not retained storage or peak.
Reset inquiry blob copies fall from 6,308,439 to 733,515 bytes; reset ReAct from
5,709,609 to 591,854. Maximum scenario checkpoints grow by 18–79 bytes: reset
inquiry is 48,999 → 49,025 bytes and reset ReAct 67,681 → 67,699 bytes.
Normal BPI2 / BPC1 / BPI3 image sizes are inquiry 44,338 / 40,167 / 36,756,
repeated 44,684 / 40,486 / 37,137, and ReAct 49,249 / 43,394 / 48,226 bytes.
ReAct remains larger than BPC1; the specification's separate installation-image
condition is satisfied, not replaced by a universal image-size claim.

The normal tuple now selects Boundary 1b00c8c / World 02846a4. Its kernel is
462,629 bytes, SHA-256
7a27d64295431c960046439353a158e378f14d4686fac47b61b1406cf1753663.
Boundary's dependency package is 1,392,930 bytes (282,310 compressed); World runtime
contents are 519,413 bytes. No paid inference or live-model quality claim is made.
The adequacy obstruction and its minimal reproducer remain intact.

Reproduce captures with `tools/agent4/capture-inquiry.mjs` and explicit frozen
source/runtime/native/inspector paths. World's `build_replay_bench.zig` supplies
native timing; use file-backed stdin (`replay-bench OUTCOME_SHA256 < INPUT`).
The temporary build graphs only install existing inquiry/native/inspection tools;
all other tracked Agent bytes match their declared revisions. Raw captures,
profiles and temporary predecessor installations are not maintained.

## Qualification scope

The current cumulative inquiry/repeated/ReAct confirmation closes the earlier
runtime-refinement evidence gap for these applications. All native complete-call
peaks match the previously reported peaks exactly. Three rejection peaks remain
2,058–2,123 bytes above BPC1, and checkpoints remain larger as reported. The latest
normal-source authentication also passes offline. The standalone guest matrix and clarification lane are separately confirmed in
their owning result sections; none substitutes for serial reviews.

## World review repair qualification

The normal lock now authenticates World 02846a4, including its Git tree, downloaded
archive and complete runtime inventory. Boundary remains pinned to 1b00c8c.
World repairs failed-publication rollback for shallow resumptions, rejects inherited
or non-string control names before execution, and synchronizes shared preparation
leases across independent native Sessions. These are correctness fixes, not new
performance objectives or changes to application policy.

The repaired tuple passes Agent's normal 229-step / 176-test check, all six
integration groups, extracted consumers and compiled-tool transfers in Chromium
and Firefox. World's normal package dependency produces the same kernel bytes as
its exact-source qualification. Inquiry/repeated/ReAct images remain
36,756 / 37,137 / 48,226 bytes. Repeated inquiry retains 28 model calls, four
experiments, eight cleanups, eight templates and 16 activations; every completed
turn retains two nodes and one blob, with no resources, cells or obligations.

The cumulative tables above retain their stated World a20a285 subject. A targeted
before/after follow-up compares Agent 97b4265 / World a20a285 with Agent ea6e4fd /
World 02846a4, holding Boundary 1b00c8c, images, policy, capacities and toolchains
fixed. All 180 captured inputs and outputs match byte for byte. Timing selects the
three predeclared representative paths (90 inputs), with two isolated rotating
windows, three warmups and nine samples per input. Native replay uses file-backed
stdin; guest clocks include the full public fresh-kernel path. File loading and
capture are outside clocks, and no builds or benchmarks overlap.

| Path | Native ms before → after (windows 1; 2) | Guest ms before → after (windows 1; 2) |
| --- | ---: | ---: |
| paired-reset-inquiry | 168.94 → 168.92; 172.31 → 171.63 | 313.33 → 313.49; 312.53 → 313.11 |
| paired-reset-react | 58.20 → 58.64; 58.90 → 58.64 | 132.39 → 132.93; 132.95 → 132.58 |
| repeated | 464.27 → 467.02; 473.60 → 473.14 | 820.66 → 822.30; 826.01 → 822.79 |

Native peaks and allocated-byte totals are identical on all three paths. Timing
changes are small and mixed; no speedup is claimed for the correctness repair.
These observations preserve the established application gains without replacing
the optimized BPC1 anchors or claiming a new exhaustive BPC1 matrix. Fresh World
review closeout follows qualification. The requested
Boundary rerun then includes one standard review and all five auxiliary lenses;
Agent's own review sequence remains required. Named economic tradeoffs remain
accepted, without waiving new correctness defects or material regressions.

## Current clarification comparison

The unchanged four-case document-clarification policy was refreshed on Agent
production 9cad6d0 / Boundary 1b00c8c / World a20a285 against the fixed Agent 1f3297b /
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
| divergent-active | 215.84 | 219.10 | 135.61 | 243.93 → 164.89 | 2600 → 2639 |
| common | 174.31 | 174.69 | 101.08 | 191.55 → 116.85 | 1985 → 2055 |
| clarify-first-common | 113.63 | 113.73 | 72.69 | 128.61 → 87.90 | 1891 → 1928 |
| clarify-first-divergent | 115.48 | 113.75 | 72.29 | 127.07 → 88.93 | 2044 → 2081 |

Both windows preserve lower fresh-invocation time than BPC1 on all four cases. Across all
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
The latency amendment alone did not accept memory, WASM or material Agent
regressions. The standalone guest, inquiry/ReAct/repeated and clarification confirmations on
Boundary 1b00c8c / World a20a285 are complete. The requirement audit's narrow
inspector extension is implemented and tested; serial-review status is recorded in the linked PRs. Existing
functionality is not reopened by older status prose or optional optimization ideas.

The three rejection peaks increase by 2,058–2,123 bytes (about 0.11%); their full-invocation peaks are reproduced on the current tuple. Their precise
byte-level differential attribution remains unresolved; the explicit recommendation
is acceptance as a named fixed-fixture cost, not a claim of a leak or a universal
overhead bound.
Checkpoints grow by 18–79 bytes, with repeated completed turns retaining two nodes
and one blob and no live resources, cells or obligations in the measured fixture.
ReAct's image is 43,394 → 48,226 bytes (+4,832; +11.14%); the accepted size condition
applies specifically to installation64/128/256, not every program.
These named checkpoint/image costs, together with the three rejection-peak costs
and World's listed peaks, were explicitly accepted by the user on September 19.
Current-tuple confirmation preserves the reported behavior and sizes. This is
acceptance under the amendment, not a pass of the original unamended gate.

The existing native inspector now supports `inspect-execution IMAGE STATE` via
`zig build build-inspector`. It admits the exact Program/State pair and reports
pending effect/schema/code location, retained activation/package counts and cleanup
ownership without advancing or exposing captured payloads. The original multi-shot
and suspending-cleanup runtime probes pass with additional read-only, wrong-image,
typed-schema and pending-versus-running ownership checks. The three probe images
remain byte-identical. This tooling-only extension does not change the measured
compiler, application policies or World runtime. See
[the inspection command](compiled-text-tool.md#inspect-a-suspended-execution).

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
