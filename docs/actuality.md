# Repository-repair application migration

The retained repository-repair fixtures under `actuality/` and their semantic
tests describe the predecessor application: repository reads, literal search,
tests, request-bound approval, atomic replacement and typed completion. They
still require migration to the Boundary 3 / World 6 successor. Their old
application-specific WASM build and world-host/world-capabilities acquisition
commands are retired and do not run against the current authoring API.

Current [runtime setup](agent4-runtime.md), [migration guidance](migration_from_3.md)
and [successor status](compositional-execution.md) describe the supported path.
The current inquiry and approval tests do not by themselves qualify the complete
repository-repair application. No live-model or real-repository repair claim is
made for the successor. The [adequacy obstruction](../adequacy/router-policy-v1/agent-adequacy-obstruction.md)
and its minimal reproducer remain retained.
