const std = @import("std");
const boundary = @import("boundary");
const action = @import("action.zig");
const budget = @import("budget.zig");
const decision_contract = @import("decision_contract.zig");
const flow_module = @import("flow.zig");
const manifest = @import("manifest.zig");
const strategy = @import("strategy.zig");

const Constant = enum(u16) {
    zero,
    one,
    maximum_turns,
    maximum_decisions,
    maximum_effect_actions,
    maximum_child_actions,
    initial_phase,
    budget_exhausted,
    invalid_variant,
    decision_contract_digest,
    initial_memory,
    true_value,
    false_value,
    reflect_phase,
    reflection_rounds,
};

const epistemic_constant_base: u16 = 15;

fn ActionSite(comptime Definition: type, comptime action_index: usize) type {
    return strategy.ActionSite(Definition, action_index);
}

fn decisionSiteType(
    comptime Definition: type,
    comptime Strategy: type,
    comptime Epistemics: type,
) type {
    return strategy.DecisionSiteFor(
        Definition,
        strategy.DecisionTurn(Definition, Strategy, Epistemics),
    );
}

fn effectSites(
    comptime Definition: type,
    comptime Strategy: type,
    comptime Epistemics: type,
) [1 + strategy.effectCount(Definition)]type {
    return strategy.effectSites(Definition, Strategy, Epistemics);
}

fn observationIndex(
    comptime Definition: type,
    comptime name: []const u8,
) u16 {
    inline for (@typeInfo(Definition.Observation).@"union".fields, 0..) |field, index| {
        if (comptime std.mem.eql(u8, field.name, name)) return @intCast(index);
    }
    unreachable;
}

fn observationFieldCount(comptime Definition: type) usize {
    return switch (@typeInfo(Definition.Observation)) {
        .@"union" => |info| info.fields.len,
        else => 0,
    };
}

fn hasVoidEffectAction(comptime Definition: type) bool {
    inline for (0..Definition.action_count) |index| {
        const Descriptor = Definition.ActionDescriptor(index);
        if (Descriptor.kind == .effect and Descriptor.Site.Payload == void) {
            return true;
        }
    }
    return false;
}

fn unitConstantIndex(comptime Epistemics: type, comptime Definition: type) u16 {
    return epistemic_constant_base + Epistemics.constantValues(Definition).len;
}

fn epistemicContext(comptime Definition: type, comptime Epistemics: type) type {
    return Epistemics.constantContext(Definition, epistemic_constant_base);
}

fn generatedFlowLimits(
    comptime Definition: type,
    comptime Epistemics: type,
    comptime is_reflective: bool,
) flow_module.Limits {
    const actions = Definition.action_count;
    const scale: usize = if (is_reflective) 2 else 1;
    // Boundary v1.6.1's compiler admits at most 1024 values and 128 blocks.
    // Complexity may scale the other authoring buffers, but it must not make
    // Agent request an impossible Boundary compiler envelope.
    const maximum_values = 1024;
    const maximum_blocks = 128;
    return .{
        .maximum_values = @min(
            maximum_values,
            128 + 64 * actions * scale + 128 * Epistemics.lowering_complexity,
        ),
        .maximum_blocks = @min(
            maximum_blocks,
            16 + 16 * actions * scale + 32 * Epistemics.lowering_complexity,
        ),
        .maximum_instructions = 64 + 64 * actions * scale + 128 * Epistemics.lowering_complexity,
        .maximum_operands = 128 + 128 * actions * scale + 256 * Epistemics.lowering_complexity,
        .maximum_parameters = 64 + 64 * actions * scale + 128 * Epistemics.lowering_complexity,
        .maximum_requests = 8 + 8 * actions * scale,
        .maximum_edge_arguments = 128 + 128 * actions * scale + 256 * Epistemics.lowering_complexity,
    };
}

fn generatedCompilerLimits(
    comptime control_ir: boundary.ir.Program,
    comptime is_reflective: bool,
    comptime epistemic_complexity: usize,
) boundary.ir.CompilerLimits {
    const defaults: boundary.ir.CompilerLimits = .{};
    return .{
        .maximum_values = @max(
            control_ir.value_types.len,
            defaults.maximum_environment_fields,
        ),
        .maximum_blocks = control_ir.blocks.len,
        .maximum_constructors = defaults.maximum_constructors,
        .maximum_environment_fields = defaults.maximum_environment_fields,
        .maximum_invariant_terms = @min(
            64,
            defaults.maximum_invariant_terms +
                2 * (epistemic_complexity - 1) +
                @intFromBool(is_reflective),
        ),
        .maximum_generated_operations = defaults.maximum_generated_operations,
    };
}

fn schemaTypes(
    comptime Definition: type,
    comptime Strategy: type,
    comptime Epistemics: type,
) [13 + Definition.action_count + observationFieldCount(Definition) + Strategy.StateSchemaTypes(Definition).len + Epistemics.StateSchemaTypes(Definition).len]type {
    var result: [13 + Definition.action_count + observationFieldCount(Definition) + Strategy.StateSchemaTypes(Definition).len + Epistemics.StateSchemaTypes(Definition).len]type = undefined;
    result[0..13].* = .{
        Definition.Goal,
        Definition.Action,
        Definition.Observation,
        Definition.Result,
        Definition.Failure,
        budget.Counters,
        Epistemics.MemoryType(Definition),
        strategy.State(Definition, Epistemics),
        strategy.DecisionTurn(Definition, Strategy, Epistemics),
        Epistemics.DecisionViewType(Definition),
        budget.DecisionPhase,
        Strategy.DecisionLocalType(Definition),
        [32]u8,
    };
    inline for (@typeInfo(Definition.Action).@"union".fields, 0..) |field, index| {
        result[13 + index] = field.type;
    }
    switch (@typeInfo(Definition.Observation)) {
        .@"union" => |info| inline for (info.fields, 0..) |field, index| {
            result[13 + Definition.action_count + index] = field.type;
        },
        else => {},
    }
    const state_offset = 13 + Definition.action_count + observationFieldCount(Definition);
    const strategy_types = Strategy.StateSchemaTypes(Definition);
    inline for (strategy_types, 0..) |StateType, index| {
        result[state_offset + index] = StateType;
    }
    const epistemic_types = Epistemics.StateSchemaTypes(Definition);
    inline for (epistemic_types, 0..) |StateType, index| {
        result[state_offset + strategy_types.len + index] = StateType;
    }
    return result;
}

