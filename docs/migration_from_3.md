# Migrating to the compositional Agent 4 successor

Agent 4 authors BPI3 Programs for Boundary 3 / World 6. Unfinished execution is
PST3; current invocation and reply envelopes are PKI3/PKO3 and ERQ3/ERS3.
Recompile applications and start new executions. Agent 3 BPI1/PST1 artifacts,
predecessor Agent 4 BPI2/PST2 artifacts, and earlier draft checkpoint grammars
require their original pinned pair; there is no automatic state conversion.

The **candidate-integration** tuple in
[the dependency lock](../conformance/agent4/dependencies.lock.json) selects the
exact Boundary 3.0.0-dev.0 and World 6.0.0-dev.0 commits, source/package
inventories, runtime/kernel identities and physical profile. These are successor
branches, not published releases. [Current status](compositional-execution.md)
records validation and remaining acceptance work.

The historical Interpretation v1 BPI1 emitter, fixed Machine-v2 driver, kernel
acquisition and world-host/world-capabilities lock are retired. Current source-
independent packages and native/WASM/browser transfer exercise the one generic
World kernel. Model proposals remain data; current approval and inquiry owners
retain their authority and continuation responsibilities.

## Replace the system's runtime template with an emitter

The Agent 4 `agent` module is rooted at [`src/agent4.zig`](../src/agent4.zig).
Import `agent` and the same locked `boundary` authoring module in a consumer.
Pure schemas and value encoding are also available through `agent_contracts`.
Authoring does not require a World installation, a WASM engine, or credentials.

Replace the Agent 3 `Goal`/`Action`/`Observation` system and sealed `strategy`
selection with `InitialArgs`, `Result`, `Failure`, and an application type with
`emit(context)`. The optional `models`, `prompts`, `skills`, `tools`, and
`interactions` fields retain declarations for the application; declaring them
does not install a runtime topology or activate a handler. Construct and wire
the required operations in the emitter.

This minimal headless body returns its input:

```zig
const agent = @import("agent");
const boundary = @import("boundary");

const Application = struct {
    pub fn emit(c: agent.Context) !boundary.computation.Module {
        const b = c.builder;
        const integer = try c.schema(u32);
        const entry = try b.declare(&.{integer}, integer, &.{}, &.{});
        try b.define(entry, try b.pure(try b.reference(b.parameter(entry, 0))));
        return b.module(entry, try c.schema(void));
    }
};

const System = agent.system(.{
    .InitialArgs = u32,
    .Result = u32,
    .Failure = void,
    .application = Application,
});
```

Call `agent.compile(allocator, System)` and release the returned Boundary
`Compiled` with `deinit()`. Its `encode` method emits the canonical BPI3 image.
The entry must take exactly one `InitialArgs` value and return `Result`; the
module's failure schema must match `Failure`.

`Context.builder` exposes ordinary Boundary source construction. Use its
functions, terms, handlers, regions, and computation arguments for branches,
loops, helpers, and nested control. `Context.schema(T)` and `literal(T, value)`
derive portable data; `Context.external(...)` declares and classifies an
environmental effect. `agent.compile` checks the completed source with Agent
admission before calling Boundary's compiler.

Do not port `system_compiler.ReactBody`, `strategy_v3.ProgramBody`, Flow, or a
host phase switch into the new application. `agent.react.define` and
`agent.react.run` build an ordinary reusable composition; using ReAct is
optional. All native Zig emitters run during authoring. A Zig function pointer,
closure, or native stack is not portable runtime control.

Application authors remain trusted to select policy and construct native source.
Agent's protected-path claim covers the final admitted construction and its
untrusted inputs; it is not a sandbox against native code that forges registry
records or mutates Builder internals. Raw Boundary authoring must pass the same
final Agent admission to claim those protections.

## Port domain declarations and policy

