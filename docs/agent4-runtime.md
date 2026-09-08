# Agent 4 runtime and portable use archive

Agent authoring emits ordinary Boundary BPI2. The unchanged World interpreter
executes it; unfinished control is contained in PST2. The JavaScript bridge
imports no Zig authoring module and introduces no additional execution format.

The checked-in dependency lock currently identifies **candidate integration**:
Boundary `7a4d10ec656cf70bbab99281dd71e3ec493daa0c` and World
`699a3147088274d2bf742c6ecb4cb70a5faea631`. These identities are development
inputs, not stable release claims. The exact runtime contents, kernel digest,
public API and physical profile are in
`conformance/agent4/dependencies.lock.json`. The loader checks this Agent-owned
lock before importing the supplied World module. A runtime's own checksum is
not substituted for this expected identity.

## Start, resume, inspect and cancel

Run the commands from the extracted use archive. Supply an existing immutable
World runtime directory; the runner neither downloads nor rebuilds it. Node's
version is recorded by the lock. Images, InitialArgs and synthetic reply files
are listed in `examples/inventory.json`. That file is an inventory only;
execution does not read it to select control, prompts, policies or continuations.

The following filenames illustrate the typed dialogue probe. For a different
example use the image and InitialArgs paths in its inventory entry, and supply
a canonical reply admitted by that example's current request.

```sh
node runtime/runner.mjs start \
  --world-runtime /absolute/path/to/world-runtime \
  --image examples/twice.bpi2 --initial-args examples/empty.args.bin \
  --out started.pko2

node runtime/runner.mjs inspect \
  --world-runtime /absolute/path/to/world-runtime --outcome started.pko2

node runtime/runner.mjs resume \
  --world-runtime /absolute/path/to/world-runtime \
  --image examples/twice.bpi2 --outcome started.pko2 \
  --reply examples/reply-3.bin --out resumed.pko2

node runtime/runner.mjs cancel \
  --world-runtime /absolute/path/to/world-runtime \
  --image examples/twice.bpi2 --outcome started.pko2 \
  --reason "operator requested cancellation" --out cancelled.pko2
```

Resume and cancel are alternative successors of the same input in this example;
do not execute both against one live environmental occurrence. The probe's reply
is the eight-byte little-endian encoding of unsigned integer 3. Other contracts
may require a tagged reply, a product, or another portable value. `--reply`
contains the canonical **application value**, not an ERS2 frame. World validates
it and constructs the ERS2 bound to the current ERQ2. No transcript is needed.

The optional `--lock FILE` selects another explicit Agent-owned input lock.
Unknown, duplicate, incomplete and cross-command flags reject. An output cannot
overwrite an input or enter the runtime directory. Successful operations save
the complete canonical PKO2 with an exclusive temporary file, file sync and
atomic replacement; prior authoritative input remains available on rejection.
The runner is single-writer. It supplies no distributed checkpoint lock, inbox,
outbox or concurrent-writer arbitration.

Inspection performs no model/tool operation. JSON printed to stdout is a
non-authoritative view; opaque values are base64 bytes and exact large integers
are decimal strings inside `{ "integer": "..." }`. Continue using the saved
PKO2, not this display JSON. A textual purpose may produce `awaiting_message`,
`awaiting_clarification` or `awaiting_approval`; other declared values remain
typed requests. A display label grants no authority.

## Library and raw World execution

```js
import { loadWorldRuntime } from "./runtime/world.mjs";

const host = await loadWorldRuntime({ runtimePath: "/absolute/world-runtime" });
const pending = await host.start(imageBytes, initialArgsBytes);
const view = host.inspectPending(pending); // no environmental I/O
const next = await host.resume(
  imageBytes, pending.state, pending.request, canonicalReplyBytes,
);
// Alternative to resumption, when cancellation is intended:
// const next = await host.cancel(imageBytes, pending.state, "stop");
```

The bridge returns World's complete outcome, including original PKO2 `bytes`
and detached nested State/request/value records. It copies submitted bytes and
checks request-to-State binding before asking the kernel to admit the complete
input. All application control remains in BPI2/PST2. Environmental callbacks,
when an embedding chooses to register them, may implement exact typed external
effects only; they are not checkpointed continuations.

The convenience bridge is optional. Authenticate the runtime and use its public
module directly:

```js
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { verifyRuntime } from "./tools/agent4/dependencies.mjs";

const selected = verifyRuntime("/absolute/world-runtime");
const world = await import(pathToFileURL(selected.entrypoint).href);
const kernel = await world.admitProcessKernel(await readFile(selected.kernelPath), {
  expectedSha256: selected.kernelSha256,
});
const pending = await kernel.run({ image: imageBytes, initialArgs: initialArgsBytes });
const next = await kernel.run({
  image: imageBytes,
  state: pending.state,
  result: world.encodeResult(pending.request, canonicalReplyBytes),
});
```

