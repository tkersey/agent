# Evidence and Memory

world-host owns complete protocol evidence: Frames, EffectRequests,
EffectResults, branch heads, and lifecycle lineage. The Machine owns compact
Memory. Capabilities own neither.

Continuation needs only the current compact Frame. Retry reuses the persisted
EffectResult and recomputes the same fold. Replay from genesis recomputes every
fold with zero fresh covered effects. Branches derive independent Memory.
Migration transfers the application, current Frame, retained results, and
lineage while receiver secrets and policy remain local.

Forgetting an Observation from current Memory never deletes its retained
EffectResult and never turns Memory into complete audit evidence.
