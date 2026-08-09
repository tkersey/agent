# RuntimeStrategy v1

A RuntimeStrategy is comptime Zig software. It validates one definition,
selects a portable config and decision-request type, declares strategy state
schemas, and elaborates one Boundary program body.

Built-ins are `agent.strategy.react(.{})` and
`agent.strategy.reflective(.{ .reflection_rounds = N })`. Reflective ReAct
performs one proposal followed by a statically bounded number of reflection
decisions before dispatching the selected Action.

Downstream strategies use `agent.strategy.custom` with a typed portable config,
an implementation exposing `validate`, `DecisionRequest`, `StateSchemaTypes`,
and `Body`, and exhaustive stable-name coverage in Action declaration order.
The Body must be authored through public `agent.Flow` or equivalent ordinary
Boundary IR. The compiler rejects any Body whose effect row differs from the
definition-derived decision and Action sites.

No callback, config object, strategy enum, or strategy selection mechanism is
retained in the Machine. Config canonical bytes, generated Control IR, state
schemas, and Machine contract identity are retained only as provenance.
