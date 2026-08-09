# Architecture

`agent` owns one transformation:

```text
typed AgentDefinition + compile-time RuntimeStrategy
    -> normalized agent specialization
    -> Boundary Control IR
    -> Boundary Program.compile
    -> Boundary Machine ABI v2
```

Definition admission closes the action algebra and static policy. Strategy
admission closes typed config, decision-request schema, state schemas, and the
exact residual effect row. `Flow` assigns compiler-local SSA and block
identities and emits ordinary Boundary Control IR. Boundary alone validates,
normalizes, lowers to RNF, synthesizes continuations, meters fuel, and executes
the Machine.

At runtime there is no privileged agent object. There is only Boundary Machine
state and typed residual effects. World may close provider Machines at
comptime; world-host persists and drives World Frames; capability receivers
implement genuinely external effects.

The preserved boundary is: Agent may generate Boundary source, but may not
generate a reducer, portable runtime state format, World Frame, host adapter,
or capability implementation. A falsifier is any production path that can
execute an AgentDefinition without `Boundary Program.compile`.
