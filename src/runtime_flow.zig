/// Compiler-owned topology choices available to a custom RuntimeStrategy.
/// The facade is intentionally declarative: Agent retains construction of
/// state, decisions, effects, epistemic folds, final admission, and budgets.
pub const Topology = enum {
    react,
};

pub fn RuntimeFlow(
    comptime Definition: type,
    comptime Epistemics: type,
) type {
    return struct {
        pub const AgentDefinition = Definition;
        pub const EpistemicStrategy = Epistemics;

        pub fn react() Topology {
            return .react;
        }
    };
}
