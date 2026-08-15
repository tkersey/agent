# Agent v1 conformance

`zig build check --summary all` is the public compiler proof. It requires no
host/capability artifact, GitHub authentication, provider credential, or live
effect.

`zig build check-agent-release --summary all` additionally runs the hermetic
compiler proof and the lock-pinned anonymous reference-stack lifecycle before
emitting the candidate completion receipt.

After `v1.1.2` is tagged, run the released-artifact proof with the exact source
archive and its verified SHA-256:

```sh
AGENT_V1_ARCHIVE=/path/to/agent-v1.1.2.tar.gz \
AGENT_V1_ARCHIVE_SHA256=<sha256> \
zig build check-agent-1-externality --summary all
```

The command extracts every compiler package into an empty temporary directory,
builds the four specialization applications against exact released Boundary and
World packages, copies only runtime artifacts to a second directory, removes Zig
from runtime `PATH`, and drives the applications with exact public world-host
v1.0.1 and world-capabilities v2.1.2 artifacts. The default public proof uses
stable release URLs and no GitHub CLI; `check-agent-reference-stack-offline`
accepts local archives matching the same lock checksums.

The release-line provenance and the meaning of historical versus remaining
upstream work are defined in [release_line.md](../../docs/release_line.md).
