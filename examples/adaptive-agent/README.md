# Adaptive repository agent

This example runs one authored computation on the existing native host. The
model can call `inference_set` and `skill_set`; the host admits their proposed
next request before the computation commits the new control revision.

The current scope is the **October 9, 2026 authored-program amendment**: one
reusable Zig Agent/Boundary computation, executed and continued by World, with
the existing native environmental adapters. The repository investigation is its
reference consumer. The separate JS adaptive implementation and Node/WASM
adaptive package are **superseded by scope change**. A new polished standalone
distribution is deferred; the existing embedded executable remains useful for
reference execution.

Linux reference qualification uses recorded provider replies and controlled I/O.
The [cache-preserving continuation report](../../docs/adaptive-cache-continuation-2026-10-09.md)
qualifies the current history-preserving effort/model/skill transitions.
The [October 9 live report](../../docs/adaptive-live-validation-2026-10-09.md)
records the merged artifact's failure, subsequent repairs, and successful
Sol/medium → Sol/high → Astra/medium continuation, skills, restart, and
provider-reported cache reuse on the identified repaired artifact. The
[acceptance map](../../docs/adaptive-responses-acceptance.md) binds the current
obligations to proof surfaces and exact-head PR evidence.

## Author and build

The reusable owners are `agent.adaptive_controls.defineInference`,
`agent.adaptive_controls.defineSkill(P, ...)`, `P.declareAdaptive`, and
`agent.responders.defineAdaptiveModelObserved`. They build ordinary Boundary
computations and checked contracts. [`definition.zig`](definition.zig) composes
them with this consumer's task, evidence, question, inbox and completion logic;
[`types.zig`](types.zig) supplies its actions and ordinary schemas. Model choice,
skills, offers, budgets, epochs and next actions stay in that authored program.
The native adapter realizes its explicit requests; it has no transcript-driven
policy loop. See the [v6 API contract](../../docs/model-invocation-v6.md).

From the Agent repository with its authenticated dependencies:

```sh
zig build adaptive-agent -Doptimize=safe \
  -Dworld-runtime="$PWD/.agent4/out/world-runtime/runtime"
```

This produces the reference executable `zig-out/bin/adaptive-agent` and the
identifiable program/contract outputs:

```text
zig-out/agent4/adaptive-agent/program.bpi3
zig-out/agent4/adaptive-agent/application.json
```

`zig build adaptive-agent-image` emits those program/contract outputs without
building another application shell. The application metadata contains ordinary
wire schemas and approved resource identities. Their meaning does not depend
on an executable pathname or package layout.

For another consumer, use the same authored controls and checked responder
with that consumer's action/catalog types. For native embedding, the existing
`build.zig.addNativeSystem` / `build_native.zig` entry accepts definition, types
and environment paths. Its `.application.emitted` option reuses exact compiled
image/assets/types; the repository reference already uses it. That is also the
entry for later single-binary assembly, not a new framework to implement.

## Execute the compiled program

```sh
./zig-out/bin/adaptive-agent describe-build
./zig-out/bin/adaptive-agent demo --offline --state-dir ./adaptive-demo
```

The prebuilt reference embeds the same BPI3 and runs it through native World.
It does not execute `.zig` source or invoke a compiler, Node, Python or a helper
service. Separate image and contract files are build/inspection outputs, not
additional launch dependencies of this existing embedding. Exact image, assets,
runtime and task-resume identities remain enforced; another packaging layout
does not authorize grafting old state onto a different build.

`demo --offline` uses embedded source and recorded function-call replies. It
exercises resident and transient skills, a skill-specific inspection permission,
model/effort changes, deactivation, hard unload, return to an earlier profile,
a question and a report. This script is an explicit fixture input, not the
production decision loop.

A configured reference uses `validate --config FILE`, then:

```sh
./zig-out/bin/adaptive-agent run --config ./approved-adaptive.json \
  --input-json '{"task":"Explain the entry point using source evidence."}' \
  --state-dir ./adaptive-task
./zig-out/bin/adaptive-agent serve --transport stdio \
  --config ./approved-adaptive.json --state-dir ./adaptive-task
```

Inference additionally requires `--authorize-inference --credential-file FILE`.
Configuration and discovery alone perform no inference or credential discovery.
Use `--help` for status, result, response, resume, cancellation and checkpoint
commands. The CLI and `agent-host/1.0` front end use the same image and native
task owner. Protocol callers may use any language; the existing optional
[`stdio-client.mts`](../native-minimal/stdio-client.mts) is a caller, not an agent
runtime dependency. Questions require the reported identity/revision/digest;
queued follow-ups cannot substitute for a question response. Stable client
operation IDs support lost-ack retries, not new inference after unknown delivery.

