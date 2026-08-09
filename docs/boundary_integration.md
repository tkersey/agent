# Boundary integration

The sole executable route is:

```text
agent.compile -> boundary.program -> Program.compile -> Machine ABI v2
```

Agent consumes exact Boundary v1.3.1. It uses public program, Control IR,
effect, schema, codec, Driver, and Machine surfaces. It does not import
`boundary.Agent`, emit WASM, duplicate value codecs, reinterpret fuel, or
author another state transition system.

The build exports a `boundary` module facade backed by Agent's exact dependency.
A downstream consumer that also loads World should rebind World's `boundary`
import to `agent_dependency.module("boundary")`. The focused shared-boundary
gate proves nominal `Vector` and schema identities are identical.

Compiler limits are compile-only admission policy and are excluded from Machine
semantic identity. Agent explicitly requests the bounded profile required by
its generated ReAct programs; Boundary owns the hard implementation maxima.
