# agent

`agent` is a Zig staged compiler for data-defined agent systems.

```text
AgentDefinition
+ RuntimeStrategy
-> Boundary Machine
-> World application WASM
```

Agent definitions are immutable typed comptime data. Runtime strategies are
reusable compile-time software. `agent.compile` specializes both through one
ordinary Boundary program; the resulting Boundary Machine is the only
executable meaning.

```zig
const agent = @import("agent");

const Action = union(enum) { final: u32 };
const Failure = enum {
    budget_exhausted,
    history_overflow,
    arithmetic_overflow,
    invalid_variant,
    capacity_exceeded,
};

const Definition = agent.define(.{
    .name = "answer-agent",
    .version = "1.0.0",
    .instructions = "Return one typed answer.",
    .Goal = u32,
    .Action = Action,
    .Observation = void,
    .Result = u32,
    .Failure = Failure,
    .decision = .{
        .interface = "model.decide.v1",
        .maximum_request_bytes = 4096,
        .maximum_result_bytes = 64,
    },
    .actions = .{
        agent.action.final(.final, .{
            .name = "final",
            .description = "Return the answer.",
        }),
    },
    .budget = .{
        .maximum_turns = 1,
        .maximum_decisions = 1,
        .maximum_effect_actions = 0,
        .maximum_child_actions = 0,
    },
    .history = .{ .maximum_observations = 0, .overflow = .fail },
});

pub const Compiled = agent.compile(
    Definition,
    agent.strategy.react(.{}),
    .{ .machine = .{
        .maximum_frames = 16,
        .maximum_state_bytes = 64 * 1024,
        .maximum_machine_fuel = 4096,
    } },
);
pub const Machine = Compiled.Machine;
```

The package targets Zig 0.16.0 and exact Boundary v1.3.2. Its clean-room proof
closes four specialized Machines with exact World v3.1.1 and runs them through
unchanged world-host v1.0.0 and the authenticated Effect v1 capability release.

The agent definition is never loaded at runtime. A strategy is not a runtime
plugin. The package contains no host, capability implementation, model client,
definition loader, strategy registry, tool registry, or generic interpreter.
Concrete model and tool implementations remain external effects.

`boundary.Agent` is a historical thin spelling over Boundary program
compilation. This repository does not import or extend it; `tkersey/agent` owns
AgentDefinition and RuntimeStrategy specialization. Direct Boundary authoring
remains available below this layer.

See [docs/architecture.md](docs/architecture.md) and the typed Research and
Coding definitions under [examples](examples). The authorized dependency
correction from the initial targets to the released compatibility line is
recorded in [docs/release_line.md](docs/release_line.md).

Agent v1.1 also contains the `repository-repair-actuality` witness: the
compiled Machine reads a controlled repository, observes a failing Bun test,
requests one digest-bound replacement, and returns success only after the real
test passes. The ordinary release proof is deterministic and network-free:

```sh
zig build check-agent-actuality-release
```

The OpenAI lane is explicit, requires `OPENAI_API_KEY`, `OPENAI_MODEL`, and an
interactive approval, and is never part of `zig build check`:

```sh
OPENAI_API_KEY=... OPENAI_MODEL=... zig build check-agent-actuality-live
```

Published live evidence can be checked against independently supplied release
archives and generated application artifacts with
`zig build check-agent-actuality-v1-live-receipt -- ...`; see
[Actuality](docs/actuality.md) for the exact arguments.

See [Actuality](docs/actuality.md), the
[decision contract](docs/decision_contract.md), and
[live model data handling](docs/live_model_data.md).

Licensed under the MIT License.
