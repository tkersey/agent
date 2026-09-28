# M2.5 consumer qualification

Continue on the existing cutover branch and Agent #39 under the user-directed
one-branch/one-PR policy. Preserve earlier M2 receipts and accepted cost decisions.
The authenticated Boundary dependency remains exactly 8b900338818c084d0e752f191313a4535ee31699; later Boundary test/document changes are not relabeled as its source.
World uses the unchanged authenticated f8a1597 runtime, kernel
7d31effb1d4e32523d0fcbd5b4d5f5a8a2289fbd4c731173a33b1c174524282f.

## Terminal evidence

- Authenticated package verification and managed-tool build: 7/7 steps.
- Corpus emission: 3/3 steps; 18 images, 13 byte-identical to M2.
- Inquiry/ReAct: 13 prescribed cases; document: 13; consequence: 36.
- Repeated inquiry now passes with the required real executor: four epochs,
  28 prescribed model responses, four experiments and eight cleanups; native,
  production WASM and independent Wasmtime agree. The earlier outer-sandbox
  failure is retained as historical evidence, not rewritten as a pass.
- Admission memory: all 18 workloads on native and production WASM, with local
  M2 and cumulative pre-cutover comparisons. Largest local native increase is
  474 bytes; no local WASM increase.
- Admission timing: 20 changed-image/engine/control comparisons completed;
  no reproducible slowdown above 5%. Raw samples and identities are retained.

These are bounded observations, not final M2.5 acceptance. Execution/checkpoint
paired timings, final integrated/browser qualification, remaining representation
obligations, and later optimization milestones remain open. Code reviews follow
the complete programme; they do not gate continued implementation.

## Frozen-image execution timing

The paired run completed 78 scenario/engine/control comparisons with three
alternating windows and two additional confirmation windows when indicated.
No fresh-invocation or native-phase slowdown was confirmed. Ten WASM phase
comparisons exceeded 5%: eight checkpoint cells (+1.8–4.4 microseconds,
6.0–14.2%), one start cell (+1 microsecond, 7.3%), and one restore cell
(+18.4 microseconds, 5.9%). Only two are local M2.5/M2 regressions; the other
eight are cumulative comparisons with the pre-cutover baseline.
The exact rows, controls, raw-file digests and paired medians are retained in
`conformance/agent4/m25-execution-timing.json`. The user explicitly accepted these ten bounded costs on 2026-09-28.
These observations belong to Boundary8b90033 and do not qualify later changes.

## Direct-worker compiler rebind

The new compiler input is exact Boundary15c53569bae3e12131088a0141487b8385173184,
authenticated from its GitHub commit tree and independently inventoried source
and Zig package. Managed component tools passed 7/7 steps and the fresh
economy emitter built in 3/3 steps. All 18 consumer images are **byte-identical**
to the preceding 8b90033 images; reported semantic compilations have no
work-limit outcome. `conformance/agent4/m25-direct-rebind.json` retains both
image identities and the source/package/runtime verification.

Accordingly the existing runtime behavior and user-accepted 8b90033 World costs
apply to these exact unchanged images with the unchanged runtime and consumer
code. This does not relabel the earlier runs as new executions, claim faster
compilation, or close remaining full integration and synthesis obligations.

## Final consumer integration

On the authenticated 15c5356 package/runtime tuple, the selected authoring,
integration and browser aggregate completed **411/411 steps and 202/202 Zig
tests**, with Node groups of 9, 22, 35 and 95 tests reporting no failures.
Chromium 153 and Firefox 155 completed real Worker/file/Worker transfer and
cleanup checks. The separate economy target passed 208/208 steps and 4/4 tests.
These are separate command outcomes, not an invented sum of their shared build
steps. `conformance/agent4/m25-final-integration.json` retains the exact scope
and log digests. Remaining synthetic cost disposition belongs to Boundary.

The bounded M2.5 checkpoint is qualified. Boundary records the additional
source-level witnesses, the completed synthetic native/WASM economics and
the explicit acceptance of the 128-word native admission tradeoff. No new
consumer runtime cost is inferred from smaller images: all 18 consumer images
were compared byte-for-byte, and the final integration was executed on the
actual authenticated package/runtime tuple. Continue M3 and the remaining
programme on these same draft branches; final code review remains deferred.
