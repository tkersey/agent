# Release line

The initial exact targets were Boundary v1.0.0 and World v3.0.0, with no source
changes expected in either upstream repository.

Implementation produced two concrete obstructions:

- Boundary v1.0.0 could not faithfully lower every required runtime-authored
  `Failure` value and its compiler limits could not admit the required staged
  strategy programs.
- World v3.0.0 structurally admitted the resulting Machine after shared-module
  wiring, but its owned application provenance still recorded Boundary v1.0.0.

The release owner authorized the smallest upstream correction releases. The
current compatibility line is Boundary v1.3.2 and World v3.1.1. Boundary
Machine ABI v2, World Application ABI v1, World Frame v1, Effect protocol v1,
world-host v1 runtime semantics, and the one-pending-effect restriction remain
unchanged. Public world-host v1.0.1 changes release packaging and metadata only;
it preserves v1.0.0 runtime behavior.

Release receipts distinguish two temporal claims:

- `agent_boundary_changes_required=true` and
  `agent_world_changes_required=true` record the historical work required to
  resolve the obstructions.
- `agent_additional_*_changes_required=false` records that no further upstream
  changes are required by the released Agent package.

Agent v1.0.1 supersedes the ambiguous v1.0.0 receipt wording. This correction
changes provenance metadata and its reproducible proof; it does not introduce
another runtime, reducer, state format, ABI, Frame, or capability implementation.

Agent v1.1.0 adds the repository-repair actuality witness and provider-neutral
decision contract while preserving the same Machine, Application, Frame, and
Effect protocol ABIs.

Agent v2.0.0 adds an explicit EpistemicStrategy compilation axis, bounded typed
Memory, deterministic DecisionView projection, and digest-bound `AGT_DCT2`
static decision contracts. It remains on Boundary v1.3.2, Machine ABI v2,
World v3.1.1, Application ABI v1, Frame v1, world-host v1.0.1, and Effect
protocol v1. world-capabilities v2.2.2 changes only application-specific
decision codecs, contract artifacts, bindings, and rendering.

Agent v2.2.0 carries the router-policy adequacy application and consumes
Boundary v1.5.0 and World v3.1.3 without changing Machine ABI v2, Application
ABI v1, Frame v1, or Effect
protocol v1. The exact Agent v2.0.0 adequacy obstruction remains historical;
the successor tuple is the correction line.

Agent v2.3.0 adds typed, effect-free action admission before an effect action
reaches its declared site. Custom EpistemicStrategies may inspect current
Memory and the selected Action; denial produces the definition's typed
`invalid_variant` failure before `flow.perform`. Implementations that omit the
hook retain the v2.2.0 admit-all behavior. Machine ABI v2 and `ABL_RNF2` remain
unchanged.

Agent v2.4.0 exposes Boundary's existing pure `text_compare` operation as the
typed `Flow.textCompare` authoring seam. Custom strategies can compare bounded
UTF-8 Text values without bypassing Flow or adding an effect. Native and WASM
Machine behavior remain byte-identical; Machine ABI v2 and `ABL_RNF2` are
unchanged.

Agent v2.5.0 saturates generated Flow value and block authoring buffers at the
existing Boundary v1.5.0 compiler ceilings. A custom EpistemicStrategy may use
its declared lowering complexity without causing Agent to request an impossible
Boundary compiler envelope. It may also specialize pre-effect admission by the
compile-time action index so an exact predicate is lowered only at its owning
site. A strategy may explicitly mark a specialized site as statically admitted,
which omits the dead runtime admission branch; the existing global hook remains
the required fail-closed fallback for specialized declarations. Actual Control
IR must still fit Boundary's unchanged ceilings; Machine ABI v2 and `ABL_RNF2`
remain unchanged.

Agent v2.6.0 makes action metadata class admission eager at the public
descriptor-construction boundary. Effect, final, and fail descriptors resolve
their metadata class as `agent.action.Class` before returning the descriptor
type, so foreign enum values cannot bypass admission through Zig's lazy
declaration analysis. Contextual enum literals and the default `.custom` class
remain supported; Machine ABI v2 and `ABL_RNF2` remain unchanged.
