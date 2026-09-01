# agent

`agent` is a Zig staged compiler for complete typed agent systems.

```text
complete immutable Agent source
    -> Agent frontend and generic Boundary composition
    -> one ordinary Boundary Program
    -> one BPI1 image

fixed Boundary Process kernel WASM
    + BPI1
    + portable Process State and explicit EffectResults
    -> Process outcome
```

Agent owns model configuration, prompt construction, embedded skills, the
closed typed action algebra, raw provider-response interpretation, epistemic
state transitions, admission, and runtime control flow. Boundary owns portable
values, generic effects and handlers, BPI1, Process State, and the fixed
evaluator. World admits that evaluator and relays Process bytes. Environment
adapters perform only the explicit model transport and typed external effects.

The canonical Agent 3 authoring entry point is `agent.system(comptime spec)`:

```zig
const System = agent.system(.{
    .name = "answer-agent",
    .version = "3.0.0",
    .Goal = Goal,
    .Action = Action,
    .Observation = Observation,
    .Result = Result,
    .Failure = Failure,
    .models = .{agent.model(.{
        .name = "primary",
        .protocol = agent.protocol.openaiResponsesV1.Profile,
        .model = "configured-model-id",
        .parameters = .{},
    })},
    .prompts = prompts,
    .skills = skills,
    .actions = actions,
    .strategy = agent.strategy.react(.{}),
    .epistemics = epistemics,
    .failures = failures,
    .representation = representation,
});

const image = System.Program.image().bytes;
```

`System.Program` is an ordinary Boundary program. Agent does not emit an
Agent-specific WASM module, require a Machine profile, or ask World to link an
application graph. Static meaning is reachable image computation; dynamic
meaning is in InitialArgs, Process State, or explicit effect results.

## Deterministic checks and emission

Agent targets Zig 0.16.0 and the Process-capable Boundary line. World is a
runtime/test consumer, not a compiler dependency.

```sh
zig build check --summary all
zig build check-agent-system-closure-v1 --summary all
zig build emit-agent-system-closure-v1 --summary all
```

During candidate development, an exact verified Boundary source tree can be
supplied with Zig's package fork option. The World integration proof is
explicit and consumes a verified runtime root:

```sh
zig build --fork=/path/to/boundary \
  -Dworld-process-root=/path/to/world-runtime \
  check-agent-repository-system-world --summary all
```

The emit command installs these release-candidate assets under `zig-out/`:

```text
agent-v3.0.0-system-closure-v1.tar.gz
agent-v3.0.0-system-closure-v1.tar.gz.sha256
agent-v3.0.0-system-closure-v1-receipt.json
```

After extracting the archive, run the source-independent fixture with released
World and an existing empty work directory:

```sh
node run.mjs --world-root /path/to/world-runtime --mode fixture \
  --work-dir /path/to/empty-work-directory
```

Fixture mode uses provider-shaped raw JSON over real loopback HTTP transport,
real repository reads, one digest-bound replacement, and the fixture's fixed
test command. It is deterministic model-environment evidence, not a live-model
quality claim. The portable process is forkable data and does not itself imply
exactly-once side effects or a hostile-host authenticity guarantee.

Agent 2.7 tags and published transcript artifacts remain frozen historical
evidence. They are not an alternate Agent 3 compiler or runtime path.

Licensed under the MIT License.
