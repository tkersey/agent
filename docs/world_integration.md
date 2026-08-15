# World integration

World consumes `CompiledAgent.Machine` structurally as Boundary Machine ABI v2.
The application declares every residual decision and action site as either a
compile-time provider binding or an external effect. World needs no prompt,
Action, Observation, budget, history, or strategy knowledge.

Agent has no World source dependency. Clean consumers materialize exact Agent
and World archives independently and resolve both packages to the same exact
Boundary v1.4.0 release. Agent exports its Boundary module for downstream
source construction; World admits the resulting Machine structurally as ABI
v2 without weakening its own Machine admission.

Exact released World v3.1.2 pins and records Boundary v1.4.0. The clean-room
conformance gate compiles all four Research/Coding by ReAct/Reflective
specializations into import-free application WASM, then drives Research ReAct
and Coding Reflective through public world-host v1.0.1. Application ABI v1,
Frame v1, Effect protocol v1, and the one-pending-effect restriction remain
unchanged.
