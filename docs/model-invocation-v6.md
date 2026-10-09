# Adaptive Responses contract (v6)

`agent.model.invoke.v6` adds separately bound inference selection and context
projection to the existing model/responder owner. It does not change v3, inline
v4, or the fixed-profile v5 contract. The reference consumer is
[`adaptive-agent`](../examples/adaptive-agent/README.md).

## Ownership and identities

| Value | Meaning and owner |
| --- | --- |
| Frozen task profile and ordered resources | Existing native grant identity, or the separately bound JS task store. Contains the approved universe and limits for this task. |
| `AdaptiveSelection.profile_id/profile_digest` | One approved inference entry; the digest covers its ordinary encoded value. It cannot replace the task policy. |
| `control_revision` | Authored configuration revision. Separate from native task revision, message ordinal, provider call ID, and physical attempt count. |
| `AdaptivePlan.epoch/watermark` | Explicit projection lineage and committed response position. |
| `eviction_generation` | Authored exclusion fence. Every newly selected lineage must respect it. |
| `AdaptiveContextReference` | Content reference plus schema, policy, inference selection, task, tenant, audience, epoch, watermark, and eviction bindings. |

The additional identities are `agent.model.context.responses.adaptive.v1`,
`agent.model.policy.adaptive.v1`, and `agent.model.seed.adaptive.v1`. The v5
`agent.model.context.responses.v1` reference is not an adaptive reference.

## Requests and checked actions

`P.AdaptiveRequest` contains the ordinary invocation, frozen policy digest,
selection, projection plan, materialized mask, offered mask, and settled tool
results. `defineAdaptiveModelObserved` derives definitions from the compiled
catalog and captures the original offered set with the continuation.

The three sets have distinct meanings:

- **C:** compiled action variants, schemas and codecs;
- **D:** definitions materialized from C by the core and loaded skills;
- **O:** actions currently callable, within D and the active frozen permissions.

Retaining a definition does not retain its execution permission. The responder
admits against original O. Application work additionally binds to the original
captured call, task, snapshot and exact native resource role. The adaptive
model identity remains protected against raw model-effect authoring bypasses.

An inference profile explicitly declares its model, efforts, reasoning mode and
context, feature flags, opaque-family label, output-token maximum, byte bounds
and timeout. No feature is inferred from a model-name prefix. The example
rejects `effort_update: true`; its effort-only changes use the named
`effort_change` epoch fallback. The generic projection represents an approved
configuration update without rewriting the original top-level effort, but that
immediate tool-continuation API combination is not live-qualified here.

## Projection and eviction

The core instructions and metadata remain fixed within a task. Work results,
user input, tool additions and resident bodies appear at their actual history
positions. Transient bodies are appended after committed history and are not
copied into it. Their subsequent movement therefore limits the genuinely
unchanged visible prefix.

Explicit caching places a marker on the epoch core and the latest newly
appended eligible input-text block, including eligible tool-result content.
Earlier markers retain their positions. At most two new marker positions are
selected in one request; no marker is inserted into `additional_tools` or opaque
provider items. Transient suffixes follow all selected boundaries. The field
locations and diagnostic comparison request follow the official
[prompt-caching guide](https://developers.openai.com/api/docs/guides/prompt-caching)
and [diagnostics guide](https://developers.openai.com/api/docs/guides/prompt-caching/diagnostics).
These documents do not establish live acceptance or a cache hit.

Resident deactivation removes offers while retaining material. Hard unload,
transient deactivation, model changes and unsupported in-place effort changes
use explicit new epochs. A new epoch requires a bound semantic seed and a
settled old call/result group. It carries exact task facts, evidence, outcomes,
follow-ups, allowances and control information, with proposed intent labeled
as a hypothesis. It excludes old opaque reasoning. There is no opaque-family
compatibility shortcut, decrypted reasoning, or covert `replay = null` reset.
An oversized handoff rejects instead of summarizing away required facts.

## Acquisition and replay

Native execution reuses `CaptureAdapter.prepare/acquire/interpret` and the
existing task owner. Preparation fixes the exact request, selection and plan.
Dispatch charges a durable physical attempt. Capture is committed before pure
interpretation; reply, context objects and reported usage are then committed
before World consumes the reply. An application can narrow the native host's
attempt ceiling through a pure frozen-profile callback; this dispatch check is
not applied to historical capture replay.

The JS implementation uses the same image and generated wire layouts, the
existing `WorldAdmission` executor, and a distinct local storage realization of
that lifecycle. It never writes native namespaces. Reopening validates original
captures against saved projections. A lost process after dispatch without
capture leaves unknown delivery; no adapter silently retries it.

`P.AdaptiveResult` separates normalized result, replay reference/disposition,
and optional usage. Exact provider bytes remain a `CapturedResponse`, while the
adaptive context records the original prepared request and capture. The replay
grammar is closed, preserves call/result pairing and admitted phase/opaque
fields, and rejects provider-created tool additions. The aggregate reply limit
can return `normalization_limit` with retained usage and no replay, independently
of raw response and individual-field bounds.

JS v6 adds its closed grammar around the existing JS typed-argument normalizer.
It handles native-compatible omitted empty annotations and the one-refusal
projection without changing legacy JS v3/v4 admission. Multiple function calls
are rejected before adaptive replay. Legacy v3 intersection results alone are
not evidence of adaptive support.

## Bounds and observations

The example admits 1–16 charged model attempts, 0–16 control revisions,
14 approved skills, four active skills, 32 KiB per body, and 128 KiB of skill
bodies. Snapshot, bodies and catalog together fit the native 16 MiB frozen
resource ceiling. It retains at most eight evidence references, 12 work outcomes,
16 control receipts, and four answers/follow-ups combined. These are independent
ceilings, not a promise that every maximal field combination fits a request.

Provider requests are at most 256 KiB and responses at most 512 KiB. The
normalized adaptive reply is at most 16 KiB; its raw capture is retained on
projection overflow. Handoff fact text is at most 8 KiB. Existing native
64 MiB requested allocation, 16 MiB worker and SQLite budgets, and 256 MiB
namespace limits remain unchanged. The Node/WASM reference uses the locked
64 KiB input/output and 1 MiB working limits. Protocol frames, checkpoint size,
working memory and namespace quotas are separate limits.

Read-only observations record actual byte counts, selection/epoch identities,
skill residency, D/O identities, marker positions, local visible-prefix equality,
returned model/context when supplied, optional usage, and bounded diagnostic
kind/reason/counts. Missing, null and zero usage are distinguished in the
observation report. Diagnostic counts are separate from billing usage and
cannot alter task success, trigger an extra request, or authorize a fallback.
No price or provider cache saving is inferred from fixture data or local bytes.

See the [acceptance map](adaptive-responses-acceptance.md) for executable proof
surfaces, artifact subjects and remaining qualification limits.