This path uses World for process framing, admission, value validation, result
binding and execution. It requires no Agent compiler, application source,
private World evaluator import, application WASM or source map. The reference
use archive includes the pure dependency verifier and lock because those files
authenticate the separately supplied runtime.

World has one outstanding external request per process. Retained internal
dialogues are not simultaneous environmental requests. The bridge performs no
background relay and does not inject a user message into a pending model/tool
result. Buffering and later presentation are embedding concerns; the program
admits input only through its declared current contract.

`Requested`, `Completed`, `Failed`, `Cancelled`, `Yielded`, `Progressed` and
`NeedsCapacity` retain World's meanings. A turn reply may itself be a pending
next-input exchange; only the root result is `Completed`. `Yielded` is not a
typed reply slot; use the public World continuation operation when consuming
an authored yield. `NeedsCapacity` supplies no authoritative successor. Killing
a worker proves neither completion nor cleanup.

Cancellation may return another `Requested` outcome while cleanup is pending.
Save it and supply the declared cleanup result against its **current** ERQ2.
Cancellation can rebind the request. Reuse a previously obtained semantic result
only when the unchanged environmental operation makes that legitimate; never
patch an old ERS2 or State, restart cleanup, or label it finished early.

## Application value and model contracts

`runtime/values.mjs` implements pure application-value marshalling over the
documented Boundary encoding. `decodeSchema(request.resumeSchema)` obtains the
actual standalone schema. `encodeValue(schema, value)` produces canonical value
bytes; `decodeValue` reads them; `parseJsonValue` handles exact JSON convenience
input against a declared schema. World remains the authority for ERQ2/ERS2 and
full input admission. Product values are arrays, sum values are `{ tag, value }`,
unit is `null`, byte values are `Uint8Array`, and 64-bit integers are `BigInt`.
Structural errors and host codec capacity exhaustion are distinct errors.

Each interaction identity is
`agent.interaction.exchange.v1.<declared-contract-name>`. Its ordered payload is
`(channel, purpose, presentation, outgoing)`. The input sum starts with
`Value(In)` and contains `AbortTurn(reason)` and/or `CloseConversation(reason)`
only where the declaration admits them, in that order. The concrete ERQ2 schema
and contract digest bind each specialization. No continuation/resource handle
is externalized. Presentation contains field/value hints only and may be unit.

The versioned model effect is `agent.model.invoke.v3`; its provider protocol
identity remains `agent.model.protocol.openai-responses-v2`. Its product order is:

1. protocol text, model identifier, exact admitted parameters;
2. ordered messages, ordered offered declarations;
3. call-selection policy, response policy, normalization limits;
4. maximum provider response bytes.

Parameters are `(optional max_output_tokens, optional decimal temperature text,
optional reasoning(effort, summary))`. A message is `(role, content)`, with role
tags `system`, `developer`, `user`, `assistant` in order. A declaration is
`(action_ordinal, action_tag, name, description, input_schema_json, strict,
argument_codec)`. Each codec field is `(name, kind, bit_width, maximum_bytes,
enum_names, enum_tags)`; kinds are text, signed integer, unsigned integer,
boolean and enumeration in that order. Concrete capacities and answer schemas
are application specializations present in ERQ2; no global model-schema sidecar
selects them.

Selection is `(minimum_calls, maximum_calls, parallel_calls)`. Response policy
is `(store, stream, background, truncation)`; truncation currently admits only
`disabled`. Normalization limits are maximum output items, call ID bytes, name
bytes, argument bytes, argument-field-name bytes, argument-field count, and
result-text bytes, in that order. The required adapter path is nonstreaming.

The normalized result sum order is output, refusal, transport failure, provider
failure, unsupported response. Output is `(ordered items, 32-byte normalized
output digest)`. Item sum order is function call, message, reasoning summary.
A call contains `(call_id, name, raw_arguments_json, tool_ordinal_claim,
decoded_answer)`. Decoding preserves either the typed answer or the declared
decode failure. The image still checks name/variant association, request-time
offers and current admission; decoded output and its digest do not prove
environmental truth or confer commit authority.

`runtime/model.mjs` provides the generic provider adapter and strict normalizer.
It does not choose the application phase, model, offered set or prompt, and does
not silently change configuration or retry a call. Its optional transport abort
signal is operational, not an Agent lifetime limit. Credentialed execution is
separate from deterministic synthetic-provider tests and requires explicit
authorization; the archive contains no credentials or provider session state.
The complete concrete v3 field and tag order is also documented in
[`model-invocation-v3.md`](model-invocation-v3.md).

