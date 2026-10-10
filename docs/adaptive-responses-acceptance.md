# Adaptive Responses program: acceptance and current scope

**Scope authority:** the user's October 9, 2026 “adaptive program on Boundary,
executed by World” amendment. It supersedes conflicting v1.0–v1.3 and earlier
Zig-only wording. The required result is one reusable authored adaptive
computation/API, emitted BPI3 and ordinary contracts, approved resources, native
adapter integration and a working reference through the existing World/Agent
host. It is not a new native framework or a handwritten policy loop.

The repository-analysis example is the deciding consumer. It exercises two
fixture model IDs, eight control transitions, resident and repeated transient
use, hard eviction, questions, read-only work and a report: 14 model calls and
five work actions. Separate negative traces check forbidden offers and held-I/O
cancellation. Fixture calls establish no live-provider or cache qualification.

## Active execution plan and scope dispositions

| Existing work | Current disposition |
| --- | --- |
| A0 foundation and locks | Retained; do not recreate the native host or repin dependencies. |
| A1 reusable model/control contracts and checked authoring | Retained in `src/model_invocation.zig`, `src/adaptive_controls.zig` and `src/responders.zig`; lowered through Boundary and executed by World. |
| A2 native context/provider/resource integration | Retained; deterministic adapters realize authored plans under frozen authority. |
| A3 repository-analysis consumer, inbox and recovery | Retained on the existing native task owner and front ends. |
| JS adaptive production backend, journal, runner and Node/WASM package | **Superseded by scope change.** Code, exclusive packaging and differential-execution gates are removed; historical user state and receipts are not migrated or destroyed. |
| A5 native qualification | Independent provider records, Zig contract tests and the existing copied-host peer replace the second production implementation. Current exact-head results are required. |
| A6 closeout | Update PR #46 in place and complete current Actuating review convergence; prior-head reviews do not transfer. |
| New standalone distribution, signing/release or another shell | **Deferred from completion.** The working embedded reference executable and existing build/embedding helper remain available. |

This file is the current proof inventory, not a substitute for a passing run.
A row is qualified only by the matching exact-head Linux result and review
status in the PR. Superseded obligations are not recorded as passed.

## Subjects and retained evidence

