# Recursive participant integration

Implementation of Defunctionalized Hyperfunctions and Recursive Interaction
v1.1 (September 19, 2026). Current review and acceptance status is maintained in
the linked draft PRs. Boundary companion:
https://github.com/tkersey/boundary/pull/153. Agent draft:
https://github.com/tkersey/agent/pull/33.

## Foundation

Boundary #152, World #54, Agent #32 are merged. Immutable follow-on bases:
Boundary c7a08ed7c1e15732fc7373dd1f149cbe7da82e7b,
World 374ed712c2a2ab5041c28befa38bb3c3a859bd26,
Agent e1b56f06ce0d91a8d7f324198a541f0b16b55a00.
The current authenticated tuple is Boundary
`3fc90c83dfedc9bcc7dce3385776d60f0bfae6bb` and World
`0bcdf990daa4b0e2a359034334bb1d2b55469998`. Their archive/tree/package/runtime
identities are bound in the normal dependency lock. The setup tool recomputes
source inventories and builds the generic World kernel before admitting it.
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

The supported participant profile has one entry per installed instance and
function/effect imports. Local one-shot control can own cleanup; compiled
assessment interfaces reject incoming or escaping cleanup owners, including
recursively wrapped captures. Multi-shot object control, abstract resources and
suspension packages inside compiled assessment objects remain unsupported.
Clone-safe source factories and the existing owned exchange facilities retain
their independent support; these restrictions do not disable the demonstrated
parser/model/experiment/assessment path or weaken the compiled-tool profile.

## Current implementation and evidence

The maintained production path is Boundary authoring/data → World execution →
Agent admission and application. Exact source trees, archives, Zig package and
runtime bytes are bound in `conformance/agent4/dependencies.lock.json`; local
setup never substitutes an unchecked participant or a different kernel.
Current review/acceptance status belongs to the linked draft PRs. The milestone
is not complete merely because one witness or a local check passes.

| Required behavior | Owning implementation and deciding evidence |
| --- | --- |
| Pure non-strict general construction | Boundary `library.hyper`; constant/divergent-peer, aggregate, fault, adaptive ana, and 96 generated-construction comparisons against the independent closure oracle |
| Effectful reciprocal demands | Boundary `hyper.demand`; parser `step` and `referenceParticipant` retain the real waiting callers and route only residual leaves to the host |
| Checked compiled participants | `src/participant.zig`, normal `agent.compile`, `test/agent4/participant.zig`: model-helper binding, imported authority, incoming-owner and allocation-failure negatives |
| Source-free reuse and consumer swap | `tools/agent4/link_parser.zig`, `parser_source_free.mjs`, `parser_comparison.mjs`: source-denied linking/execution and identical producer bytes with two consumers |
| Owned composition and lifetime | Boundary `generator.compose`, Agent `composed_owners.mjs`, parser cleanup paths: nested composition, local disposal with a surviving sibling, distinct whole-session cancellation |
| Recursive assessment without delivery authority | `deliberation.selectSequential`, `recursive_selection.mjs`, `parser_selection.mjs`, `parser_disposition_negative.mjs`: actual nested experiments and rejection of imported completion authority |
| Independent parser acceptance | `runtime/parser_oracle.mjs`, qualified executor, parser executor/evaluation tests: two independently written valid candidates, separate invalid candidates, chunk/error/prefix/closed-protocol and retained-state checks |
| Model proposals and actual repair | `parser_construction.mjs` and parser comparison: a partial transition precedes the complete candidate, a real counterexample reaches the producer, and the revised exact source is evaluated |
| Exact delivery and context binding | `parser_delivery.mjs`, parser tool/protocol tests: reacquired target, exact approval, conditional fixture replacement, stale/forged reports, denial and uncertain delivery |
| Fresh portable execution | Shared recursive peer/Worker harness and parser construction/delivery/selection scenarios: native, Node/WASM, Wasmtime and Chromium consume actual destination State bytes |
| Progress and honest stopping | `parser_circular.mjs`, zero/one-round and unavailable/malformed cases: explicit unresolved results, no invented evidence, cancellation and reclaimed ownership |
| Comparison and live readiness | `parser_comparison.mjs`, `runtime/parser_cli.mjs`, reserved-input evaluation: capable ReAct baseline, complete-candidate ablation, opt-in authorized provider path; paid/live quality remains unmeasured |

Pure and task-valued hyperfunctions share the ordinary compiler and World
interpreter. The owned sequential exchange operator is a narrower derived
pipeline; it does not replace general hyperfunction invocation or inherit all
pure laws. ReAct and Inquiry remain independent supported strategies.

Earlier sections below retain the named slice's executed observations and exact
inputs. Their historical remaining-work notes are not the current acceptance
inventory. The final audit uses the owning code/tests and the current tuple,
with reused observations explicitly distinguished from fresh executions.