fn failureConstant(
    flow: anytype,
    comptime Definition: type,
    comptime which: Constant,
) flow_module.Value(Definition.Failure) {
    return flow.constant(Definition.Failure, @intFromEnum(which));
}

fn emitEpistemicInitial(
    comptime Definition: type,
    comptime Epistemics: type,
    flow: anytype,
    goal: flow_module.Value(Definition.Goal),
) flow_module.Value(Epistemics.MemoryType(Definition)) {
    const before_suspensions = flow.suspensionSnapshot();
    const before_returns = flow.returnSnapshot();
    const result = Epistemics.emitInitial(
        Definition,
        flow,
        goal,
        epistemicContext(Definition, Epistemics),
    );
    if (!std.meta.eql(flow.suspensionSnapshot(), before_suspensions)) {
        @compileError("agent EpistemicStrategy emitInitial must be effect-free");
    }
    if (!std.meta.eql(flow.returnSnapshot(), before_returns)) {
        @compileError("agent EpistemicStrategy emitInitial must not terminate the Agent program");
    }
    return result;
}

fn emitEpistemicObservePayload(
    comptime Definition: type,
    comptime Epistemics: type,
    flow: anytype,
    memory: flow_module.Value(Epistemics.MemoryType(Definition)),
    comptime observation_index: u16,
    payload: anytype,
) flow_module.Value(Epistemics.MemoryType(Definition)) {
    const before_suspensions = flow.suspensionSnapshot();
    const before_returns = flow.returnSnapshot();
    const result = Epistemics.emitObservePayload(
        Definition,
        flow,
        memory,
        observation_index,
        payload,
        epistemicContext(Definition, Epistemics),
    );
    if (!std.meta.eql(flow.suspensionSnapshot(), before_suspensions)) {
        @compileError("agent EpistemicStrategy emitObserve must be effect-free");
    }
    if (!std.meta.eql(flow.returnSnapshot(), before_returns)) {
        @compileError("agent EpistemicStrategy emitObserve must not terminate the Agent program");
    }
    return result;
}

fn emitEpistemicProject(
    comptime Definition: type,
    comptime Epistemics: type,
    flow: anytype,
    memory: flow_module.Value(Epistemics.MemoryType(Definition)),
) flow_module.Value(Epistemics.DecisionViewType(Definition)) {
    const before_suspensions = flow.suspensionSnapshot();
    const before_returns = flow.returnSnapshot();
    const result = Epistemics.emitProject(Definition, flow, memory);
    if (!std.meta.eql(flow.suspensionSnapshot(), before_suspensions)) {
        @compileError("agent EpistemicStrategy emitProject must be effect-free");
    }
    if (!std.meta.eql(flow.returnSnapshot(), before_returns)) {
        @compileError("agent EpistemicStrategy emitProject must not terminate the Agent program");
    }
    return result;
}

fn emitEpistemicFinalAllowed(
    comptime Definition: type,
    comptime Epistemics: type,
    flow: anytype,
    memory: flow_module.Value(Epistemics.MemoryType(Definition)),
    result: flow_module.Value(Definition.Result),
) flow_module.Value(bool) {
    const before_suspensions = flow.suspensionSnapshot();
    const before_returns = flow.returnSnapshot();
    const allowed = Epistemics.emitFinalAllowed(
        Definition,
        flow,
        memory,
        result,
        epistemicContext(Definition, Epistemics),
    );
    if (!std.meta.eql(flow.suspensionSnapshot(), before_suspensions)) {
        @compileError("agent EpistemicStrategy emitFinalAllowed must be effect-free");
    }
    if (!std.meta.eql(flow.returnSnapshot(), before_returns)) {
        @compileError("agent EpistemicStrategy emitFinalAllowed must not terminate the Agent program");
    }
    return allowed;
}

fn emitEpistemicActionAllowed(
    comptime Definition: type,
    comptime Epistemics: type,
    comptime action_index: u16,
    flow: anytype,
    memory: flow_module.Value(Epistemics.MemoryType(Definition)),
    action_value: flow_module.Value(Definition.Action),
) flow_module.Value(bool) {
    const before_suspensions = flow.suspensionSnapshot();
    const before_returns = flow.returnSnapshot();
    const allowed = if (@hasDecl(Epistemics, "emitActionAllowedKnown"))
        Epistemics.emitActionAllowedKnown(
            Definition,
            flow,
            memory,
            action_index,
            action_value,
            epistemicContext(Definition, Epistemics),
        )
    else
        Epistemics.emitActionAllowed(
            Definition,
            flow,
            memory,
            action_value,
            epistemicContext(Definition, Epistemics),
        );
    if (!std.meta.eql(flow.suspensionSnapshot(), before_suspensions)) {
        @compileError("agent EpistemicStrategy emitActionAllowed must be effect-free");
    }
    if (!std.meta.eql(flow.returnSnapshot(), before_returns)) {
        @compileError("agent EpistemicStrategy emitActionAllowed must not terminate the Agent program");
    }
    return allowed;
}

