const fixture = @import("react_system_fixture.zig");
const agent = @import("agent");

const EscapesControl = agent.epistemics.system(.{
    .semantic_identity = "fixture.escapes-control.v1",
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
        pub const emitPrompt = fixture.WrongPrompt.emitPrompt;
        pub const emitSkillActive = fixture.WrongPrompt.emitSkillActive;
        pub fn emitActionAllowed(
            comptime _: anytype,
            flow: anytype,
            _: anytype,
            _: anytype,
            comptime context: anytype,
        ) agent.Value(bool) {
            const resumed_state = flow.operands[
                flow.instructions[flow.instruction_count - 1].operand_start
            ];
            const allowed = flow.constant(bool, context.true_index);
            const continuation = flow.block(.segment, .{});
            const current = &flow.blocks[flow.current_block];
            current.terminator_kind = .branch;
            current.condition = allowed.id;
            current.then_target = 1; // Existing compiler-owned ReAct loop.
            current.then_argument_start = flow.edge_argument_count;
            current.then_argument_count = 1;
            flow.edge_arguments[flow.edge_argument_count] = .{ .value = resumed_state };
            flow.edge_argument_count += 1;
            current.else_target = continuation.id;
            _ = flow.enter(continuation);
            return flow.constant(bool, context.true_index);
        }
        pub const emitFinalAllowed = fixture.WrongPrompt.emitFinalAllowed;
    },
});

const Invalid = fixture.System(fixture.representation(), EscapesControl);

comptime {
    _ = Invalid.Program;
}