## Development evidence by slice

### Executed first production slice

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

## Scope of the first slice

The first numerical model/reference witness established the integration boundary.
The later parser, ownership, composition, selection and comparison witnesses below
carry their own evidence; the first slice alone did not establish those results.
Live-model quality and cost remain unmeasured.

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

General constraint routing, generic selection,
owned channel composition, held-out live/comparator evaluation, broader proof and
economic evidence, and serial reviews remain required. No paid live study was run.

## Model-proposed candidate experiments

After a candidate exists, the model may propose an experiment through the existing
flat hex/chunk/finalization schema. The checked compiled sample helper binds it to
the exact retained candidate and frozen subject, gives it a fresh contribution
occurrence, and calls the probe-only execution interpretation. The consumer checks
candidate content/completeness/version and reply occurrence before re-entering.
The host merely executes the declared leaf. An experiment is not a new candidate:
round 2 still checks candidate version 1; changed source in round 3 receives version 3.

Reports retain the proposed inputs and an applicable failed observation. Passing or
unavailable additional probes do not erase that counterexample. Subsequent model
context names the actual experiment and retained failure. Re-offering identical
refuted source as complete is rejected even with a fresh version label. Changed
source does not inherit old verdicts and still undergoes private authoritative
acceptance. This is bounded current-candidate evidence, not a complete history or
universal dependency-invalidation system.

The discriminator intentionally uses a passing additional experiment: the original
escape-boundary probe refutes a buffer-until-EOF implementation, while the proposed
hex `610a`, one-byte chunks, finalization on the last chunk passes. The report still
contains the original failed observation, and the unchanged-source completion is
rejected. A changed implementation then passes the full required evaluator.

Executed cases include an experiment before any candidate (unoffered/rejected),
malformed hex (unavailable without candidate execution), wrong candidate-version
reply (authored rejection), a probe reply forged as full assessment (rejected),
unchanged refuted source (unresolved), and the pre-existing forged completion case.
The full three-model-response path passes native/Node/Wasmtime/Chromium agreement:
18,640-byte Program, nineteen transfers and twenty destroyed Workers, 540 candidate
processes plus two qualification processes, no approval or target write. The same
three-response flow passes through the packaged command and actual provider adapter
using a credential-free local HTTP fixture. No paid inference or live quality study.

Validation: check plus emit-agent4 passes 275 steps / 123 tests; parser CLI tests pass.
Reproduce with `parser_construction.mjs` scenarios `experiment`, `experiment-invalid`,
`experiment-stale`, `experiment-assessment`, `experiment-before`,
`experiment-unchanged`, and `experiment-repair`. Round naming was clarified without
changing the tested Program bytes. Constraint/intent routing, generic selection,
complete regression-history/revalidation, broader composition/proof/economic work
and serial reviews remain open. No global completion claim is made.

## Explicit EOF intent before construction

`agent.parser_intent` reuses the consequence-sensitive classifier and resolver for
the separate task whose final unterminated-record policy is intentionally unresolved.
Two frozen subjects share the source base but name distinct strict/emit-EOF contracts,
reference meanings, requirements and runners. Their keys describe different accepted
behavior, not implementation style. The question retains both subjects and the
occurrence. Other, unsure, unoffered, aborted or closed answers do not select a policy.

The application receives an optional alternate EOF task. When absent, its already
specified subject proceeds without a question. When present, the root resolves the
task definition before creating participant work, so no captured candidate premise
is rewritten. Zero allowance performs no work and asks nothing; a later unspecified
task still asks. Known strict behavior is never presented as missing evidence.
Invalid base/contract pairs reject before interaction. Old question replies reject
without changing the parked input.

The default strict parser meaning is unchanged. The emit-EOF alternative emits the
last unfinished non-escaped record and preserves empty-input behavior, prefix records,
DanglingEscape, InvalidEscape and their offsets. Distinct contract and trace identities
prevent cross-policy observation reuse. The same tool adapters and generic World
interpreter execute both; no alternative parser runtime or host participant controller
was introduced. The selected policy is part of every reference/evaluation binding.

Executed evidence: five oracle tests; cross-policy candidate discrimination and full
alternate acceptance (536 required checks plus retention); eleven intent scenarios,
including repeated tasks, no-work, invalid subjects and stale replies. The final
21,361-byte Program agrees across native/Node/Wasmtime/Firefox while advancing actual
destination states (124 destroyed Workers). The earlier eight-case version also
passed Chromium. The final packaged CLI uses the local provider adapter, asks for the
emit-EOF choice, performs three model responses and three checks, and produces the
correct alternate artifact; unsure and closed stdin make no model call. Paid calls
were not run. Clarification is separate from final approval/delivery.

