# agent

`agent` is a Zig staged compiler for typed agent systems.

```text
AgentDefinition + RuntimeStrategy + EpistemicStrategy
    -> one Boundary Program
    -> one Boundary Machine ABI v2 reducer
    -> World application-specific WASM
```

Agent v2 separates four objects:

```text
Evidence != Memory != DecisionView != DecisionContract
```

world-host retains complete Frames and EffectResults as evidence. The Machine
retains bounded typed Memory. An EpistemicStrategy deterministically folds each
Observation into Memory and projects a turn-specific DecisionView. The external
decision provider admits one immutable, digest-bound DecisionContract and
receives only the dynamic DecisionTurn.

```zig
const Definition = agent.define(.{
    .name = "answer-agent",
    .version = "2.0.0",
    .instructions = "Return one typed answer.",
    .Goal = u32,
    .Action = union(enum) { final: u32 },
    .Observation = void,
    .Result = u32,
    .Failure = enum { budget_exhausted, history_overflow, arithmetic_overflow, invalid_variant, capacity_exceeded },
    .decision = .{
        .interface = "model.decide.v1",
        .maximum_request_bytes = 4096,
        .maximum_result_bytes = 64,
    },
    .actions = .{agent.action.final(.final, .{
        .name = "final",
        .description = "Return the answer.",
    })},
    .budget = .{
        .maximum_turns = 1,
        .maximum_decisions = 1,
        .maximum_effect_actions = 0,
        .maximum_child_actions = 0,
    },
});

const Runtime = agent.strategy.react(.{});
const Epistemics = agent.epistemics.verbatim(.{
    .maximum_observations = 0,
    .overflow = .fail,
    .final = agent.final_policy.none,
});

pub const Compiled = agent.compile(Definition, Runtime, Epistemics, .{
    .machine = .{
        .maximum_frames = 16,
        .maximum_state_bytes = 64 * 1024,
        .maximum_machine_fuel = 4096,
    },
});
```

The package targets Zig 0.16.0, Boundary v1.4.0, Machine ABI v2, World
v3.1.2, Application ABI v1, and Frame v1. Agent definitions and strategies are
compile-time inputs: there is no runtime definition loader, strategy registry,
memory VM, provider-owned conversation, or second reducer.

## Proof classes

```sh
# Public compiler semantics, packaging, native/WASM parity, malformed corpus.
zig build check

# Compiler proof after exact archive acquisition with network disabled.
zig build check-agent-hermetic

# Anonymous deterministic host/capability lifecycle from lock-pinned releases.
zig build check-agent-reference-stack

# Local deterministic ENF Actuality plus retry/replay/branch/migration.
zig build check-agent-actuality-release

# Explicit credentialed and interactive provider proof.
OPENAI_API_KEY=... OPENAI_MODEL=... zig build check-agent-actuality-live
```

The live lane is never part of `zig build check` or the anonymous public proof.
Reference implementations do not imply exactly-once effects, hostile-host
protection, universal receiver policy, or credential-free live model access.

See [Epistemic Normal Form](docs/epistemic_normal_form.md),
[EpistemicStrategy](docs/epistemic_strategy.md),
[DecisionContract](docs/decision_contract.md),
[evidence and memory](docs/evidence_and_memory.md),
[Actuality](docs/actuality.md), and the
[v1.1 migration guide](docs/migration_from_1_1.md).

Licensed under the MIT License.
