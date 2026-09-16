# Resumable inquiry

The deterministic World diagnose-and-repair path connects retained
investigations, real isolated experiments, hypothesis revision, independent
candidate checks and exact approved delivery. Mechanism tests and the opt-in
live entry are implemented; live-model usefulness has not been measured.

## Custody construction

`agent.inquiry.define` specializes one dialogue on application demand, reply,
and finding schemas. Its emitted functions operate under ordinary Boundary
ownership admission:

- `park(state, investigation, answer)` retains an actual awaiting package or
  appends a completed finding. Every new offer receives a checked, increasing
  demand generation. Investigation occurrences are assigned by authored callers.
- `project(state)` consumes and rebuilds the queue, returning ordinary demand
  views separately. It never copies a record containing a package.
- `distribute(state, generations, reply)` consumes a fixed input queue. It
  resumes each selected package once and parks returned answers in a separate
  output queue. New offers cannot join the distribution already in progress.
- `retire(state, generations)` disposes selected futures, preserving the rest
  during any cleanup suspension. `finish(state)` disposes all remaining futures
  and returns ordinary findings.

These are custody operations, not an evidence-admission API. A reply passed to
them is not thereby authenticated as experimental evidence. Use the broker for
acquisition, admission, matching and storage of experimental observations.

Each scan is bounded by its input queue length. Membership uses a linear scan
of the fixed recipient list. New findings and offers can increase storage;
the application must impose its declared capacities and work allowances.
The builder owns source allocations. Returned definitions contain schema and
function IDs, with no borrowed configuration slices or host continuations.

## Experiment broker

`agent.inquiry.broker.define` specializes subject, demand, exact experiment key,
observation, finding and policy schemas. `implement` accepts pure authored
admission, selection, observation-admission and early-finish functions. It emits a controller accepting
seeded custody, the frozen subject, an explicit pass allowance, the sharing
switch and ordinary policy. Its acquisition effect has a distinct identity and
explicit request/result schemas. `implementProtected` registers the actual
acquisition site as external write work through Agent's protected authoring path.
Admission may explicitly retire an offered future; the broker disposes it before
selecting further work, preserving unrelated futures throughout cleanup.

Application admission derives the key, permitted reuse, requirement priority
and tool cost. A key must cover the complete input, environment, mode, schema,
runner and access contract; the broker does not infer these facts from prose.
The default authored selector orders admitted views by priority class, shared
discriminating predictions, cost, then oldest generation. A supplied pure
discriminator interprets application predictions/actions. Sharing count alone
does not count as discrimination. Applicable cached work is selected before
new acquisition, using the same policy within that set.

The broker checks the returned subject, exact key and experiment occurrence
before admitting a completed observation. It stores the observation before
fan-out and sends ordinary `Evidence` or `NoNewEvidence` replies to a fixed
recipient set. Fresh demands acquire separately. Denial and inconclusive replies
are typed; transient failures are not cached. Conflicting deterministic results
retain both records and stop unresolved. Every stop disposes retained packages.

Controller outcomes distinguish finished control, unresolved work, allowance
stop, invalid selection, invalid evidence, environment unavailability and
conflicting observations. Finished control is not a repair-acceptance verdict.
The enclosing application still owns hypothesis revision, candidate validation,
live applicability and exact approval/delivery. A truthful executor is an
explicit assumption; an envelope cannot prove that a malicious host ran a tool.

## Executed witnesses

Run the focused authoring/ownership checks without World:

```sh
zig build check-inquiry-probe -Doptimize=ReleaseSafe
```

Add the unchanged authenticated runtime to execute every saved boundary in
native World, a fresh Node/WASM instance, and an independent Wasmtime process:

```sh
zig build check-inquiry-probe -Doptimize=ReleaseSafe \
  -Dworld-runtime="$PWD/.agent4/out/world-runtime"
```

The test continues using Wasmtime's actual returned bytes. All three engines
agree byte for byte in `run` mode. The independent expected traces and graph
assertions live in `test/agent4/inquiry_runtime.mjs`.

| Witness | Complete BPI2 bytes | Maximum pending PST2 bytes | Result |
| --- | ---: | ---: | --- |
| Direct owning queue | 1,182 | 424 | 92 |
| Reusable custody composition | 2,364 | 529 | Findings `(1,36), (3,56)` |
| New generations and stale delivery | 3,015 | 559 | Findings `(1,54), (3,74)` |