`zig build check check-parser-intent` passes 275 steps / 123 Zig tests under the
normal authenticated runtime. `check-parser-eof-executor` owns the real alternate
executor test. Packaged CLI tests pass. Broader constraint routing, generic selection,
owned channel composition, complete observation history/revalidation, matched strategy
and runtime economics, and serial reviews remain open.

## Sequential consumer-supplied selection

The existing deliberation owner now provides `selectionTypes` and
`selectSequential`. An application supplies candidate/assessment schemas, an explicit
maximum, an assessor function, a pure choice function and an assessment-effect
allow-list. The generated loop assesses each candidate in order and retains paired
candidate/assessment rows. Choice returns an index or unresolved; invalid indices
return unresolved with all rows. The constructor exposes no executable function
until construction completes. No scalar scoring law, approval or completion authority
is implied by a selected row.

The actual assessor is registered with Agent's protected admission. Its source,
callable origins, imported participant code and bound helpers remain subject to the
existing transitive checks. Including write authority in the declared allow-list
does not make it legal in assessment. The ordinary caller retains its real completion
continuation; the selection interface does not receive it. Candidate extraction also
retains Boundary's ordinary copy/use and borrow checking.

`test/agent4/recursive_selection.zig` supplies the non-agent numerical witness.
An independently compiled unchanged producer cooperates with the assessor through
public task-valued hyperfunctions: assessor asks producer, producer asks back, an
external square observation completes, then both callers perform distinct non-tail
work. Changing the consumer's assessment policy changes the selected candidate from
5 to 2 on identical producer bytes and inputs. The default metric is x*x+x+5; the
alternate consumer compares its complement. A guarded branch leaves an overflowing
unused complement unevaluated. A pure-assessment variant requests no observation;
completion remains a separate fixture write.

Eight runtime cases pass, including empty input, insufficient data, an out-of-range
choice and an explicitly unestablished assessment. All assessment-time observations
verify that the completion file does not exist. Selected cases create it once;
unresolved cases never create it. A callable alias attempting to invoke the real
write helper from assessment rejects with SpeculativeEffect before an image is
published. The normal numerical Program is 1,564 bytes. Native, Node, Wasmtime and
Chromium agree using actual destination states; 74 Workers are destroyed across the
cases. This is a finite mechanism witness, not an optimality or live-quality claim.

`check-selection` includes construction/allocation-failure and invalid-schema/capacity
checks. `check-selection-runtime` runs the numerical flow against an authenticated
World. The aggregate with this runtime lane passes 289 steps / 125 tests. Existing
parser behavior is unchanged; integrating this generic selection API into its
consumer-supplied assessment strategy remains open, as do the other stated
composition, regression-history, economic and serial-review requirements.

### Agent adoption of composed exchange owners

Agent now authenticates Boundary `5a8aa24bb179bc8defaa896ea776605261ed6539`
(Git tree `41c292f1e16b96bd6d32dfe8273cb656286b0106`) through its ordinary
archive, package, source inventory, and API checks. World remains
`5c3dea1c0443f026b2451581de77ec2e51085e57`; rebuilding it against that Boundary
source produced the same `df7fe1ae0ed0de7b2976c98b1534d1d55f4c341b7148837ce32f42ed8d011084`
kernel. Offline setup verification passed. No runtime or wire extension was needed.

`test/agent4/composed_owners.zig` uses the normal `agent.compile` entry point to
start two owned exchanges, consume them into a pipeline, and dispose the
successor. Admission permits read cleanup, including inside an assessment;
it rejects consuming that successor twice and rejects write authority reachable
through retained cleanup during assessment even when the effect is explicitly
listed. The otherwise identical non-assessment write case admits, so rejection
is not an unsupported-shape shortcut.

`zig build check-composed-owners-runtime -Dworld-runtime=RUNTIME -Dworld-source=SOURCE`
executes the 994-byte image on the authenticated generic kernel. Thirteen fresh
Node/WASM restores include both cleanup suspensions; owners release once in order
`2, 1`, and terminal working live memory is zero. This focused adoption test does
not add a separately compiled Agent pipeline or establish general owned
hyperfunction composition. Boundary's earlier three-part, sibling, cancellation,
and cross-engine pipeline results remain separate evidence. Parser selection
integration and final serial reviews remain unfinished.

### Separate parser assessment from completion

The parser round now returns its actual assessment to the caller. It has no
approval, target-read, or delivery effect in its row, and Agent checks the whole
round under its assessment policy, including linked producer/consumer/reference
objects and bound helpers. Only the caller interprets the returned accepted report
and enters live delivery. The existing participant-report rejection remains in
front of that boundary; a forged complete assessment does not become trusted by
passing through the new return path. This is the prerequisite authority split for
parser selection, not integration of the generic selector or multiple alternatives.

