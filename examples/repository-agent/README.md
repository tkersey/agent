# Repository agent

This authored application investigates a bounded, immutable repository snapshot.
Its native handlers only list and read frozen files or acquire model responses;
World retains action selection, questions, follow-ups, evidence and budgets.
Linux reference qualification covers a copied executable in a restricted clean
environment, a controlled HTTPS provider, archive closure and recorded
native/WASM/native continuation. See the [qualification report](../../docs/native-single-binary-qualification.md)
and [PR #45](https://github.com/tkersey/agent/pull/45) for exact subjects, artifacts
and current review disposition. macOS evidence is historical; live OpenAI
qualification is separate and is not claimed.

Build from Agent using the pinned Zig 0.17.0 toolchain and admitted dependencies:

```sh
node tools/agent4/setup.mjs --native
zig build native-example -Doptimize=safe \
  -Dworld-runtime="$PWD/.agent4/out/world-runtime/runtime"
./zig-out/bin/repository-agent --help
./zig-out/bin/repository-agent describe-build
./zig-out/bin/repository-agent demo --offline --state-dir ./repository-demo
```

The same public `addNativeSystem` recipe as `examples/native-minimal/build.zig`
accepts this directory's `definition.zig`, `types.zig` and `environment.zig`.
Include `tools.zig` and `instructions.txt` with the application source. The output
name is `repository-agent`. Build tools and sources are not launch inputs.

For a live HTTPS profile, explicitly supply a JSON configuration:

```json
{
  "workspace": "selected-repository",
  "snapshot_root": "/explicit/repository/path",
  "responses": {
    "endpoint": "https://api.openai.com/v1/responses",
    "audience": "openai",
    "model": "EXPLICIT_APPROVED_MODEL",
    "effort": "medium",
    "max_output_tokens": 4096,
    "request_bytes": 262144,
    "response_bytes": 524288,
    "timeout_ms": 30000
  }
}
```

The model placeholder must be replaced with an explicitly approved supported
model. This file does not authorize spending or supply credentials.

```sh
./repository-agent validate --config ./approved-profile.json
./repository-agent run --config ./approved-profile.json --task "Explain the entry point" \
  --state-dir ./repository-state --authorize-inference --credential-file ./private-token
./repository-agent serve --transport stdio --config ./approved-profile.json \
  --state-dir ./repository-server --authorize-inference --credential-file ./private-token
```

The credential file contains the bearer token, has private permissions, and is
read only when explicitly named. Production admission requires exactly
`https://api.openai.com/v1/responses` before reading credentials. No environment
credential or proxy lookup occurs.
Admission rejects snapshot files containing the supplied token, including hard
links, copied contents and restored snapshots. Keep credential material outside
the source input; this check covers the explicitly supplied token, not discovery
of arbitrary secrets.
Serving without `--authorize-inference` cannot authorize a provider call.

Controlled TLS qualification uses `--test-provider --trust-root ROOT.der` and
profile ID `controlled-test`. It accepts only HTTPS loopback URLs with an explicit
port and `/v1/responses` path, uses the built-in non-secret `qualification-only`
token, and rejects `--credential-file`. It still requires `--authorize-inference`
to dispatch. This profile remains explicit on resume/import and cannot be
silently promoted to production by supplying credentials. `--trust-root` selects
an explicit DER trust root; certificate and hostname checks remain enabled.

At admission, the snapshot and non-secret profile become task-owned immutable
objects. Snapshots allow up to 512 regular files, 256 KiB per file and 16 MiB in
encoded total. Named administrative/build entries (`.git`, `.zig-cache`, `zig-out`,
`node_modules`) are excluded and counted. Other symlinks and nonregular files
reject capture. Reads return at most 4096 bytes and reject incomplete UTF-8
windows. Listings are paginated and never imply exhaustive absence.

On CLI resume, omit `--config` to use the selected task's frozen inputs. Supplying
it verifies the original configuration digest without recapturing the workspace.
For a restarted stdio server, use `--profile-task TASK_ID` to select the frozen
profile and snapshot. Keep `--offline` for an offline task. Credentials and current
inference authorization must be supplied separately for live work; neither is
restored from task state. A task never changes its profile silently.
Read-only CLI `status` and `result` do not load execution configuration and remain
available for authorized old or foreign application tasks.

After parking the server, a settled task can be copied explicitly:

```sh
./repository-agent export-checkpoint --state-dir ./repository-state --task-id TASK_ID --output ./task.bundle
./repository-agent import-checkpoint --state-dir ./imported-state --input ./task.bundle --operation-id import-task
```

Keep `--offline` on both commands for an offline task. The private archive includes
the original snapshot and complete admitted provider replay objects. Import
restores frozen inputs and spent counters into a fresh namespace without making
a provider call. It grants no permission to run concurrent copies; any later
live resume needs current credentials and explicit inference authorization.

Use `initialize`, `describe`, `task.submit`, `task.status`, `task.respond`,
`task.message`, `task.subscribe`, `task.result`, `task.cancel` and explicit
`task.resume` through the shared `agent-host/1.0` protocol. Submission uses profile
ID returned by `describe` (`offline`, `fixed`, or the explicit `controlled-test`
profile) and the embedded `repository-agent.input.v1` schema.
Questions and follow-ups use the embedded answer/message schema, both with a
bounded `message` string. The generic protocol runbook and TypeScript subprocess
client are described in `docs/native-single-binary.md`.

The offline fixture performs list, read, clarification and report through the
same capture/task owners. It makes no network call and is identified as offline.
A live investigation uses the model's checked proposals; it is not this fixed
fixture sequence. Reports carry an actual read's snapshot identity, path, digest,
byte range and content. The model's prose remains an inference from that evidence.
