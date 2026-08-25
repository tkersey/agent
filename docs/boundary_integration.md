# Boundary integration

Agent exposes two execution forms over one compiled Boundary Program:

```text
agent.compile -> boundary.program -> Program.compile -> specialized Machine ABI v2
agent.compile -> boundary.program -> BPI1 + MachineV2Profile -> fixed Boundary kernel
```

Agent consumes exact Boundary v1.6.0. It uses public program, Control IR,
effect, schema, codec, Driver, image, and Machine-v2 kernel surfaces. It does
not import `boundary.Agent`, duplicate value codecs, reinterpret fuel, or
author another state transition system. The asset build compiles one host
emitter once and writes the exact repository-repair `Program.image().bytes`
and MachineV2Profile bytes directly to standard output;
application-specific WASM remains owned by World, and the interpreted runtime
loads only the fixed Boundary kernel.

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