fn epistemicActionAlwaysAllowed(
    comptime Definition: type,
    comptime Epistemics: type,
    comptime action_index: u16,
) bool {
    if (!@hasDecl(Epistemics, "actionAlwaysAllowedKnown")) return false;
    return Epistemics.actionAlwaysAllowedKnown(Definition, action_index);
}

fn epistemicCapacityCheckRequired(comptime Epistemics: type) bool {
    if (!Epistemics.is_verbatim) return false;
    return Epistemics.normalized_config.overflow == .fail;
}

fn emitEffectAction(
    comptime Definition: type,
    comptime Epistemics: type,
    comptime action_index: usize,
    flow: anytype,
    action_value: flow_module.Value(Definition.Action),
    state_value: flow_module.Value(strategy.State(Definition, Epistemics)),
    loop_block: anytype,
    comptime invalid_variant_constant: u16,
    comptime unit_constant_index: u16,
) void {
    const Descriptor = Definition.ActionDescriptor(action_index);
    const Site = ActionSite(Definition, action_index);
    const payload = if (Descriptor.Site.Payload == void)
        flow.constant(void, unit_constant_index)
    else
        flow.sumExtract(action_index, action_value);
    const initial_counters = flow.productExtract(2, state_value);
    const effect_actions = flow.productExtract(2, initial_counters);
    const maximum_effect_actions = flow.constant(
        u32,
        @intFromEnum(Constant.maximum_effect_actions),
    );
    var budget_exhausted = flow.integerGreaterEqual(effect_actions, maximum_effect_actions);
    if (Descriptor.class == .child_agent) {
        const child_actions = flow.productExtract(3, initial_counters);
        const maximum_child_actions = flow.constant(
            u32,
            @intFromEnum(Constant.maximum_child_actions),
        );
        budget_exhausted = flow.booleanOr(
            budget_exhausted,
            flow.integerGreaterEqual(child_actions, maximum_child_actions),
        );
    }

    const budget_failure = flow.block(.terminal_handoff, .{});
    const perform_block = flow.block(.segment, .{
        Descriptor.Site.Payload,
        strategy.State(Definition, Epistemics),
    });
    const after_admission = if (comptime epistemicCapacityCheckRequired(Epistemics))
        flow.block(.segment, .{
            Descriptor.Site.Payload,
            strategy.State(Definition, Epistemics),
        })
    else
        perform_block;
    if (comptime !epistemicActionAlwaysAllowed(Definition, Epistemics, action_index)) {
        const admission_check = flow.block(.segment, .{
            Definition.Action,
            Descriptor.Site.Payload,
            strategy.State(Definition, Epistemics),
        });
        flow.branch(
            budget_exhausted,
            budget_failure,
            .{},
            admission_check,
            .{ action_value, payload, state_value },
        );
        _ = flow.enter(budget_failure);
        flow.failValue(failureConstant(flow, Definition, .budget_exhausted));

        const admission_values = flow.enter(admission_check);
        const action_allowed = emitEpistemicActionAllowed(
            Definition,
            Epistemics,
            action_index,
            flow,
            flow.productExtract(1, admission_values[2]),
            admission_values[0],
        );
        const admission_failure = flow.block(.terminal_handoff, .{});
        flow.branch(
            action_allowed,
            after_admission,
            .{ admission_values[1], admission_values[2] },
            admission_failure,
            .{},
        );
        _ = flow.enter(admission_failure);
        flow.failValue(flow.constant(Definition.Failure, invalid_variant_constant));
    } else {
        flow.branch(
            budget_exhausted,
            budget_failure,
            .{},
            after_admission,
            .{ payload, state_value },
        );
        _ = flow.enter(budget_failure);
        flow.failValue(failureConstant(flow, Definition, .budget_exhausted));
    }

    if (comptime epistemicCapacityCheckRequired(Epistemics)) {
        const capacity_values = flow.enter(after_admission);
        const memory = flow.productExtract(1, capacity_values[1]);
        const full = flow.integerGreaterEqual(
            flow.vectorLength(memory),
            flow.constant(u32, epistemicContext(Definition, Epistemics).maximum_observations_index),
        );
        const history_failure = flow.block(.terminal_handoff, .{});
        flow.branch(full, history_failure, .{}, perform_block, capacity_values);
        _ = flow.enter(history_failure);
        flow.failValue(flow.constant(
            Definition.Failure,
            epistemicContext(Definition, Epistemics).history_overflow_index,
        ));
    }

    const performing = flow.enter(perform_block);
    const performed = flow.perform(Site, performing[0], .{performing[1]});
    const observation_index = observationIndex(Definition, Descriptor.observation_name);
    const fold_block = flow.block(.segment, .{
        strategy.State(Definition, Epistemics),
        Descriptor.Site.Resume,
    });
    flow.jump(fold_block, .{ performed.carried[0], performed.value });
    const fold_values = flow.enter(fold_block);
    const folded_state = fold_values[0];
    const resumed_counters = flow.productExtract(2, folded_state);
    const one = flow.constant(u32, @intFromEnum(Constant.one));
    const old_effect_actions = flow.productExtract(2, resumed_counters);
    const next_effect_actions = flow.integerAdd(old_effect_actions, one);
    var next_counters = flow.productReplace(
        2,
        resumed_counters,
        next_effect_actions,
    );
    if (Descriptor.class == .child_agent) {
        const old_child_actions = flow.productExtract(3, next_counters);
        const next_child_actions = flow.integerAdd(old_child_actions, one);
        next_counters = flow.productReplace(3, next_counters, next_child_actions);
    }
    const next_memory = emitEpistemicObservePayload(
        Definition,
        Epistemics,
        flow,
        flow.productExtract(1, folded_state),
        observation_index,
        fold_values[1],
    );
    flow.jump(loop_block, .{flow.productConstruct(
        strategy.State(Definition, Epistemics),
        .{
            flow.productExtract(0, folded_state),
            next_memory,
            next_counters,
        },
    )});
}

