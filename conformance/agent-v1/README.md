# Agent v1 conformance

`zig build check-agent-release --summary all` emits the candidate completion
receipt after the focused compiler, specialization, Boundary-equivalence,
native/WASM, no-runtime, clean-room World, lifecycle, external-consumer,
compile-fail, and lint proofs pass.

After `v1.0.0` is tagged, run the released-artifact proof with the exact source
archive and its verified SHA-256:

```sh
AGENT_V1_ARCHIVE=/path/to/agent-v1.0.0.tar.gz \
AGENT_V1_ARCHIVE_SHA256=<sha256> \
zig build check-agent-1-externality --summary all
```

The command extracts every compiler package into an empty temporary directory,
builds the four specialization applications against exact released Boundary and
World packages, copies only runtime artifacts to a second directory, removes Zig
from runtime `PATH`, and drives the applications with exact released world-host
and Effect v1 capability artifacts.