Each trace has three starts, one outer experiment, two model-shaped fixture
requests, and three suspending cleanups. Captured locals 10 and 20 produce
different non-tail results. Graph inspection establishes three coexisting
packages and preservation of unrelated packages during partial distribution
and retirement. The follow-up witness parks new generations 4 and 5, attempts
delivery to obsolete generations 1 and 3, and then independently resumes the
new generations. Duplicate resume, duplicate disposal, queue duplication, and
illicit conversion of an obligated linear resumption to a multi-shot template
are rejected with `InvalidOwnership`.

These are deterministic mechanism witnesses, not live model synthesis or a
usefulness comparison. The locked shared World kernel is unchanged (413,317
bytes); the table reports application images separately.

The 9,712-byte numerical broker image runs 24 scenarios through Node/WASM and native
World, with Wasmtime transfer for shared acquisition, the sharing ablation,
cached follow-up and conflicting results. The same emitted image accepts at
most eight runtime demands. The executor computes a numerical measurement from
the requested immutable input; it has no hypothesis or scheduling table.
The tests cover default selection order, binding mutations, stale selection,
typed denial/inconclusive/unavailable replies, allowance stops, fresh samples,
conflicting results, and preservation of a previous result across a new offer.
Recipient requests expose the admitted observation occurrence: coalesced
recipients and cached follow-up share occurrence 1, while independent
acquisitions retain occurrences 1 and 2.
The synthetic model-shaped effect is only a continuation-transfer witness;
this consumer does not claim integration with a live language model.

| Waiting investigations | Actual shared experiments | Maximum pending PST2 bytes |
| ---: | ---: | ---: |
| 1 | 1 | 517 |
| 2 | 1 | 667 |
| 4 | 1 | 967 |
| 8 | 1 | 1,567 |

With coalescing disabled, two matching reusable demands cause two independent
acquisitions while retaining the same binding and conflict checks. This is a
mechanism ablation, not yet the required repair/ReAct comparison.

## Isolated repair experiments

`runtime/inquiry.mjs` exposes `probe` and `validate` for the single editable
`session.mjs` subject. Source bytes, runner identity and relative scope are
explicit inputs. Traces admit 1–24 operations: issue, encode a reply to an earlier
request, submit that original encoded reply, abort, close and inspect. Questions
use at most four byte-valued choices, 64 bytes of text and a 32-byte label. Source
is limited to 8,192 UTF-8 bytes; unsupported inputs reject before execution.
No hypothesis ID or diagnosis table participates in the executor.

The inspectable reduced reproduction and visible task contract are under
`test/consumers/inquiry/`. They were authored for this milestone, not discovered
as an unknown production incident. Test-only sibling data includes occurrence
reset and adapter rebinding defects, an already-correct module, and two distinct
repairs (a monotonic counter and retained ticket history). The production tool
does not import these repairs or compare source against them.

The local profile was qualified on macOS 27.0, build 26A428, with locked Node
26.8.2. It uses deny-by-default Seatbelt policy, exact Node dependency paths and
their symlink spellings, Apple's installed loader bootstrap profile, immutable
input files and a fresh scratch directory. It denies network access, process
creation, unrelated/checkout reads, outside writes, input mutation through
aliases and scratch permission changes. Only regular scratch-file creation,
data writes and removal are allowed. Environment inheritance is cleared.

The profile has a two-second process deadline, a 65,536-byte combined output
limit, 64 MiB V8 old space and 8 MiB semi-space settings. These are not a claim
of a universal process RSS bound. Cancellation and output overflow kill the
process group and await its exit before cleanup. Every environment creation
qualifies the restrictions with trusted probes; unsupported or changed runtime
inputs return unavailable, with no unsandboxed fallback. Relative scratch roots
and spaces are tested. `sandbox-exec` is deprecated and Apple's dyld profile is
a private interface: this is a qualified local profile, not a portable OS API.

