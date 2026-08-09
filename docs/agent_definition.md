# AgentDefinition v1

`agent.define` admits immutable comptime data containing a name, semantic
version, bounded instructions, portable `Goal`, `Action`, `Observation`,
`Result`, and `Failure` types, a decision protocol, exhaustive action
descriptors, budgets, and history policy.

`Action` is an exhaustive tagged union. `Observation` is an exhaustive tagged
union when effect actions exist; effect-free definitions may use `void`.
Decision result capacity must admit the maximum canonical encoding of
`Action`. Strategy specialization separately proves that the selected typed
decision request fits the request bound.

Built-in strategies use authored failures named `budget_exhausted`,
`history_overflow`, `arithmetic_overflow`, `invalid_variant`, and
`capacity_exceeded`. `.drop_oldest` additionally requires `invalid_index`
because its bounded shift uses Boundary's safe vector get/set operations.

Instructions and semantic version are identity-bearing constants. They are
not host configuration, cannot contain credentials, and cannot grant effect
authority. Optional diagnostic metadata is not implemented in v1.