fn emitAction(
    comptime Definition: type,
    comptime Epistemics: type,
    comptime action_index: usize,
    flow: anytype,
    action_value: flow_module.Value(Definition.Action),
    state_value: flow_module.Value(strategy.State(Definition, Epistemics)),
    loop_block: anytype,
    comptime invalid_variant_constant: u16,
    comptime unit_constant_index: u16,
) void {
    const Descriptor = Definition.ActionDescriptor(action_index);
    switch (Descriptor.kind) {
        .final => emitFinalAction(
            Definition,
            Epistemics,
            action_index,
            flow,
            action_value,
            state_value,
            invalid_variant_constant,
        ),
        .fail => flow.failValue(flow.sumExtract(action_index, action_value)),
        .local => @compileError(
            "agent v2 compiler does not admit Agent 3 local actions",
        ),
        .effect => emitEffectAction(
            Definition,
            Epistemics,
            action_index,
            flow,
            action_value,
            state_value,
            loop_block,
            invalid_variant_constant,
            unit_constant_index,
        ),
    }
}

fn emitFinalAction(
    comptime Definition: type,
    comptime Epistemics: type,
    comptime action_index: usize,
    flow: anytype,
    action_value: flow_module.Value(Definition.Action),
    state_value: flow_module.Value(strategy.State(Definition, Epistemics)),
    comptime invalid_variant_constant: u16,
) void {
    const result = flow.sumExtract(action_index, action_value);
    const memory = flow.productExtract(1, state_value);
    const allowed = emitEpistemicFinalAllowed(
        Definition,
        Epistemics,
        flow,
        memory,
        result,
    );
    const accept = flow.block(.terminal_handoff, .{Definition.Result});
    const reject = flow.block(.terminal_handoff, .{});
    flow.branch(allowed, accept, .{result}, reject, .{});
    const rejected = flow.enter(reject);
    _ = rejected;
    flow.failValue(flow.constant(Definition.Failure, invalid_variant_constant));
    const accepted = flow.enter(accept);
    flow.returnValue(accepted[0]);
}

fn emitDispatch(
    comptime Definition: type,
    comptime Epistemics: type,
    flow: anytype,
    action_value: flow_module.Value(Definition.Action),
    state_value: flow_module.Value(strategy.State(Definition, Epistemics)),
    loop_block: anytype,
    comptime invalid_variant_constant: u16,
    comptime unit_constant_index: u16,
) void {
    const current_action = action_value;
    var current_state = state_value;
    inline for (0..Definition.action_count) |index| {
        if (index + 1 == Definition.action_count) {
            emitAction(
                Definition,
                Epistemics,
                index,
                flow,
                current_action,
                current_state,
                loop_block,
                invalid_variant_constant,
                unit_constant_index,
            );
        } else {
            const selected = flow.block(.segment, .{
                strategy.State(Definition, Epistemics),
            });
            const next = flow.block(.segment, .{
                strategy.State(Definition, Epistemics),
            });
            const is_selected = flow.sumTagIs(index, current_action);
            flow.branch(
                is_selected,
                selected,
                .{current_state},
                next,
                .{current_state},
            );
            const selected_values = flow.enter(selected);
            emitAction(
                Definition,
                Epistemics,
                index,
                flow,
                current_action,
                selected_values[0],
                loop_block,
                invalid_variant_constant,
                unit_constant_index,
            );
            const next_values = flow.enter(next);
            current_state = next_values[0];
        }
    }
}

