# Boundary integration

Agent exposes two execution forms over one compiled Boundary Program:

```text
agent.compile -> boundary.program -> Program.compile -> specialized Machine ABI v2
agent.compile -> boundary.program -> BPI1 + MachineV2Profile -> fixed Boundary kernel
```

Agent consumes exact Boundary v1.6.0. It uses public program, Control IR,
effect, schema, codec, Driver, image, and Machine-v2 kernel surfaces. It does
not import `boundary.Agent`, duplicate value codecs, reinterpret fuel, or
author another state transition system. The asset build uses a freestanding
WASM emitter to copy the exact repository-repair `Program.image().bytes`;
application-specific WASM remains owned by World, and the interpreted runtime
loads only the fixed Boundary kernel.

The build exports a `boundary` module facade backed by Agent's exact dependency.
A downstream consumer that also loads World resolves both packages to the same
exact Boundary v1.6.0 archive. The focused shared-boundary gate proves Agent's
facade retains nominal `Vector` and schema identity; the clean-room World gate
proves the compiled Machine is admitted without a sibling checkout.

Compiler limits are compile-only admission policy and are excluded from Machine
semantic identity. Agent explicitly requests the bounded profile required by
its generated ReAct programs; Boundary owns the hard implementation maxima.
