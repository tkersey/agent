# Recursive participant integration

Implementation of Defunctionalized Hyperfunctions and Recursive Interaction
v1.1 (September 19, 2026), still incomplete. Boundary companion:
https://github.com/tkersey/boundary/pull/153. Agent draft:
https://github.com/tkersey/agent/pull/33.

## Foundation

Boundary #152, World #54, Agent #32 are merged. Immutable follow-on bases:
Boundary c7a08ed7c1e15732fc7373dd1f149cbe7da82e7b,
World 374ed712c2a2ab5041c28befa38bb3c3a859bd26,
Agent e1b56f06ce0d91a8d7f324198a541f0b16b55a00.
The normal authenticated Boundary dependency now selects
`b604ae828650a9be176b103552942adaafc983c0`, including suspended invocation and
state-based reciprocal constructors. Its downloaded source tree was recomputed
and matched to GitHub commit tree `45d214c586a30762b55d5c9fc4445d3f3d108f72`;
the archive bytes, API files, Zig package hash and both package inventory profiles
are bound in the existing lock. The World dependency and kernel remain unchanged.
Inherited economic dispositions remain scoped to the foundation. No new
performance waiver or live-model quality claim is made.

## Checked internal participants

`agent.participant.declare` installs a BMO1 object and exact function/effect
bindings into Agent's existing compilation owner. It returns a normal source
function declaration. The component is not a model-visible tool.

Boundary independently checks the object code, schemas, ownership and imported
borrow assumptions. Agent inspects every object effect, direct operation and
handler, including locally hidden code. Direct external work is limited to
registered read/simulation effects. A model effect may appear in an imported
helper's row but the object cannot directly perform or handle that effect.
The component must instead call an actual checked Agent responder function.
Agent traverses each bound source helper using its normal protected-admission
walker. Binding a name or a declared row never substitutes for inspecting code.

The normal `agent.compile` path performs these checks before source-free linking.
The linker verifies actual helper signatures, residual effects and code-derived
borrow guarantees against object assumptions, then produces the ordinary closed
Program. Object bytes and bindings are copied before publication into the registry;
caller mutation cannot substitute a different implementation afterward.

Assessment inspects all object effects under its allowed environmental policy,
checks callable origins in source input/result captures, and traverses bound helper
bodies. A helper capable of writing at an ordinarily authorized source site is
rejected in assessment. Unallowed model access is rejected too. The original
compiled-tool profile and its independent rejection tests remain intact.

The initial supported participant profile has one entry per installed instance,
function/effect imports, and one-shot control. Multi-shot object control and
resource-bearing assessment objects remain conservatively rejected pending the
required custody proof. These are incomplete portions of v1.1, not claims of
complete recursive participant support. Other component symbol kinds are not yet
exposed through this path. Ordinary source capabilities remain available.

## Executed first production slice

`test/agent4/participant.zig` independently emits a producer object with a typed
model-helper import. A separate process reads only its BMO1 bytes and links it to
`responders.defineModel`, through normal `agent.compile`, with ordinary
`model_invocation.Profile` request, result and interpretation schemas.

```
zig build check-participants participant-images --summary all
node test/agent4/participant.mjs WORLD_ENTRY KERNEL zig-out/agent4/participant
```

`WORLD_ENTRY` is the baseline World's `src/embedding/index.mjs`; `KERNEL` is its
`zig-out/world-kernel.wasm`, built by `zig build build-kernel
-Doptimize=ReleaseSafe`. On Zig 0.16.0 and the unchanged baseline kernel SHA-256
`7a27d64295431c960046439353a158e378f14d4686fac47b61b1406cf1753663`, the 1,790-byte
Program issues one actual `agent.model.invoke.v3` request. The test transfers
World's actual State bytes into a fresh WASM instance, supplies a request-bound
synthetic provider response, and receives the expected admitted contribution 42.
The source handle is invalidated and its working memory released. There is no
paid inference, host continuation, or transcript reconstruction.

Focused negatives reject direct protected model emission, missing assessment
allowance, write-capable helper substitution and incompatible helper results.
A separate test verifies owned object bytes survive caller mutation. Existing
compiled-tool tests retain the rejection of model-named read-tool aliases.
These observations establish model admission and fresh recovery, not yet the
required reciprocal application episode or an independent empirical experiment.

## Compiled reciprocal task endpoints

`test/agent4/recursive_participant.zig` now uses the public Boundary `ana` and
`Query.ask` operations with endpoints that are suspended tasks. Pure construction
creates task descriptors; explicit task invocation executes environmental work.
The resulting image contains the participant relationship and every waiting
caller. The host only supplies declared leaves.