fn ReactLowering(
    comptime Definition: type,
    comptime Strategy: type,
    comptime Epistemics: type,
) type {
    @setEvalBranchQuota(10_000_000);
    const Builder = flow_module.Flow(.{
        .schema_types = schemaTypes(Definition, Strategy, Epistemics),
        .limits = generatedFlowLimits(Definition, Epistemics, false),
    });
    comptime var flow = Builder.init("agent-react-v2");
    const goal = flow.begin(Definition.Goal);
    const memory = emitEpistemicInitial(Definition, Epistemics, &flow, goal);
    const zero = flow.constant(u32, @intFromEnum(Constant.zero));
    const counters = flow.productConstruct(budget.Counters, .{ zero, zero, zero, zero });
    const initial_state = flow.productConstruct(
        strategy.State(Definition, Epistemics),
        .{ goal, memory, counters },
    );
    const loop_block = flow.block(.loop_header, .{strategy.State(Definition, Epistemics)});
    flow.jump(loop_block, .{initial_state});

    const loop_values = flow.enter(loop_block);
    const state_value = loop_values[0];
    const loop_counters = flow.productExtract(2, state_value);
    const maximum_turns = flow.constant(u32, @intFromEnum(Constant.maximum_turns));
    const maximum_decisions = flow.constant(u32, @intFromEnum(Constant.maximum_decisions));
    const exhausted = flow.booleanOr(
        flow.integerGreaterEqual(flow.productExtract(0, loop_counters), maximum_turns),
        flow.integerGreaterEqual(flow.productExtract(1, loop_counters), maximum_decisions),
    );
    const budget_failure = flow.block(.terminal_handoff, .{});
    const decide = flow.block(.loop_header, .{strategy.State(Definition, Epistemics)});
    flow.branch(exhausted, budget_failure, .{}, decide, .{state_value});
    _ = flow.enter(budget_failure);
    flow.failValue(failureConstant(&flow, Definition, .budget_exhausted));

    const decide_state = flow.enter(decide)[0];
    const decide_goal = flow.productExtract(0, decide_state);
    const decide_memory = flow.productExtract(1, decide_state);
    const decide_counters = flow.productExtract(2, decide_state);
    const view = emitEpistemicProject(Definition, Epistemics, &flow, decide_memory);
    const decision_local = if (Strategy.kind == .custom) decision_local: {
        const before_suspensions = flow.suspensionSnapshot();
        const before_control = flow.controlTopologySnapshot();
        const value = Strategy.emitDecisionLocal(
            Definition,
            Epistemics,
            &flow,
            decide_goal,
            decide_counters,
            view,
        );
        if (!std.meta.eql(flow.suspensionSnapshot(), before_suspensions)) {
            @compileError("agent custom RuntimeStrategy emitDecisionLocal must be effect-free");
        }
        if (!std.meta.eql(flow.controlTopologySnapshot(), before_control)) {
            @compileError("agent custom RuntimeStrategy emitDecisionLocal must not alter compiler-owned control topology");
        }
        break :decision_local value;
    } else flow.constant(void, unitConstantIndex(Epistemics, Definition));
    const request = flow.productConstruct(
        strategy.DecisionTurn(Definition, Strategy, Epistemics),
        .{
            flow.constant([32]u8, @intFromEnum(Constant.decision_contract_digest)),
            decide_goal,
            decide_counters,
            flow.constant(budget.DecisionPhase, @intFromEnum(Constant.initial_phase)),
            view,
            decision_local,
        },
    );
    const decision = flow.perform(
        decisionSiteType(Definition, Strategy, Epistemics),
        request,
        .{decide_state},
    );
    const resumed_state = decision.carried[0];
    const resumed_counters = flow.productExtract(2, resumed_state);
    const one = flow.constant(u32, @intFromEnum(Constant.one));
    var next_counters = flow.productReplace(
        0,
        resumed_counters,
        flow.integerAdd(flow.productExtract(0, resumed_counters), one),
    );
    next_counters = flow.productReplace(
        1,
        next_counters,
        flow.integerAdd(flow.productExtract(1, resumed_counters), one),
    );
    const next_state = flow.productConstruct(
        strategy.State(Definition, Epistemics),
        .{
            flow.productExtract(0, resumed_state),
            flow.productExtract(1, resumed_state),
            next_counters,
        },
    );
    emitDispatch(
        Definition,
        Epistemics,
        &flow,
        decision.value,
        next_state,
        loop_block,
        @intFromEnum(Constant.invalid_variant),
        unitConstantIndex(Epistemics, Definition),
    );
    return flow.finish(Definition.Result);
}

