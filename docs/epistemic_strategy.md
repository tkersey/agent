# EpistemicStrategy v1

An EpistemicStrategy declares portable bounded `Memory` and `DecisionView`
types and compile-time lowerings for initial Memory, Observation folding,
projection, and final admission. `agent.compile` requires it as the third axis.

`agent.epistemics.verbatim` preserves bounded transcript behavior for
differential proof. `agent.epistemics.custom` admits program-specific working
sets. Both lower through the same compiler and Boundary reducer; neither leaves
a callback or registry at runtime.

For fixed inputs, initial, observe, project, and final admission must yield the
same canonical result or authored failure. Every collection and text field is
statically bounded, and DecisionView must fit the definition's request limit.
