# Packaged incremental-parser synthesis

The use archive contains a checked compiled Program, its independently emitted
producer/consumer/reference objects, schemas, frozen batch reference and required
acceptance tools. It contains no authoring emitters or known incremental replacement
in the production proposer. Run these commands from the extracted archive.

The default performs no model or tool work and returns an unresolved zero-allowance
result:

```sh
node runtime/parser_cli.mjs --world-runtime /absolute/path/to/world-runtime
```

An explicitly authorized live run uses the existing model adapter:

```sh
node runtime/parser_cli.mjs --world-runtime /absolute/path/to/world-runtime \
  --model YOUR_SELECTED_MODEL --endpoint https://api.openai.com/v1/responses \
  --key-env OPENAI_API_KEY --allow-paid --data-policy fixture-only \
  --max-model-calls 4 --max-checks 4
```

The command does not acquire credentials. A selected environment variable is read
only after positive call allowance and paid-use authorization are supplied. External
calls require `--allow-paid`; credentialed requests remain restricted to the OpenAI
Responses endpoint. Credential-free loopback HTTP is available for local tests.
The data policy permits sending the packaged batch reference/requirements and the
current candidate/evidence context to the selected provider. No live user repository
is read or changed. Live inference was not run during implementation.

The Program owns reciprocal demands, construction/revision, candidate versions,
acceptance and completion. The command implements declared environmental leaves;
it does not choose peers or replay prompts to reconstruct control. It creates an
ephemeral fixture target and returns a reviewable artifact after authoritative
acceptance and live target reading. This command grants no approval or target-write
authority. The existing checked delivery construction is tested separately.

Model and experiment-call allowances are charged outside World rollback. Each full
acceptance call includes the prescribed semantic/retention suite, not a single
candidate process; physical execution counts are reported. Allowances are at most
16 calls/checks. `--max-quanta` defaults to 10,000 operations of 100 World work units.
Exhaustion returns unresolved with the actual owned checkpoint, spent counters and
next invocation control. If an external reply was completed but not yet admitted,
its exact bound bytes are retained in that control; do not repeat the operation.
it is not an authored answer or proof that no solution exists. The ephemeral fixture
binding is removed on exit. There is no automatic retry/resume of an external call;
resuming exported work requires restoring its environmental bindings and respecting
the reported spent allowances. This CLI is not a durable session manager.

Unsupported qualified executors stop before model calls. Unknown model output,
refusal, failed checks and incomplete candidates do not become successful artifacts.
The current application offers fragment/complete-candidate/unresolved contributions;
model-proposed experiment/constraint routing, missing-intent task support, a held-out
live comparison and the broader selection/composition obligations remain open.

The optional `test/agent4/parser_package_runtime.mjs` checks zero work and a real
reference/cleanup transfer using only archive files. Deterministic loopback-provider
tests establish the transport/control path, not model reasoning quality or live cost.
