# RuntimeStrategy v2

A RuntimeStrategy is compile-time Zig software that selects deliberation
topology. ReAct and reflective ReAct share compiler-owned AgentState,
DecisionTurn construction, effect dispatch, observation folding, budget
counters, and final admission.

Custom strategies select topology through `agent.RuntimeFlow`. They cannot
replace the complete Program Body or bypass the selected EpistemicStrategy.
RuntimeFlow owns every state and epistemic boundary; custom code may choose
phases and transitions only.

`emitDecisionLocal` receives only the current goal, budget counters, and the
already-projected DecisionView. It never receives AgentState or raw Memory.
The compiler independently rejects effects and control-topology mutation even
for a hand-authored structural strategy type.

No callback, strategy registry, or strategy selection object remains in the
Machine. Every strategy lowers into the same ordinary Boundary Program and the
same Machine ABI v2 reducer.
