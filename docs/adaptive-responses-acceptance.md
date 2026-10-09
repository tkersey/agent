# Adaptive Responses Agent v1.2 acceptance

The specification is implemented as one additive application and v6 model
contract. Qualification is Linux-only. The deciding workload uses real
Responses function-call records with two distinct fixture model IDs, eight
control transitions, resident and repeated transient use, hard eviction,
questions, read-only work and a report. It uses 14 model calls and five work
actions; fixture calls are not live-provider evidence.

## Subjects and receipts

The foundation is Agent `7d86739af1a47ce8ec36905ba5fe578fa3ce4d9d` (PR #45).
Boundary remains `c49f743382257c7cf5512934ae3a2d0f56d4d4c0` and World remains
`35f11b811b03fcaa2d696265ff8d9b9c92c8fc95`. The existing locks select Zig 0.17.0,
its authenticated library inventory, the delivered World runtime, and SQLite
3.53.4. The qualification workflow verifies these inputs rather than repinning
them.

The PR's complete **Zig 0.17 qualification** run binds all checks to its exact
head. Focused runs establish only their selected lane. Retained artifacts are:

- `native-reference-Linux-X64-HEAD-ATTEMPT.tar.gz`: executed copied native
  applications, observed build manifests, runbooks and the existing stdio client;
- `adaptive-node-wasm-HEAD`: the executed source-independent use archive,
  package receipt, checksums and `adaptive-observations.json`;
- each native manifest binds binary, image, assets, dependency and compiler
  identities; the use-archive receipt binds the actual packaged bytes;
- `adaptive-observations.json` records `source_head`, actual captured workload,
  per-call identities and sizes, and the bounded layout comparison. It contains
  no raw prompts or opaque reasoning.

The first complete passing integration subject was
[`d00ee24f0c3389ad59b92fed16aceab13832ae6e`](https://github.com/tkersey/agent/actions/runs/37891742767),
with the earlier 13-call workload: 311 seconds from workflow creation through
completion, above the 300-second target and below the 360-second maximum.
It passed 120 authoring tests, 117 native tests, the external installation, the
public downstream recipe, copied binaries and extracted Node/WASM execution.
This historical measurement is not a timing guarantee for later heads or the
extended 14-call workload. Current artifacts and the PR checks identify the
later subjects and measurements.

## Executable proof surfaces

| Name | Scope |
| --- | --- |
| `adaptive_controls.zig` | Actual authored control computations: model/effort, stale revision, unknown/version/operation rejection, idempotence, deactivation and eviction. |
| `adaptive_responses.zig` + `adaptive-responses-v1.json` | Native pure projection, shared independent provider/replay/usage corpus, original context binding and aggregate capacity. |
| `adaptive_provider.mjs` | Same corpus through the real JS adaptive adapter, exact integer/Unicode contracts, D/O, pairing and eviction. |
| `adaptive_recovery.zig` | Same generated application through native task storage; reopen after raw unload capture before interpretation; complete without redispatch; narrowed physical attempt ceiling. |
| `adaptive_application.mjs` + test-only capture child | Existing packager, extracted runtime and actual WASM image; real process kill after durable capture; original replay, three consumed messages, one retained unconsumed message, question binding and final output. |
| `adaptive_native_peer.mjs` | Copied binary, controlled HTTPS, held-I/O messages/status, frozen identity, killed parked host, settled export/import, missing/tampered capture rejection, byte-exact JS reinterpretation of native projections. |
| `adaptive_measurements.mjs` | Actual trace observations and three bounded offline layout counterfactuals. No alternative live inference, fabricated token counts or cache-hit claims. |
| Existing retained roots/peers | Fixed v3/v4/v5 and repository consumer, protected admission, argument codecs, native protocol/client schemas, snapshot, namespace, reservations, capture/archive, cancellation and deployment boundaries. |

These files are under `test/agent4`. Adaptive tests use the existing shared
fixture compiler, native test root and native peer; there is no per-profile
compiler, new workflow lane, or restored economy/browser campaign.

## Requirement dispositions

“Covered” below means the named finite deterministic checks and source-owned
invariants, not exhaustive scheduling, arbitrary-provider behavior or formal
verification. Live exceptions are explicit.

| IDs | Disposition and evidence |
| --- | --- |
| AR-001 | Covered: unchanged dependency locks and mandatory source/runtime/native authentication in the complete workflow. |
| AR-002–003 | Covered: one `definition.zig` computation, actual checked function calls, shared image in both environments. |
| AR-004–006 | Covered with two **fixture** model IDs and independent effort change; held-I/O follow-up cannot mutate the acquired request. Real model feature acceptance is not run. |
| AR-007–010 | Covered: authored rejection/idempotence tests, original offered-set/batch admission, recoverable control receipts, explicit admitted-versus-executed wording. |
| AR-011–012 | Covered: compiled C, materialized D and original O remain distinct; exact role/schema/resource grants and captured-call work admission remain in force. |
| AR-013–014 | Covered: immutable catalog/body digests, UTF-8 and capacity checks, bounded no-follow file admission. This deployment admits 14 approved skills within the unchanged 16-resource host ceiling. |
| AR-015–018 | Covered: resident append, retained deactivation, eligible markers before repeated transient suffixes, and explicit hard-unload epochs. |
| AR-019–024 | Covered: core/shared permission union, eviction fencing on profile return, removal of opaque state, exact-version control cases, no executable skill installation, metadata-only core catalog. |
| AR-025–030 | Covered: additive identities and protected admission, separate raw/normalized records, closed lossless replay grammar, shared corpus, exact codecs, no unresolved-call reset. |
| AR-031–033 | Generic authored/projection representation is covered. The application rejects in-place updates and uses the named new-lineage effort fallback. Immediate tool-only API update qualification is **not run**. |
| AR-034–036 | Covered: conservative visible-fact handoffs preserve exact admitted facts/allowances and label hypotheses; no cross-model opaque compatibility is assumed. Oversized handoffs reject. |
| AR-037–038 | Covered request construction: supported input-text marker locations, retained historical boundaries, at most two new writes, no transient suffix markers, explicit cache/diagnostic fields. Live API acceptance is **not run**. |
| AR-039–040 | Covered: local byte-prefix metrics are labeled, prewarm/compaction counts are zero, and there is no automatic model substitution or ambiguous retry. |
| AR-041–042 | Covered for the bounded deciding workload and explicit refusal limits: measured state/preparation/allocation/storage sizes, existing reservations/namespace ceilings, original-reference binding and missing-reference rejection. Maximal combinations are not advertised as guaranteed to fit. |
| AR-043–046 | Covered: acquired-before-interpreted native reopen, real Node kill and recovery, unknown-delivery fencing, original pure projection replay, once-only accounting and frozen physical attempt limits. Required-artifact deletion blocks; it does not reset or redispatch. |
| AR-047–048 | Covered source boundaries: all context resources remain task-owned and enter native archive closure; JS state has no mobility/namespace-conversion promise. Explicit private credential inputs are excluded from frozen resources and logs. No real credentials were discovered or used. |
| AR-049–050 | Covered deterministic trace and production construction: fixture selection requires explicit offline mode; ordinary live tasks use actual Responses calls and the same authored program. Live task quality is **not evaluated**. |
| AR-051–054 | Implemented observations and bounded comparison. Live features, cache reuse and billed cost are **not run/measured**. Eager layout fails hard eviction; naive layout is an unexecuted rendering counterfactual. Equal model behavior is not claimed for either. |
| AR-055–059 | Covered: copied standalone native binary, extracted Node/WASM package, existing build helper/shared assets, retained lanes and compiler-free preflight. Legacy campaigns were not restored. |
| AR-060 | Measured per workflow; 300-second target and 360-second maximum are unchanged. Report each exact subject, cache state and any overrun. The existing manual build-measurement switch supplies cold/warm/resource-edit samples separately. |
| AR-061–064 | Covered dual-image integration, disabled-inference validation, subject-bound artifacts/PR disclosure and authorization limits. No merge, release, paid call or real-repository mutation is part of qualification. |
| AR-065–069 | Covered: original native runtime/store/protocol/build owners, immutable task authorization, subordinate selection, explicit epoch provenance and D/O separation. |
| AR-070–071 | Covered: original captures re-interpret without current-state substitution; real authored inbox consumes identified inputs once at settled boundaries, independently of control revision. |
| AR-072–074 | Covered bounded retained objects, allocator/storage observations, actual transient prefix divergence and eviction, settled archive closure and pure capture validation without I/O. |
| AR-075–076 | Covered existing native discovery/client schemas and fixed-consumer checks; adaptive identities and exact artifact gates prevent implicit old-task migration. |
| AR-077 | Covered common independent corpus plus exact native/JS committed projection comparison. Adaptive JS compatibility handling leaves legacy v3/v4 behavior unchanged. |
| AR-078–080 | Covered Linux-only execution restrictions, unchanged compiler/backend/cache policies, existing dispatch/capture reservations, and diagnostics/usage that cannot trigger retries or invented savings. |

## Performance and qualification limits

The retained measurement report separates request/response bytes, optional token
fields, local prefix comparisons, controlled-server time, end-to-end scenario
time, allocator requests, World working memory, OS process high-water RSS and
namespace object/database growth. They are different measurements. One CI sample
does not establish a p99 or a deployment memory bound.

The comparison keeps the recorded work/control workload and offered actions
constant. Only the projected policy is executed; the eager and naive layouts
measure rendering differences without extra model calls. No pricing was
provided, so billed cost is unavailable. Source byte savings are not token or
cache savings.

Live API qualification requires separate current model/data/spend authorization.
It must use two approved real model IDs and record actual feature acceptance,
usage and cache regimes. macOS execution is excluded. Exhaustive schedules,
all maximal input combinations and alternative-prompt behavior remain outside
these finite reference checks.
