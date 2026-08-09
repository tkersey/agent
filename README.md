# agent

`agent` is a Zig staged compiler for data-defined agent systems.

```text
AgentDefinition
+ RuntimeStrategy
-> Boundary Machine
-> World application WASM
```

Agent definitions are typed comptime data. Runtime strategies are reusable
compile-time software. Specialization lowers through the ordinary Boundary
compiler, and the resulting Boundary Machine is the only executable meaning.

```zig
const agent = @import("agent");

const Definition = agent.define(.{ /* typed definition */ });
const Strategy = agent.strategy.react(.{});
const Compiled = agent.compile(Definition, Strategy, .{});

pub const Machine = Compiled.Machine;
```

The package targets Zig 0.16.0 and exact Boundary v1.3.1. It contains no host,
capability implementation, runtime definition loader, strategy registry, tool
registry, or generic agent interpreter.

Licensed under the MIT License.
