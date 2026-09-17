# Compositional execution: Agent status

Agent 4.0.0-dev.0 consumes Boundary 3 / World 6 on the dedicated
`feat/compositional-execution` branches. The complete successor goal remains
incomplete. The linked PRs are drafts; no merge, promotion or release is authorized.

## Current construction and dependency custody

The normal manifests and [dependency lock](../conformance/agent4/dependencies.lock.json)
select Boundary `711325d3453f9fbb4d43f3ca9438c038fb7c14d7` and World
`389d44c95507c37bc93de380d720de03d8908547`. Downloaded source trees match GitHub
commit trees. Source/archive inventories, both Boundary package profiles, and
World's runtime inventory are independently authenticated. Isolated setup rebuilds
the generic kernel from these exact inputs. This is candidate integration, not a
published release.

The kernel is 460,851 bytes with SHA-256
`b0cee0db452b46d9cf8f3f3067c52693383d566b9670a38da778793e29de66ee`.
The current graph has no predecessor control/continuation argument vectors:
values belong to stable activation views. World cloning requires their owner.
The raw graph State and migration-only Store import/export helpers are retired.
Earlier draft PST3 records require their original pinned pair.

World now gathers outgoing operands before changing an active control into its
continuation in place. The continuation retains the same frame handle and node ID;
multi-shot activation still clones its template. Unique slot prefixes stay in
place, and constructor capacity is prepared before temporary values. All 86
commands captured from this Agent implementation
(`ec6827e0ab4bbfde60cf5ee24a9ffca9c1c570a0`) reproduce identical complete output
bytes under the candidate native runtime. World records the new native timings
and unresolved BPC1 gap in `docs/measurements/continuation-transfer.json`.

Agent compiles through `boundary.program.compile`/`compileObserved`, with pure
records from `boundary.data` and `boundary_data`. Protected Agent admission runs
before Boundary admission. Diagnostics and native phase observers remain available
but do not enter portable images. Every source clause has its resumption checked;
there is no caller-supplied direct-clause trust flag.

The byte bridge authenticates World before loading it, preserves canonical
PKO3/PST3/ERQ3 records, and binds ERS3 to the actual pending State. Replies cannot
select control from display JSON. Wrong image/State/reply, stale occurrences and
cancellation during suspended cleanup retain their independent rejection tests.
Fresh and resident execution use World's single evaluator.

Each default arena allowance reaches the authenticated kernel's overall
memory ceiling (256 MiB). The kernel still enforces that global ceiling; explicit
smaller limits reject without consuming input. This is a capacity policy, not a
claim of reduced working memory or retention.

## Preserved behavior and qualification

Normal-pin authoring passes 159 steps, 112 Zig tests and 35 JavaScript tests.
Complete integration qualification passes 169 steps and 50 Zig tests, the
83-test Node suite, 49 inquiry scenarios, executor/application checks and real
Chromium/Firefox transfer. Post-run source/package/runtime authentication passes.
These results bind the exact pair above; no paid model calls or real application
data were used.

The owning commands are `zig build check-agent4` for authoring and the combined
`check-native check-agent4-economy check-compiled-tools check-component-tools
check-compiled-tool-browser check-agent4-integration` for runtime qualification.
Runtime commands require the authenticated `world-source`, `world-runtime` and
locked `browser-tools` paths; [runtime instructions](agent4-runtime.md) describe
setup and source-independent execution.

Coverage includes model custody, typed responders, scoped interpretations,
clarification, exact approval, speculative isolation, retained dialogues,
fixed-input inquiry distribution, repeated tasks, suspending retirement and the
coalescing ablation/ReAct comparator. Inquiry preserves separately owned recipients
across a model suspension without reacquiring the observation. Native, Node and
independently invoked Wasmtime compare meaningful results and transfers.

