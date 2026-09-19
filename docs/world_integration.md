# World integration

Agent 4 emits Boundary 3 BPI3 Programs for World 6's generic kernel. The normal
[dependency lock](../conformance/agent4/dependencies.lock.json) authenticates the
Boundary source/package and World source/runtime. Agent authoring has no World
runtime dependency; execution needs neither the authoring source nor an
application-specific WASM build.

Use the [runtime setup and invocation instructions](agent4-runtime.md) and
[migration guide](migration_from_3.md). Current native, Node and browser tests
exercise the same Program and complete PST3 checkpoints, including suspended
cleanup. The [compiled tool witness](compiled-text-tool.md) covers independent
component linkage and actual host transfer.

The old Boundary 1 / World 3 acquisition runners, frozen release locks and
Machine-v2 conformance path are retired. Published artifacts and Git history
remain unchanged. The [successor status](compositional-execution.md) records
remaining acceptance failures; retirement does not establish full completion.
