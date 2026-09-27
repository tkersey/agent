# Coalescing consumer qualification

The default is `safe`. The accepted Boundary specification v2.1
amendment makes speedup optional and accepts current compiler overhead and limited
Agent reductions. Correctness, integration and review remain required.

## Dependency and configuration

The consumer selects landed Boundary `63137689bf788bc408ba638f47256f2a8f219b44`
([merged PR 160](https://github.com/tkersey/boundary/pull/160)). Its Git tree is
identical to the reviewed Boundary head `86f7f0d4785d3566273ba35cac978666dcea9182`. The downloaded
archive was checked against GitHub's commit tree
`79f7b243faa71ed2e4131860da53e851ac866cc3`; source and Zig package inventories
were recomputed. The predecessor Boundary pin was `f512dbb` and the Agent
starting commit was `7b3215cecabd93e7b8d4c547f6c3948a838cf3f5`.

World remains `c20695e00056186a4b74564da6e4ca1c368cb33b`. Both arms use the
authenticated kernel with SHA-256
`7d31effb1d4e32523d0fcbd5b4d5f5a8a2289fbd4c731173a33b1c174524282f`.
Fresh setup against the landed commit also reproduced that exact artifact and its
runtime inventory. There is no World evaluator change or new wire version.

```zig
var compiled = try agent.compileObserved(allocator, System, .{
    .boundary_options = .{ .coalescing = .{ .mode = .safe } },
});
defer compiled.deinit();
```

The same option reaches direct lowering and the final compiled-tool link.
Intermediate BMO1 emission defers coalescing. Agent admission remains before
Boundary compilation. Ordinary calls now select `safe`; explicitly select `off`
for diagnostics and ablation. The compiler and final linker share this default.

## Current observations

[The structural census](../conformance/agent4/coalescing-census.json) compares
18 existing workload configurations under `off` and `safe`. It records each
image's digest, all catalogue counts, instruction counts, candidate sizes and
discovery work. The document/review systems are exported for the measurement
harness; their application bodies and policies were not changed between arms.

No measured configuration removes a function body or constructor. Document,
review and some inquiry cases save 4–14 bytes through description sharing;
other cases are unchanged. The user accepts these limited reductions for this
first round; they are not evidence of code/constructor coalescing in this corpus. The full candidate also retains those
function counts, so this observation is not just a description-profile selection.
It is scoped to these inputs and this implementation, not proof that no stronger
optimization or undiscovered equivalence is possible.

The [compiled-tool witness](../conformance/agent4/coalescing-components.json)
uses the same four original objects, each emitted once. The enabled final Agent
link produces 873 bytes versus 887 bytes disabled, with 14 functions and five
constructors in both arms. Both modes perform one Agent source check and one
lowering. Enabled execution preserves the expected yield, result, cleanup request,
fresh-kernel transfers and cancellation behavior. This is Node/WASM evidence for
that witness; it does not claim full native/browser/platform qualification.

The census is structural evidence. Its emitter's timing observations are not a
qualified benchmark. Boundary's bounded measured pass retained its verified
improvements and documented the remaining cost; further tuning is deferred.
No Agent runtime speedup is claimed.

## Reproduction

After authenticated setup, set `WORLD_SOURCE` and `WORLD_RUNTIME` to its input
and runtime directories. These paths select the same locked World for both arms.

```sh
zig build check-agent4 build-component-tools -Doptimize=ReleaseSafe
node test/agent4/component_runtime.mjs zig-out/bin/agent4-component-objects \
  zig-out/bin/agent4-component-link "$WORLD_RUNTIME"
zig build build-economy-probe -Doptimize=ReleaseSafe \
  -Dworld-source="$WORLD_SOURCE" -Dworld-runtime="$WORLD_RUNTIME"
zig-out/bin/economy-probe emit .agent4/census-off off
zig-out/bin/economy-probe emit .agent4/census-safe safe
zig-out/bin/economy-probe emit .agent4/census-default
node tools/agent4/coalescing-census.mjs .agent4/census-off .agent4/census-safe \
  conformance/agent4/coalescing-census.json .agent4/census-default
```

The maintained aggregate retains its predecessor assertions. The compiled-tool
runtime harness adds an enabled arm, verifies the final-link outcome (not merely
intermediate component observation), and preserves its original emission counts.

The final consumer qualification command passed against Boundary `6313768`:

```sh
zig build check-agent4 check-agent4-integration build-component-tools \
  build-economy-probe -Doptimize=ReleaseSafe \
  -Dworld-source="$WORLD_SOURCE" -Dworld-runtime="$WORLD_RUNTIME"
```

The integration driver recorded all six commands with exit status zero, including
92 passing Node tests and the macOS Seatbelt session checks. The complete build
also passed its native, parser, retained-state and source-independent consumer
witnesses. These are macOS arm64 results with Zig 0.16.0, Node 26.10.0 and Bun
1.3.2; they do not claim qualification on every operating system or live-model
evaluation. Boundary records its separate semantic, diagnostic and browser
qualification in its acceptance inventory.

The serial review record for each Agent head is tracked in [PR 38](https://github.com/tkersey/agent/pull/38).
The released Codex 0.157.0 runtime passed CAS's review compatibility gate.

## Default enablement at landed Boundary 6313768

Fresh authenticated setup reproduced the locked World runtime and kernel. The
source archive tree, source inventory, Zig package inventory and API file hashes
were recomputed for Boundary `63137689bf788bc408ba638f47256f2a8f219b44`.
The three modes (explicit off, explicit safe, omitted option) compile the same
18 workload configurations. All default images equal explicit safe byte for byte.
The census still reports no removed function bodies or constructors, as accepted.

The compiled-tool runtime test now executes explicit off, explicit safe and the
ordinary default. The default equals the 873-byte safe image (887 bytes off),
retains one source check and one lowering, and preserves result 183, yield,
cleanup request, cancellation and fresh-kernel transfer behavior. The two
standalone controls remain explicitly off at 811 and 842 bytes. This prevents
the default change from silently relabeling an enabled run as the disabled arm.


### Existing fixture-executor assertion correction

The integration run on Bun 1.3.2 exposed an existing test-oracle mismatch,
independent of Boundary: the executor, fixture suite and original test were
byte-unchanged from Agent `7b3215c`. Five hostile evaluation-time replacements
can abort before Bun writes a completed report. `runRepositoryTests` rejects
those runs as unavailable, as required by the adjacent absent/incomplete-report
test; it does not return a successful or completed failing observation.

The hostile-replacement test now accepts that exact unavailable-report error for
those five cases, or still requires `passed == false` if a report completes.
The other seven cases still require a completed failing report. Unexpected
errors remain failures. The executor and OS/realm protections are unchanged.
The packaged runtime witness likewise keeps the real test request pending when
a hostile evaluation aborts without a report, checking unchanged state/request and
the outside-file sentinel. It never converts unavailable evidence into failure
evidence. All five focused executor tests pass, including valid accessor/proxy repairs,
native Bun equality, read-only authority, and rejection of forged reports.