The economy harness checks direct/facade byte equality, shared helpers,
conversations, multi-shot alternatives, clarification, inquiry image identity and
the prescribed inquiry/ReAct comparison. Resident replay prepares once and compares
exact outcomes under the same reply and checkpoint obligations, then closes with
zero live working allocation. The 1,024-turn witness checks bounded quiescent State.
These are functional observations, not measured performance acceptance.

One prior archived inquiry CLI run timed out. The same archive completed a
31.7-second diagnostic run. Test-server teardown now closes active connections and
the single-file child has an enforceable deadline; subsequent focused and aggregate
runs passed without weakened behavior assertions. The original trigger was not
reproduced, so universal elimination is not claimed.

## Compiled tools and actual host transfer

The [compiled text tool](compiled-text-tool.md) is one BMO1 object linked into
standalone and Agent Programs. Agent invokes it through its actual model-facing
local-tool declaration while retaining unrelated owned work and human occurrence
identity. Real Chromium and Firefox Workers export guest checkpoints, are destroyed,
and resume successors produced by a separate Node process reading a fixture file.
The same tool and bindings execute from the extracted use archive. No host
reconstruction of authored control is involved.

The three-component witness independently emits callable, private-state and owned-
suspension objects once, then links two standalone Programs and two Agent callers
from those bytes. The private counter yields 41/42; cleanup carries 83; standalone
results are 83/166 and Agent results are 183/184. Cancellation after yield runs
cleanup once. Native phase observations record no source lowering during standalone
links and one client lowering per Agent caller; unchanged object digests and emitter
counts establish reuse. Producer and client-edit costs are reported below.

Nominal internal effects may be explicitly bound in a compiled tool interface.
Internal/external status and Agent role must agree. External declarations remain
explicit, and opaque imports still reject in protected speculation; composition
does not grant arbitrary protected-component authority.

## Measurements and limits

The frozen comparator is Agent `1f3297b8cd7eeb7638bd1bb2a81c9ba609e2e311`
with optimized Boundary 2.0.2 / World 5.0.2. Normal BPI2 and identity-verified BPC1
are reported separately. Each retained report binds exact sources, kernels, images,
policies and sample units. Later functional qualification does not transfer those
measurements to the current pair.

- [Document clarification](measurements/clarification-performance.json) retains
  all four actual fixture policies and assertions, semantic traces, approval/effect
  counts, results/memory and file bytes. Two rotating windows use three isolated
  processes per format. Early successor clarify-first fresh calls regressed 24–28%
  versus BPC1 (`CEX-d6699e0faf41cb3fe5574899`); buffer ownership reduced this to
  roughly 21–23%. These unfavorable observations remain in the report.
- Agent implementation `e2c148ce175885af28432c3c12876f6b469cccd3` with World
  `9a045a1` improved consequence-sensitive whole scenarios to 201.1/202.3 ms
  versus BPC1 231.4/232.9 ms for divergent input, and 152.9/153.6 ms versus
  181.1/179.3 ms for common input. Clarify-first fresh totals were approximately
  level (109.6/109.9 ms versus 109.2/110.0 ms); small whole-scenario overhead
  remained. These are cumulative timings, not request-tail percentiles.
- The [source runtime matrix](measurements/runtime-source-matrix.json) retains
  generator, scheduler, queens DFS/BFS, shallow/reentrant handling and suspending
  cleanup with independent source expectations. The host-admission pair improved
  all seven cases in both windows; BFS was 12.9/13.1 ms versus 26.4/26.8 ms BPC1.
  Earlier mixed/regressing windows and larger State sizes remain recorded.
- The [native data matrix](measurements/native-data-matrix.json) covers product
  and variant projection at 0/1KiB/1MiB and sequence consumption at 16/64/256/1024.
  A 1MiB product took about 0.41 ms versus 37.6–37.7 ms BPC1; 1024-element
  consumption took 1.54–1.55 ms versus 19.36–19.38 ms, allocating 1.11 MB versus
  42.82 MB. Tiny projections lost latency; some small sequence peaks were higher.

