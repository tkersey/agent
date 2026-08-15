# RuntimeStrategy v2

A RuntimeStrategy is compile-time Zig software that selects deliberation
topology. ReAct and reflective ReAct share compiler-owned AgentState,
DecisionTurn construction, effect dispatch, observation folding, budget
counters, and final admission.

Custom strategies select topology through `agent.RuntimeFlow`. They cannot
replace the complete Program Body or bypass the selected EpistemicStrategy.
RuntimeFlow owns every state and epistemic boundary; custom code may choose
phases and transitions only.

No callback, strategy registry, or strategy selection object remains in the
Machine. Every strategy lowers into the same ordinary Boundary Program and the
same Machine ABI v2 reducer.