This exposed a conservative compiled-participant restriction: merely declaring a
local obligation-bearing resumption previously rejected an assessment. Internal
one-shot resumptions may now retain locally created cleanup. A finite worklist
checks imported and exported function/effect interfaces, recursively including
callable parameters, results, and capture bounds, and rejects incoming or escaping
obligation-bearing resumptions. Abstract resources and suspension packages remain
unsupported in compiled assessment objects; multi-shot restrictions remain.
Boundary still checks actual ownership/captures and source-free bindings. Agent
still checks every object's effects and all bound helper bodies, including cleanup;
no protected tool profile was weakened.

The added normal-compilation negatives reject both direct and aggregate-wrapped
incoming cleanup owners, while their ordinary non-assessment neighbors admit.
Allocation-failure tests cover the new graph traversal and its partial storage.
Focused admission passes 14 tests; the authoring aggregate passes 292 steps and
130 tests. The actual parser repair run completes with two synthetic model replies,
539 isolated candidate executions, one target read, and no approval/write in
artifact mode. Forged assessment performs no external work. Local abandonment
releases the nested producer (90), then its affected retained owner (5), resumes
unrelated work (57), and finally releases that owner (50). No paid model study ran.

The approval/apply variant passed native, Node/WASM, independent Wasmtime and
Chromium Worker execution, continuing each destination's actual returned State:
20 transfers, 21 destroyed Workers, one target read, one approval and one
fixture-confined write. The 21,573-byte Program is 212 bytes larger than the prior
21,361-byte parser image. This is an image-size observation, not a latency or
strategy-quality result. The generic World kernel and dependency tuple did not
change in this slice.
The regenerated use archive passed all three extracted-package command tests
(including qualified parser and Inquiry execution), with no skipped tests.

### Parser selection through the generic assessor

The parser emitter supports `link-select-first` and `link-select-last` beside
its default single-construction mode. Both link the same producer, consumer and
reference BMO1 bytes, and feed two immutable construction states to
`deliberation.selectSequential`. The actual recursive parser round is the
assessor: each fresh construction requests its reference and fragment, runs the
consumer probe, requests completion/repair, and performs authoritative acceptance.
Only the caller receives the chosen assessment and enters delivery. Running
interactions and completion authority are not cloned.

The policies are deliberately explicit tie-breaks between two fully accepted
alternatives, not quality scores: choose the first or last. Both alternatives
must establish complete acceptance; any unresolved assessment prevents delivery.
Each construction has a disjoint checked observation-occurrence interval, while
model executions remain fresh even for equal prompts and provider IDs. The
existing default Program and its CLI still use one construction; CLI selection
configuration and a fair strategy comparison remain unfinished.

`zig build check-parser-selection -Dworld-runtime=RUNTIME -Dworld-source=SOURCE`
uses real qualified candidate execution and fresh Node/WASM State recovery. Its
scripted proposals are test-only implementations, never imported into the
production proposer or its prompt. One fragment needs repair after a failed
probe; the other passes its probe but still needs a complete candidate and full
acceptance. The test requires different resulting feedback, zero target reads or
writes during both assessments, one final approval/write for the selected code,
and no delivery when an assessment reply is unavailable. The unavailable reply
case is explicitly a protocol injection after real execution, not a claim that
the evaluator actually became unavailable.

The two selection Programs are included as `parser-selection-first` and
`parser-selection-last` in the source-independent archive, with zero-work default
arguments. A configured run gives each alternative the supplied per-construction
round allowance; total model/tool spending remains the embedding's responsibility
outside rollback. No live inference is enabled by emitting or packaging them.
The default CLI does not silently double its allowance or select this mode.
Both selection images are 22,777 bytes; the default image remains 21,573 bytes.

Executed results: both policies passed with four synthetic model contributions,
four real checks, 1,078 isolated candidate executions plus two qualification
executions, 34 fresh Node/WASM transfers, one target read, one approval, and one
fixture write. First/last selected the respective independently written accepted
source. The injected unavailable result completed unresolved after 23 transfers,
with zero target reads, approvals, or writes. The source-independent archive
passed all three documented-command tests, including zero-work invocation of
both selection variants. This slice did not rerun the four-engine matrix for the
new selection Programs or measure their timing/retention; preceding parser
transfer results do not establish those new combinations.

### Selection portability and CLI entry

`test/agent4/parser_selection.mjs` accepts optional native-fixture, Wasmtime-peer
and browser-tools paths after its runtime and policy arguments. At every boundary
it compares the actual generic-kernel outcomes and rotates which destination's
returned bytes continue the computation. Browser calls use newly created Workers;
no participant control is reconstructed by the host.