fn ReflectiveLowering(
    comptime Definition: type,
    comptime Strategy: type,
    comptime Epistemics: type,
) type {
    @setEvalBranchQuota(10_000_000);
    const Builder = flow_module.Flow(.{
        .schema_types = schemaTypes(Definition, Strategy, Epistemics),
        .limits = generatedFlowLimits(Definition, Epistemics, true),
    });
    comptime var flow = Builder.init("agent-reflective-react-v2");
    const goal = flow.begin(Definition.Goal);
    const memory = emitEpistemicInitial(Definition, Epistemics, &flow, goal);
    const zero = flow.constant(u32, @intFromEnum(Constant.zero));
    const counters = flow.productConstruct(
        budget.Counters,
        .{ zero, zero, zero, zero },
    );
    const initial_state = flow.productConstruct(
        strategy.State(Definition, Epistemics),
        .{ goal, memory, counters },
    );
    const loop_block = flow.block(.loop_header, .{strategy.State(Definition, Epistemics)});
    flow.jump(loop_block, .{initial_state});

    const loop_values = flow.enter(loop_block);
    const state_value = loop_values[0];
    const loop_counters = flow.productExtract(2, state_value);
    const turns = flow.productExtract(0, loop_counters);
    const decisions = flow.productExtract(1, loop_counters);
    const maximum_turns = flow.constant(u32, @intFromEnum(Constant.maximum_turns));
    const maximum_decisions = flow.constant(
        u32,
        @intFromEnum(Constant.maximum_decisions),
    );
    const turns_exhausted = flow.integerGreaterEqual(turns, maximum_turns);
    const decisions_exhausted = flow.integerGreaterEqual(
        decisions,
        maximum_decisions,
    );
    const budget_exhausted = flow.booleanOr(turns_exhausted, decisions_exhausted);
    const budget_failure = flow.block(.terminal_handoff, .{});
    const propose = flow.block(.loop_header, .{strategy.State(Definition, Epistemics)});
    flow.branch(
        budget_exhausted,
        budget_failure,
        .{},
        propose,
        .{state_value},
    );

    _ = flow.enter(budget_failure);
    flow.failValue(failureConstant(&flow, Definition, .budget_exhausted));

    const propose_values = flow.enter(propose);
    const propose_state = propose_values[0];
    const propose_goal = flow.productExtract(0, propose_state);
    const propose_memory = flow.productExtract(1, propose_state);
    const propose_counters = flow.productExtract(2, propose_state);
    const propose_view = emitEpistemicProject(Definition, Epistemics, &flow, propose_memory);
    const propose_phase = flow.constant(
        budget.DecisionPhase,
        @intFromEnum(Constant.initial_phase),
    );
    const no_candidate = flow.optionalNone(?Definition.Action);
    const contract_digest = flow.constant(
        [32]u8,
        @intFromEnum(Constant.decision_contract_digest),
    );
    const proposal_request = flow.productConstruct(
        strategy.DecisionTurn(Definition, Strategy, Epistemics),
        .{
            contract_digest,
            propose_goal,
            propose_counters,
            propose_phase,
            propose_view,
            no_candidate,
        },
    );
    const proposal = flow.perform(
        decisionSiteType(Definition, Strategy, Epistemics),
        proposal_request,
        .{propose_state},
    );
    const proposal_state = proposal.carried[0];
    const proposal_counters = flow.productExtract(2, proposal_state);
    const old_decisions = flow.productExtract(1, proposal_counters);
    const one = flow.constant(u32, @intFromEnum(Constant.one));
    const next_decisions = flow.integerAdd(old_decisions, one);
    const counted_proposal_counters = flow.productReplace(
        1,
        proposal_counters,
        next_decisions,
    );
    const proposal_goal = flow.productExtract(0, proposal_state);
    const proposal_memory = flow.productExtract(1, proposal_state);
    const counted_proposal_state = flow.productConstruct(
        strategy.State(Definition, Epistemics),
        .{ proposal_goal, proposal_memory, counted_proposal_counters },
    );

    const reflection_loop = flow.block(.loop_header, .{
        Definition.Action,
        strategy.State(Definition, Epistemics),
        u32,
    });
    flow.jump(
        reflection_loop,
        .{ proposal.value, counted_proposal_state, zero },
    );

    const reflection_values = flow.enter(reflection_loop);
    const candidate = reflection_values[0];
    const reflection_state = reflection_values[1];
    const reflection_index = reflection_values[2];
    const reflection_rounds = flow.constant(
        u32,
        @intFromEnum(Constant.reflection_rounds),
    );
    const reflections_complete = flow.integerGreaterEqual(
        reflection_index,
        reflection_rounds,
    );
    const dispatch = flow.block(.segment, .{
        Definition.Action,
        strategy.State(Definition, Epistemics),
    });
    const reflection_budget_check = flow.block(.segment, .{
        Definition.Action,
        strategy.State(Definition, Epistemics),
        u32,
    });
    flow.branch(
        reflections_complete,
        dispatch,
        .{ candidate, reflection_state },
        reflection_budget_check,
        .{ candidate, reflection_state, reflection_index },
    );

    const check_values = flow.enter(reflection_budget_check);
    const checked_candidate = check_values[0];
    const checked_state = check_values[1];
    const checked_index = check_values[2];
    const checked_counters = flow.productExtract(2, checked_state);
    const checked_decisions = flow.productExtract(1, checked_counters);
    const reflect_decision_exhausted = flow.integerGreaterEqual(
        checked_decisions,
        maximum_decisions,
    );
    const reflection_failure = flow.block(.terminal_handoff, .{});
    const reflect = flow.block(.segment, .{
        Definition.Action,
        strategy.State(Definition, Epistemics),
        u32,
    });
    flow.branch(
        reflect_decision_exhausted,
        reflection_failure,
        .{},
        reflect,
        .{ checked_candidate, checked_state, checked_index },
    );

    _ = flow.enter(reflection_failure);
    flow.failValue(failureConstant(&flow, Definition, .budget_exhausted));

    const reflect_values = flow.enter(reflect);
    const reflect_candidate = reflect_values[0];
    const reflect_state = reflect_values[1];
    const reflect_index = reflect_values[2];
    const reflect_goal = flow.productExtract(0, reflect_state);
    const reflect_memory = flow.productExtract(1, reflect_state);
    const reflect_counters = flow.productExtract(2, reflect_state);
    const reflect_view = emitEpistemicProject(Definition, Epistemics, &flow, reflect_memory);
    const reflect_phase = flow.constant(
        budget.DecisionPhase,
        @intFromEnum(Constant.reflect_phase),
    );
    const some_candidate = flow.optionalSome(
        ?Definition.Action,
        reflect_candidate,
    );
    const reflect_request = flow.productConstruct(
        strategy.DecisionTurn(Definition, Strategy, Epistemics),
        .{
            contract_digest,
            reflect_goal,
            reflect_counters,
            reflect_phase,
            reflect_view,
            some_candidate,
        },
    );
    const reflected = flow.perform(
        decisionSiteType(Definition, Strategy, Epistemics),
        reflect_request,
        .{ reflect_state, reflect_index },
    );
    const reflected_state = reflected.carried[0];
    const resumed_index = reflected.carried[1];
    const reflected_counters = flow.productExtract(2, reflected_state);
    const reflected_decisions = flow.productExtract(1, reflected_counters);
    const counted_decisions = flow.integerAdd(reflected_decisions, one);
    const counted_reflection_counters = flow.productReplace(
        1,
        reflected_counters,
        counted_decisions,
    );
    const reflected_goal = flow.productExtract(0, reflected_state);
    const reflected_memory = flow.productExtract(1, reflected_state);
    const counted_reflection_state = flow.productConstruct(
        strategy.State(Definition, Epistemics),
        .{ reflected_goal, reflected_memory, counted_reflection_counters },
    );
    const next_reflection_index = flow.integerAdd(resumed_index, one);
    flow.jump(
        reflection_loop,
        .{ reflected.value, counted_reflection_state, next_reflection_index },
    );

    const dispatch_values = flow.enter(dispatch);
    const dispatch_candidate = dispatch_values[0];
    const dispatch_state = dispatch_values[1];
    const dispatch_counters = flow.productExtract(2, dispatch_state);
    const dispatch_turns = flow.productExtract(0, dispatch_counters);
    const counted_turns = flow.integerAdd(dispatch_turns, one);
    const counted_dispatch_counters = flow.productReplace(
        0,
        dispatch_counters,
        counted_turns,
    );
    const dispatch_goal = flow.productExtract(0, dispatch_state);
    const dispatch_memory = flow.productExtract(1, dispatch_state);
    const counted_dispatch_state = flow.productConstruct(
        strategy.State(Definition, Epistemics),
        .{ dispatch_goal, dispatch_memory, counted_dispatch_counters },
    );
    emitDispatch(
        Definition,
        Epistemics,
        &flow,
        dispatch_candidate,
        counted_dispatch_state,
        loop_block,
        @intFromEnum(Constant.invalid_variant),
        unitConstantIndex(Epistemics, Definition),
    );
    return flow.finish(Definition.Result);
}

