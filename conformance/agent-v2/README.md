# Agent ENF conformance

`baseline.json` binds the exact Agent v1.1.2 release tuple and the measured
repository-repair run used by the v2 resource gates. Measurements were taken
with Zig 0.16.0 and Bun 1.3.14 against checksum-authenticated public artifacts.

`candidate.json` binds the exact Agent v2 implementation commit, tree,
deterministic Git archive, package-source projection, artifacts, and
authenticated compiler benchmark. Revisions after that implementation commit,
including a topology-only merge commit, may change only `candidate.json`; this
avoids a self-referential commit hash while making any later implementation
change fail closed. The release check reruns the
controlled deterministic lifecycle from lock-pinned public runtime archives
and rejects any mismatch in revision, Frame, state, payload, or WASM measures.

`zig build check-agent-release` installs its deterministic receipt at
`zig-out/agent-v2/completion-receipt.txt`. The redacted live Actuality receipt
is a separate release-closeout gate and must pass before the Agent tag is cut.

The measurement runner is `tools/actuality/measure-release.mjs`. Frame and
state sizes are canonical bytes returned and admitted by world-host; timing
values are observational and machine-specific.