The JavaScript realm is an additional separation layer for the session API,
not the security boundary. Imports are unavailable, and only bounded serialized
observations reach the parent evaluator. Node explicitly disclaims security
guarantees for [VM contexts](https://github.com/nodejs/node/blob/main/doc/api/vm.md)
and its [permission model](https://nodejs.org/api/permissions.html).
The runner identity binds Node/dependencies, the driver, adapter, evaluator,
loader profile, resource configuration and acceptance contract. Probe reuse
still needs an application-authorized deterministic subject contract; freezing
arbitrary JavaScript does not make it deterministic.

Acceptance runs 16 prescribed checks across matched modes. Expected transitions
use symbolic request references, so a candidate's colliding IDs cannot redefine
which reply ought to be accepted. Rejection preserves authoritative state;
occurrences must be distinct, without requiring a preferred numbering scheme.
Both repairs pass. Both root causes, accept-all, reject-all, state-reset,
display-only, forged-verdict, early-exit and JSON-tampering replacements fail.
The evaluator and expectations remain outside the candidate process; missing
observations, nonzero exit, timeout, cancellation and malformed output cannot
become successful acceptance.

```sh
node test/agent4/inquiry_executor.test.mjs
```

The executed test recorded 17 logical requests, 151 candidate-process launches
and two separate qualification launches. The integration and focused inquiry
build steps include this test when a World runtime is selected. These are
executor/acceptance results; the separate end-to-end World witness is described below.

## World repair composition

The consumer under `test/consumers/inquiry/` uses public Agent and Boundary
imports. One shared investigator body takes runtime hypothesis data; the program
assigns investigation IDs and hypothesis versions. Existing model normalization
and interpretation admit batches of flat typed operations into a bounded trace.
The image checks operation references, prediction selectors, requirement IDs,
subject scope and the accepted contract before requesting an experiment.
The model supplies complete candidate source, with no compiled repair catalog.

The scripted execution retains A, B and C, executes A/B's common trace once,
and compares their different predictions in authored code. A requests a
different-question trace. B is contradicted and offers retirement; its actual
future is disposed through suspending cleanup while two other packages survive.
The follow-up advances A and C. A returns a revision and the shared body starts
its next program-assigned version. An initially proposed reject-all repair fails
the prescribed checks; a different replacement is then tested successfully.

The application rereads the logical target, verifies the frozen base, obtains
exact approval and conditionally replaces the isolated fixture file. The read
proof binds the complete checked proposal: target, base, candidate bytes and
check record, runner/contract, principal and attempt. An amendment changing that
proposal cannot obtain a challenge backed by old validation. The final portable
receipt retains the base, replacement, executed checks and qualified explanation.

```sh
zig build check-inquiry-application -Doptimize=ReleaseSafe \
  -Dworld-runtime="$PWD/.agent4/out/world-runtime"
```

The current positive witness uses a 43,774-byte BPI2 image, reaches a maximum
48,853-byte pending State, makes 10 model requests and 4 logical experiment
requests (34 isolated executions), retires/cleans all three investigations,
then approves and delivers the exact replacement. Every transition is compared
byte for byte across Node/WASM, native World and Wasmtime, continuing from the
independent guest's returned bytes. Graph assertions cover three parked futures
and preservation of other packages during retirement cleanup.

Approval fixtures reject decline, a wrong principal, stale challenge, foreign
target and unvalidated amendment without a write. Changing the live file during
approval produces a conditional-delivery conflict; an old outer result also
rejects. No real user repository is modified. These prescribed provider replies
establish the mechanism, not previously unknown model synthesis or usefulness.

The same focused command runs 33 additional scenarios, plus the comparison cases below: a different root cause
and repair, an already-satisfied subject, inadequate initial hypotheses, invalid
model proposals and provider responses, observation/acceptance rejection,
resource stop, cancellation, delivery intent and model-only exploration.
The application sharing ablation uses the same image and model inputs: two
matching investigations acquire one experiment with coalescing enabled and two
with it disabled, retaining identical authority and binding checks.

The repair image also accepts 1/2/4/8 investigations without recompilation.
Each scaling fixture parks exactly that many packages, shares one actual probe,
and cleans all of them after an honest unresolved result:

| Investigations | Model requests | Experiments | Maximum pending State bytes |
| ---: | ---: | ---: | ---: |
| 1 | 3 | 1 | 27,957 |
| 2 | 5 | 1 | 28,596 |
| 4 | 9 | 1 | 29,717 |
| 8 | 17 | 1 | 31,645 |

These are bounded fixture observations, not a constant-space or latency claim.

Optional exploration uses `agent.deliberation` after evidence arrives. Two
model-only alternatives inherit a private cell containing 10, independently
write 11 and 12, and retain those values across model suspension. The fixture
records four templates and eight activations while another investigation remains
parked. The selected ordinary proposal drives a second real experiment outside
the speculative scope before cleanup. Actual experiment effects inside the delimiter fail protected authoring
with `SpeculativeEffect`, including when hidden behind an inaccurate wrapper row.
The policy accepts the first normalized proposal, falling back to the second;
this is not a claim of optimal proposal selection.

Delivery intent can be known or explicitly requested: return a checked artifact,
or conditionally write after separate exact approval. Clarification answers echo
the complete task and authored occurrence. Other, NotSure, unoffered choices,
abort, close and wrong-context answers remain distinct outcomes. Artifact-only
delivery returns the checked proposal without approval or a write.

The repeated-use image runs four tasks through one `agent.conversation` state.
Its authored caller assigns epochs 1–4, overriding incoming attempt/epoch values;
the epoch qualifies experiment subjects and clarification occurrences. Repeated
provider IDs cannot reset it. Old outer replies and re-encoded stale inner
answers reject. Across 28 model requests, four experiments, eight cleanups,
eight templates and 16 activations, every completed-task boundary retains exactly
170 State bytes, two nodes and one blob, with no packages, templates, branches,
resources, cells or obligations. The complete repeated image is 44,120 bytes.

The application also builds as an independent compiler-only consumer:

```sh
zig build --build-file test/consumers/inquiry/build.zig \
  -Doptimize=ReleaseSafe --prefix "$PWD/.agent4/out/inquiry-external"
```

Its repair, repeated-use and ReAct images match the root build byte for byte.

## Use archive and compilation measurements

`emit-agent4` includes the inquiry, repeated-use and ReAct images, their ordinary Boundary schemas,
the visible contract and the executor's complete runtime modules in the existing
use archive. The packaged zero-work InitialArgs is a configuration example;
actual runs supply a qualified runner and explicit operator allowances.
Optional provider fixtures remain under `test/` and are never imported by the
production executor.

```sh
zig build emit-agent4 -Doptimize=ReleaseSafe \
  -Dworld-runtime="$PWD/.agent4/out/world-runtime"
node --test test/agent4/package_commands.test.mjs
zig build check-agent4-economy -Doptimize=ReleaseSafe \
  -Dworld-runtime="$PWD/.agent4/out/world-runtime"
```

The archive test extracts the actual artifact and runs its own inquiry oracle,
runtime modules and image against unchanged World. It completes the 10-model,
four-experiment repair and approval-negative cases without authoring sources or
a compiler. The economy aggregate passes and binds observed compilations to the
same application bytes:

| Image | Bytes | Schemas | Functions | Blocks | Constants | Constant bytes |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Repair | 43,774 | 184 | 106 | 1,111 | 157 | 9,135 |
| Repeated use | 44,120 | 187 | 109 | 1,123 | 158 | 9,145 |
| ReAct | 48,815 | 146 | 65 | 791 | 145 | 8,764 |

The inquiry images contain two handler definitions; ReAct contains none.
Complete compiler phase observations live
in `zig-out/agent4/economy/source-metrics.json`; the existing economy report is
`zig-out/agent4/economy-results/economy-report.json`. This run uses functional
mode: phase times are diagnostics, not isolated timing or speedup evidence.

## Single-trajectory comparison

`inquiry/react.bpi2` uses `agent.react` with ordinary working records, a current
explanation/version and an exact-key observation cache. It shares the inquiry
consumer's model protocol, plan parser, trace admission, prediction reporting,
candidate acceptance and live approval/delivery code. It can retain reusable
observations, revise its account, propose arbitrary admitted traces and submit
replacement source. It starts directly with a single model trajectory; it does
not pay the inquiry construction's initial hypothesis-population request.

The same task specifies source, requirements, model, experiment passes and final
authority. The baseline receives the inquiry's total model allowance
(`1 + investigations * model_turns`) and the same experiment-pass allowance.
Both paired strategies disable optional multi-shot exploration. This compares
one executable trajectory with retained inquiry under declared fixture choices;
it does not establish live-model repair quality or an optimal allocation policy.

```sh
zig build check-inquiry-comparison -Doptimize=ReleaseSafe \
  -Dworld-runtime="$PWD/.agent4/out/world-runtime"
```

The pairs cover occurrence reset, adapter rebinding, already-correct source and
an inadequate explanation set. Both repair scripts repeat an eligible probe,
change the next trace after evidence, revise the account, reject a bad candidate
and independently check its replacement. The test host supplies provider values;
the images interpret evidence, admit cache reuse and decide whether to deliver.

The executed pairs below agree across native World, Node/WASM and fresh
Wasmtime instances, continuing from the independent embedding's returned bytes.

| Case | Strategy | Model calls | Logical / physical experiments | Maximum State bytes | Peak allocated payload bytes |
| --- | --- | ---: | ---: | ---: | ---: |
| reset | Inquiry | 11 | 4 / 34 | 48,985 | 1,880,205 |
| reset | ReAct | 6 | 4 / 34 | 67,654 | 2,151,174 |
| rebinding | Inquiry | 11 | 4 / 34 | 48,095 | 1,876,695 |
| rebinding | ReAct | 6 | 4 / 34 | 67,083 | 2,148,761 |
| already-correct | Inquiry | 7 | 2 / 17 | 37,010 | 1,834,382 |
| already-correct | ReAct | 2 | 2 / 17 | 43,968 | 2,050,768 |
| inadequate | Inquiry | 7 | 1 / 1 | 29,030 | 1,833,370 |
| inadequate | ReAct | 2 | 1 / 1 | 26,054 | 1,978,257 |

Both repaired cases have one cache hit, one hypothesis revision, a failed
16-check candidate followed by a passing 16-check candidate, and one exact
approval/write. Already-correct source needs no approval/write; inadequate
explanations stop unresolved. Completed outcomes retain no continuation State.
The economy report includes semantic/provider byte counts, actual observed
recipient IDs, demands, reuse, cleanup, check outcomes and complete image metrics.
Separate baseline negatives reject a foreign subject, key, occurrence and
incomplete acceptance; an inconclusive validation retains the attempted source
for the next model request.

These fixtures favor ReAct in model work. Their State/image differences also
depend on the concrete source construction; neither result is a general ranking
of the strategies. No latency or live-model usefulness claim follows.

Native diagnostics use World's public workspace allocator to report maximum
live allocated payload per invocation, including image/State decoding and the
interpreter's outcome allocations. This excludes host input/output buffers and
allocator metadata; it is neither RSS nor a whole-session heap measurement.
The test host grants 256 MiB backing capacity for this diagnostic lane. Canonical
results are compared with the unchanged Node/WASM and Wasmtime executions.

## Opt-in live entry and comparison

The source-independent archive includes `runtime/inquiry_cli.mjs`. It dispatches
only emitted effects through the existing model/executor/delivery adapters.
Investigation policy stays in the selected image. Each public boundary is saved
as ordinary PKO2; returned replies are saved as bound ERS2 before continuing.
No report, transcript, provider session or host investigation table is needed
to restore the image and checkpoint.

Select a model, endpoint, corpus, execution profile and resource allowances
explicitly. This example is a configuration template, not previously authorized
operator choices; paths resolve relative to its JSON file:

```json
{
  "name": "session-case-01",
  "corpus": "operator-supplied-holdout",
  "worldRuntime": "/absolute/path/to/world-runtime",
  "images": "/absolute/path/to/extracted/examples/inquiry",
  "targetRoot": "/absolute/path/to/subject-directory",
  "strategy": "inquiry",
  "provider": {
    "endpoint": "https://api.openai.com/v1/responses",
    "model": "YOUR_EXPLICIT_MODEL",
    "keyEnv": "INQUIRY_API_KEY"
  },
  "profile": "macos-seatbelt-session-v1",
  "allowance": {
    "modelRequests": 40,
    "experiments": 8,
    "requestBytes": 1048576,
    "elapsedMs": 300000,
    "modelTimeoutMs": 30000
  },
  "task": {
    "investigations": 3,
    "passes": 24,
    "modelTurns": 12,
    "reusable": false,
    "explore": false,
    "intent": "artifact",
    "principal": "7"
  }
}
```

The target contains one regular `session.mjs`; symlink/traversal reads are
rejected through the existing document environment. The logical target identity
binds its physical directory. `reusable: true` requires the operator's declared
deterministic subject contract. `intent` is `artifact`, `deliver` or `ask`;
clarification and exact-candidate approval remain different interactions.

```sh
# Prepare a checkpoint without inference authority.
node runtime/inquiry_cli.mjs run --config case.json --out prepared

# Separately authorized inference; credentials are read only at dispatch.
node runtime/inquiry_cli.mjs run --config case.json --out attempt \
  --from prepared/0000.pko2 --authorize-inference
```

Only a later operator invocation with explicit inference authorization may make
network/paid calls. The named credential variable is read only then; there is no
automatic key discovery, dotenv loading or provisioning. Credentialed endpoints
retain the existing model adapter's endpoint restriction. The resource allowance
bounds this invocation's calls, experiments, request bytes and elapsed time; it
is not a dollar-cost guarantee. A resumed invocation requires a new explicit
allowance and produces a separate report. Actual work does not reset inside a
speculative branch. Exhaustion cancels World and services its cleanup requests.

Every output directory must be new and outside the runtime, image and target
roots. `report.json` names the latest checkpoint and distinguishes application
outcomes, resource stops, pending human input and uncertain dispatch. A crash
or failed checkpoint write does not prove cleanup or exactly-once execution;
there is no automatic retry. Copy the image and PKO2 to restore elsewhere, then
supply the appropriate external environment and authority.

At a human interaction, inspect `question.json`; an approval also exports
`base.mjs`, `replacement.mjs`, `repair.diff` and `proposal.json`. Answer the
specific saved boundary and pass its bound ERS2 back unchanged:

```sh
node runtime/inquiry_cli.mjs answer --config case.json \
  --from attempt/0004.pko2 --choice approve --out answer.ers2
node runtime/inquiry_cli.mjs run --config case.json --out successor \
  --from attempt/0004.pko2 --result answer.ers2 --allow-write
```

Use the actual checkpoint named by the report. Intent choices are `artifact`,
`deliver`, `other` and `not-sure`; approval choices are `approve` and `decline`.
Both support `abort` and `close`. `--allow-write` is separate target-mutation
authority and never replaces the program's approval. Artifact-only completion
exports the same reviewable files without a write. The diff is independently
tested by applying it with Git and comparing the resulting source bytes.

A corpus JSON file is an array of configuration paths, for example
`["case-01.json", "case-02.json"]`. Each case must use artifact-only intent.
The comparison freezes each source once and performs one attempt per strategy,
with that case's same provider/profile/allowances and independent checkpoints:

```sh
node runtime/inquiry_cli.mjs compare --corpus corpus.json --out study \
  --authorize-inference
```

`comparison.json` records every attempted pair, including unavailable inputs,
failed runs and resource stops, with references to per-attempt reports. There
are no automatic repeated samples or winner selection. Reports include actual
model/tool attempts, semantic byte counts, provider request bytes, executor
physical executions and application outcomes. Provider response bytes are marked
unmeasured because the existing normalized transport does not expose them;
deterministic paired tests independently measure both provider directions.
Select held-out cases and varied causes before a later live study. No live-model
usefulness study or paid inference was performed for this milestone.

`zig build check-inquiry-cli -Doptimize=ReleaseSafe -Dworld-runtime=...` tests
both strategies against a local synthetic HTTP provider, actual isolated
candidate execution, saved-state recovery, stale-result rejection, intent,
exact approval, conditional delivery, resource cancellation and source-scope
rejection. The normal integration and use-archive tests include this path.

## Validation and limits

The implemented source has passed the existing authoring, integration, functional
economy and emission/package gates:

```sh
zig build check-agent4 check-agent4-integration check-agent4-economy emit-agent4 \
  -Doptimize=ReleaseSafe -Dworld-runtime="$PWD/.agent4/out/world-runtime"
```

The strengthened multi-shot/follow-up fixture also passes the application case
runner under native, Node/WASM and Wasmtime. Draft PR #31 holds publication and
review status. These executions establish the declared mechanism and finite test
contracts; they do not establish universal repair correctness or live-model
usefulness. The selected Boundary/World and toolchain inputs remain unchanged.

No paid inference, credential discovery, real user-repository repair, PR
promotion, merge or release was performed. A later live study needs its own
explicit provider/corpus/profile/resource selection and inference authority.