| Agent 3 source | Agent 4 migration |
|---|---|
| Model descriptor | Keep `agent.model` for the named protocol, model identifier, and exact parameters. Use `agent.model_invocation.Profile` or `Question` for the concrete invocation contract. |
| Prompts and skills | Keep `agent.prompt.literal` and `agent.skill` as descriptors. Emit ordered instructions and activation as lexical source control through `agent.scopes` or ordinary arguments. |
| Action catalog and `u32` masks | Use `agent.tools.Descriptor` and descriptor-sized `agent.sets`; preserve each logical identity, payload/result schemas, and implementation association. |
| Epistemic/runtime hooks | Emit ordinary functions and scoped state for observation folding, retention, and context projection. Native hooks do not run after compilation. |
| Strategy/runtime emitter | Supply `Application.emit(c)`; build the actual authored order and return a Boundary module. |
| Failure/final-action routing | Use declared result sums and authored recovery. Root return, turn reply, local abort, and process cancellation have separate meanings. |

`agent.model_invocation` uses **`agent.model.invoke.v3`**, retaining the semantic
provider protocol `agent.model.protocol.openai-responses-v2`. Do not feed the
old BPI1 value encoding to this effect. A profile supplies `Request`, `Result`,
`declare`, `invocationValue`, `interpreter`, and `interpretAll`; `Question`
derives a non-executable answer declaration. Keep ordered messages, offered
declarations, exact parameters, selection policy, normalization limits, and
provider-response bounds in the authored request. Derive request-time offers
from the same declarations, retain them across the invocation, and pass them to
the staged interpreter. `interpretAll` preserves admitted calls in order;
single-answer interpretation rejects incompatible cardinality.

The provider adapter marshals semantic requests and normalizes responses. It
does not choose a model, rewrite prompts, select a convenient call, retry under
new settings, or turn a failure into a candidate. Generated schemas and strict
codec metadata preserve the association between a returned name and typed
variant. Models supply proposals, never authority.

Port model payloads to supported product/enum declarations with text, integer,
boolean, and enum fields. `agent.contracts.Text`, `Bytes`, and `Vector` express
explicit value bounds; integer widths and enum tags must be admitted. Exact
decimal parameters such as temperature remain strings. The model codec has a
narrower domain than portable interaction schemas: an unsupported model shape
is an authoring error, not permission to change Boundary or decode it loosely.

`agent.tools.Descriptor` distinguishes `.external` effect IDs from `.local`
staged function IDs. `model_offered` defaults to `false`; an offered declaration
also requires its model-visible name and description. Validate the catalog with
`agent.tools.validate`. `agent.tools.perform` handles permitted direct operations;
protected write/commit/approval roles require their checked owner. Availability
sets use one member per descriptor, including indexes beyond 31, rather than a
larger fixed mask.

Use `agent.approval.define` and `approveAndCommit` for protected commitment.
Retain the exact proposal and live precondition evidence; supply authored
authority and revalidation functions. The composition issues an occurrence,
checks the challenge and decision, and keeps grant custody internal. Amendment
requires a new challenge; a model answer or a Boolean cannot replace approval.
The environment authenticates principals and atomically enforces the final
precondition. Preserve explicit success, conflict, failure, and uncertain-delivery
results; uncertainty must not restore a grant for automatic retry.

## Preserve scope, memory, and unfinished control

`agent.scopes.define`, `read`, and `enter` implement lexical environments.
`scopes.narrow` appends instructions and intersects model/tool/skill permissions;
`overrideModel` returns an accepted or denied result that the application must
handle. Preserve base instruction order and lexical contribution order. Do not
rebuild scope from current files or provider session settings after restoration.