The foundation is Agent `7d86739af1a47ce8ec36905ba5fe578fa3ce4d9d` (PR #45).
Boundary remains `c49f743382257c7cf5512934ae3a2d0f56d4d4c0` and World remains
`35f11b811b03fcaa2d696265ff8d9b9c92c8fc95`. The locks select Zig 0.17.0, its
library inventory, the delivered World runtime and SQLite 3.53.4. Existing
qualification authenticates these inputs.

`adaptive-agent-image` emits `program.bpi3` and `application.json` under
`zig-out/agent4/adaptive-agent/`. The metadata carries ordinary wire contracts
and approved resource identities, without a second adaptive codec/executor.
`adaptive-agent` builds the existing native reference vehicle from those same
assets. No authoring compiler is invoked during execution or restoration.

The existing `native-reference-Linux-X64-HEAD-ATTEMPT.tar.gz` evidence bundle
retains executed reference binaries and manifests, `adaptive-program/` with the
image/contracts, the approved example data, runbooks, optional stdio caller,
and `ADAPTIVE-OBSERVATIONS.json`. This is reuse of existing evidence transport,
not a new distribution completion gate. Each manifest binds its actual binary,
program, assets, compiler and dependencies. The observation report records its
source head and contains no raw prompts or opaque reasoning.

Historical results remain historical:

- [`d00ee24`](https://github.com/tkersey/agent/actions/runs/37891742767): earlier
  13-call workload, 311-second full workflow, before the scope amendment.
- [`5091ebd`](https://github.com/tkersey/agent/actions/runs/37896945541): 413-second
  measurement-enabled workflow; public-recipe cold 75.597s, warm 2.373s and
  resource edit 5.064s. Its overrun is retained, not relabeled as compliant.
- [`9e0da38`](https://github.com/tkersey/agent/actions/runs/37904316342): 297-second
  exact-head full workflow under the previous dual-runtime scope, including the
  native catalog-admission repair. Its JS-specific work is superseded, and its
  proof does not qualify a later removal or changed acceptance meaning.

## Executable proof surfaces

All listed tests are under `test/agent4` and use existing retained roots/peers.

| Surface | Observation |
| --- | --- |
| `adaptive_controls.zig` | Authored inference/skill transitions, independent effort, stale revision, unknown/version/operation rejection, idempotence, deactivation and eviction. |
| `model_custody.zig` | Checked responder preserves original offers across World suspension; raw model-effect bypass and invalid D/O relationships reject. |
| `adaptive_responses.zig` + `adaptive-responses-v1.json` | Native projection and independent envelope/replay/usage expectations, exact failure values, full-width/integral argument values, Unicode, pairing, original context binding, missing-reference rejection and aggregate capacity. |
| `native_responses.zig` | Frozen native admission, shared configuration/runtime catalog validity, permission subset and pre-transport cancellation. |
| `adaptive_recovery.zig` | Actual emitted program and native storage reopened after raw unload capture but before interpretation; original-plan continuation without another acquisition, once-only counters and narrowed attempt ceiling. |
| `native_adaptive.mjs` + `adaptive_native_peer.mjs` | External controller of the copied native host: actual BPI3 identity, controlled HTTPS, model/effort/offer observations, three consumed follow-ups and one not consumed, exact question restart, forbidden decoded offer, protocol cancellation and SIGINT/SIGTERM, unknown-delivery recovery, settled archive import and missing/tampered capture rejection. Captured-wire expectations do not call an adaptive JS interpreter. |
| `adaptive_measurements.mjs` | Read-only native capture observations and three small offline layout comparisons. It cannot dispatch, render the agent's request or choose a continuation. |
| Existing retained roots and peers | Fixed v3/v4/v5 and repository consumer, native protocol/client mappings, namespaces, grants, reservations, event/lost-ack recovery, backpressure and clean-host boundaries. |

The existing deployment witness excludes Node/JS engines, Python, compilers and
loose runtime/authoring code inside the executed host's boundary. External
controllers stay outside it. Native World executes the compiled image; tests
and adapters do not supply an alternative agent loop.

## Requirement map

The entries name finite deterministic evidence and source-owned invariants,
not exhaustive schedules, arbitrary-provider behavior or formal verification.
All AR-001–AR-080 identifiers are retained with the amended meanings below.

| IDs | Current obligation and evidence |
| --- | --- |
| AR-001 | Unchanged dependency locks and mandatory source/runtime/native authentication. |
| AR-002 | One reusable Zig Agent/Boundary-authored computation, executed and continued by World. Shared controls and checked responder remain independent of the repository consumer. |
| AR-003 | Actual model-callable controls in the emitted computation, witnessed through recorded Responses calls. |
| AR-004–006 | Two distinct fixture model IDs, independent effort change and next-request selection; held-I/O input cannot mutate the acquired request. Real model acceptance is not run. |
| AR-007–010 | Authored rejection/idempotence, original offered-set admission and recoverable control receipts; admitted selection is distinguished from subsequent executed inference. |
| AR-011–012 | Distinct compiled C, materialized D and original O; exact role/schema/resource grants and captured-call work admission. A decoded but deactivated inspection is rejected by the authored checked responder. |
| AR-013–014 | Immutable catalog/body digests, shared semantic admission, UTF-8/capacity and bounded no-follow file checks. This consumer admits 14 skills within the existing 16-resource host ceiling. |
| AR-015–018 | Resident append, retained deactivation, eligible markers before repeated transient suffixes and explicit hard-unload epochs. |
| AR-019–024 | Core/shared permission union, return-to-profile eviction fencing, removal of old opaque state, exact-version controls, no executable skill installation and metadata-only core catalog. |
| AR-025–028 | Additive identities and protected admission, separate raw/normalized records, closed lossless replay grammar and explicit unsupported-shape rejection. |
| AR-029 | Exact values, Unicode, replay and client mappings checked against independent records and Zig assertions; a JS adaptive counterpart is not required. |
| AR-030 | Settled call/result groups and explicit lineage transitions; no unresolved-call or replay-null shortcut. |
| AR-031–033 | Generic authored/projection representation is retained. The consumer rejects in-place effort updates and uses its named new-lineage fallback. Immediate tool-only API-update qualification is not run. |
| AR-034–036 | Transcript continuation retains admitted task facts and settled exchanges while excluding incompatible opaque material. Explicit replacement contexts are retired. |
| AR-037–038 | Input-text marker locations, retained boundaries, at most two new writes, no transient suffix markers and explicit cache/diagnostic fields. Live API acceptance is not run. |
| AR-039–040 | Labeled local byte-prefix measurements, zero prewarm/compaction calls and no automatic model substitution or ambiguous retry. |
| AR-041–042 | State/preparation/allocation/storage observations, existing reservations and namespace ceilings, original-reference binding and missing-reference rejection. Maximal input combinations are not promised to fit. |
| AR-043–046 | Native acquired-before-interpreted reopen, conservative unknown-delivery fencing, original-setting replay, once-only accounting and frozen physical attempt limits. Missing artifacts block without reset or redispatch. |
| AR-047–048 | Task-owned context enters native archive closure. Explicit private credentials remain outside frozen prompts/resources/reports. No real credential is discovered or used by qualification. Abandoned JS journals are not adopted or converted. |
| AR-049–050 | Explicit offline fixture mode and real ordinary task inputs use the same authored program. The production environment performs actual Responses I/O when separately authorized; live task quality is not evaluated. |
| AR-051–054 | Native observations and bounded equal-work comparisons. Live features, provider cache reuse and billed cost are not measured. Eager layout fails hard eviction; naive layout is an unexecuted counterfactual, not equivalent model behavior. Independent negative traces are counted separately. |
| AR-055 | The prebuilt native reference executes the program/control/protocol/recovery paths without a compiler, JS adaptive runtime, authoring source or helper service. New standalone-distribution polish is deferred. |
| AR-056–059 | Existing addNativeSystem/shared assets, appropriate test roots, retained lanes and compiler-free source accounting. No per-profile compiler, second evaluator or retired campaign is introduced. |
| AR-060 | Keep the 300-second complete-workflow target and 360-second maximum; report exact subjects, cache regimes and any unresolved overrun. Historical cold/warm/edit observations are distinguished from current provisioned qualification. |
| AR-061 | Human CLI and stdio feed the same compiled adaptive program and native World/task owner; there is no second adaptive backend or dual-runtime gate. |
| AR-062–064 | Disabled-inference configuration validation, current-subject evidence and honest gaps; no unauthorized merge, release, paid call, credential discovery or real-repository mutation. |
| AR-065 | Reuse existing native/environment/build infrastructure and admitted dependencies. External build/test/client tools are not agent launch dependencies; no language-purity rewrite or new platform is required. |
| AR-066–069 | Immutable task authorization, subordinate inference selection, explicit epoch provenance and separate materialized/callable sets. |
| AR-070–071 | Original captures re-interpret without current-state substitution; the authored inbox consumes identified inputs once at settled boundaries independently of control revision. |
| AR-072–074 | Bounded retained objects and allocations, actual transient-prefix divergence/unload, settled archive closure and pure original-capture validation without I/O. |
| AR-075–076 | Existing native discovery/client schemas and fixed-consumer checks. Exact image/resource/runtime bindings prevent implicit state grafting or task migration. |
| AR-077 | One native adaptive implementation passes independent feature, captured-wire, capability and recovery evidence. The removed JS-v6 differential implementation is superseded, not an outstanding prerequisite. |
| AR-078–080 | Linux-only restrictions, unchanged compiler/backend/cache policies and dispatch/capture reservations; optional diagnostics/usage cannot authorize retries or invented savings. |

## Completion states and remaining limits

| State | Evidence required / scope |
| --- | --- |
| Adaptive program implemented | Reusable authored controls/contracts/responder plus the deciding consumer and emitted BPI3; source and authored/native tests. |
| Native reference integration qualified | Exact-head retained Linux checks, real controlled I/O/recovery/archives and current review convergence. |
| Live features qualified | Original merged subject: unqualified. Later authorized campaign: see the exact repaired subject and feature dispositions in the live report. |
| Cache measured | Later live campaign reports actual cached-input usage separately for Sol/medium, Sol/high and Astra/medium; controlled fixture and local-prefix measurements remain separate evidence. |
| Single-binary distribution | New distribution work is deferred. The existing embedded reference executable is available and exercised; no new package, shell or release is required. |

The observation report separates byte counts, optional usage, local prefix
comparisons, controlled-server time, trajectory time, negative-probe calls,
allocator requests and namespace growth. One sample establishes neither p99
latency nor a deployment memory bound. No speedup is inferred from deleted code.
Only the proposed projection runs the deciding workload; eager and naive layouts
are unexecuted byte comparisons. No pricing is supplied, so billed cost is
unavailable. Source bytes are not token or cache savings.

Runtime dependencies retain SQLite/C shim/libc/OS facilities. Zig and setup
utilities are build dependencies; existing JS/Python controllers and optional
protocol clients are external. Existing non-adaptive JS/WASM products remain
supported. macOS execution, exhaustive schedules, all maximal input combinations
and alternative-prompt behavior remain outside these finite reference checks.
