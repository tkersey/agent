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

## Model-facing construction proposals

`parser_synthesis.proposals` now uses the existing checked model responder for
untrusted fragment, complete-candidate, experiment, constraint and unresolved
proposals. The model cannot assign candidate versions, validated status, approval
or delivery authority. The prompt distinguishes partial source from an unvalidated
complete module, empirical reference questions from genuinely missing intent, and
observations from predictions. It contains no accepted replacement implementation.

The existing model codec intentionally supports flat typed fields. Experiments
therefore specify hex input, first-chunk size, later chunk size, finalization and
a reason. `experimentTrace` checks these fields and expands them into the existing
typed trace, with explicit capacity rejection. It performs no candidate execution.
The execution request now accepts this proposed-probe form; the qualified adapter
normalizes and executes it, and the compiled receiver requires a probe response
rather than an assessment. Malformed proposals become explicit unavailable data.

`zig build check --summary all` passes 238 steps / 123 tests. The 5,080-byte model
interpretation Program was recovered with six synthetic response cases: fragment,
experiment, constraint and unresolved proposals were admitted; unknown and
unoffered actions rejected. A decoded experiment was run against a test-only
candidate through the qualified executor. No provider network call or paid
inference occurred. The updated 501-byte execution-binding Program passed nine
fresh-recovery cases, including a model-proposed experiment and rejection of an
assessment substituted for its result. Existing parser-tool tests also pass.

Reproduce with `zig build parser-proposal-images check-parser-tools`, then
`node test/agent4/parser_proposals.mjs WORLD_ENTRY KERNEL` and
`node test/agent4/parser_tools_world.mjs WORLD_ENTRY KERNEL`. This verifies the
proposal/execution interfaces; it does not claim that the complete recursive
synthesis controller, repair episode, approval/delivery or live provider command
has been implemented. Those remain the next application work.

## First consumer-directed parser construction episode

`test/consumers/incremental-parser/main.zig` is the growing application. Producer,
consumer and reference computations emit separate BMO1 objects. The consumer
invokes the reference participant through the same hyperfunction interface; the
composite remains an admissible consumer. All three link through normal Agent
participant admission and the existing checked model/tool helpers. The host
implements declared leaves only and does not choose peers or reconstruct callers.

The current episode requests a partial escape-boundary construction. Before any
candidate exists, the producer makes a reciprocal Need request; the consumer's
successor invokes the reference participant and waits on actual reference
execution. After fresh recovery, the consumer checks the returned occurrence,
and the producer builds a model request containing the actual observation count.
The model's fragment becomes an application-versioned partial candidate. The
original consumer then runs a real qualified probe and returns its concrete
counterexample. Complete-candidate proposals are not offered at this first step.

The deterministic model response contains an API-shaped but invalid EOF-buffering
implementation. The actual probe observes no record at the feed containing the
terminator and a late record at final EOF. This is a genuine delayed-emission
counterexample, not an unrelated protocol failure or a previously complete
candidate relabeled as a fragment. Test-only source is supplied by the synthetic
provider; the producer and prompts do not import accepted implementations.

The 8,208-byte Program passes native, Node/WASM, Wasmtime 48.0.0, Chromium
153.0.8010.12 Worker and Firefox 155.0 Worker agreement. Each run continues from
selected engines' actual returned bytes, makes four transfers, and destroys five
browser Workers. The environmental trace is reference → model → candidate probe;
the model request is observed only after reference completion. The probe executes
one candidate process under the qualified facility (plus two qualification
processes). No provider network call or paid inference ran.

`zig build check` passes 258 steps / 123 tests. Reproduce the application with
`zig build parser-construction-images`, then
`node test/agent4/parser_construction.mjs WORLD_ENTRY KERNEL`. Optional arguments
`WASMTIME_PEER NATIVE_TOOL BROWSER_TOOLS ENGINE` exercise the existing full engine
harness. This remains the first construction episode: candidate revision,
completion and authoritative full acceptance, retained idle ownership and local
cleanup in this application, assessment policy replacement, exact approval and
conditional delivery are still required. It does not yet complete parser synthesis.

## Revision and complete-candidate acceptance