The packaged CLI now exposes `--selection single|first|last`, with `single` as its
unchanged default. It chooses the corresponding hash-checked inventory image.
Existing model/check counters remain shared across both assessments and outside
World rollback. Selection does not grant approval or fixture write authority to
the CLI. The loopback tests exercise exhausted allowance and a complete two-candidate
run using the real provider adapter and qualified candidate tools, without credentials
or paid inference.

The `last` selection policy passed the four-engine path: 34 actual State
transfers across Chromium 153.0.8010.12 Workers, Node/WASM, native World and
independent Wasmtime, with 35 Workers destroyed. It retained both recursive
assessments through real tools, then performed one target read, one approval and
one fixture write. The 22,777-byte Program and generic kernel were unchanged.
The first-policy and unavailable-result cases retain their prior Node/WASM
evidence; this representative matrix does not imply a Cartesian host/case sweep.
The extracted CLI suite passed all three tests with no skips: existing provider/
EOF behavior, shared one-call exhaustion without a second provider request, and
a complete `--selection last` run with four total model calls, four checks and
1,078 isolated candidate executions. It returned the second accepted source as
an artifact without approval/write authority. No paid provider calls ran.

### Parser strategy comparison inputs

This comparison uses the frozen incremental-parser fixture, its real qualified
executor and independent authoritative evaluator, the same typed model adapter,
and the same shared approval/delivery constructions. All executions use the
locked generic World kernel and fresh recovery at each quantum/effect boundary.
No paid inference is authorized or run.

Compare the existing `agent.react` loop with consumer-directed recursive
construction and a complete-candidate-only ablation of recursive construction.
ReAct retains its current candidate, counterexample/experiment and applicable
reference observation; it may propose experiments, revise after rejection and
resume actual saved State. It is not a transcript-restart baseline. The ablation
keeps the same producer/consumer objects and changes the offered construction
protocol to require complete candidates. No runtime speedup is inferred from a
change in model/tool work.

Before running: use equal three-call and corresponding experiment allowances,
the same reference, required input language and acceptance contract. The scripted
cases are (1) a valid initial source and (2) an invalid source, an additional
experiment, and a valid revision. The offered partial/complete contribution kind
is the declared strategy difference; candidate source, experiment input and
provider adapter are held fixed. Scripted behavior proves control/effect work,
not live model reasoning quality or a general win. Keep all attempted cases and
false completion claims in the denominator.

Record actual accepted artifacts, model calls/context bytes, checks/physical
executions, reference requests/reuse, approval/write counts, Program bytes, peak
checkpoint bytes and transfer count. A successful run must return the exact
validated source. Failures, unavailable checks and allowance exhaustion must
remain non-success. These are finite deterministic observations; no latency
claim, universal memory bound or calibrated model-cost inference is made.

The full required comparison also needs broader failure, base-change and intent
cases, held-out/live readiness, and resource attribution. Do not promote the
recursive strategy based only on the initial cases below.

Initial matched observations (Zig 0.16.0, Node 26.9.0, locked World kernel;
quantum 97, full checkpoint/fresh restore after every nonterminal outcome):

| Case | Strategy | Model calls | Context bytes | Candidate processes | Max checkpoint bytes | Transfers |
|---|---|---:|---:|---:|---:|---:|
| Valid initial source | ReAct | 1 | 4594 | 538 | 25954 | 16 |
| Valid initial source | Recursive fragment | 2 | 10460 | 539 | 37310 | 22 |
| Valid initial source | Complete-only ablation | 1 | 4594 | 538 | 25989 | 17 |
| Repair + experiment | ReAct | 3 | 16763 | 543 | 32394 | 27 |
| Repair + experiment | Recursive fragment | 3 | 16868 | 540 | 40582 | 29 |
| Repair + experiment | Complete-only ablation | 3 | 16763 | 543 | 41913 | 30 |

Every row delivered the exact accepted fixture source after one target read and
one approval; each fetched its reference once and retained it across fresh
resumptions. Each run also paid two executor qualification processes, excluded
from the candidate-process column. Context is supplied message UTF-8 bytes, not
provider tokens. Checkpoint maxima are observations at the declared boundaries,
not universal memory bounds or physical process RSS. No timing claim is made.

The recursive fragment path loses on the easy case: one extra model call,
5,866 extra context bytes (+127.7%) and 11,356 extra checkpoint bytes (+43.8%)
versus ReAct. On repair it saves three candidate processes, but adds 105 context
bytes (+0.6%) and 8,188 checkpoint bytes (+25.3%). Its image is 21,573 bytes versus
ReAct's 19,096 (+2,477, 13.0%); the complete-only image is 21,544 bytes. These are
new strategy/representation costs, not inherited foundation costs or a regression
claim about unchanged foundation applications. Keep recursive construction opt-in;
these cases do not justify a general quality or cost superiority claim.

