# M3 consumer qualification

The initial candidate compiler was Boundary `fd2cb6f3ceae51341bf61fdd579c735cd70d22dc`
on existing draft #161. Agent continues on its existing branch and draft #39.
The downloaded archive's recomputed Git tree matches the GitHub commit API;
source and Zig package inventories are independently verified. The dependency
lock and manifest bind that exact package. World remains the authenticated
`f8a1597d4ff62ae691dfca12f7ce3a2b4e6c0727` runtime, with unchanged kernel
`7d31effb1d4e32523d0fcbd5b4d5f5a8a2289fbd4c731173a33b1c174524282f`.

## Completed observations

- Authenticated managed component tools: 7/7 build steps, terminal exit 0.
- Fresh corpus emitter: 3/3 build steps; emission completed with exit 0.
- Eighteen unchanged application inputs were compiled. Twelve resulting images
  are byte-identical to the qualified M2.5 package at `15c5356`.
- Six images changed: document and document-consequence shrink by 12 bytes each;
  review-react shrinks by 2 bytes; inquiry-repair and inquiry-repeated grow by
  381 and 383 bytes; inquiry-react grows from 40,966 to 49,604 bytes.

`conformance/agent4/m3-rebind.json` retains the exact identities and source,
package, runtime and build evidence. Image size is not a runtime speed claim.

## Remaining qualification

Changed-image behavior, admission/execution/checkpoint economics, cumulative
pre-cutover comparisons and final integrated/browser validation remain pending.
The accepted P22 synthetic costs apply only to their reported witnesses; they do
not accept these new consumer costs. Do not relabel M2.5 evidence as M3 execution.
The full optimization programme and final serial reviews remain open.

## Initial behavior and blocking regression

Prescribed behavior checks passed: 13 inquiry/ReAct cases with native/WASM/Wasmtime agreement, 13 document cases, 36 consequence cases with native agreement, four repeated-inquiry epochs (28 model responses, four experiments, eight cleanups), and the review runtime suite. These are simulated provider inputs, not paid inference.

Admission measurements identify a concrete regression. Inquiry/ReAct exceeds the default semantic work budget and returns the P01 baseline: ReAct stops at call-pattern specialization, repair and repeated inquiry stop at dead-computation analysis. ReAct admission peak increases by 159,994 native bytes and 482,052 WASM bytes versus M2.5; retained storage increases by 129,954 and 360,850 bytes. An isolated call-pattern probe also exhausts its own allowance on ReAct. The current package is not economically qualified. Timing and final integration are deferred while correcting unnecessary analysis/work accounting; limits and deterministic rollback remain binding.

## Corrected candidate

The current manifest and dependency lock now bind authenticated Boundary
`c1f4baf48a5d07b6d8c166c4434070267c427c36`. The initial `fd2cb6f`
measurements above remain historical. All 18 corpus compilations now finish
without work-limit rollback; ReAct emits 41,021 bytes and its local WASM
admission peak increase falls from 482,052 to 3,192 bytes. Current local memory
and checkpoint observations stay within the specified thresholds.

Boundary integrated validation passes 319 steps and 689 tests. The first timing
sweep completes 24 admission and 108 execution/phase comparisons; admission
has no confirmed slowdown. A targeted 256-session batch resolves the zero-clock
native execution cell without a confirmed slowdown. Thirteen other phase
increases remain recorded. Additional WASM fresh-invocation timing and final
managed-package/browser integration are pending. No economic acceptance or
final M3 closure is claimed.

Final integration on the actual authenticated c1f4baf tuple completed with exit
zero: 411/411 steps and 202/202 Zig tests. Chromium 153 and Firefox 155 pass real
Worker/file/Worker transfer and cleanup. The unchanged World kernel retains its
original build identity. Remaining cost measurements and disposition are pending.

## Completed measurement and pending decision

The final c1f4baf measurements include 24 admission, 36 native fresh-invocation,
36 WASM fresh-invocation and 72 prepared phase comparisons. Admission and both
fresh-invocation engines have no confirmed consumer slowdown. Thirteen phase
cells and the unchanged callable witness require the single §9.5 decision in
`optimization-m3-cost-decision.md`; it has been requested, not yet accepted.
The current PRE image passes 14 timing comparisons. No M4 cost is covered.