The construction Program now has an explicit round allowance. The consumer retains
the actual prior report, enters a fresh immutable construction state, increments
the application-owned candidate version and reduces the remaining allowance.
The counterpart receives that current state through its recursive constraint
contribution. Model prompts include the prior source and feedback derived from
the real probe/acceptance result. Complete-candidate proposals are offered only
after the initial partial-construction request.

The frozen reference observation is retained as ordinary data and reused only
while the same task input (subject and trace) is preserved. Its original occurrence
is preserved; no new reference execution is claimed. Every candidate check still
binds the actual source/version and a distinct execution occurrence. Partial
candidates receive probes; complete candidates receive the full authoritative
acceptance suite. A reported pass with zero/missing checks or failed retention
is explicitly unresolved rather than accepted.

The deterministic run refutes version 1's EOF buffering, supplies different complete
source as version 2 through the real model interpretation, and passes all 536
semantic traces plus both retention cases. There are two model requests, one actual
reference request, one counterexample probe and one full acceptance request.
The qualified executor runs 539 candidate processes plus two qualification
processes. Test provider responses are synthetic; production participants and
prompts do not import accepted implementations, and no paid provider call ran.

The final 10,290-byte Program passes native/Node/Wasmtime/Chromium/Firefox boundary
agreement with ten transfers and eleven destroyed Workers per browser run.
Zero rounds produce an explicit unresolved result with no Program environmental
requests or candidate executions. One round preserves a refuted partial report.
A forged passed-but-incomplete acceptance result is rejected as unresolved.
`zig build check` passes 258 steps / 123 tests. Existing qualified evaluator
implementation and check inputs are unchanged.

Run `parser_construction.mjs WORLD_ENTRY KERNEL` for the two-round repair. Its
optional existing engine arguments exercise the same cross-engine harness.
The final optional scenario argument accepts `zero`, `one`, or `incomplete` for
the bounded-stop and forged-report witnesses. The returned report remains ordinary
evidence, not approval or delivery authority. Live target revalidation, approval,
conditional fixture application, intent handling, isolated assessment/completion
control, local disposal/cleanup variants and the remaining comparisons/reviews
are still required before milestone completion.

## Private completion acceptance boundary

Exploratory components now receive `agent.parser.probe.v1`, whose adapter refuses
full acceptance before launching code. Complete candidates return as ordinary
proposals to a private application-owned completion function. That function makes
the authoritative, version-bound acceptance call through `agent.parser.execution.v1`.
Neither the completion function nor that effect is exported to participant objects.
Participant-claimed complete assessment reports are rejected instead of treated as
completion authority. No opaque trusted-component flag or second interpreter is added.

This replaces the prior placement of full validation inside the consumer. It does
not duplicate full checks: normal exploration performs partial probes only. If a
complete candidate fails acceptance, the private owner re-enters construction with
the actual failure report, retained reference evidence, a new version and the
remaining allowance. Successful acceptance still produces ordinary report data;
approval and target application remain separate unfinished work.

A separately compiled malicious consumer returning a forged complete/passed report
is stopped without environmental requests or candidate execution. The probe-only
adapter rejects an acceptance request even when caller options attempt to relax it.
The ordinary two-round repair passes the new boundary, including native, Node,
Wasmtime and Chromium Worker agreement. A three-round case refutes the initial
fragment, rejects a complete parser with wrong error offsets, then validates the
third version. It performs one reference observation, three model requests and
569 candidate executions (plus two qualification executions); no paid inference.
The current Program is 11,354 bytes. `zig build check` passes 261 steps / 123 tests.

The `forged` and `full-repair` scenarios in `parser_construction.mjs` reproduce the
new negatives and re-entry case. Firefox verification of this newest boundary is
not rerun here; its earlier repair/transfer evidence is scoped to the earlier
Program. Live-target evidence, approval and conditional fixture replacement remain
the next authority-bearing implementation steps.

## Live target, exact approval and conditional application

Successful private acceptance now enters `agent.parser_delivery`. It reuses the
existing observation evidence resource and approval owner, then the existing
repository/document conditional replacement implementation. The exact proposal
binds target path/base/source, required principal, frozen subject, candidate version
and acceptance data. Neither the private delivery function nor its approval/write
effects are exported to exploratory participant objects. Incoming participant
delivery claims are rejected by the completion boundary.

