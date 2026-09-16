# Resumable inquiry

Implementation in progress. The deterministic World diagnose-and-repair path
now connects retained investigations, real isolated experiments, hypothesis
revision, independent candidate checks and exact approved delivery. The broader
milestone coverage and review-closeout remain open.

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
mechanism ablation, not yet the required repair/ReAct comparison. Full compiler
economy and working allocation measurements remain pending.

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

The current positive witness uses a 43,919-byte BPI2 image, reaches a maximum
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

The same focused command runs 29 additional scenarios: a different root cause
and repair, an already-satisfied subject, inadequate initial hypotheses, invalid
model proposals and provider responses, observation/acceptance rejection,
resource stop, cancellation, delivery intent and model-only exploration.
The application sharing ablation uses the same image and model inputs: two
matching investigations acquire one experiment with coalescing enabled and two
with it disabled, retaining identical authority and binding checks.

Optional exploration uses `agent.deliberation` after evidence arrives. Two
model-only alternatives inherit a private cell containing 10, independently
write 11 and 12, and retain those values across model suspension. The fixture
records two templates and four activations while another investigation remains
parked. Actual experiment effects inside this delimiter fail protected authoring
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
resources, cells or obligations. The complete repeated image is 44,265 bytes.

The application also builds as an independent compiler-only consumer:

```sh
zig build --build-file test/consumers/inquiry/build.zig \
  -Doptimize=ReleaseSafe --prefix "$PWD/.agent4/out/inquiry-external"
```

Its repair and repeated images match the root build byte for byte. This establishes
public source consumption; source-independent use-archive execution remains open.

## Remaining milestone work

The accepted objective remains the full Agent-only milestone. Remaining work
includes the live entry path, source-independent use-archive consumption,
repair/ReAct comparison, complete compilation/economy measurements,
and final Ship/review-closeout. Draft PR #31 tracks the implementation. Full
integration, economy and packaging acceptance have not been established by these
focused witnesses.

No paid inference, credential discovery, dependency/toolchain update, real
user-repository repair, PR promotion, merge, or release is authorized here.
The live-model usefulness study has not run.