The additional unresolved-model and stale-reference cases preserve failure
outcomes: neither can produce an accepted artifact or target write. These are
explicit scripted/protocol cases, not a live model success-rate estimate. The
broader live/held-out study and remaining task variants are still unmeasured.

Across this fixed four-case set, each strategy produced two accepted artifacts
and two expected unresolved outcomes, with zero false completion claims. ReAct
and the ablation used five total model calls per two accepted artifacts (2.5);
recursive fragment construction used six (3.0). Candidate processes were 1,081,
1,081 and 1,079 respectively, plus eight qualification processes per strategy.
These intentionally weighted fixture totals are not population success rates or
live cost-per-task estimates. All twelve runs used actual fresh State recovery;
no native/browser/Wasmtime claim is made here for the new ReAct Program.

Authoring checks passed 300 build steps and 130 tests. Package emission passed
187 steps. Two focused extracted CLI tests passed, including zero-work baseline
modes and a one-model-call ReAct candidate accepted by the real evaluator through
the credential-free provider adapter. The prior selection-specific CLI test was
not repeated; the comparison did not change its Program. Normal dependency
bindings remain Boundary `5a8aa24bb179bc8defaa896ea776605261ed6539` and World
`5c3dea1c0443f026b2451581de77ec2e51085e57`.

### Immutable evaluation identity and reserved input partition

A concrete pre-change witness created one executor and called `validate` with
seeds 1 and 2. It reported 501 versus 521 required checks under the same runner
identity (two actual reject-all candidate executions). That conflated the required
check sets even though the tool subject used the runner as its binding.

The executor now constructs one immutable evaluation plan and incorporates its
metadata/digest into the runner. Per-call seed/evaluation overrides reject before
candidate execution; a tool subject from the other split also rejects before
execution. Development retains exactly the original 536 traces. The reserved
partition uses seed 1831565813, shares 68 mandatory edge cases, and adds 491
exact traces disjoint from development (559 total). Trace arrays, calls, chunks
and metadata are frozen. This is a finite graph/data construction, not a new
scheduler, wire format or runtime policy registry.

The source-independent `parser_evaluation.mjs` command reads a bounded frozen
source file and uses the existing qualified executor. It returns source/runner/
check-set bindings and finite acceptance, counterexample or unavailability. It
has no model/approval/delivery adapter. Reserved-input evaluation remains separate
from synthesis feedback; prior exposure is an environmental evaluation condition.
The reserved input partition satisfies the specification's task/input-split preparation. A separate task corpus is not added as a new acceptance gate; live model quality remains unmeasured and paid evaluation still needs external authorization.

Validation passed: six oracle tests, both independent valid implementations on
all 559 reserved-partition checks plus retention (561 candidate processes each),
and reject-all rejection. The original development suite retained its two valid
acceptances and five distinct rejection results (1,650 candidate processes plus
two qualification processes total). Cross-split subject rejection and immutable/
per-call-override tests passed before any candidate execution. The extracted
archive command returned exit 1 and a correctly bound counterexample for reject-all.
Authoring checks passed 300 steps/130 tests; package emission passed 187 steps.
No live inference or task-quality claim is added by these fixture observations.

### Updated integrated dependency tuple

Agent now authenticates Boundary `b40befad3fa214431961e60c375c012995817aac`
against Git tree `5711235ab99210dcc9721a65a88536c3ee580d45`, with World still
`5c3dea1c0443f026b2451581de77ec2e51085e57`. Downloaded source, Zig package,
archive bytes, API files and normal build binding are refreshed together.
The standard setup and offline verification passed; rebuilt World kernel bytes
remain `df7fe1ae0ed0de7b2976c98b1534d1d55f4c341b7148837ce32f42ed8d011084`.

The full normal `check-agent4-integration` run uses this authenticated tuple with
two build jobs. Its result is tracked separately from the setup and focused
witnesses; neither setup success nor prior sliced checks establish full integration.

The remaining-acceptance audit distinguishes required work from optional research.
The valid parser-specific alternate-consumer witness remains unproved by the
current normal/forged consumer objects; numerical/general consumer swaps and
first/last selection policies are different evidence. Final serial reviews also
remain unstarted. The prepared reserved input split is complete as an input split;
a paid live-model study is not required for implementation acceptance.

The integrated run completed successfully: 280/280 build steps and 64/64 Zig
tests; its packaged Node group passed 90 tests with zero failures/skips. All six
top-level commands in the normal integration report exited zero, including the
source-independent archive/source-consumer path and sequential runtime checks.
The report binds dependency-lock digest
`ef4bedef2e7c66c7f8baa1fdcdb84953d13a549acaaab4f7108e564d19fb90c5`.
Qualified macOS executor coverage passed. Existing cross-engine fixture evidence
remains separately scoped; this integrated run is not serial-review closeout or
proof that every outstanding goal discriminator is implemented.