A current target read is required even for artifact-only output. The resulting
one-shot live evidence is either consumed for a reviewable artifact or passed to
the exact approval construction. Wrong principals and amendments are denied; an
amendment cannot inherit validation. The file adapter permits only `parser.mjs`
inside its explicitly supplied fixture root, delegates conditional replacement to
the existing file owner, and never retries uncertain delivery.

The isolated delivery Program passed seven real-file cases: artifact-only, approved,
declined, wrong principal, amended source, changed target before read and changed
target during approval. Only the approved case replaced content. A change during
approval reached the conditional operation but produced a conflict without replacing
that external change. All cases resumed from actual saved State at each boundary.

The integrated synthesis/repair/acceptance/approval run also passed. Its 14,223-byte
Program executes two model requests, refutes version 1, fully accepts version 2,
reads the live target once, obtains one exact approval and applies the expected
candidate once. Native, Node/WASM, Wasmtime and Chromium Worker outcomes agree;
there are twenty transfers and twenty-one destroyed Workers. The qualified executor
runs 539 candidate processes plus two qualification executions. Provider and
principal responses are explicitly synthetic fixture responses; no paid inference
or real-user-data mutation occurs.

`zig build check` passes 269 steps / 123 tests. Reproduce the standalone gate with
`zig build parser-delivery-images` and
`node test/agent4/parser_delivery.mjs WORLD_ENTRY KERNEL`. The integrated driver
accepts `apply` as its final scenario argument; `repair` returns the reviewable
artifact after live read. Firefox has not been rerun for this newest delivery
Program. General owned-channel composition, intent ambiguity, generic
assessment selection, broader proof/failure sweeps, strategy/runtime comparisons,
opt-in live configuration and serial reviews remain unfinished.

## Retained endpoints around parser work

Agent now authenticates Boundary `cd457113d2450f35880fe4a0d8e8f78637bd19e0`
through its ordinary archive, package hash and dependency inventory. The World
kernel and protocols are unchanged. `zig build check` passes 271 steps / 123 tests.

The `link-retained` fixture links the same producer, consumer and reference objects
and surrounds the actual parser computation with two independently owned exchange
endpoints. Their ownership remains private to the application entry; neither
assessment imports nor participant captures receive it. Both endpoints are parked
before the nested reference/model/probe chain. After that chain returns, local
`generator.close` disposes endpoint 5, then `generator.exchange` supplies 7 to
endpoint 50. The latter emits ordinary work 57 and completes with 57; cleanup
releases 50 before the saved parser result returns. The assertions distinguish
input-taking exchange from previous-yield behavior and require both cleanup leaves.

`retained-one` runs a real qualified candidate experiment, observes the invalid
partial candidate, and exhausts its one-round allowance without claiming acceptance.
The 14,947-byte Program passes eight fresh transfers with identical native,
Node/WASM, Wasmtime and Chromium Worker outcomes. Actual selected destination bytes
advance execution; nine Workers are destroyed. The ordered lifetime observations
are release 5, work 57, release 50.

The separate `retained-cancel` execution accepts global cancellation while local
cleanup is pending. It replies to the still-pending cleanup occurrence, releases
both endpoints, and performs no ordinary sibling work. Native, Node/WASM, Wasmtime
and Firefox Worker agree across eight transfers and nine destroyed Workers. The
pending request can be observed again after cancellation; this is not counted as a
second release execution. Both cases use one real candidate process and two
executor qualification processes; model and lifetime leaves remain synthetic.

Reproduce with `zig build parser-construction-images`, then
`node test/agent4/parser_construction.mjs WORLD_ENTRY KERNEL WASMTIME_PEER NATIVE_TOOL BROWSER_TOOLS chromium retained-one`
or the same command with `firefox retained-cancel`. Empty peer/tool arguments select
Node-only execution. The ordinary `link` application has no retained fixture owners.

