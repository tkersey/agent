# AgentDefinition v2

`agent.define` admits immutable comptime data: name, version, instructions,
portable `Goal`, `Action`, `Observation`, `Result`, and `Failure` types, the
decision protocol, exhaustive action descriptors, and budgets.

History and final policy are not definition fields in v2. Memory retention and
final admission belong to the explicitly selected EpistemicStrategy. The
compiler rejects legacy `.history`, legacy `.final_policy`, an absent
EpistemicStrategy, and the v1 three-argument `agent.compile` form.

Instructions and action metadata are identity-bearing static contract data.
They are emitted in `AGT_DCT2`, not repeated in dynamic DecisionTurns. They
cannot contain credentials or grant effect authority.
