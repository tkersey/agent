# Coalescing consumer qualification

Status: draft; the default is `off`. The complete version 2 implementation and
promotion requirements remain open. In particular, the current real-consumer
code/constructor-sharing value gate has **not** been met.

## Dependency and configuration

The candidate selects Boundary `cc1cdb00fb4f9c573afd8ae51fdda1a4dba491b6`
([draft PR 160](https://github.com/tkersey/boundary/pull/160)). Its downloaded
archive was checked against GitHub's commit tree
`c70c9ec602c395cb18c12e6d477580d258d2d498`; source and Zig package inventories
were recomputed. The predecessor Boundary pin was `f512dbb` and the Agent
starting commit was `7b3215cecabd93e7b8d4c547f6c3948a838cf3f5`.

World remains `c20695e00056186a4b74564da6e4ca1c368cb33b`. Both arms use the
authenticated kernel with SHA-256
`7d31effb1d4e32523d0fcbd5b4d5f5a8a2289fbd4c731173a33b1c174524282f`.
Fresh setup against the candidate also reproduced that exact artifact and its
runtime inventory. There is no World evaluator change or new wire version.

```zig
var compiled = try agent.compileObserved(allocator, System, .{
    .boundary_options = .{ .coalescing = .{ .mode = .safe } },
});
defer compiled.deinit();
```

The same option reaches direct lowering and the final compiled-tool link.
Intermediate BMO1 emission defers coalescing. Agent admission remains before
Boundary compilation, and the existing default call stays `off`.

## Current observations

[The structural census](../conformance/agent4/coalescing-census.json) compares
18 existing workload configurations under `off` and `safe`. It records each
image's digest, all catalogue counts, instruction counts, candidate sizes and
discovery work. The document/review systems are exported for the measurement
harness; their application bodies and policies were not changed between arms.

No measured configuration removes a function body or constructor. Document,
review and some inquiry cases save 4–14 bytes through description sharing;
other cases are unchanged. These are not substituted for the required
code/constructor-coalescing benefit. The full candidate also retains those
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
qualified benchmark: the required alternating windows, confirmations, memory,
checkpoint and runtime/admission protocols are still outstanding. The B0/B1
control comparison also remains to be completed.

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
node tools/agent4/coalescing-census.mjs .agent4/census-off .agent4/census-safe \
  conformance/agent4/coalescing-census.json
```

The maintained aggregate retains its predecessor assertions. The compiled-tool
runtime harness adds an enabled arm, verifies the final-link outcome (not merely
intermediate component observation), and preserves its original emission counts.

Remaining work includes complete equivalence/exclusion census provenance,
Boundary's remaining semantic and diagnostic cases, consumer runtime comparisons,
the full performance/platform gates, and required serial review convergence.
Neither repository is ready for promotion, merge or release.