This establishes retained owned endpoints around the real nested application and
local disposal returning to an active owner. The local-abandonment construction below extends it to the suspended parser chain.
A compositional owned hyperfunction channel API and resource-bearing assessment
admission remain required, alongside the semantic, selection, comparison and review
gaps listed below.

The same retained Program also passes the two-round `retained` scenario: real
counterexample, revised complete candidate, full independent acceptance, live target
read and reviewable artifact. It uses 539 candidate processes plus two qualification
processes, two synthetic model calls, no approval and no target write. Native,
Node/WASM, Wasmtime and Chromium agree through sixteen transfers and seventeen
destroyed Workers; release 5, work 57 and release 50 occur only after the actual
parser result. This fresh evidence includes the new dependency binding; the older
approved-write scenarios above remain separately scoped evidence.

## Local abandonment at the lexical demand owner

Agent now authenticates Boundary e96ad16baad6fc80ad9028cf64e9b9b9f20395f1.
The Need interpretation uses hyper.demand.interpretWith: the staged completion
receives the actual linear requester and the counterpart result. An unresolved
contribution disposes that requester; other contributions resume it. The source
checker rejects a callback that drops it (InvalidOwnership) or resumes it twice
(UnavailableSlot), without publishing an object. No capture contract is widened.

The parser input has an explicit abort_nested fixture policy. The producer installs
cleanup before asking its counterpart. The consumer recursively asks the reference
participant, which executes the real frozen reference observation and returns an
unresolved contribution under that policy. The producer's waiting continuation is
then disposed instead of resumed into model sampling. Its cleanup emits release 90
and can suspend. Disposal returns through the still-active outer owner, which closes
endpoint 5, resumes unrelated endpoint 50 with input 7, observes work/completion 57,
and releases 50. Model, approval and target-write counts are zero.

The same separately compiled participant bytes and 15,553-byte retained Program run
both ordinary repair and this policy; no host controller reconstructs the waiting
chain. The local-abort trace is reference, participant release 90, release 5, work 57,
release 50. Native, Node/WASM, Wasmtime and Chromium agree across six transfers and
seven destroyed Workers; actual selected destination bytes advance the next step.
The reference operation is real; lifecycle leaf responses are synthetic fixtures.

A separate run accepts whole-session cancellation during participant cleanup.
It finishes release 90, unwinds younger endpoint 50 then endpoint 5, and never starts
ordinary sibling work. Native, Node/WASM, Wasmtime and Firefox agree across six
transfers and seven destroyed Workers. Reobserving the pending cleanup request after
cancellation does not count as another release execution. Global unwind is distinct
from the authored local close-and-resume order.

Build with zig build parser-construction-images. The existing runtime driver takes
retained-abort or retained-abort-cancel as its final scenario argument. The obsolete
parser-abort-image target and outer reference-handler prototype were removed.
That prototype had two problems: its declared capture bound omitted a private
participant Need continuation, and its operational assumption was wrong. World
routes a perform without an explicit capability directly to the host, so an outer
handler cannot intercept it. A schema-binding prototype admitted that image but did
not cause interception; it was removed. The selected construction disposes at the
existing lexical owner and requires no new Agent import category or World change.

Aggregate validation passes 272 steps / 123 tests, including both callback rejection
cases. This result closes this scoped local-abandonment witness; general owned
channel composition, generic selection, missing intent, multishot and broader
failure sweeps, structural economy, matched comparisons, live opt-in configuration
and serial reviews remain unfinished.

The same 15,553-byte Program also reran ordinary two-round repair successfully:
539 isolated candidate executions plus two qualification executions, two synthetic
model calls, a real counterexample, full acceptance and live target read. Native,
Node/WASM, Wasmtime and Chromium agree over sixteen transfers and seventeen destroyed
Workers. No approval or fixture replacement was requested in this artifact-only run.

## Authenticated integrated dependency tuple

The normal Agent manifest/lock now selects Boundary
`9c9992d25ab4883efa60fc9ce01f859917caeac5` and World
`5c3dea1c0443f026b2451581de77ec2e51085e57`. Both downloaded source trees match their
GitHub commit-tree identities; source/archive/package inventories are bound in
`conformance/agent4/dependencies.lock.json`. The existing setup tool rebuilt World
using the selected Boundary source and reproduced kernel SHA256
`df7fe1ae0ed0de7b2976c98b1534d1d55f4c341b7148837ce32f42ed8d011084`.
The relevant Boundary data code is unchanged from World's original pinned source.
No validator bypass or manually substituted runtime file was used.

