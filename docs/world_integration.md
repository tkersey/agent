# World integration

World consumes `CompiledAgent.Machine` structurally as Boundary Machine ABI v2.
The application declares every residual decision and action site as either a
compile-time provider binding or an external effect. World needs no prompt,
Action, Observation, budget, history, or strategy knowledge.

Agent has no World source dependency. Clean consumers materialize the exact
Agent and World archives independently and rebind World's `boundary` import to
Agent's exported exact Boundary module before creating `world.application`.

Released World v3.0.0 is structurally compatible after that wiring but owns a
hard-coded Boundary v1.0.0 provenance field. It therefore cannot truthfully
close an Agent Machine compiled against Boundary v1.3.1. End-to-end release
conformance remains gated on a World release that pins and records Boundary
v1.3.1 while preserving Application ABI v1 and Frame v1. Bypassing the public
constructor or falsifying the manifest is forbidden.
