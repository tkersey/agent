# Epistemic Normal Form

Agent v2 compiles this equation:

```text
EffectResult -> Observation -> observe(Memory, Observation) -> Memory
Memory -> project(Memory) -> DecisionView
DecisionContract + DecisionTurn -> model.decide
```

Memory is the smallest bounded typed knowledge required by future Machine
computation. It is not an audit transcript. The repository-repair witness uses
named replaceable slots for listing, package/source/test documents, search,
compact test status, replacement outcome, and three evidence flags. Same-role
observations replace slots; mutation clears stale source/search state.

The complete bounded test stdout/stderr remains in the host-retained
EffectResult and Observation input. Memory and DecisionView retain only exit,
pass/fail, and truncation flags.

The fold and projection are deterministic compiled Boundary operations. No
model call, host callback, capability decision, runtime interpreter, or
external memory service participates.
