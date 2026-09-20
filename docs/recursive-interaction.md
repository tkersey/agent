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
`894359086952c314b2c18b0854e3f6f35ff970e8`, including the pure algebra and
lexical internal-demand interpretation. Its downloaded source tree was recomputed
and matched to GitHub commit tree `1f574225c99dcc9e5b8f3cfca2e9fb2697ffc3d1`;
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
`090c104a780cce5e315f3d025a0c8d7408fb2353c0a0207fdc412cd76800924d`
(1,086 bytes), is passed unchanged to both source-free links. The second consumer
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
slice now interprets explicit lexical `Need` effects over task-valued endpoints.
The generic library handler owns counterpart invocation and resumes each actual
waiting one-shot requester. Repeating a request creates a fresh continuation;
there is no multi-shot activation of one capture.

## Current transfer and admission evidence

`zig build check recursive-participant-images --summary all` passes 204/204 steps
and 122/122 tests, including the normal package-installation check. Focused
participant/image checks pass 23 steps and nine tests. New nearby negatives reject
an exclusive resource hidden in a reusable task, an omitted reference binding,
and completion write authority substituted through the actual recursive component
path. A permitted assessment case passes beside the authority negative.

| Consumer | Program bytes | Node/fresh transfers | Observed checkpoint bytes |
| --- | ---: | ---: | --- |
| Single contribution | 3,461 | 3 | 646, 1012, 124 |
| Two contributions | 3,496 | 6 | 654, 1020, 631, 668, 1034, 124 |

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

Broader pure-law/generated agreement, source-independent support library and three-part compositional
closure, local disposal with suspended cleanup, multi-shot custody and allocation
failure sweeps remain unfinished. The incremental-parser synthesis application,
independent acceptance, consumer-supplied assessment, exact delivery, full required
transfer variants, structural economy, matched comparisons and serial reviews
remain required. No live-model quality or cost study has run. The numerical
model/reference witness is the integration foundation for that application, not
its completed substitute.

## Independent incremental-parser acceptance

`fixtures/incremental-parser-v1/batch.mjs` is the stateless batch reference supplied
as immutable task evidence. It preserves arbitrary bytes, escaped delimiters,
empty fields/records, strict LF termination, prefix records before errors, and
absolute InvalidEscape/DanglingEscape/UnterminatedRecord offsets. It rescans a
prefix; it is not a correct incremental replacement under the retention contract.
The adjacent requirements describe the public candidate interface and closed-call
behavior without supplying a preferred patch.

`runtime/parser_oracle.mjs` derives per-feed observations from that reference.
The default reproducible seed is `0x13579bdf`. Its 536 traces include every two-way
split of fixed and generated byte samples, empty chunks, byte-at-a-time feeds,
valid and invalid inputs, repeated finalization and input after termination.
Hand-derived tests check concrete records and error offsets separately. These
are finite observations, not a proof about every byte string.

`runtime/parser_executor.mjs` reuses the existing qualified Seatbelt facility via
a fixed parser driver. No arbitrary caller-supplied driver or unsafe fallback is
added. Each candidate feed call runs in a fresh JavaScript realm initialized only
from the previous serialized state. Only primitive serialized results leave that
realm. The driver measures the actual serialized state; the parent owns expected
observations and acceptance. Candidate code cannot supply trusted occurrence
counters, memory counts or verdicts, and cannot import or edit the evaluator.

The parser profile limits source to 8,192 bytes, logical traces to 4,096 calls and
262,144 input bytes, serialized trace transport to 2 MiB, returned state to
131,072 bytes and total output to 1 MiB. Default OS execution timeout is 10 seconds,
with the existing 64 MiB old-space/8 MiB semi-space limits. Timeout, malformed
output and unavailable isolation do not pass acceptance. The original Inquiry
profile retains its 16 KiB trace transport and default limits.

Executed on the qualified macOS profile:

| Test-only candidate | Semantic traces | Acceptance | State observations |
| --- | ---: | --- | --- |
| Incrementally decoded fields | 536/536 | Pass | 88-byte completed-history peak; 24,658-byte unfinished-field peak |
| Deferred raw-record decoding | 536/536 | Pass | 63-byte completed-history peak; 24,634-byte unfinished-field peak |
| Reject all | 1 before rejection | Reject | Wrong observations |
| Buffer until EOF | 4 before rejection | Reject | Missing immediate emissions |
| Incorrect error offsets | 30 before rejection | Reject | Wrong absolute offset |
| Module-global state | 1 before rejection | Reject | Fresh-context and closed-state violation |
| Retain completed history | 536/536 | Reject | 13,600-byte retained history exceeds the 2,048-byte fixture limit |

The retention cases feed 500 bounded complete records and an 8,192-byte unfinished
field. Growing unfinished data is legitimate; accumulated completed history is
not. The two accepted implementations are independently written test strings in
`test/consumers/incremental-parser/candidates.mjs`. Production validators, task
evidence and prompts do not import them. No candidate was executed outside the
qualified facility. The check used 1,650 physical candidate executions and two
isolation qualification executions.

Executed commands:

- `node --test test/agent4/parser_oracle.test.mjs`: four tests pass.
- `node test/agent4/parser_executor.test.mjs`: all seven expected dispositions pass.
- `node test/agent4/parser_protocol.test.mjs`: forged verdict/import rejection,
  real timeout and pre-cancelled zero-execution checks pass.
- `node test/agent4/inquiry_executor.test.mjs`: existing Inquiry executor regression
  passes (183 physical executions plus two qualification executions).
- `zig build check --summary all`: 204 steps / 122 Zig tests pass, plus the new
  pure Node oracle checks. `zig build check-parser-executor` reproduces the two
  isolated parser test scripts; the scripts above were executed directly.

This supplies independent real-tool acceptance for the emerging application.
Model-directed fragment construction, version-bound observations, intent handling,
selection/completion separation, exact approval/delivery and the strategy
comparison remain unimplemented. No live-model quality advantage is claimed.

The Need migration removes manual counterpart-forcing sequences from participant
step bodies. Shared generic handler code now performs that work. The single/double
images increased by 380/219 bytes versus the preceding direct-query witnesses;
checkpoint peaks increased by 426/271 bytes. These are representation costs for
the required effect interpretation, not timing results or an accepted economic
waiver. The World kernel and its data/runtime implementation are unchanged. The
existing native fixture binary (compiled against Boundary b604ae8 data) was reused
because no Boundary data or World runtime code changed. Both consumer variants
and the complete four-engine double-consumer/cancellation cases were rerun.

## Parser application protocol and bound tool calls

`agent.parser_synthesis` now defines ordinary typed Subject, Candidate, Trace,
Observation, Probe and Assessment values. Candidate completeness is separate from
validation and confers no approval or delivery authority. The subject binds the
source base, actual reference/requirements digests, executor identity and required
acceptance contract. Reference requests omit candidate code; execution requests
carry the exact source/version, occurrence and probe-or-acceptance operation.

`runtime/parser_tools.mjs` implements only the declared read/simulation leaves.
It verifies frozen subject inputs before execution and checks the actual executor's
source, trace, runner and contract bindings. Partial candidates cannot request
final acceptance. Malformed observations and output-capacity exhaustion remain
explicit unavailable results, not truncated evidence or false success. Test-only
candidate implementations remain outside production imports.

The staged `parser_synthesis.execute` helper checks returned occurrence, candidate
version, operation kind and completeness after World's complete request-envelope
binding. The emitted 463-byte integration Program was executed through fresh
World recovery with a real qualified parser probe. Correct and unavailable replies
return their distinct data; wrong occurrences, versions, operations, stale
unavailable replies and partial-candidate assessment claims take the authored
failure path. This helper is not itself a trusted validation token or approval
construction; the full consumer and delivery path remain required.

`zig build check-parser-tools` builds the normal Agent integration and emits its
portable request/reply schemas. `node test/agent4/parser_tools.test.mjs` passed
reference/probe round-trips, partial acceptance rejection, actual reject-all
assessment, wrong-subject rejection, capacity handling and malformed output cases
(three candidate executions, two qualification executions). The seven World reply
binding cases in `test/agent4/parser_tools_world.mjs WORLD_ENTRY KERNEL` passed
with one real candidate probe. No model-driven parser controller, target write,
or live inference is claimed by this protocol slice.