### Parser-specific consumer replacement

`consumer-alt.bmo1` asks an additional immediate-emission question before the
normal escape-boundary probe. Its probe uses literal `a` followed by a non-final
LF, and a disjoint occurrence interval; it does not mutate the caller's reference
trace or cached reference binding. A failed additional experiment remains attached
to the exact candidate even when the following boundary probe passes. Unavailable
additional evidence ends unresolved, with no target read or write.

Both consumer objects link through normal Agent admission against producer bytes
`fcf0b53d44983c0aabe5e69eec502295d2b2e66b6eb3cdcd57281be8cf456502`, unchanged
from the preceding delivery. The same initial partial implementation passes the
usual probe but fails the alternate consumer's extra question. The producer gets
different feedback and revises before full acceptance; no producer-side consumer
identity branch or host routing phase is added. Default/alternate full runs each
used two model contributions and one approval/write. Checks were two versus three,
with 539 versus 540 candidate processes and 22 versus 25 fresh Node/WASM transfers.

`tools/agent4/link_parser.zig` is a link-only executable entering `agent.compile`;
participant-emission entry points are unreachable from its main. The source-free
witness copies objects, that linker, a normal native World invocation tool and the
use archive into an isolated directory. OS policy denies reads and execution in
the original Agent source/emitter root; an actual read-denial probe confirms it.
Both linking and every guest invocation run under this policy. Qualified tools
remain outside the source-denial process and receive only declared requests. The
first attempt to nest the candidate sandbox under source denial was unavailable
(`sandbox_apply: Operation not permitted`); no unsandboxed candidate fallback was
used. The adopted split reuses the existing external-tool/native-invocation seam.

`zig build check-parser-source-free -Dworld-runtime=RUNTIME -Dworld-source=SOURCE`
passed 197 steps. Both source-denied executions performed the actual reciprocal
partial-construction episode: default one probe/five fresh native transfers;
alternate two probes/seven transfers. They return partial reports, not accepted
artifacts. The complete acceptance/delivery runs are separate evidence. The
source-denied path does not measure native working-live memory; no zero-memory
claim is inferred from process exit.

The alternate consumer's full path also passed native/Node/Wasmtime/Chromium
execution through 25 actual destination-State transfers and 26 fresh Workers.
It completed two model contributions, three checks, 540 candidate processes and
one approved fixture write. An injected unavailable first probe returned unresolved
with one model/probe and no target read, approval or write. The earlier counterexample
and its `610a`/non-final trace metadata are explicitly checked in the source-denied
partial result after the later probe passes. Authoring passed 306 steps/130 tests.
The updated use archive passed all three extracted-command tests with no skips,
including the alternate Program's zero-work default. This replaces the earlier
unproved parser-consumer-swap audit item with executed evidence. It does not start
or complete the serial-review inventory, nor replace the final requirement audit.

### Unsupported circular-demand discriminator

A checked `consumer-circular` object deliberately asks its producer back without
supplying reference evidence. It links through the normal participant path.
`check-parser-circular` executes eight quanta of 97 instructions, transferring the
actual State between fresh embeddings each time. Every outcome is Progress;
there are zero model/tool requests and no invented answer or constraint. The
embedding's explicit work allowance then yields an unresolved report with a
6,676-byte saved State. A separate cancellation drive completes cancellation and
releases working ownership. This finite observation is not a divergence/deadlock
proof or a semantic fuel limit in Boundary. The cyclic test Program is 20,853 bytes.
The focused build/check passed 48 steps. Production inventory images/components
were read back against their existing hashes; all 29 remained unchanged.

The current normal dependency tuple is Boundary
`a3676bef943e2fcea2a2452988b08a2a357e131c` and World
`0bcdf990daa4b0e2a359034334bb1d2b55469998`, authenticated through GitHub tree
identities and downloaded source/package/archive inventories. Setup and offline
verification passed; kernel bytes remain unchanged. Agent authoring plus the
circular-demand check passed 312 steps/130 tests; package emission passed 196
steps. The circular fixture is test-only. Existing production images/components
retain their previous hashes, so the preceding integration and cross-engine
observations are reused for those unchanged inputs rather than relabeled as new
executions. The whole specification still needs its final review disposition.

## Latest dependency and validation update

The normal tuple now selects Boundary `3fc90c83dfedc9bcc7dce3385776d60f0bfae6bb`
(Git tree `dfdcf4e2f68bda0b9e9a05ce626894a8d3d52f75`) and World
`0bcdf990daa4b0e2a359034334bb1d2b55469998`. Setup, offline verification and
196-step package emission passed. All 29 production Programs/components are
byte-identical to the preceding d8132a6 tuple; the generic kernel is unchanged.

