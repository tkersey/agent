const CanonicalSystemEpistemicsSeal = struct {};

pub fn isAdmitted(comptime Epistemics: type) bool {
    return @hasDecl(Epistemics, "agent_system_epistemics_seal") and
        Epistemics.agent_system_epistemics_seal == CanonicalSystemEpistemicsSeal;
}

/// Open, non-accumulating Agent 3 epistemics for systems whose Goal already is
/// the complete decision prompt. It introduces no lifetime counter or budget.
pub fn systemStateless(comptime config: anytype) type {
    if (@typeInfo(@TypeOf(config)).@"struct".fields.len != 0) {
        @compileError("agent.epistemics.systemStateless accepts only an empty config");
    }
    return struct {
        const agent_system_epistemics_seal = CanonicalSystemEpistemicsSeal;
        pub const system_semantic_identity = "agent.epistemics.system-stateless.v1";
        pub const prompt_is_json_escaped = false;
        pub fn MemoryType(comptime _: anytype) type {
            return void;
        }
        pub fn DecisionViewType(comptime _: anytype) type {
            return void;
        }
        pub fn PromptType(comptime source: anytype) type {
            return source.Goal;
        }
        pub fn schemaTypes(comptime _: anytype) @TypeOf(.{}) {
            return .{};
        }
        pub fn emitInitial(comptime _: anytype, flow: anytype, _: anytype, comptime context: anytype) @import("flow.zig").Value(void) {
            return flow.constant(void, context.unit_index);
        }
        pub fn emitObserve(comptime _: anytype, flow: anytype, _: anytype, _: anytype, comptime context: anytype) @import("flow.zig").Value(void) {
            return flow.constant(void, context.unit_index);
        }
        pub fn emitProject(comptime _: anytype, flow: anytype, memory: anytype) @import("flow.zig").Value(void) {
            return flow.copy(memory);
        }
        pub fn emitPrompt(comptime source: anytype, _: anytype, goal: anytype, _: anytype, comptime _: anytype) @import("flow.zig").Value(source.Goal) {
            return goal;
        }
        pub fn emitModelIndex(comptime _: anytype, flow: anytype, _: anytype, comptime context: anytype) @import("flow.zig").Value(u32) {
            return flow.constant(u32, context.zero_u32_index);
        }
        pub fn emitActionAllowed(comptime _: anytype, flow: anytype, _: anytype, _: anytype, comptime context: anytype) @import("flow.zig").Value(bool) {
            return flow.constant(bool, context.true_index);
        }
        pub fn emitSkillActive(comptime _: anytype, flow: anytype, _: anytype, comptime _: usize, comptime context: anytype) @import("flow.zig").Value(bool) {
            return flow.constant(bool, context.false_index);
        }
        pub fn emitFinalAllowed(comptime _: anytype, flow: anytype, _: anytype, _: anytype, comptime context: anytype) @import("flow.zig").Value(bool) {
            return flow.constant(bool, context.true_index);
        }
    };
}

/// Admit one custom staged Agent 3 epistemic strategy. Every method emits
/// deterministic Boundary computation and no runtime plugin is retained.
pub fn system(comptime spec: anytype) type {
    if (!@hasField(@TypeOf(spec), "semantic_identity") or
        !@hasField(@TypeOf(spec), "implementation"))
    {
        @compileError("agent.epistemics.system requires semantic_identity and implementation");
    }
    if (spec.semantic_identity.len == 0) {
        @compileError("agent system epistemics semantic identity must not be empty");
    }
    const Implementation = spec.implementation;
    inline for (.{
        "MemoryType",
        "DecisionViewType",
        "schemaTypes",
        "emitInitial",
        "emitObserve",
        "emitProject",
        "emitPrompt",
        "emitSkillActive",
        "emitActionAllowed",
        "emitFinalAllowed",
    }) |name| {
        if (!@hasDecl(Implementation, name)) {
            @compileError("agent system epistemics implementation is incomplete: " ++ name);
        }
    }
    return struct {
        const agent_system_epistemics_seal = CanonicalSystemEpistemicsSeal;
        pub const system_semantic_identity = spec.semantic_identity;
        pub const prompt_is_json_escaped = if (@hasDecl(
            Implementation,
            "prompt_is_json_escaped",
        )) Implementation.prompt_is_json_escaped else false;
        pub const MemoryType = Implementation.MemoryType;
        pub const DecisionViewType = Implementation.DecisionViewType;
        pub fn PromptType(comptime source: anytype) type {
            if (@hasDecl(Implementation, "PromptType")) {
                return Implementation.PromptType(source);
            }
            return source.Goal;
        }
        pub const schemaTypes = Implementation.schemaTypes;
        pub const emitInitial = Implementation.emitInitial;
        pub const emitObserve = Implementation.emitObserve;
        pub const emitProject = Implementation.emitProject;
        pub const emitPrompt = Implementation.emitPrompt;
        pub fn emitModelIndex(
            comptime source: anytype,
            flow: anytype,
            memory: anytype,
            comptime context: anytype,
        ) @import("flow.zig").Value(u32) {
            if (@hasDecl(Implementation, "emitModelIndex")) {
                return Implementation.emitModelIndex(source, flow, memory, context);
            }
            if (source.models.len != 1) {
                @compileError("agent multi-model system epistemics must emit a deterministic model index");
            }
            return flow.constant(u32, context.zero_u32_index);
        }
        pub const emitSkillActive = Implementation.emitSkillActive;
        pub const emitActionAllowed = Implementation.emitActionAllowed;
        pub const emitFinalAllowed = Implementation.emitFinalAllowed;
    };
}
