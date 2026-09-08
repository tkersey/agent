# Agent 4 candidate integration evidence

This report describes finite consumer proofs against unchanged development inputs.
It is not a stable dependency release, live inference report, or CAS review.
CAS review is intentionally not dispatched at the owner's request.

## Inputs and identity

- Agent baseline: 151c683de871e3df819a1a666fcdf41bff3e391f.
- Source-input SHA256: 85f96c53749fc9144e92215bffce8ac405f249ca7480875f10f3aa206b52bf75. This binds the sorted path/content inventory of build configuration, current source/runtime, new tests/tools, and dependency/contracts inputs. The derived report itself is excluded.
- Boundary: 7a4d10ec656cf70bbab99281dd71e3ec493daa0c, 2.0.0-dev.0; source archive 6a0ce149a47f400f8514db6cabf2e3b15209168430d7a01ab260a089da3a2a78; package boundary-2.0.0-dev.0-flclaPEkFQD7SP5XqTrQtqMjyG2qAU5fGr9QW3xaQKUs.
- World: 699a3147088274d2bf742c6ecb4cb70a5faea631, 5.0.0-dev.0.
- Kernel: 9d1cc7b8f2895a25034a5074413da646ae038dfc00b3d80563e71698c630f9a4, 388453 bytes; ABI2; 0 imports; 10 exports; 20 initial /4096 maximum memory pages.
- Zig0.16.0 and Node26.8.1. World keeps its existing ReleaseSmall kernel build; Agent checks use ReleaseSafe.
- Full source/archive/package/runtime inventories and physical profile are in dependencies.lock.json. Named zig-managed and archive-extracted package profiles preserve the observed Zig materialization modes; no dependency bytes or permissions were edited to fit a digest.

The generated use receipt records the actual packaging HEAD/tree and source-file identities. No tracked receipt requires its own enclosing commit SHA.

## Executed acceptance

All listed cases pass. Test paths below are under test/agent4 unless prefixed otherwise.

| ID | Required observation | Executable evidence |
|---|---|---|
| A01 | Agent-only diff and unchanged locked source/package/runtime inputs | dependencies.test.mjs; dependencies.mjs pre/post guards |
| A02 | World-free installed authoring and pure-contract identity | installations.mjs |
| A03 | Source-independent runtime installation | bridge.test.mjs; extracted archive tests |
| A04 | Independent authored request orders | review_runtime.mjs; document_runtime.mjs |
| A05 | ReAct through public shared source operations | review_runtime.mjs; src/react.zig tests |
| A06 | Same Ask body under model/human/rule | review_runtime.mjs; decision_scopes.zig |
| A07 | Mid-turn local data and scope continuation | document_runtime.mjs; dialogue_runtime.test.mjs |
| A08 | Turn replies keep the root parked until close | document_runtime.mjs; review_runtime.mjs |
| A09 | Headless root completion | review_runtime.mjs |
| A10 | Typed owned dialogue with non-void input/result | dialogue_probe.zig; dialogue_runtime.test.mjs |
| A11 | Delayed child resume and disposal | document_runtime.mjs; multi_runtime.mjs |
| A12 | Scope and region restoration through transfer | decision_scopes.zig; document_runtime.mjs; approval.test.mjs |
| A13 | Request-time offered-set custody | model_custody.zig; model_admission.zig |
| A14 | Indexes 31, 32, and 63 with unavailable members rejected | model_custody.zig; decision_scopes.zig |
| A15 | Typed model question without a tool action | review_runtime.mjs; model_invocation_tests.zig |
| A16 | Strict migrated normalization and all admitted calls | model.test.mjs; model_admission.zig; values tests |
| A17 | Actual internal multi-shot continuation | multi_runtime.mjs; document_runtime.mjs |
| A18 | Branch-local cells and unchanged outer evidence | multi_runtime.mjs; observation.zig; document_runtime.mjs |
| A19 | Retained alternatives survive transfer | multi_runtime.mjs; independent.mjs |
| A20 | Simulations cannot mint corresponding live evidence | observation.zig; approval.test.mjs |
| A21 | Amendment invalidates the previous challenge | approval.test.mjs; document_runtime.mjs |
| A22 | Atomic actual-base conflict without overwrite | document.test.mjs; document_runtime.mjs |
| A23 | Grant custody and protected dispatch closure | admission.zig; approval_probe.zig; model_custody.zig |
| A24 | Turn abort cleans up and preserves the conversation | document_runtime.mjs |
| A25 | Root close and World cancellation remain distinct | bridge.test.mjs; multi_runtime.mjs; independent.mjs |
| A26 | Suspended cleanup transfer and binding | dialogue_runtime.test.mjs; independent.mjs |
| A27 | Malformed/stale/misbound replies preserve input | bridge.test.mjs; approval.test.mjs; independent.mjs |
| A28 | Repeated content is not globally deduplicated | bridge.test.mjs; economy conversation matrix |
| A29 | One pending external request and strict current binding | bridge.test.mjs; runner.test.mjs |
| A30 | Raw World executes without the convenience bridge | independent.mjs; review_runtime.mjs; document_runtime.mjs |
| A31 | Quiescent control/state follows retention policy | economy.mjs: 1/8/64/1024 turns |
| A32 | Native, Node and independent Wasmtime same-image records | independent.mjs; native.zig |
| A33 | Real alternate document success and typed failed/conflict outcomes | document_runtime.mjs; document.test.mjs |
| A34 | Identical images and use archives from two clean source copies | independent clean emit-agent4 builds |
| A35 | One unchanged kernel across every application | dependency lock; all integration kernel readbacks |
| A36 | No upstream optimization branch or mutable delivery inputs | exact lock; isolated build/proof paths |

