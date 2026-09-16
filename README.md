# Agent

**Build agents as portable, resumable programs.**

This branch is migrating to Boundary 3 / World 6. Agent authoring now emits BPI3
through an exactly pinned successor compiler; the normal runtime loader and
integration package still need ABI 3 migration. The predecessor runtime examples
below do not yet run these new images. See [migration status](docs/compositional-execution.md).

Agent is a Zig library for building agents that work with models, people, and
tools. You author the control flow; [Boundary](https://github.com/tkersey/boundary)
checks and compiles it into portable program data;
[World](https://github.com/tkersey/world) executes it natively or in WebAssembly.

The important difference is what can travel: **not just the conversation, but
what the agent is doing and what happens next.** Pause for clarification, retain
a child dialogue, explore alternatives, or wait for approval. Save the execution
state and resume on another compatible host, with the program's local state,
scopes, and pending cleanup intact.

[Capabilities](#what-you-can-build) ·
[How it works](#why-boundary-and-world) ·
[Examples](#complete-applications-not-just-api-snippets) ·
[Get started](#get-started)

## What you can build

### Your agent, your control flow

Compose the interactions your application needs: decisions, loops, nested
computations, tool use, and continuing conversations. ReAct is an available
library composition, not a mandatory runtime loop. Model profiles, prompts,
skills, and application policies become part of the compiled program rather
than executable policy hidden in host callbacks.

### The same question, answered by a model, a person, or a rule

A typed question separates **what the program needs to know** from **how it gets
the answer**. Interpret the same decision body with a model responder, a human
interaction, a deterministic rule, or another authored computation. Each answer
returns to the same call site. Model responses are checked against the exact
actions offered when the request was made; an answer is not permission to act.

### Conversations that survive interruptions

Ask for clarification in the middle of a turn without flattening the rest of the
work into a host-side state machine. Keep a child dialogue parked while the
surrounding program does other work, then resume or dispose of it explicitly.
Scoped model, prompt, skill, tool, and memory interpretations survive suspension
and restore their enclosing context on exit. A turn can finish while the
conversation stays open; aborting a turn, closing the conversation, and cancelling
execution remain distinct operations.

### Explore alternatives before committing to one

Use multi-shot continuations to evaluate alternatives from the same point in a
computation, retaining alternatives across state transfers. Immutable evidence
can inform the exploration while captured mutable state follows Boundary's
branch-local region semantics. Agent's protected authoring checks reject writes,
commits, approval, live-evidence acquisition, and unclassified effects inside
speculation. This is **exploration without granting speculative branches the
authority to commit**, not a claim that model calls or search are free.

### Make approval part of the program, not a prompt convention

Bind approval to the exact proposal, the approving principal, current policy,
and required live evidence. An amendment requires a new approval; simulated
observations cannot manufacture the corresponding live-read authority. The
program consumes its internal grant before requesting the commit and treats
uncertain delivery as something to reconcile, not automatically retry. The
external tool still enforces its final preconditions atomically.

## Why Boundary and World?

**Agent authors. Boundary checks and compiles. World executes. The environment
supplies effects.**

| Layer | Responsibility | What you gain |
| --- | --- | --- |
| **Agent** | Typed agent constructions, semantic contracts, and protected authoring checks | Agent-specific building blocks without a second execution model |
| **Boundary** | Check types, effects, captures, and resource use; compile the complete computation | Control flow, handlers, and policies represented as portable program data |
| **World** | Interpret the program and admit its saved state using one generic native/WASM runtime | Execution without the Agent compiler, application source, or an application-specific WASM kernel |
| **Your environment** | Resolve typed requests using models, people, credentials, and real tools | External authority stays explicit rather than becoming hidden continuation state |

Boundary turns the authored computation into a **program image** (`BPI2`). World
carries unfinished execution in **saved state** (`PST2`), including the
continuations needed to resume. The program image and complete saved state—not
a transcript, a suspended JavaScript callback, or an originating process—carry
the application control.

That separation makes it possible to deploy compiled agents without their
source, inspect a pending request without executing a tool, and resume the same
program through a different compatible embedding. Every application uses the
same World kernel. Agent adds neither its own evaluator nor another portable
execution-state format. Boundary remains a general computation library; Agent
is an optional authoring layer, not a restriction on what Boundary can express.

## Complete applications, not just API snippets

The repository includes independent consuming packages built with the public
Agent and Boundary APIs.

**[Document assistant](test/consumers/document).** Combines clarification,
live document reads, model-backed assessment of alternatives, a retained critic
dialogue, approval, and conditional replacement of a real file. The application
keeps its conversation open across turns. Its tests exercise successful changes,
amendments, conflicting edits, declined approval, uncertain delivery, and
cleanup—not just a happy-path transcript.

Its opt-in [consequence-sensitive mode](docs/consequence-clarification.md) explores
both scopes of a terminology edit before asking. Equal permitted edits skip the
scope question; different edits expose their actual consequences. Fresh evidence
and exact-proposal approval still precede replacement.

**[Review agent](test/consumers/review).** Runs the same decision body with human,
model, and rule responders; composes clarification before or during review; and
includes an ordinary ReAct composition. The application, not the compiler or a
host adapter, chooses the order of work.

The [acceptance evidence](conformance/agent4/evidence.md) maps these capabilities
to executable tests, including source-independent execution, state transfer,
and agreement between native World, Node/WASM, and an independent Wasmtime
embedding. Required tests use synthetic provider replies and real tools in
isolated fixture directories: no personal credentials or paid inference. These
are finite execution checks, not claims about live-model quality.

## Get started

Use **Zig 0.16.0** and **Node 26.8.1 or newer**. Agent 4 pins Boundary 2.0.2 and
World 5.0.2 source commits in its [dependency lock](conformance/agent4/dependencies.lock.json); use
that exact Boundary/World combination rather than substituting other versions.
The locked source-installation profile is POSIX, qualified on Darwin arm64;
Windows setup is not qualified.

### Compile and check the examples

```sh
git clone https://github.com/tkersey/agent.git
cd agent
zig build check-agent4 -Doptimize=ReleaseSafe
```

This fetches the exact locked Boundary package and checks authoring, contracts,
and example compilation **without installing World**. The authoring check also
works from an extracted source package without Git metadata.

### Execute the integration examples

Acquire the locked World inputs explicitly, then run the integration checks:

```sh
node tools/agent4/setup.mjs
zig build check-agent4-integration -Doptimize=ReleaseSafe \
  -Dworld-runtime="$PWD/.agent4/out/world-runtime"
```

The repair executor's qualified profile is macOS Seatbelt. On other hosts,
the general integration target keeps the portable World/Agent checks and
reports inquiry execution as unavailable; this does not validate the repair
executor. Explicit `check-inquiry-application` and `check-inquiry-comparison`
execution still require that profile. See [inquiry validation](docs/resumable-inquiry.md).

The optional runner can **start, resume, inspect, and cancel** saved World
outcomes using canonical reply bytes, without a UI or provider session. See
[the runtime guide](docs/agent4-runtime.md) for complete commands, the JavaScript
embedding API, and direct World execution without the convenience bridge.

### Author your own program

A consuming package imports `agent` and `boundary`. An application emitter
constructs a Boundary module; `agent.system` binds its input, result, failure,
and optional catalogs, and `agent.compile` produces the compiled program. The
[document](test/consumers/document) and [review](test/consumers/review) packages
include complete build configuration and executable emitters.

<details>
<summary>Minimal staged Zig example</summary>

This small emitter performs one typed external read. It illustrates the
authoring boundary; the complete applications above show the agent compositions.

```zig
const agent = @import("agent");
const boundary = @import("boundary");

const Application = struct {
    pub fn emit(c: agent.Context) !boundary.computation.Module {
        const b = c.builder;
        const integer = try c.schema(u32);
        const unit = try c.schema(void);
        const read = try c.external("example.read.v1", integer, integer, .read);
        const entry = try b.declare(&.{integer}, integer, &.{read}, &.{});
        try b.define(entry, try b.term(.{ .perform = .{
            .effect = read, .payload = try b.reference(b.parameter(entry, 0)),
        } }));
        return b.module(entry, unit);
    }
};

const System = agent.system(.{
    .InitialArgs = u32, .Result = u32, .Failure = void,
    .application = Application,
});
// var compiled = try agent.compile(allocator, System);
// defer compiled.deinit();
```

Native emitters run only while authoring: arbitrary Zig closures and stack
frames are not translated or checkpointed. Helpers construct the same public
Boundary source terms available to your application. The optional
`agent_contracts` module provides pure schema/value support without a compiler
or runtime dependency. Supplied catalogs are checked and available through
`Context.catalogs`.

</details>

<details>
<summary>Packaging, economy checks, and development inputs</summary>

Creating a use archive is separate from checking authoring. Run this from an
Agent Git checkout so packaging can record its source provenance:

```sh
zig build emit-agent4 -Doptimize=ReleaseSafe
```

The archive contains compiled examples and runtime support; World remains a
separately supplied, authenticated dependency. No runtime kernel is built per
application. See [packaging and execution](docs/agent4-runtime.md) for archive
contents, receipts, and source-independent use.

With World acquired, run the economy checks separately:

```sh
zig build check-agent4-economy -Doptimize=ReleaseSafe \
  -Dworld-runtime="$PWD/.agent4/out/world-runtime"
```

Without the supported inquiry execution host, economy reports
`PASS_PORTABLE_ONLY` with `inquiryComparison: UNAVAILABLE` when its portable
checks pass. It does not report a passing inquiry/ReAct experiment comparison.

Use `--cache-dir` and `--global-cache-dir` inside the isolated Agent checkout when
working alongside other deliveries. `-Dboundary-v2-source=/absolute/immutable/copy`
is an optional development input, verified against the same lock. Its authentication
check also runs when an external build consumes Agent's exported modules.
Native agreement tests use the separately authenticated unchanged World source acquired by setup.

For `node tools/agent4/setup.mjs --work-dir "$PWD/.agent4-inputs"`, pass
`-Dworld-source="$PWD/.agent4-inputs/inputs/world"` and
`-Dworld-runtime="$PWD/.agent4-inputs/out/world-runtime"` to both aggregates.
The archive defaults to `world-<first seven commit characters>.tar.gz` beside the selected source;
`-Dworld-archive=/absolute/immutable/archive.tar.gz` selects a different location.
All selected inputs are checked against the same lock before and after execution.
Permission modes are never normalized to bypass exact inventories.

</details>

## Compatibility and trust boundaries

The current package is **Agent 4 development** (`4.0.0-dev.0`), with the exact
Boundary 2 / World 5 inputs recorded in the lock. That dependency selection is
not a claim of compatibility with independently released versions. Agent 3
artifacts stay on their frozen BPI1/PST1 runtime; active-state migration is not
supported. See [migration from Agent 3](docs/migration_from_3.md).

Portable state is not a distributed persistence service. Your embedding must
persist and protect checkpoints; the reference runner is single-writer, with
one outstanding external request per computation. Snapshot portability supplies
neither encryption nor global anti-replay. Protected authoring assumes trusted
application authors and conforming environmental handlers. Authentication,
external deduplication, and atomic tool preconditions remain environmental
responsibilities; cancellation is not external rollback or an exactly-once
guarantee. See [the architecture](docs/architecture.md) and
[runtime custody rules](docs/agent4-runtime.md) for the precise boundaries.

## Go deeper

| Guide | Start here for |
| --- | --- |
| [Architecture](docs/architecture.md) | Ownership, typed decisions, continuations, scopes, and protected admission |
| [Runtime and portable archives](docs/agent4-runtime.md) | Running, saving, resuming, inspecting, cancelling, and embedding agents |
| [Model invocation contract](docs/model-invocation-v3.md) | Model configuration, offered actions, normalization, and response admission |
| [Acceptance evidence](conformance/agent4/evidence.md) | Executable capability checks, portability, measured economy, and limitations |

[MIT licensed](LICENSE).
