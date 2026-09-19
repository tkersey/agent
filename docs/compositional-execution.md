# Agent successor status

Agent 4.0.0-dev.0 consumes Boundary 3 and World 6 through the authenticated
[dependency lock](../conformance/agent4/dependencies.lock.json). Authoring, approval,
model/tool contracts, inquiry and reusable compiled tools remain product code.
The successor is incomplete; implementation has resumed after the authorized
archive cleanup and all linked PRs remain drafts.

Current architecture, runtime and migration instructions are in
[architecture.md](architecture.md), [agent4-runtime.md](agent4-runtime.md),
[migration_from_3.md](migration_from_3.md), and [compiled-text-tool.md](compiled-text-tool.md).

Current authoring and runtime qualification passes 229 build steps and 176 Zig
tests, plus JavaScript consumers including an extracted external consumer. Dependency/setup tests pass 25/25
and offline setup authenticates the complete source/runtime tuple. Current integration,
functional economy, independent native/Node/Wasmtime execution, extracted-package
consumers, component reuse and real Chromium/Firefox compiled-tool transfers pass.
The economy run is functional-only and does not establish timing acceptance.

## Current results and unresolved failures

Boundary now owns large outer block catalogs with exact allocations while nested
records keep their existing arena. Budget validation, canonical bytes and identity
are unchanged; partial decode failures and caller mutation have explicit coverage.
The normal dependency tuple selects the authenticated successor sources and kernel.

Across 13 fixed scenarios and 128 paired native invocations, canonical outcomes
and transition/control/copy counters match. Inquiry/ReAct Session peaks fall from
1,952,780 / 3,084,054 to 1,866,916 / 2,739,154 bytes. Two native replay and two
initial guest-invocation windows show small mixed timing changes; no latency gain
is claimed. The kernel is 461,647 bytes with SHA-256
`01895dd4c2ea74def03c7dc794248058e62087ecec49f6c54314f0f876f05256` (+915 bytes).
Inquiry/repeated/ReAct images remain 38,162 / 38,561 / 64,111 bytes.

Native Session peaks remain above BPC1's 1,853,961 / 2,061,220 bytes. The previous
small-control regressions, final matched Agent comparison and ReAct guest-latency
gap remain open. No paid inference or live-model usefulness claim is made.

World's suspension reclamation and tail-frame reuse remain in place. The
one-element survivor retains 8,182 native / 6,064 WASM working-live bytes at its
recorded revision, with an 86-byte checkpoint; final memory accounting must use the
final candidate. Retired slot-view records replace the separate free-index arrays.
Historical control and value measurements remain attributed in World's current
results document; they are not silently promoted to final acceptance.

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
