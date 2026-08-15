/// Runtime counters selected into each specialized Boundary program.
pub const Counters = struct {
    turns: u32,
    decisions: u32,
    effect_actions: u32,
    child_actions: u32,
};

/// Static deterministic maxima admitted with an AgentDefinition.
pub const Budget = struct {
    maximum_turns: u32,
    maximum_decisions: u32,
    maximum_effect_actions: u32,
    maximum_child_actions: u32,
};

/// Standard phases available to typed strategy decision requests.
pub const DecisionPhase = enum {
    decide,
    propose,
    reflect,
};
