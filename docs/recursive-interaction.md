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

## Remaining deciding witness

Next, independently compile a producer and consumer using the same recursive
interface. The producer's request must remain waiting while the consumer requests
an actual reference observation; the model boundary supplies a typed contribution.
Both saved callers must perform distinct non-tail work after fresh restore, with
a second owned participant idle and valid. Add false reusable capture and
compiled completion-authority negatives alongside that positive case.

The complete hyperfunction library, reciprocal source-free composition, parser
synthesis and independent acceptance, local cleanup/global cancellation cases,
full native/browser/Wasmtime transfer, multi-shot custody, failure sweeps,
structural economy, comparisons and serial reviews remain required. The strategy
and any future live evaluation stay opt-in; no live-model study has run.

Current slice validation: `zig build check participant-images --summary all`
passes 185/185 steps and 119/119 tests, including six participant tests and the
external public-package installation check. The final Node/WASM execution above
was repeated against those emitted artifacts. An earlier aggregate invalidated
its installation evidence when source changed during execution; it receives no
credit and was replaced by this stable-input run. No existing assertion or
negative case was removed to admit the new path.

The new Boundary binding passed `zig build check` (185 steps / 119 tests),
`check-participants participant-images` (six focused tests), and the actual
Node/WASM model request transfer. No source override or authentication relaxation
was used. The next application slice will use the newly bound hyperfunction
constructors; this dependency update does not itself establish reciprocal Agent
interaction.
