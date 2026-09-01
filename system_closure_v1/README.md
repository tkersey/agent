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
