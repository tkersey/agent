# Adaptive repository agent

This example runs one authored computation on the existing native host. The
model can call `inference_set` and `skill_set`; the host admits their proposed
next request before the computation commits the new control revision.

The implementation is under qualification. The native offline scenario is a
recorded provider fixture, not evidence of live API acceptance or cache hits.
The Node/WASM counterpart and package integration are under qualification. The
complete acceptance report remains pending.

## Native use

Build from the Agent repository with its authenticated dependencies:

```sh
zig build adaptive-agent -Doptimize=safe \
  -Dworld-runtime="$PWD/.agent4/out/world-runtime/runtime"
./zig-out/bin/adaptive-agent describe-build
./zig-out/bin/adaptive-agent demo --offline --state-dir ./adaptive-demo
```

`demo --offline` uses embedded source and recorded function-call replies. It
exercises a resident skill, its independently granted inspection tool, effort
and model changes, deactivation, physical unload, a return to the original
profile, a transient skill, a question, and a report. Production requests are
ordinary task inputs; production action selection does not use this script.

A configured launch uses `validate --config FILE`, then the existing
`run --config FILE --input-json '{"task":"…"}' --state-dir PATH` or
`serve --transport stdio --config FILE --state-dir PATH`. Inference additionally
requires the existing explicit `--authorize-inference --credential-file FILE`
flags. Validation and discovery perform no inference and discover no credential.
Use `--help` for the inherited status, result, response, resume, cancellation,
and checkpoint commands. The TypeScript client remains
[`stdio-client.mts`](../native-minimal/stdio-client.mts).

## Node/WASM use package

The source-independent use archive contains the same `program.bpi3`, generated
contracts, pure projections and a thin Node CLI. Supply the separately
authenticated, locked World runtime. Linux and Node 26 are the qualification
target; this CLI does not advertise the native machine protocol.

```sh
node runtime/adaptive/cli.mjs demo --offline \
  --world-runtime /absolute/world-runtime/runtime --state-dir ./adaptive-js-demo
node runtime/adaptive/cli.mjs validate-config --config ./approved-adaptive.json
node runtime/adaptive/cli.mjs run --config ./approved-adaptive.json \
  --world-runtime /absolute/world-runtime/runtime --state-dir ./adaptive-js-task \
  --input-json '{"task":"Explain the entry point using source evidence."}'
```

Live execution additionally requires `--authorize-inference --credential-file
FILE`. Without both, execution parks before inference. `resume` uses the same
state directory; `status` performs no inference. `message` requires a stable
`--operation-id` and `--message-json '{"message":"…"}'`. `respond` requires the
reported `--question-id`, `--request-digest`, a stable `--operation-id`, and
`--answer-json '{"message":"…"}'`; then run `resume`. A queued message cannot
answer a pending question. Use one private directory per task and stop a running
CLI before another local mutation. The embedding API also accepts messages
while an inference is in flight.

The JS store is distinct from native state. It commits prepared requests,
charged dispatch, captured bytes, interpreted replies and World successors in
that order. Recovery reinterprets original captures and does not resend an
unknown delivery. Neither format implies automatic native-to-JS state import.

## Frozen configuration

Configuration has these fields:

- `workspace`, `snapshot_root`, `endpoint`, `audience`;
- `profiles`, `initial_profile`, `initial_effort`;
- `skills`, `maximum_model_calls` (1–16), `maximum_control_revision` (0–16).

Every profile declares `id`, actual API `model`, `reasoning_mode`,
`reasoning_context`, `efforts`, `effort_update`, `explicit_cache`,
`additional_tools`, `cache_diagnostics`, `opaque_family`, `max_output_tokens`,
`request_bytes`, `response_bytes`, and `timeout_ms`. The application currently
requires `effort_update: false`: effort changes use the named new-context
fallback, including changes made immediately after a tool call. Features are
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
Unload starts a new context epoch and physically omits that material and opaque
reasoning from the next request. The handoff retains acquired facts, outcomes,
follow-ups and allowances; a model's proposed next intent is labeled as a
hypothesis. Original captures remain immutable audit evidence. Returning to an
old profile uses current task facts and the current eviction generation.

Work results and control receipts are immutable artifacts. World continuations
retain references, not duplicated source excerpts or directory pages. The
current model call's offered set is checked independently from materialized
definitions, and work dispatch binds to that captured call. Queued user messages
are consumed through the authored inbox only after the current call settles.

The new contracts are `agent.model.invoke.v6` and
`agent.model.context.responses.adaptive.v1`. Existing v3/v4/v5 consumers and the
fixed `repository-agent` keep their meanings. Reports expose bounded evidence
and control receipts; raw provider captures and opaque reasoning are not public
report artifacts. Absent usage remains unavailable. Explicit cache markers and
unchanged request prefixes do not establish provider cache reuse.
