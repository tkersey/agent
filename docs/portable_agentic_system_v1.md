# Portable Agentic System v1

The canonical Agent path is build-time only:

```text
agent.process.define
-> agent.process.compile
-> ordinary Boundary Program
-> world.system internal-handler linkage
-> one closed BPI1
-> fixed import-free Boundary Process kernel
```

`agent.process` has no mandatory Budget, final action, maximum decisions, or
Machine-v2 profile. Its decision effect is self-contained:

```text
DecisionEnvelope {
  contract_digest,
  contract_bytes,
  turn,
}
```

The repository-repair witness links `repository.propose_replace.v1` to an
ordinary `ReplacementPolicyProgram`. The policy admits only the fixed source
path, a complete SHA-256 digest, and nonempty replacement/rationale values, then
emits `repo.replace.approved.v1`. The proposal effect is absent from the final
residual catalog.

The Agent-owned epistemic admission law rejects read paths outside the three
admitted documents and rejects replacement before a failing test or when its
path/digest differ from the latest admitted source read. Final admission binds
the sole changed path and final digest to the typed applied replacement outcome.
These checks execute inside BPI1 before an external effect or terminal result;
the host adapter and capability implementation are not semantic fallbacks.

```sh
zig build check-portable-agentic-system-v1 --summary all
zig build emit-portable-agentic-system-v1
```

The proof executes one finite reduction per fresh WASM instance, transfers only
BPI1 and Process State after external effect eight, recovers the byte-identical
pending request, completes the 17-boundary repository-repair trace, and verifies
the final Git tree. Its runtime inventory is exactly:

```text
boundary-process-kernel-v1.wasm
boundary-process-step.mjs
system.bpi1
initial-args.bin
```

The aggregate also runs the exact landed Agent Interpretation v1 BPI1
(`7440076a...`) with the same deterministic typed residual-effect resolver. Its
separate receipt binds every request payload and supplied result digest, all 17
external boundaries, the terminal result, transfer recovery, and the final Git
tree without a MachineV2Profile.

`agent.episode` retains bounded Agent v2 behavior and the World Application ABI
v1 compatibility path. Portable Process execution does not claim portable
environmental authority, exactly-once effects, hostile-host protection, infinite
physical memory, or removal of Machine ABI v2 and World Application ABI v1.
