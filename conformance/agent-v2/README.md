# Agent ENF conformance

`baseline.json` binds the exact Agent v1.1.2 release tuple and the measured
repository-repair run used by the v2 resource gates. Measurements were taken
with Zig 0.16.0 and Bun 1.3.14 against checksum-authenticated public artifacts.

`candidate.json` binds the Agent v2 frozen candidate and uses the same
measurement runner and controlled fixture. `completion-receipt.txt` is emitted
only after deterministic lifecycle, public archive, and live-receipt gates pass.

The measurement runner is `tools/actuality/measure-release.mjs`. Frame and
state sizes are canonical bytes returned and admitted by world-host; timing
values are observational and machine-specific.