Reproduce setup with `node tools/agent4/setup.mjs --work-dir .agent4-recursive-integrated`.
The same command with `--verify-only --offline` authenticates the completed setup
without building or downloading. Its returned World source/runtime paths are the
normal `-Dworld-source` and `-Dworld-runtime` inputs for the integration target.

The first combined `check check-agent4-integration` run reached 326/330 steps and
passed 187 Zig tests, but correctly failed its source-package test because a Node
test-runner context leaked into nested Node invocations. Direct Node test commands
in the build now remove only `NODE_TEST_CONTEXT`. The assertion that nested tests
must actually execute was retained. The failed integration lane was rerun through
`tools/agent4/check.mjs integration`: all 86 Node tests pass, followed by the dialogue,
multi-shot, document, 38 clarification cases and independent embedding commands.
All six commands returned zero; dependency snapshots before and after agree. This
is a corrected-lane result, not a claim that the original failed aggregate passed.

The parser's local-abandonment witness also ran freshly against the setup-produced
runtime package: real reference observation, suspended participant cleanup, local
sibling resumption, six fresh Node transfers, no model/approval/write calls. Earlier
full parser approval/delivery and browser/Wasmtime evidence remains separately
scoped to its recorded run rather than relabeled as freshly executed here.

The existing distributable examples archive is rebuilt and authenticated against
this tuple. The parser distribution and command are described below. Normal dependency
integration alone does not complete general composition/selection, economic
comparisons or serial-review obligations.

## Packaged parser and opt-in provider command

The use archive now includes the parser Program, producer/consumer/reference BMO1
objects, schemas, zero-allowance InitialArgs, trusted batch reference/requirements,
qualified execution and delivery leaves, and runtime/parser_cli.mjs. The command
uses the same generic World interpreter and existing provider adapter. It dispatches
only environmental leaves; reciprocal construction and acceptance remain compiled
control. No accepted incremental implementation is imported by the production
proposer. See [parser-synthesis.md](parser-synthesis.md) for executable commands.

Model calls default to zero. Enabled runs require an explicit model, endpoint,
fixture-only data policy and call/check allowances. External calls require paid-use
authorization; selected credentials are read only under that authorization and the
existing endpoint restriction. Local loopback tests used no credentials or paid
inference. The command creates an ephemeral fixture and returns a reviewable
validated artifact; it grants no approval or target-write authority.

Model/check counts and context/request/reply bytes are accounted outside World
rollback. A work stop exports the actual checkpoint and next invocation control.
A completed but not-yet-admitted environmental reply is preserved as bound bytes,
not silently lost or repeated. A fresh-instance test consumes the saved reference
reply and reaches the model request without replaying the reference operation.
This is an explicit partial-result handoff, not a durable session manager.

The extracted archive runs without authoring sources or emitters. Its default case
performs zero leaf operations; its abandonment case performs a real reference read
and transferable cleanup. Provider-adapter tests cover explicit configuration,
unresolved output, budget stopping and full repair: two model responses, two checks,
539 isolated candidate executions plus qualification, and the exact validated source.
The provider is a deterministic local HTTP fixture, so these results establish the
live transport path and control semantics, not live-model reasoning quality or cost.

Validation: check plus emit-agent4 passes 275 steps / 123 Zig tests; extracted archive
commands pass three tests; parser CLI passes two tests, including the full real-tool
acceptance path. A final context-counter check records actual semantic request and
reply bytes. The existing source-authoring-outside-Git obligation is unchanged. An
extra repackaging-outside-Git test was retired because the existing packager requires
Git provenance; extracted execution, rather than provenance-free repackaging, is
the relevant requirement here. No provenance guard was weakened.

Missing-intent cases, model-proposed experiment/constraint routing, generic selection,
owned channel composition, held-out live/comparator evaluation, broader proof and
economic evidence, and serial reviews remain required. No paid live study was run.