SQLite, the existing C shim, libc and OS facilities remain admitted native
dependencies. Zig and setup/build tools are authoring dependencies; JavaScript
and Python qualification controllers stay outside the deployed reference
boundary. Existing non-adaptive JS/WASM products are unchanged.

## Frozen configuration

[`adaptive.example.json`](adaptive.example.json) is a disabled-by-default launch
template, not a model approval. Replace both model placeholders with approved
Responses IDs, check their declared feature flags, and select your read-only
snapshot. Paths are relative to the launch working directory. The template and
skill files accompany the native reference artifacts. Configuration alone never
authorizes inference; the launch flag and explicit credential file are separate.

Configuration has these fields:

- `workspace`, `snapshot_root`, `endpoint`, `audience`;
- `profiles`, `initial_profile`, `initial_effort`;
- `skills`, `maximum_model_calls` (1–16), `maximum_control_revision` (0–16).

Every profile declares `id`, actual API `model`, `reasoning_mode`,
`reasoning_context`, `efforts`, `effort_update`, `explicit_cache`,
`additional_tools`, `cache_diagnostics`, `opaque_family`, `max_output_tokens`,
`request_bytes`, `response_bytes`, and `timeout_ms`. Profiles that admit `effort_update: true` use append-only configuration updates
after settling the actual control call. Request-level effort stays unchanged;
the replayed update selects effective effort. A false declaration changes the
request-level effort without discarding visible history. Features are
explicit approvals, not inferred from model-name prefixes. Supply actual
operator-approved models and capabilities; fixture names are not live models.

Each skill declares `id`, `version`, a short `description`, a `markdown` file,
and eight `tools` booleans in this order: list, read, ask, report, stop,
inference_set, skill_set, inspect. The first seven are core tools. `inspect` is
a lexical guard-line count over previously acquired evidence and is available
only while a loaded approved skill grants it. It does not prove correctness.
No skill executes scripts or installs code. Markdown is admitted before task
creation (32 KiB per body, 128 KiB total). The shared catalog format allows 32
entries; this deployment admits 14, leaving two of the native host's 16 frozen
resource slots for snapshot and catalog. At most four skills may be active.
The complete frozen resource set, including the snapshot, must fit 16 MiB.
Context and continuation limits can reject a
proposed transition before it is acknowledged.
The task admits four answers and follow-ups in total. At that limit it stops
offering questions and polling the inbox; later queued messages remain retained
and are reported as not consumed when the task finishes.

The adaptive model reply has a 16 KiB aggregate projection ceiling, independent
of the 512 KiB raw response ceiling. An oversized projection returns a typed
capacity result, retains its captured response and observed usage, and does not
trigger another provider attempt. The full allowed combinations remain subject
to the existing World, worker, object and namespace budgets.

The snapshot, skill bytes, catalog, profiles and limits are frozen into task
resources. Reopening reads those bytes. Editing a configuration or Markdown
file cannot update a saved task; supply a new task for new authorization.

## Controls and context

Both tools require `expected_revision` and a bounded `reason`. The inference
control selects an approved profile and supported effort. The skill control
specifies `operation` (`load`, `deactivate`, `unload`), exact `skill_id` and
`version`, and `residency` (`resident`, `transient`, `unchanged`). Load requires a
residency; removal operations require `unchanged`. Changing residency requires
an explicit unload followed by load. Repeating an already satisfied selection
is a no-op, while a stale revision rejects.

Resident deactivation retains its body and definitions but removes its offers.
Unload advances the eviction revision and physically removes the owned skill
injection and exclusive definitions. It removes opaque reasoning that could
have observed that skill, retaining unrelated opaque output and ordinary
evidence—even when evidence contains identical text. The Boundary computation
resumes with its existing task state, transcript and evidence references. Model
changes retain visible messages and settled tool exchanges while excluding old
opaque reasoning and old-profile effort updates. No task-state handoff bundle is
constructed. Original captures remain immutable audit evidence.

Work results and control receipts are immutable artifacts. World continuations
retain references, not duplicated source excerpts or directory pages. The
current model call's offered set is checked independently from materialized
definitions, and work dispatch binds to that captured call. Queued user messages
are consumed through the authored inbox only after the current call settles.

The new contracts are `agent.model.invoke.v6` and
`agent.model.context.responses.adaptive.v3`. Existing v3/v4/v5 consumers and the
fixed `repository-agent` keep their meanings. Reports expose bounded evidence
and control receipts; raw provider captures and opaque reasoning are not public
report artifacts. Absent usage remains unavailable. Explicit cache markers and
unchanged request prefixes do not establish provider cache reuse.
