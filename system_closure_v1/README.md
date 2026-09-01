# Agent System Closure v1 fixture

This archive contains one ordinary Boundary Program Image, its InitialArgs, a
small World Process scheduler, a byte-preserving loopback model transport, and
the isolated repository fixture that realizes the declared external effects.
It contains no Agent compiler, Boundary source, Agent-specific interpreter,
Machine profile, prompt sidecar, tool catalog, or skill installation.

With the released World runtime extracted separately, create an empty work
directory and run:

```sh
node run.mjs --world-root /path/to/world-runtime --mode fixture \
  --work-dir /path/to/empty-work-directory
```

Fixture mode performs real HTTP transport over loopback, real repository reads
and digest-bound replacement, and the fixture's fixed `bun test` command. It
prints one JSON proof receipt and leaves the repaired Git working tree in
`WORK_DIR/workspace` for independent inspection.

Live mode uses the same image and scheduling path. It accepts only the service
endpoint, credential, World runtime, and isolated workspace authority:

```sh
OPENAI_API_KEY=... node run.mjs \
  --world-root /path/to/world-runtime \
  --mode live \
  --endpoint https://api.openai.com/v1/responses \
  --work-dir /path/to/empty-work-directory
```

The image fixes model `gpt-5.4-mini-2026-03-17`, prompts, skills, tools, and
strategy. Live mode has no override for any of them. It is explicitly invoked
and may perform the image-admitted digest-bound replacement inside the supplied
isolated workspace. A live success is reported separately from fixture proof.