The first combined integration run at d8132a6 passed 194 Zig tests but failed
one packaged CLI assertion: 89/90 Node tests passed, and the parser repair
command returned unresolved instead of a validated artifact. The assertion did
not retain the unresolved report. A focused reproduction with report diagnostics
passed, but does not explain or erase that failure. Provider diagnostics were
added without weakening acceptance; the failing integration group requires
recovery before acceptance. No paid inference ran.

### Repeated completed executions and diagnostic recovery

`check-parser-repeated` reuses one resident kernel and one prepared retained-parser
Program for four completed executions, each returning an explicit unresolved
result after a real reference observation and one synthetic model contribution.
Only the task occurrence changes. The same provider ID is reused deliberately.
Each later task rejects the preceding reference and model reply without changing
its checkpoint. Cleanup and unrelated retained work still run in the prescribed
order. Maximum checkpoint size is 8,804 bytes on every run; live working memory
returns to the prepared baseline of 578,356 bytes after each Session closes.
Releasing the prepared Program returns working memory to zero. These four runs
are a bounded ownership/retention observation, not a universal leak proof or four
accepted parser artifacts. The focused target and package emission passed 199 steps.

The packaged integration recovery exposed a second unresolved selection result.
It had completed four model calls, four checks and 1,078 candidate executions, but
its final result did not retain which individual assessment was unsuccessful.
Both focused CLI cases passed alone. The CLI now retains bounded per-check
observations with candidate/occurrence binding and descriptive unavailable reasons;
this changes reporting, not selection, allowance, approval or executor policy.
All 90 packaged Node tests and all six commands in the normal integration group
then passed against lock digest
`727dfc07c6317ac3f934850c7c0b643905cf88caf9c8f3b754f1b5aa38556245`.
The original failures remain failed; their cause was not established from the
reports available at the time, and the diagnostic improvement is not claimed to
have fixed that unknown cause. A redundant aggregate replay was stopped and is
not counted as a pass. Current exact-head authoring/package checks and the
request-bound read-only view test are recorded separately in the draft summary.

## Evaluator evidence preservation and probe protocol v2

The Agent review identified three defects: completed malformed observations became
unavailable, later unavailable retention work could mask a completed rejection,
and an absolute 2 KiB retention threshold rejected valid fixed state. The repair
keeps these judgments separate from the evaluator's finite operational budgets.

`parser_executor.evaluationDisposition` derives acceptance only from all required
completed checks and both completed retention observations. Any completed failed
check establishes rejection even if another check is unavailable. Both the typed
tool adapter and standalone evaluation command use this classification; neither
recomputes a competing precedence rule from a later error.

`agent.parser.probe.v2` and `agent.parser.execution.v2` explicitly version the
changed Probe reply. Observations are optional: absent observations identify a
completed counterexample whose candidate rows cannot be represented by the typed
observation schema. `passed` stays false and `first_failure` explains it. Valid
empty observations are not fabricated as a replacement. The compiled reply guard
rejects a success claim with absent observations. Ordinary unavailable and capacity
results remain distinct. Old v1 Probe layouts are not reinterpreted; affected BMO1
objects and BPI3 Programs are rebuilt, and saved State still requires its exact
Program. The generic BPI3/BMO1/PST3 formats and World kernel are unchanged.

The completed-history exercise now measures growth above the state following its
first completed record, with an explicit 2,048-byte growth allowance over 500
bounded records. The supplied requirements state this finite rule. A separate
8,192-byte unfinished-field exercise and the existing 131,072-byte executor state
limit remain. This is a finite acceptance contract, not an asymptotic proof.

The real executor accepts both independent parsers plus eagerly and lazily created
3 KiB lookup-table variants. Each table variant grows by seven bytes (3,165-byte
baseline; 3,172-byte peak). The history-retaining negative still fails with
13,480 bytes of growth. All five prior invalid implementations remain rejected;
2,726 candidate executions covered the nine-candidate set. Pure classification
regressions cover rejection/unavailable ordering and incomplete acceptance.

The normal compiled malformed-row episode delivers a failed probe with absent
observations, retains its explanation in the producer's next request, obtains a
revision, and passes independent acceptance. It uses two synthetic model replies,
539 real isolated candidate executions, fresh Node transfers and zero target
writes. Normal typed reply tests also reject wrong occurrence/version/operation,
missing-observation success and stale unavailable results. Broader regenerated
host/strategy evidence and successor serial reviews are separate pending checks;
these focused results do not claim their completion or explain the older
intermittent CLI outcomes.
