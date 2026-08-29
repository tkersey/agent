# Boundary integration

Agent exposes one primary portable form and one bounded compatibility form:

```text
agent.process.compile -> boundary.program -> BPI1 -> fixed Process kernel
agent.episode.compile -> boundary.program -> specialized Machine ABI v2
```

Agent compiles with exact Boundary v1.6.1. It uses public program, Control IR,
effect, schema, codec, Driver, image, and Machine-v2 kernel surfaces. It does
not import `boundary.Agent`, duplicate value codecs, reinterpret fuel, or
author another state transition system. The asset build compiles one host
emitter once and writes the exact repository-repair `Program.image().bytes`
and MachineV2Profile bytes directly to standard output;
application-specific WASM remains an optional World compatibility artifact. The
portable runtime is only fixed Process-kernel WASM, BPI1, and Process State or
InitialArgs; Agent owns none of those runtime formats or artifacts.

The build exports a `boundary` module facade backed by Agent's exact dependency.
Agent and World v3.1.4 pin the same implementation-only Boundary owner fix,
which makes the released `Program.image()` surface use one practical canonical
encoder without adding public API. The receipt binds the exact Boundary and
World source commits and Zig package hashes. Compatibility is proved by the
unchanged BPI1 bytes, Machine-v2 profile/manifest root binding, successful World
application build, and byte-identical specialized/interpreted execution. The
runtime kernel remains the exact Boundary v1.6.0 release artifact.

Compiler limits are compile-only admission policy and are excluded from Machine
semantic identity. Agent explicitly requests the bounded profile required by
its generated ReAct programs; Boundary owns the hard implementation maxima.