Use `agent.scopes.state` (Boundary's state construction), regions, and ordinary
values to distinguish conversation knowledge from turn scratch and speculative
branch state. Author observation-fold, retention, and provider-context projection
functions explicitly. Transcript retention is optional; it is not the
continuation. Avoid keeping provider JSON and duplicated cumulative prompts as
canonical memory. `agent.tools.Observation(Value)` distinguishes external,
simulation, and proposal values; the commitment policy must retain the relevant
provenance distinction. A finite retention window belongs to the application.

`agent.decision.define`, `ask`, `interpret`, and `handle` separate a typed
question from its responder. The responder is a statically authored reusable
computation with its declared effects and captures. It may use model or human
I/O, compute a rule, or delegate; it can clarify before returning to the original
call site. Answer substitution does not grant access to approval effects.

For a child that returns unfinished control, use `agent.dialogue.define`,
`start`, `offer`, `resumeWith`, and `dispose`. The internal result is
`Done(R) | Awaiting(Out, owned future)` with a typed input to the future. Consume
that future exactly once by resuming or disposing it. Put owned child regions
inside the handled body and keep borrowed caller regions live. The parent can
hold a child while doing another permitted interaction; no continuation handle
is exported to the host. Transfer moves the whole PST3.

`agent.deliberation` emits internal multi-shot control. Capture before acquiring
approval or exclusive live resources, declare the residual effects and captures,
and return candidate data from speculation. Keep branch-local memory separate
from live knowledge. Agent admission excludes protected authority and writes
from the speculative domain. Do not replace this with host-side PST3 cloning.

`agent.interaction.define` declares
`agent.interaction.exchange.v1.<contract-name>`. `exchange` emits the ordered
payload `(channel, purpose, presentation, outgoing)`. The reply sum always
includes the declared input and includes abort/close only when declared. Names
must retain their meaning and schema association. Presentation is data only.

`agent.conversation.define` accepts a turn function
`(Memory, Input) -> (Memory, Reply)` and a finish function
`(Memory, CloseReason) -> Result`; `run` enters that authored loop. A turn reply
parks at the next-input exchange. A headless application can return directly.
The conversation exchange admits close, while a turn handles its own abort
before returning an aborted reply. Use authored sums, Raise/catch, disposal, and
protect for recovery and cleanup. World cancellation unwinds the whole process;
it cannot fabricate a surviving conversation. Cleanup may itself return a
pending request. Worker termination or absent input proves neither cleanup nor
completion.

## Invoke the authenticated World runtime

[`runtime/world.mjs`](../runtime/world.mjs) exports
`loadWorldRuntime({ runtimePath, lockPath })`. It verifies the runtime against
the selected lock and returns `start`, `resume`, `cancel`, `decodeOutcome`, and
`inspectPending`. Pass canonical bytes to these operations:

```js
import { loadWorldRuntime } from "./runtime/world.mjs";

const world = await loadWorldRuntime({ runtimePath, lockPath });
const first = await world.start(image, initialArgs);
if (first.kind === "requested") {
    const next = await world.resume(image, first.state, first.request, canonicalReply);
}
```

Resume only a `requested` outcome. `canonicalReply` is the encoded value for
that ERQ3's resume schema; World constructs and binds the ERS3. It is not an old
ERS1, arbitrary JSON, or a serialized callback. Persist the complete canonical
PKO3 before discarding its predecessor. Its detached PST3 and pending ERQ3 carry
the control needed to resume; inspection is a non-authoritative view.

The reference runner performs one operation and returns environmental requests
without servicing them. From the package root, with an existing output directory:

```sh
node runtime/runner.mjs start --world-runtime /absolute/world-runtime \
  --image app.bpi3 --initial-args initial.bin --out first.pko3
node runtime/runner.mjs inspect --world-runtime /absolute/world-runtime \
  --outcome first.pko3
node runtime/runner.mjs resume --world-runtime /absolute/world-runtime \
  --image app.bpi3 --outcome first.pko3 --reply reply.bin --out next.pko3
node runtime/runner.mjs cancel --world-runtime /absolute/world-runtime \
  --image app.bpi3 --outcome next.pko3 --reason stopped --out cancelled.pko3
```

All commands accept `--lock /absolute/dependencies.lock.json`; otherwise they
use the package's Agent 4 lock. Output must not overwrite an input or dependency.
The runner validates flags and paths and uses atomic checkpoint replacement;
use a distinct output filename for each operation. Check the returned outcome:
the filename `cancelled.pko3` does not mean cleanup has already finished.

There is one outstanding external request per process. Queue other input outside
the computation until an admitted input boundary; do not inject a message into
a pending model/tool response. Preserve delivery occurrence identity separately
from content hashes, which are not globally unique event IDs. The local runner
is single-writer, with no distributed locking or exactly-once side-effect claim.

Raw public World APIs and canonical BPI3/PST3/ERQ3/ERS3 remain sufficient for
execution without this bridge. A distribution that includes the bridge must
include its pure value and dependency-verification modules and lock. Execution
needs no application source, Agent compiler, credential in a snapshot, or
application-specific WASM module.
