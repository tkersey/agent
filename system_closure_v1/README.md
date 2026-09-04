# Agent System Closure v1 fixture

This archive contains one ordinary Boundary Program Image, its InitialArgs, a
small World Process scheduler, a generic semantic model protocol adapter, and
the isolated repository fixture that realizes the declared external effects.
It contains no Agent compiler, Boundary source, Agent-specific interpreter,
Machine profile, prompt sidecar, tool catalog, or skill installation.

With the released World runtime extracted separately, create an empty work
directory and run:

```sh
node run.mjs --world-root /path/to/world-runtime \
  --world-archive /path/to/world-v4.1.0-process-host-runtime.tar.gz --mode fixture \
  --work-dir /path/to/empty-work-directory
```

Fixture mode performs real HTTP transport over loopback, real repository reads
and digest-bound replacement, and the fixture's fixed `bun test` command. It
prints one JSON proof receipt and leaves the repaired Git working tree in
`WORK_DIR/workspace` for independent inspection.

For an uninterrupted source-independent Process State census, add an output
path. This uses the same image, adapter, fixture, and World runtime while
recording every State-bearing outcome against the nonsemantic source map:

```sh
node run.mjs --world-root /path/to/world-runtime \
  --world-archive /path/to/world-v4.1.0-process-host-runtime.tar.gz --mode fixture \
  --work-dir /path/to/empty-work-directory \
  --census-output /path/to/process-census.json
```

`source-map.json` and `process_state_census.mjs` are diagnostic only. Normal
execution does not read them, and their image/transition digests must match the
canonical `system.bpi1` before census collection begins.

After anonymously downloading the World and Agent release archives and the
Agent receipt, verify their public fixture, census, and admitted negative paths
from an otherwise empty directory:

```sh
node public_verify.mjs \\
  --world-root /path/to/extracted-world-runtime \\
  --world-archive /path/to/world-v4.1.0-process-host-runtime.tar.gz \\
  --agent-archive /path/to/agent-v3.0.0-system-closure-v1.tar.gz \\
  --agent-receipt /path/to/agent-v3.0.0-system-closure-v1-receipt.json \\
  --work-root /path/to/empty-verification-work \\
  --census-output /path/to/public-census.json \\
  --negative-output /path/to/public-negatives.json
```

The public verifier rejects stale or unoffered Actions, malformed and multiple
calls, false completion and replacement claims, host model/prompt/tool
substitution, checkpoint mode changes, and unknown or duplicate scheduler
controls. It reports zero dangerous effects for every rejected input and never
runs live-model mode.

The model invocation carries distinct image-selected bounds for normalized
result text, Action argument JSON, and the complete provider response envelope.
Tool schemas expose standard `maxLength`; the generic adapter additionally
enforces the corresponding UTF-8 byte capacity. Canonical decimal parameters
and integer schema bounds are spliced as validated JSON number lexemes, without
binary floating-point conversion.

Live mode uses the same image and scheduling path. It accepts only the service
endpoint, credential, World runtime, and isolated workspace authority:

```sh
OPENAI_API_KEY=... node run.mjs \
  --world-root /path/to/world-runtime \
  --world-archive /path/to/world-v4.1.0-process-host-runtime.tar.gz \
  --mode live \
  --endpoint https://api.openai.com/v1/responses \
  --work-dir /path/to/empty-work-directory
```

The image fixes model `gpt-5.4-mini-2026-03-17`, prompts, skills, tools, and
strategy. Live mode has no override for any of them. It is explicitly invoked
and may perform the image-admitted digest-bound replacement inside the supplied
isolated workspace. A live success is reported separately from fixture proof.