The protected authoring negatives include real Boundary-compiling counterexamples, copied source sites, model effect relabeling, private function/resource escapes, hidden/forwarded speculative effects, and a retained shallow future resumed under a multi successor. The public callable helper permits static code-specific types when structural schema interning would conservatively mix unrelated callback origins. Its 1/8/64-installation tests preserve actual World observations with 8 bytes of schema overhead and shared executable bodies.

## Images

| Image | Bytes | SHA256 |
|---|---:|---|
| review/clarify_first.bpi2 | 3187 | 397c19c27f2369a4c07a238fc2c524d846f36a72b615a58e5e46374a0f70bbb6 |
| review/human.bpi2 | 469 | f256a7167fcf8ac864de61fbc13abaa1502eb23f92b42d3172023cc4903249be |
| review/mid_review.bpi2 | 3193 | 9f6934ab78d1d2df5d0ad5ff244cf6b3b52090e597051e8c1f37783640b72451 |
| review/model.bpi2 | 2360 | 96143881d93c159d4f16567198a6f17de5109ecc19d5693715f79e69f3bf67bb |
| review/react.bpi2 | 414 | 416d855de849ff18f169d937435c392dff6735dd7ca8e5b2a1f84e50e6fd53c8 |
| review/rule.bpi2 | 321 | c939fd6133f2e75e57e7518ed066474c7570329650e7b08e999826fc08c9be20 |
| document/document.bpi2 | 8330 | 9b3b0ce3df84cdf6e69fac17b898939238f275d73379a39024270b2c0a4fbf00 |

## Economy observations

- Matched minimal Agent/direct Boundary images are identical: 119 bytes.
- Fixed retention8 conversation parks at 100/156/156/156 bytes after 1/8/64/1024 turns. Every post-window parked State is identical; live control returns to 2 nodes, 2 blobs, 1 frame and 1 pending request, without retained regions, futures, resources or cleanup obligations.
- Internal alternatives1/8/64 have maximum parked States249/418/1762 bytes. Branch work is real and grows with alternatives; one internal multi template and branch-local cells remain observable while parked.
- Controlled cold/warm/edited-source Zig builds: 19.011s / 0.211s / 13.645s.
- Measured minimal facade authoring overhead in one warmed direct/facade pair: 3000ns, including 1125ns of Agent admission. Image emission varied by -24792ns between equivalent paths; this is a finite timing observation, not an optimization/speedup or universal overhead claim.
- Descriptor construction, source construction, admission, existing Boundary compiler phases and emission are separately observed. Observer/no-observer compilation produces identical BPI2. Public advance replay reports finite-trace portable-State maxima; total kernel working-arena peak and live model cost remain unmeasured.

## Reproduction and raw artifacts

Run the documented check-agent4, check-agent4-integration and check-agent4-economy targets with isolated local/global caches. emit-agent4 writes compiled examples and a source-independent archive under zig-out.

Raw local proof files: .agent4/out/checks/final-aggregate.log, .agent4/out/checks/authoring.json, .agent4/out/checks/integration.json, .agent4/out/installation-authoring.json, .agent4/out/independent/receipt.json, .agent4/out/document/runtime-proof.json, and .agent4/out/economy-measured/economy-report.json. The economic report includes every input/fixture/probe/harness digest and raw measurement command. Repeated clean emission logs are .agent4/out/checks/repro-one.log and repro-two.log. These raw outputs are regenerated, not trusted caches.

For controlled timings on an otherwise idle host, use check-agent4-economy with -Dmeasure-economy=true and a fresh output prefix, or the explicit --measure --uncontended economy.mjs invocation. Functional economy mode labels timing acceptance unmeasured.

The use archive contains canonical examples/InitialArgs, contract documentation, pure bridge/value/provider/tool support, synthetic external fixtures, optional test oracles, licenses and checksums. It contains no compiler, extra WASM, kernel fork, credential, hidden prompt/skill sidecar, or required host continuation. Extracted document and review oracles execute against a separately supplied authenticated World runtime.

## Limits and execution note

Tests establish application semantics for the declared finite cases, same-image implementation agreement, and independent source authoring. They do not establish malicious-handler truth, global exactly-once effects, snapshot anti-replay, distributed locking, universal model reliability, or live model execution.

One diagnostic zig build --help invocation omitted isolated-cache flags; shared-cache non-mutation for that invocation is unestablished. Dependency inventories remained unchanged, and actual dependency builds and acceptance proof runs used isolated caches. This is a tooling-isolation exception, not a dependency compatibility or kernel modification.