fn ReactBody(
    comptime Definition: type,
    comptime Strategy: type,
    comptime Epistemics: type,
) type {
    const Lowering = ReactLowering(Definition, Strategy, Epistemics);
    const prefix = .{
        @as(u32, 0),
        @as(u32, 1),
        Definition.budget.maximum_turns,
        Definition.budget.maximum_decisions,
        Definition.budget.maximum_effect_actions,
        Definition.budget.maximum_child_actions,
        budget.DecisionPhase.decide,
        strategy.failureNamed(Definition, "budget_exhausted"),
        strategy.failureNamed(Definition, "invalid_variant"),
        decision_contract.semanticDigest(Definition, Strategy, Epistemics),
        Epistemics.initialMemory(Definition),
        true,
        false,
        budget.DecisionPhase.reflect,
        @as(u32, 0),
    };
    const tail = .{
        @as(void, {}),
        @as(u8, 0),
        @as(u8, 1),
        @as(u8, 2),
    };
    return struct {
        pub const InitialArgs = Definition.Goal;
        pub const Result = Definition.Result;
        pub const Failure = Definition.Failure;
        pub const constants = if (Epistemics.is_verbatim)
            prefix ++ .{
                Epistemics.normalized_config.maximum_observations,
                if (Epistemics.normalized_config.overflow == .fail)
                    strategy.failureNamed(Definition, "history_overflow")
                else
                    @as(void, {}),
            } ++ tail
        else if (Epistemics.has_implementation_constant_values)
            prefix ++ Epistemics.constantValues(Definition) ++ tail
        else
            prefix ++ .{@as(void, {})} ++ tail;
        pub const effect_sites = effectSites(Definition, Strategy, Epistemics);
        pub const schema_types = Lowering.schema_types;
        pub const control_ir = Lowering.control_ir;
        pub const compiler_limits = generatedCompilerLimits(
            control_ir,
            false,
            Epistemics.lowering_complexity,
        );
    };
}

fn ReflectiveBody(
    comptime Definition: type,
    comptime Strategy: type,
    comptime Epistemics: type,
) type {
    const Lowering = ReflectiveLowering(Definition, Strategy, Epistemics);
    const prefix = .{
        @as(u32, 0),
        @as(u32, 1),
        Definition.budget.maximum_turns,
        Definition.budget.maximum_decisions,
        Definition.budget.maximum_effect_actions,
        Definition.budget.maximum_child_actions,
        budget.DecisionPhase.propose,
        strategy.failureNamed(Definition, "budget_exhausted"),
        strategy.failureNamed(Definition, "invalid_variant"),
        decision_contract.semanticDigest(Definition, Strategy, Epistemics),
        Epistemics.initialMemory(Definition),
        true,
        false,
        budget.DecisionPhase.reflect,
        Strategy.normalized_config.reflection_rounds,
    };
    const tail = .{
        @as(void, {}),
        @as(u8, 0),
        @as(u8, 1),
        @as(u8, 2),
    };
    return struct {
        pub const InitialArgs = Definition.Goal;
        pub const Result = Definition.Result;
        pub const Failure = Definition.Failure;
        pub const constants = if (Epistemics.is_verbatim)
            prefix ++ .{
                Epistemics.normalized_config.maximum_observations,
                if (Epistemics.normalized_config.overflow == .fail)
                    strategy.failureNamed(Definition, "history_overflow")
                else
                    @as(void, {}),
            } ++ tail
        else if (Epistemics.has_implementation_constant_values)
            prefix ++ Epistemics.constantValues(Definition) ++ tail
        else
            prefix ++ .{@as(void, {})} ++ tail;
        pub const effect_sites = effectSites(Definition, Strategy, Epistemics);
        pub const schema_types = Lowering.schema_types;
        pub const control_ir = Lowering.control_ir;
        pub const compiler_limits = generatedCompilerLimits(
            control_ir,
            true,
            Epistemics.lowering_complexity,
        );
    };
}

fn assertStrategy(comptime Definition: type, comptime Strategy: type) void {
    @setEvalBranchQuota(1_000_000);
    if (!@hasDecl(Strategy, "semantic_identity") or
        !@hasDecl(Strategy, "kind") or
        !@hasDecl(Strategy, "validate") or
        !@hasDecl(Strategy, "DecisionLocalType"))
    {
        @compileError("agent compile requires a RuntimeStrategy structural contract");
    }
    Strategy.validate(Definition);
    boundary.schema.assertPortable(Strategy.DecisionLocalType(Definition));
}

fn assertEpistemics(
    comptime Definition: type,
    comptime Strategy: type,
    comptime Epistemics: type,
) void {
    inline for (.{
        "semantic_identity", "normalized_config", "validate",                 "MemoryType",
        "DecisionViewType",  "StateSchemaTypes",  "initialMemory",            "emitInitial",
        "emitObserve",       "emitProject",       "emitActionAllowed",        "emitFinalAllowed",
        "constantValues",    "constantContext",   "semantic_lowering_digest",
    }) |name| {
        if (!@hasDecl(Epistemics, name)) {
            @compileError("agent compile requires EpistemicStrategy declaration " ++ name);
        }
    }
    Epistemics.validate(Definition);
    boundary.schema.assertPortable(Epistemics.MemoryType(Definition));
    boundary.schema.assertPortable(Epistemics.DecisionViewType(Definition));
    const Turn = strategy.DecisionTurn(Definition, Strategy, Epistemics);
    boundary.schema.assertPortable(Turn);
    if (boundary.schema.maximumEncodedSize(Turn) > Definition.decision.maximum_request_bytes) {
        @compileError("agent DecisionTurn exceeds decision.maximum_request_bytes");
    }
}