World's host admission hashes owned bytes on every call, then may weakly reuse
immutable compiled kernel code. Instances, Program admission and Session state
remain fresh. These repeated-call gains are distinct from resident reuse and do
not establish cold-start improvement. World's `docs/measurements/solver-facts.json`
retains later native solver measurements and the unresolved control64 regression.

Run `node tools/agent4/benchmark-clarification.mjs AGENT_SOURCE WORLD_RUNTIME
IMAGE NEW_OUTPUT` with immutable authenticated inputs. Optional `--capture` writes
native replay commands/expected outcomes and labels timings unqualified due to I/O.
Output must be outside all input paths, including physical aliases. No paid model
calls or real application data are required by these checks.

## Producer and developer workflow

`zig build build-component-tools -Doptimize=ReleaseSafe` builds the existing
component emitter and client/link executable without a World installation. The
normal Boundary authentication gate remains active. Runtime qualification still
belongs to `check-component-tools` and the integration aggregate.

The [producer/workflow measurements](measurements/producer-workflow.json) separate
native compilation from already-built producer processes. Four matched observations
per Boundary revision use empty Zig compilation caches, with alternating order;
the OS filesystem cache is not claimed cold. The unchanged 64-handler images
execute to 2080; a controlled source constant edit to 65 handlers executes to 2145.

| Native build stage | Boundary 2.0.2 | Boundary 3 candidate |
| --- | ---: | ---: |
| Cold compiler build, median | 16.80 s | 15.66 s |
| Warm no-change build, median | 157 ms | 155 ms |
| Controlled producer-source edit, median | 11.48 s | 10.42 s |

After two warmups, prebuilt producer medians across stages range from 3.45–4.55 ms
for BPI2/BPC1 and 2.68–3.00 ms for BPI3. These process clocks include launch, source construction,
checking/lowering, encoding and stdout. First post-build launches are retained
separately (about 12–26 ms); they are not replaced by warm timings.

Two component workflows build both Agent tools in 20.9/21.7 s. Warm no-change
builds take 262/267 ms; a native client source edit takes 14.7/14.9 s while reusing
the unchanged component emitter and all library objects. Already-built standalone
links take about 2.5–2.6 ms with zero source checks/lowerings; Agent client invocations
take about 2.9–3.1 ms with one client check/lowering. Object admission still runs.

The existing `agent-next` configuration produces byte-identical output to the
measured `+1` native client edit, using the already-built executable. That bounded
configuration change avoids native recompilation; arbitrary native source edits
do not. Changing the component's initial counter from 41 to 43 requires an
11.7/11.8 s native emitter rebuild and a separately measured first emission. Only
the state object is regenerated; the unchanged client executable links it in
2.5–2.9 ms and produces the independently expected result and cleanup payload.
The one-time component-owner emitter build is also recorded, rather than hidden.

These observations establish this developer-workflow slice. They do not turn
millisecond compiler execution into a claim about seconds of native compilation,
or qualify the remaining runtime performance matrix.

## Retirement and remaining work

The frozen BPI1 Process-transcript and Interpretation v1 producers/drivers,
old-kernel acquisition, interpretation dependency lock and proof scaffolding are
removed. Current archive authentication, stale-response binding, cleanup, source-
independent package and real host-transfer tests preserve their applicable safety
obligations. No current semantic test was removed with Interpretation v1.
Historical tooling remains reconstructible from Git. The adequacy obstruction
and its minimal reproducer remain intact.

Still required are the remaining historical consumer/helper retirements, the full
matched workload matrix (including inquiry/repeated inquiry/ReAct), allocation/
copy/retention corroboration where absent, resolution of material primary-workload
regressions, and serial review
closeout. The linked drafts must pass coordinated acceptance before any separately
authorized landing in Boundary → World → Agent order.
