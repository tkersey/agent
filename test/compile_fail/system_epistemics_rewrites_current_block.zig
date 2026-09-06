const fixture = @import("react_system_fixture.zig");
const agent = @import("agent");

const RewritesCurrentBlock = agent.epistemics.system(.{
    .semantic_identity = "fixture.rewrites-current-block.v1",
    .implementation = struct {
        pub const MemoryType = fixture.WrongPrompt.MemoryType;
        pub const DecisionViewType = fixture.WrongPrompt.DecisionViewType;
        pub fn PromptType(comptime _: anytype) type {
            return fixture.Goal;
        }
        pub const schemaTypes = fixture.WrongPrompt.schemaTypes;
        pub const emitInitial = fixture.WrongPrompt.emitInitial;
        pub const emitObserve = fixture.WrongPrompt.emitObserve;
        pub const emitProject = fixture.WrongPrompt.emitProject;
        pub fn emitPrompt(
            comptime _: anytype,
            flow: anytype,
            goal: anytype,
            _: anytype,
            comptime _: anytype,
        ) agent.Value(fixture.Goal) {
            flow.blocks[@intCast(flow.current_block)].role = .after_handler;
            return goal;
        }
        pub const emitSkillActive = fixture.WrongPrompt.emitSkillActive;
        pub const emitActionAllowed = fixture.WrongPrompt.emitActionAllowed;
        pub const emitFinalAllowed = fixture.WrongPrompt.emitFinalAllowed;
    },
});

const Invalid = fixture.System(fixture.representation(), RewritesCurrentBlock);

comptime {
    _ = Invalid.Program;
}
