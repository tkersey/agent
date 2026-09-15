# Agent 4 candidate integration evidence

The report below records the original development tuple. The current dependency
lock selects Boundary 2.0.1 (`5084a0d487b886197863866e20ebe6d04de2a0a1`)
and World 5.0.1 (`fd794b36fe7f429fcd62def4d87556cb5ace56f9`). Its inventories
and runtime digest supersede the historical identities below.

The updated tuple passed these checks on September 14, 2026, using Zig 0.16.0
and Node 26.8.2 on Darwin arm64:

- `node tools/agent4/setup.mjs` and offline `--verify-only --offline` readback.
- `zig build check-agent4 -Doptimize=ReleaseSafe`.
- `zig build check-agent4-integration -Doptimize=ReleaseSafe -Dworld-runtime="$PWD/.agent4/out/world-runtime"`,
  including 78 JavaScript tests, native execution and independent Wasmtime agreement.

This report describes finite consumer proofs against unchanged development inputs.
It is not a stable dependency release, live inference report, or CAS review.
The initial publication paused before CAS review. Review closeout was explicitly resumed on September 14; current review state is reported on PR #27.

## Inputs and identity

- Agent baseline: 151c683de871e3df819a1a666fcdf41bff3e391f.
- Source-input SHA256: 952ec0a51a9e5144567157fa192567e4633da18a15695fb749bb6758c9b104d6. This binds the sorted path/content inventory of build configuration, current source/runtime, new tests/tools, and dependency/contracts inputs. The derived report itself is excluded.
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
| review/clarify_first.bpi2 | 3565 | b467b7d50266b997d4de2757b9f481c6acadfd1db48894123e49986a83410912 |
| review/human.bpi2 | 469 | f256a7167fcf8ac864de61fbc13abaa1502eb23f92b42d3172023cc4903249be |
| review/mid_review.bpi2 | 3571 | 609ffdd1ee7825db48952cd4d8c730615f94904b420e2add53a96941598af550 |
| review/model.bpi2 | 2738 | 7fe9d0c8e0551a918effd0762fef3b906ba92e19dd00673068a56cc1d769d761 |
| review/react.bpi2 | 414 | 416d855de849ff18f169d937435c392dff6735dd7ca8e5b2a1f84e50e6fd53c8 |
| review/rule.bpi2 | 321 | c939fd6133f2e75e57e7518ed066474c7570329650e7b08e999826fc08c9be20 |
| document/document.bpi2 | 8717 | afb1ccfe6caa244ee1c9bfc19371d7eb4230425a7ca60d8bdbb707c7ea60a96b |

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

## September 14 review corrections

The GitHub findings on custom abort reasons and nonexistent packaged example paths were independently confirmed and corrected. The model adapter now uses the invocation signal as well as standard exception names for interruption classification. The archive includes the canonical reply fixture; an integration test executes the exact four commands extracted from its documentation. The integration build depends on fresh distribution emission. The complete authoring/integration/economy aggregate passes (120 Zig tests; 98 Node tests; seven expected source rejections, application and three-engine transfer cases). These reruns used Node26.8.2; the unchanged dependency lock retains the original kernel-build toolchain observation. Original measurements above remain historical observations, not fresh performance claims.

The first CAS wave and subsequent GitHub review exposed seven further cases. Evidence-backed approval now carries its declared region row; the combined live-proof/scoped-policy case executes with allowed, denied and mismatched-evidence inputs. File replacement preserves permissions under a restrictive umask, and file reads have an explicit contract-aligned byte bound, including growth during reading. An oversized real document follows the image's typed failure and cleanup path. Runner rendering uses an explicit work stack for 5,000-node recursive interactions; optional display-capacity exhaustion preserves the generic canonical request, tested with a million unit values. Selected source/archive/package paths now reach integration and economy verification; required multi-shot fixtures derive from the selected output directory.

