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
The current application offers fragment/complete-candidate/experiment/unresolved contributions;
general constraint routing, a held-out
live comparison and the broader selection/composition obligations remain open.

The optional `test/agent4/parser_package_runtime.mjs` checks zero work and a real
reference/cleanup transfer using only archive files. Deterministic loopback-provider
tests establish the transport/control path, not model reasoning quality or live cost.

After the first candidate, `experiment` is also offered. It checks the retained
candidate under an explicit trace; it cannot request full acceptance or choose a
new subject/version. A passing probe does not clear a previously observed failure.
The next model request includes the executed trace and retained counterexample.
Unchanged refuted source cannot become complete merely by receiving a new label.

## Intentionally unspecified EOF behavior

The default `--eof-policy strict` remains the original fully specified language and
asks no question. `--eof-policy emit` is an explicitly selected alternative: final
EOF emits a non-escaped unfinished record, while dangling/invalid escapes retain
their original errors and offsets. The alternative has its own contract, reference,
requirements and runner binding.

For a task that intentionally permits either outcome but has not selected one, use
`--eof-policy ask` with a positive model allowance. The compiled application asks
about that observable behavior before starting its participants. Enter `1` to reject
unterminated records, `2` to emit them, or `other`/`unsure` to remain unresolved.
Closed input also remains unresolved. This is intent selection, not approval.
A zero-work task stops without asking and does not establish a preference for a
future task. The existing clarification resolver retains the exact frozen subjects
and occurrence; the host only supplies the typed answer and policy-bound leaves.

## Optional comparison of two constructions

`--selection first` and `--selection last` load the packaged two-construction
Programs. Each alternative performs recursive fragment construction, consumer
feedback, and authoritative acceptance. Both must establish acceptance before the
chosen tie-break selects an artifact; an unavailable alternative leaves selection
unresolved. These policies are ordering choices between accepted artifacts, not
quality scores. `--selection single` is the default.

The supplied `--max-model-calls` and `--max-checks` are total run allowances shared
across alternatives. Selecting two does not double them or restore spent work on
re-entry. Insufficient allowance returns the actual pending State and unresolved
status. The report includes the selected policy and total usage. As with the
single-construction CLI, selection returns a reviewable artifact and does not
acquire fixture replacement approval or write authority. Live paid inference
still requires the same explicit authorization and remains unrun here.

## Complete-candidate strategies

`--strategy react` uses the existing ReAct loop with retained candidate/evidence
state. `--strategy complete` uses the recursive participants but requires complete
candidate proposals, providing the focused ablation. Both can propose experiments
and revise from counterexamples through the same adapters, required evaluator,
clarification and delivery boundary. `--strategy recursive` remains this opt-in
application's default. The `react` and `complete` strategies require `--selection single`;
incompatible combinations reject rather than silently ignoring a policy.

Call/check allowances remain total run limits for every strategy. Initial prompts
and offered operations agree: complete-candidate modes do not request or offer a
partial source fragment. These modes are available in the source-independent
archive and do not enable paid inference. The deterministic comparison in
`docs/recursive-interaction.md` does not establish live model quality or universal
strategy superiority.
