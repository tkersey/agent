# Agent Actuality v2

`repository-repair-actuality` compiles AgentDefinition v2, ReAct, and the
`repository_working_set_v1` EpistemicStrategy into one ordinary Boundary
Machine and one World Application ABI v1 WASM.

The deterministic lane performs real repository reads, literal search,
`bun test`, request-bound approval, one atomic source replacement, a hidden
behavior check, and typed completion. The current artifact is import-free,
3,741,106 bytes, uses a 128 MiB WASM stack, declares at most 256 MiB linear
memory, and admits at most 512 KiB application state.

```sh
AGENT_WORLD_HOST_ROOT=/path/to/world-host \
AGENT_WORLD_CAPABILITIES_ROOT=/path/to/world-capabilities \
zig build check-agent-actuality-release
```

The lifecycle proof additionally requires byte-identical retry, zero-fresh-
effect replay, independent children from one parent, and migration with
receiver preflight and no transferred secrets or approval.

The anonymous public lane downloads exact lock-pinned world-host and
world-capabilities artifacts, authenticates them before extraction, and runs
without sibling source checkouts or GitHub credentials:

```sh
zig build check-agent-reference-stack
```

The live lane swaps only the deterministic decision handler for the admitted
OpenAI pack. It requires `OPENAI_API_KEY`, `OPENAI_MODEL`, a TTY confirmation
before controlled fixture contents are sent, and request-specific interactive
approval before mutation:

```sh
AGENT_WORLD_HOST_ROOT=/path/to/world-host \
AGENT_WORLD_CAPABILITIES_ROOT=/path/to/world-capabilities \
OPENAI_API_KEY=... OPENAI_MODEL=... \
zig build check-agent-actuality-live
```

Capabilities return EffectResults only. They cannot author Memory,
DecisionView, Frames, Machine state, branch heads, or terminal results.
