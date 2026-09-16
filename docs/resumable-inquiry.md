# Resumable inquiry

Implementation in progress. The current code establishes the owned-future
construction required by the accepted Resumable Inquiry v1 specification; it
does **not** yet implement the complete inquiry controller or repair application.

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
them is not thereby authenticated as experimental evidence. The forthcoming
controller must own admission, key matching, selection, acquired observations,
and resource/no-progress policy before the repair application can use them.

Each scan is bounded by its input queue length. Membership uses a linear scan
of the fixed recipient list. New findings and offers can increase storage;
the application must impose its declared capacities and work allowances.
The builder owns source allocations. Returned definitions contain schema and
function IDs, with no borrowed configuration slices or host continuations.

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

## Remaining milestone work

The accepted objective remains the full Agent-only milestone: reusable authored
admission/selection/applicability and observation storage; typed non-success
and revision paths; the repeated-interaction repair consumer with model-supplied
traces and source; qualified isolated execution and independent acceptance;
exact live approval/delivery; sibling and non-repository cases; speculative
model-only integration; cancellation/clarification/approval transfer; package
consumption; the ReAct comparison, sharing ablation and 1/2/4/8 scaling series;
and one draft PR through Ship/review-closeout. Full integration, economy and
packaging acceptance have not been established by these focused witnesses.

No paid inference, credential discovery, dependency/toolchain update, real
user-repository repair, PR promotion, merge, or release is authorized here.
The live-model usefulness study has not run.