fn assertProgramBodyEffects(
    comptime Definition: type,
    comptime Strategy: type,
    comptime Epistemics: type,
    comptime Body: type,
) void {
    if (!@hasDecl(Body, "effect_sites")) {
        @compileError("agent RuntimeStrategy Body must declare effect_sites");
    }
    const expected = effectSites(Definition, Strategy, Epistemics);
    if (Body.effect_sites.len != expected.len) {
        @compileError(
            "agent RuntimeStrategy Body effect row must equal the closed " ++
                "decision and Action effect row",
        );
    }
    inline for (expected, 0..) |Expected, index| {
        const Actual = Body.effect_sites[index];
        if (Actual.site_id != Expected.site_id or
            Actual.Payload != Expected.Payload or
            Actual.Resume != Expected.Resume or
            !std.mem.eql(
                u8,
                Actual.semantic_identity,
                Expected.semantic_identity,
            ))
        {
            @compileError(
                "agent RuntimeStrategy Body contains an undeclared or mismatched effect site",
            );
        }
    }
}

fn normalizeMachineOptions(comptime input: anytype) boundary.MachineOptions {
    var result: boundary.MachineOptions = .{};
    inline for (std.meta.fields(@TypeOf(input))) |field| {
        if (!@hasField(boundary.MachineOptions, field.name)) {
            @compileError("agent.compile unknown Machine option '" ++ field.name ++ "'");
        }
    }
    inline for (std.meta.fields(boundary.MachineOptions)) |field| {
        if (@hasField(@TypeOf(input), field.name)) {
            @field(result, field.name) = @field(input, field.name);
        }
    }
    return result;
}

/// Specialize one typed definition and compile-time strategy into Boundary.
pub fn compile(
    comptime DefinitionType: type,
    comptime StrategyType: type,
    comptime EpistemicsType: type,
    comptime options: anytype,
) type {
    @setEvalBranchQuota(100_000_000);
    comptime assertStrategy(DefinitionType, StrategyType);
    comptime assertEpistemics(DefinitionType, StrategyType, EpistemicsType);
    if (!@hasField(@TypeOf(options), "machine")) {
        @compileError("agent.compile options require .machine");
    }
    inline for (std.meta.fields(@TypeOf(options))) |field| {
        if (!std.mem.eql(u8, field.name, "machine")) {
            @compileError("agent.compile unknown option '" ++ field.name ++ "'");
        }
    }
    const Body = switch (StrategyType.kind) {
        .react => ReactBody(DefinitionType, StrategyType, EpistemicsType),
        .reflective => ReflectiveBody(DefinitionType, StrategyType, EpistemicsType),
        .custom => switch (StrategyType.selectedTopology(DefinitionType, EpistemicsType)) {
            .react => ReactBody(DefinitionType, StrategyType, EpistemicsType),
        },
    };
    comptime assertProgramBodyEffects(DefinitionType, StrategyType, EpistemicsType, Body);
    const label = std.fmt.comptimePrint(
        "{s}:{s}",
        .{ DefinitionType.name, StrategyType.semantic_identity },
    );
    const ProgramType = boundary.program(label, Body);
    const machine_options = normalizeMachineOptions(options.machine);
    const MachineType = ProgramType.compile(machine_options);
    const definition_manifest = manifest.definition(DefinitionType);
    const strategy_manifest = manifest.strategy(
        DefinitionType,
        StrategyType,
        ProgramType,
    );
    const epistemics_manifest = manifest.epistemics(
        DefinitionType,
        EpistemicsType,
        Body,
    );
    const decision_contract_digest = decision_contract.semanticDigest(
        DefinitionType,
        StrategyType,
        EpistemicsType,
    );
    const compiled_manifest = manifest.compiled(
        definition_manifest,
        strategy_manifest,
        epistemics_manifest,
        decision_contract_digest,
        MachineType,
    );

    return struct {
        pub const Definition = DefinitionType;
        pub const Strategy = StrategyType;
        pub const Epistemics = EpistemicsType;
        pub const State = strategy.State(DefinitionType, EpistemicsType);
        pub const SchemaTypes = Body.schema_types;
        pub const Program = ProgramType;
        pub const Machine = MachineType;
        pub const DefinitionManifest = definition_manifest;
        pub const StrategyManifest = strategy_manifest;
        pub const EpistemicsManifest = epistemics_manifest;
        pub const Manifest = compiled_manifest;
        pub const DefinitionManifestBytes = manifest.encodeDefinition(
            DefinitionType,
            definition_manifest,
        );
        pub const StrategyManifestBytes = manifest.encodeStrategy(
            StrategyType,
            strategy_manifest,
        );
        pub const EpistemicsManifestBytes = manifest.encodeEpistemics(
            EpistemicsType,
            epistemics_manifest,
        );
        pub const ManifestBytes = manifest.encodeCompiled(compiled_manifest);
        pub const DecisionSite = decisionSiteType(DefinitionType, StrategyType, EpistemicsType);
        pub const ActionSites = effectSites(DefinitionType, StrategyType, EpistemicsType);
        pub const DecisionContract = decision_contract.contract(@This());
        pub const DecisionContractBytes = DecisionContract.binary_bytes;
        pub const DecisionContractJson = DecisionContract.json_bytes;
    };
}

comptime {
    _ = action;
}
