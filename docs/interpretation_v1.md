# Agent Interpretation v1

Agent Interpretation v1 executes the repository-repair actuality Agent from
canonical BPI1 data. The AgentDefinition, RuntimeStrategy, EpistemicStrategy,
typed decision loop, Memory transitions, admission, effects, and terminal
behavior are compiled before runtime into one Boundary Program image. BPI1 is
therefore the Agent-specific executable meaning; it is not a runtime
AgentDefinition loader.

The runtime WebAssembly module is Boundary v1.6.0's fixed Machine-v2 kernel.
Its SHA-256 is
`12973fb655f126c2acd5693a84be47496649d1ab10bf22d565c9b675172e4f27`,
it imports nothing, and a fresh instance receives the complete BPI1,
MachineV2Profile, canonical State, and auxiliary bytes for every command. The
same kernel also validates an unrelated Boundary release image/profile pair.

External capabilities remain specialized receiver policy, not interpreter
clauses. The generic resolver maps each validated BPI1 effect identity through
the World application manifest to one exact receiver-owned binding. The
repository-repair environment supplies the workspace, deterministic decision
fixture, test process, and request-bound replacement approval; it contains no
Agent loop or expected action schedule.

The aggregate build acquires world-host and world-capabilities from the exact
archives bound in `interpretation/runtime-dependencies.lock.json`, stages them
as build inputs, and verifies the admitted runtime closure again by content
digest. Local root and archive overrides retain the same digest checks for
network-free development; no proof path defaults to an ambient sibling
checkout.

The clean-room run contains the fixed kernel, emitted semantic artifacts,
generic kernel driver, receiver environment, repository fixture, and only the
content-digest-bound world-host and world-capabilities runtime files. It
contains no Zig source, Agent source, application-specific WebAssembly, native
Compiled.Machine code, or repository-repair World WASM. Bun executes under a
filesystem- and network-denying sandbox: `sandbox-exec` on Darwin or Bubblewrap
with an unshared network namespace and hidden Agent source root on Linux. The
interpreted child cannot read the outer dependency source roots.

On the deterministic actuality fixture, specialized World execution and fixed
kernel interpretation observed identical canonical Machine State, request
payload, 176-byte RequestIdentity, and capability response bytes at all 17
external-effect boundaries. They also observed the same Machine-v2 yield,
terminal result bytes, repaired source bytes, and final Git tree. Focused gates
reject corrupted BPI1, corrupted MachineV2Profile, a wrong kernel, a missing or
unrelated image, a mutated response, and source smuggling.

MachineV2Profile and caller fuel remain Machine ABI v2 compatibility details.
This proof does not provide Process ABI v1, fuel-free or unbounded execution,
runtime AgentDefinition loading, live-model success, or multi-agent
interpretation.