Separate emitter processes produce a producer object and either of two consumer
objects. The same producer object, SHA-256
`304956a6e15862001284ecd3d840691d672e930eb4b177004e512a84239c32c2`
(891 bytes), is passed unchanged to both source-free links. The second consumer
requests two contributions; no producer code or host routing change selects it.
Authored step selection occurs during component emission, never by inspecting a
runtime peer identity. This fixture does not yet demonstrate removing all authoring
sources/emitters before linking; that broader isolation check remains open.

The single-consumer episode is:

1. The consumer requests a producer contribution and waits.
2. The producer requests a contribution from the consumer's successor and waits.
3. The successor requests a real bounded reference-file read.
4. After fresh recovery, the producer uses the checked model responder, then
   performs its non-tail addition; the original consumer performs its own addition.
5. An independently owned generator package, idle throughout the nested work,
   resumes and makes a second real read before final completion.

The reference adapter reads the actual frozen fixture bytes. Provider responses
are synthetic untrusted proposal data admitted by the real model interpreter.
The single consumer returns 85; the double consumer returns 157 and makes two
fresh model/reference executions. Replaying the first bound model reply against
the second occurrence rejects without changing the waiting checkpoint. The same
provider call ID in fresh responses does not establish occurrence authority.

The existing generator package is the retained sibling ownership witness; this
is not yet a completed owned-hyperfunction exchange/disposal API. Likewise, this
slice uses pure recursive demands over task values; the explicit `Need` effect
handler translation remains required.

## Current transfer and admission evidence

`zig build check recursive-participant-images --summary all` passes 203/203 steps
and 122/122 tests, including the normal package-installation check. Focused
participant/image checks pass 23 steps and nine tests. New nearby negatives reject
an exclusive resource hidden in a reusable task, an omitted reference binding,
and completion write authority substituted through the actual recursive component
path. A permitted assessment case passes beside the authority negative.

| Consumer | Program bytes | Node/fresh transfers | Observed checkpoint bytes |
| --- | ---: | ---: | --- |
| Single contribution | 3,081 | 3 | 316, 586, 124 |
| Two contributions | 3,277 | 6 | 346, 763, 511, 327, 597, 124 |

The double-contribution program also passed exact boundary agreement across native
World, Node/WASM, Wasmtime 48.0.0 (Python 3.14.7), Chromium 153.0.8010.12 Workers
and Firefox 155.0 Workers. Each engine's actual returned bytes are selected for
subsequent execution. Each browser run destroys eight fresh Workers, including
the separate cancellation execution. These are finite observations, not a
performance comparison or universal portability proof.

A separate execution cancels the enclosing World session at the inner reference
request, after fresh transfer. All tested engines return cancellation with reason
`stop`, no cleanup failures, and no ordinary model/sibling work afterward. This
does not establish scoped local disposal or suspending resource cleanup; those
remain separate required cases. No external reference operation is dispatched in
that cancelled fixture execution; arbitrary external cancellation is not claimed.

Run the emitted images with:

```
node test/agent4/recursive_participant.mjs WORLD_ENTRY KERNEL \
  zig-out/agent4/recursive single
node test/agent4/recursive_participant.mjs WORLD_ENTRY KERNEL \
  zig-out/agent4/recursive double WASMTIME_PEER NATIVE_TOOL BROWSER_TOOLS chromium
```

Repeat the last command with `firefox`. `WASMTIME_PEER` is the unchanged World's
`test/current/peer.mjs`; `BROWSER_TOOLS` is its locked
`test/current/browser-tools` directory. The native tool is built with World's
existing `test/v2/build_source.zig`, `-Dcurrent-fixtures=true`,
`-Dworld-source=WORLD_SOURCE`, `-Dboundary-source=BOUNDARY_SOURCE`, and
`-Doptimize=ReleaseSafe`. This run used World
`374ed712c2a2ab5041c28befa38bb3c3a859bd26` and the authenticated Boundary
`b604ae828650a9be176b103552942adaafc983c0` source. The kernel SHA-256 remains
`7a27d64295431c960046439353a158e378f14d4686fac47b61b1406cf1753663`.

## Remaining implementation

The complete hyperfunction algebra and lazy aggregates, effect-based demand
translation, source-independent support library and three-part compositional
closure, local disposal with suspended cleanup, multi-shot custody and allocation
failure sweeps remain unfinished. The incremental-parser synthesis application,
independent acceptance, consumer-supplied assessment, exact delivery, full required
transfer variants, structural economy, matched comparisons and serial reviews
remain required. No live-model quality or cost study has run. The numerical
model/reference witness is the integration foundation for that application, not
its completed substitute.