## Real document I/O, custody and delivery uncertainty

`runtime/document.mjs` exports `createDocumentEnvironment({ root })` for an
existing isolated absolute directory. Its `read({ path })` returns actual
content and a SHA-256 digest. Its `replace({ path, base, replacement })` compares
that actual content/digest under the same cooperative root lock, then performs
an atomic replacement. Results distinguish success, conflict, failure and
uncertain delivery. All competing admitted writers must use that lock. Links,
workspace escapes and unsupported paths reject. A stale lock is never stolen.

This is an environmental implementation; the image separately owns proposal,
approval and admission. A read followed by a write elsewhere without the same
conditional contract does not inherit its atomicity. A model/simulation cannot
manufacture live evidence simply by returning a matching record shape.

The authoritative checkpoint is image identity plus PST2 and current ERQ2,
conveniently carried by detached PKO2. Persist it before discarding prior input.
A transport cannot infer from a missing result whether an external write or
model request occurred. Uncertain delivery must enter the application's explicit
reconciliation policy; do not retry a consumed approval automatically.

Content identity, conversation instance identity and delivery occurrence identity
are different. Equal content can recur in separate legitimate interactions.
Never use a request hash as a globally unique event or deduplication key. An
embedding may supply opaque occurrence IDs; reconstructing the same parked
occurrence preserves that identity. Replaying old whole snapshots remains
possible. Authentication, deduplication and final atomic preconditions belong
to the corresponding external authority. There is no global exactly-once claim.

## Packaging and evidence

The emitter writes an explicit `inventory.json` with format
`agent4-use-inventory/v1`, `examples` entries `{ name, image, initialArgs }`, and
`files` entries `{ path, role, sha256 }`. Relative paths are confined to the
emitter output directory. Roles are image, initial-args, contract and
synthetic-fixture. Every example references an image and InitialArgs; at least
one contract document and one synthetic fixture are required. Fixture bytes are
external inputs, never a second program or hidden semantic state.

```sh
node tools/agent4/package.mjs \
  --images-dir /absolute/path/to/emitted-use-inputs \
  --output-dir /absolute/path/to/agent-artifacts \
  --version 4.0.0-dev.0 \
  --world-runtime /absolute/path/to/immutable-world-runtime
```

The version must match Agent's package declaration. `--world-runtime` is
optional when assembling authoring outputs without a World installation. When
omitted, the receipt explicitly records `world.runtimeVerification` as
`not-performed`; its runtime/kernel hashes are expected values from the lock,
not observations of an installed runtime. Integration packaging supplies this
option and authenticates the runtime before and after assembly. Supplying or
omitting it changes that receipt status, never the archive's execution bytes.

The command checks inventory hashes and emits the versioned tar.gz, receipt
and `SHA256SUMS`. Archive entry order, modes, owners and timestamps are fixed;
no absolute source paths, timing logs, random IDs, compiler or kernel copies are
included. The actual runtime remains an external authenticated dependency.

The receipt records actual archive/input hashes, the dependency tuple, observed
Git HEAD/tree and whether packaged source files match that head. A dirty-source
receipt does not pretend its images came from HEAD. Packaging itself proves
neither emitter provenance nor application acceptance. Review, publication,
live-model execution and A01–A36 results are established separately by their
actual evidence. Compare independent clean builds before making a deterministic
release claim, and verify published downloads before claiming publication.

## Optional scripted application tests from the extracted archive

`test/agent4/document_runtime.mjs` and `test/agent4/review_runtime.mjs` are
**test oracles**, supplied separately from the production runtime. They submit
prescribed synthetic model/human replies, assert independently expected request
orders and results, and check actual document I/O. Their queues describe test
inputs; they do not implement the application's continuation or branching.
Neither the runner nor the public World API imports them, and removing the
entire `test/` directory does not change execution.

For an inventory with document and review images in the following directories,
run from the extracted archive:

```sh
mkdir -p .agent4/out
node test/agent4/document_runtime.mjs \
  /absolute/path/to/world-runtime examples/document/document.bpi2

AGENT4_WORLD_RUNTIME=/absolute/path/to/world-runtime \
AGENT4_REVIEW_IMAGES="$PWD/examples/review" \
  node --test test/agent4/review_runtime.mjs
```

The review directory must contain the emitted mode images and matching `.args`
files. A smaller probe archive need not contain the full applications; running
these tests without their images fails and supplies no acceptance evidence.
The document test writes synthetic fixtures only in its dedicated temporary
directories beneath `.agent4/out`, then removes them. No credentials or live
provider calls are needed. Full application acceptance requires actual successful
execution of these tests on the declared images and unchanged runtime, together
with the remaining acceptance checks; packaging alone does not establish it.
