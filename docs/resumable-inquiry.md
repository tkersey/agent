# Resumable inquiry

Implementation in progress. The current code implements future custody and the
authored experiment broker required by the accepted Resumable Inquiry v1
specification. The complete diagnose-and-repair application is still pending.

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
admission, selection and early-finish functions. It emits a controller accepting
seeded custody, the frozen subject, an explicit pass allowance, the sharing
switch and ordinary policy. Its acquisition effect has a distinct identity and
explicit request/result schemas. The caller classifies that real outer effect
through the existing protected authoring path when composing speculation.

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

The 8,904-byte numerical broker image runs 24 scenarios through Node/WASM and native
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
mechanism ablation, not yet the required repair/ReAct comparison. Full compiler
economy and working allocation measurements remain pending.

## Remaining milestone work

The accepted objective remains the full Agent-only milestone: hypothesis revision
and application outcome paths; the repeated-interaction repair consumer with model-supplied
traces and source; qualified isolated execution and independent acceptance;
exact live approval/delivery; sibling repair cases; speculative
model-only integration; cancellation/clarification/approval transfer; package
consumption; the repair/ReAct comparison, application sharing ablation and economy;
and one draft PR through Ship/review-closeout. Full integration, economy and
packaging acceptance have not been established by these focused witnesses.

No paid inference, credential discovery, dependency/toolchain update, real
user-repository repair, PR promotion, merge, or release is authorized here.
The live-model usefulness study has not run.