The successor aggregate passes 121/121 build steps, 120 Zig tests, 105 Node tests, seven expected source rejections and 13 actual document scenarios. A separate source copy with no default input directory passes 86/86 integration/economy steps using explicit immutable inputs; a wrong archive is rejected. Raw evidence is in .agent4/closeout/seven-fixes-proof.log, .agent4/closeout/alternate/corrected-proof.log and .agent4/closeout/alternate/wrong-archive.log. Those corrections did not change the application images. Dependency pre/post verification passes; the kernel is unchanged. Current functional economy evidence does not replace the historical timing observations above. CAS convergence remains a separate exact-head requirement.

The second complete CAS wave and corresponding GitHub review identified five distinct cases: CLI aliases, main-entry detection when Node lacks `import.meta.main`, a rejected alternate-setup example, zero-call provider policy, and platform-specific path containment. One pure CLI helper now uses native main identity when available and otherwise compares real file paths; all five entry points share it. Actual direct/alias runner execution, all CLI error paths, the feature-absence fallback, and import safety are tested. The README setup path is checked against setup admission and downstream paths. Canonical model requests cover no-call, optional-call and required-call policies. Packaging uses the platform separator for parent paths; Windows execution itself was not run.

The resulting aggregate passes 121/121 steps, 120 Zig tests and 109 Node tests, including the source-free bridge/archive cases with the pure CLI helper present. Source, package, runtime and kernel verification remains unchanged. Raw proof is .agent4/closeout/wave2/fixes-complete-aggregate.log. Those CLI/provider-only corrections did not change BPI2 images or the finite economy fixtures; CAS review credit from earlier heads is invalidated.

The third complete CAS wave identified an omitted installation-check entry point and dynamic model-template/result-schema incompatibility. The installation driver now uses the shared main-entry helper and participates in CLI alias rejection checks. The protected model responder checks five output-carrying normalization bounds against the same profile that defines its reply schema, plus the existing call-range and positive provider-budget preconditions. Incompatible templates take the caller's module failure before external I/O. Exact and tighter bounds remain unchanged; independent parser and provider-envelope limits are not capped by reply capacities. All single/batch and observed/projection paths execute the boundary cases under native World. The built-in adapter also rejects streaming/background policies as typed unsupported parameters before fetching.

The final aggregate passes 121/121 steps, 121 Zig tests and 110 Node tests, with unchanged dependency pre/post inventories. Raw proof is .agent4/closeout/wave3/fixes-final-aggregate.log. The eight shared template checks add 378 image bytes to each model-backed review composition and 387 bytes to the document image (including its resulting canonical encoding changes); other application images and the finite economy fixtures remain unchanged. The current image identities are in the table above and .agent4/closeout/wave3/image-attribution.json. Historical timings are not fresh measurements of these changed model-backed images.

Windows permission-mode normalization and complete Node20 setup were not adopted as requirements of this tuple: the locked World package declares Node>=26.8.1, and its observed source inventories include exact POSIX modes. The README now states the qualified profile. A new platform profile would need its own observed consumer evidence; modes are not weakened to force a match. Portable main detection is tested independently and does not claim complete execution on every older Node version.

The fourth complete CAS wave exposed Git-dependent authoring checks, source-override authentication omitted by external consumers, and falsy callback rejections reported as success. Authoring now compiles the images without invoking Git-dependent distribution assembly; explicit emission/integration retain packaging. A generated empty module carries the existing authentication step into consuming compilation, including every Agent-owned source-override export, without changing dependency sources or adding executable instructions. The installed authoring fixture includes the pure verifier/CLI helper and still excludes World, kernels and environmental handlers. Callback rejection status is separate from its payload, preserving all falsy reasons and combined postflight failures. A nested-build probe additionally exposed inherited NODE_TEST_CONTEXT skipping JavaScript tests; the check launcher now clears that context for its children.

The aggregate passes 122/122 build steps, 121 Zig tests and 113 Node tests. All four source-override exports accept a synthetic fixture with an explicitly bound test inventory and reject an unadmitted extra file even with cached compilation; actual Boundary inputs are not modified by this test. A manifest-selected source package runs the full authoring check outside Git, and the real external document package compiles against the unchanged locked Boundary source to the identical 8717-byte image. The ordinary BPI2 images are unchanged by these build/verification corrections. Raw evidence is .agent4/closeout/wave4/fixes-final-aggregate.log and external-source-document.log. Timing observations remain historical; the additional consuming-build authentication is not claimed free.
