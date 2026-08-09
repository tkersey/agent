const std = @import("std");
const boundary = @import("boundary");
const action = @import("action.zig");
const budget = @import("budget.zig");
const flow_module = @import("flow.zig");
const manifest = @import("manifest.zig");
const strategy = @import("strategy.zig");

const Constant = enum(u16) {
    instructions,
    action_catalog,
    zero,
    one,
    maximum_turns,
    maximum_decisions,
    maximum_effect_actions,
    maximum_child_actions,
    maximum_observations,
    initial_phase,
    budget_exhausted,
    history_overflow,
    reflect_phase,
    reflection_rounds,
};

fn ActionSite(comptime Definition: type, comptime action_index: usize) type {
    return strategy.ActionSite(Definition, action_index);
}

fn decisionSiteType(comptime Definition: type, comptime Strategy: type) type {
    return strategy.DecisionSite(Definition, Strategy);
}

fn effectSites(
    comptime Definition: type,
    comptime Strategy: type,
) [1 + strategy.effectCount(Definition)]type {
    return strategy.effectSites(Definition, Strategy);
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

fn schemaTypes(
    comptime Definition: type,
    comptime Strategy: type,
) [13 + Definition.action_count + observationFieldCount(Definition)]type {
    var result: [13 + Definition.action_count + observationFieldCount(Definition)]type = undefined;
    result[0..13].* = .{
        Definition.Goal,
        Definition.Action,
        Definition.Observation,
        Definition.Result,
        Definition.Failure,
        budget.Counters,
        strategy.History(Definition),
        strategy.State(Definition),
        Strategy.DecisionRequestType(Definition),
        boundary.Text(Definition.instructions.len),
        strategy.ActionCatalog(Definition),
        budget.DecisionPhase,
        ?Definition.Action,
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
    return result;
}

fn failureConstant(
    flow: anytype,
    comptime Definition: type,
    comptime which: Constant,
) flow_module.Value(Definition.Failure) {
    return flow.constant(Definition.Failure, @intFromEnum(which));
}

fn emitEffectAction(
    comptime Definition: type,
    comptime action_index: usize,
    flow: anytype,
    action_value: flow_module.Value(Definition.Action),
    state_value: flow_module.Value(strategy.State(Definition)),
    loop_block: anytype,
) void {
    const Descriptor = Definition.ActionDescriptor(action_index);
    const Site = ActionSite(Definition, action_index);
    const payload = flow.sumExtract(action_index, action_value);
    const counters = flow.productExtract(2, state_value);
    const effect_actions = flow.productExtract(2, counters);
    const maximum_effect_actions = flow.constant(
        u32,
        @intFromEnum(Constant.maximum_effect_actions),
    );
    var budget_exhausted = flow.integerGreaterEqual(
        effect_actions,
        maximum_effect_actions,
    );
    if (Descriptor.class == .child_agent) {
        const child_actions = flow.productExtract(3, counters);
        const maximum_child_actions = flow.constant(
            u32,
            @intFromEnum(Constant.maximum_child_actions),
        );
        const child_exhausted = flow.integerGreaterEqual(
            child_actions,
            maximum_child_actions,
        );
        budget_exhausted = flow.booleanOr(budget_exhausted, child_exhausted);
    }

    const budget_failure = flow.block(.terminal_handoff, .{});
    const history_check = flow.block(.segment, .{
        Descriptor.Site.Payload,
        strategy.State(Definition),
    });
    flow.branch(
        budget_exhausted,
        budget_failure,
        .{},
        history_check,
        .{ payload, state_value },
    );

    _ = flow.enter(budget_failure);
    flow.failValue(failureConstant(flow, Definition, .budget_exhausted));

    const checked = flow.enter(history_check);
    const checked_payload = checked[0];
    const checked_state = checked[1];
    const checked_history = flow.productExtract(1, checked_state);

    const perform_block = flow.block(.segment, .{
        Descriptor.Site.Payload,
        strategy.State(Definition),
    });
    if (Definition.history.overflow == .fail) {
        const history_length = flow.vectorLength(checked_history);
        const maximum_observations = flow.constant(
            u32,
            @intFromEnum(Constant.maximum_observations),
        );
        const history_exhausted = flow.integerGreaterEqual(
            history_length,
            maximum_observations,
        );
        const history_failure = flow.block(.terminal_handoff, .{});
        flow.branch(
            history_exhausted,
            history_failure,
            .{},
            perform_block,
            .{ checked_payload, checked_state },
        );
        _ = flow.enter(history_failure);
        flow.failValue(failureConstant(flow, Definition, .history_overflow));
    } else {
        flow.jump(perform_block, .{ checked_payload, checked_state });
    }

    const performing = flow.enter(perform_block);
    const performed = flow.perform(Site, performing[0], .{performing[1]});
    const resumed_state = performed.carried[0];
    const resumed_goal = flow.productExtract(0, resumed_state);
    const resumed_history = flow.productExtract(1, resumed_state);
    const resumed_counters = flow.productExtract(2, resumed_state);
    const observation = flow.sumConstruct(
        Definition.Observation,
        observationIndex(Definition, Descriptor.observation_name),
        performed.value,
    );
    const one = flow.constant(u32, @intFromEnum(Constant.one));
    const append_history = flow.block(.segment, .{
        strategy.History(Definition),
        Definition.Observation,
        Definition.Goal,
        budget.Counters,
    });
    if (Definition.history.overflow == .drop_oldest) {
        const history_length = flow.vectorLength(resumed_history);
        const maximum_observations = flow.constant(
            u32,
            @intFromEnum(Constant.maximum_observations),
        );
        const history_full = flow.integerGreaterEqual(
            history_length,
            maximum_observations,
        );
        const shift_history = flow.block(.loop_header, .{
            strategy.History(Definition),
            Definition.Observation,
            Definition.Goal,
            budget.Counters,
            u32,
            u32,
        });
        flow.branch(
            history_full,
            shift_history,
            .{
                resumed_history,
                observation,
                resumed_goal,
                resumed_counters,
                one,
                history_length,
            },
            append_history,
            .{ resumed_history, observation, resumed_goal, resumed_counters },
        );

        const shift_values = flow.enter(shift_history);
        const shifting_history = shift_values[0];
        const shifting_observation = shift_values[1];
        const shifting_goal = shift_values[2];
        const shifting_counters = shift_values[3];
        const shift_index = shift_values[4];
        const shifting_length = shift_values[5];
        const shift_complete = flow.integerGreaterEqual(
            shift_index,
            shifting_length,
        );
        const shift_done = flow.block(.segment, .{
            strategy.History(Definition),
            Definition.Observation,
            Definition.Goal,
            budget.Counters,
            u32,
        });
        const shift_one = flow.block(.segment, .{
            strategy.History(Definition),
            Definition.Observation,
            Definition.Goal,
            budget.Counters,
            u32,
            u32,
        });
        flow.branch(
            shift_complete,
            shift_done,
            .{
                shifting_history,
                shifting_observation,
                shifting_goal,
                shifting_counters,
                shifting_length,
            },
            shift_one,
            .{
                shifting_history,
                shifting_observation,
                shifting_goal,
                shifting_counters,
                shift_index,
                shifting_length,
            },
        );

        const shift_one_values = flow.enter(shift_one);
        const shift_source_index = shift_one_values[4];
        const source_observation = flow.vectorGet(
            shift_one_values[0],
            shift_source_index,
        );
        const shift_target_index = flow.integerSubtract(shift_source_index, one);
        const shifted_history = flow.vectorSet(
            shift_one_values[0],
            shift_target_index,
            source_observation,
        );
        const next_shift_index = flow.integerAdd(shift_source_index, one);
        flow.jump(shift_history, .{
            shifted_history,
            shift_one_values[1],
            shift_one_values[2],
            shift_one_values[3],
            next_shift_index,
            shift_one_values[5],
        });

        const shift_done_values = flow.enter(shift_done);
        const truncated_length = flow.integerSubtract(shift_done_values[4], one);
        const truncated_history = flow.vectorTruncate(
            shift_done_values[0],
            truncated_length,
        );
        flow.jump(append_history, .{
            truncated_history,
            shift_done_values[1],
            shift_done_values[2],
            shift_done_values[3],
        });
    } else {
        flow.jump(append_history, .{
            resumed_history,
            observation,
            resumed_goal,
            resumed_counters,
        });
    }

    const append_values = flow.enter(append_history);
    const next_history = flow.vectorPush(append_values[0], append_values[1]);
    const old_effect_actions = flow.productExtract(2, append_values[3]);
    const next_effect_actions = flow.integerAdd(old_effect_actions, one);
    var next_counters = flow.productReplace(
        2,
        append_values[3],
        next_effect_actions,
    );
    if (Descriptor.class == .child_agent) {
        const old_child_actions = flow.productExtract(3, next_counters);
        const next_child_actions = flow.integerAdd(old_child_actions, one);
        next_counters = flow.productReplace(3, next_counters, next_child_actions);
    }
    const next_state = flow.productConstruct(
        strategy.State(Definition),
        .{ append_values[2], next_history, next_counters },
    );
    flow.jump(loop_block, .{next_state});
}

fn emitAction(
    comptime Definition: type,
    comptime action_index: usize,
    flow: anytype,
    action_value: flow_module.Value(Definition.Action),
    state_value: flow_module.Value(strategy.State(Definition)),
    loop_block: anytype,
) void {
    const Descriptor = Definition.ActionDescriptor(action_index);
    switch (Descriptor.kind) {
        .final => flow.returnValue(flow.sumExtract(action_index, action_value)),
        .fail => flow.failValue(flow.sumExtract(action_index, action_value)),
        .effect => emitEffectAction(
            Definition,
            action_index,
            flow,
            action_value,
            state_value,
            loop_block,
        ),
    }
}

fn emitDispatch(
    comptime Definition: type,
    flow: anytype,
    action_value: flow_module.Value(Definition.Action),
    state_value: flow_module.Value(strategy.State(Definition)),
    loop_block: anytype,
) void {
    var current_action = action_value;
    var current_state = state_value;
    inline for (0..Definition.action_count) |index| {
        if (index + 1 == Definition.action_count) {
            emitAction(Definition, index, flow, current_action, current_state, loop_block);
        } else {
            const selected = flow.block(.segment, .{
                Definition.Action,
                strategy.State(Definition),
            });
            const next = flow.block(.segment, .{
                Definition.Action,
                strategy.State(Definition),
            });
            const is_selected = flow.sumTagIs(index, current_action);
            flow.branch(
                is_selected,
                selected,
                .{ current_action, current_state },
                next,
                .{ current_action, current_state },
            );
            const selected_values = flow.enter(selected);
            emitAction(
                Definition,
                index,
                flow,
                selected_values[0],
                selected_values[1],
                loop_block,
            );
            const next_values = flow.enter(next);
            current_action = next_values[0];
            current_state = next_values[1];
        }
    }
}

fn ReactLowering(comptime Definition: type, comptime Strategy: type) type {
    @setEvalBranchQuota(1_000_000);
    const Builder = flow_module.Flow(.{
        .schema_types = schemaTypes(Definition, Strategy),
        .limits = flow_module.Limits{
            .maximum_values = 256,
            .maximum_blocks = 64,
            .maximum_instructions = 128,
            .maximum_operands = 256,
            .maximum_parameters = 128,
            .maximum_requests = 32,
            .maximum_edge_arguments = 256,
        },
    });
    comptime var flow = Builder.init("agent-react-v1");
    const goal = flow.begin(Definition.Goal);
    const history = flow.vectorEmpty(strategy.History(Definition));
    const zero = flow.constant(u32, @intFromEnum(Constant.zero));
    const counters = flow.productConstruct(
        budget.Counters,
        .{ zero, zero, zero, zero },
    );
    const initial_state = flow.productConstruct(
        strategy.State(Definition),
        .{ goal, history, counters },
    );
    const loop_block = flow.block(.loop_header, .{strategy.State(Definition)});
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
    const decide = flow.block(.segment, .{strategy.State(Definition)});
    flow.branch(
        budget_exhausted,
        budget_failure,
        .{},
        decide,
        .{state_value},
    );

    _ = flow.enter(budget_failure);
    flow.failValue(failureConstant(&flow, Definition, .budget_exhausted));

    const decide_values = flow.enter(decide);
    const decide_state = decide_values[0];
    const instructions = flow.constant(
        boundary.Text(Definition.instructions.len),
        @intFromEnum(Constant.instructions),
    );
    const catalog = flow.constant(
        strategy.ActionCatalog(Definition),
        @intFromEnum(Constant.action_catalog),
    );
    const decide_goal = flow.productExtract(0, decide_state);
    const decide_history = flow.productExtract(1, decide_state);
    const decide_counters = flow.productExtract(2, decide_state);
    const phase = flow.constant(
        budget.DecisionPhase,
        @intFromEnum(Constant.initial_phase),
    );
    const request = flow.productConstruct(
        Strategy.DecisionRequestType(Definition),
        .{ instructions, catalog, decide_goal, decide_counters, phase, decide_history },
    );
    const decision = flow.perform(
        decisionSiteType(Definition, Strategy),
        request,
        .{decide_state},
    );
    const resumed_state = decision.carried[0];
    const resumed_counters = flow.productExtract(2, resumed_state);
    const old_turns = flow.productExtract(0, resumed_counters);
    const old_decisions = flow.productExtract(1, resumed_counters);
    const one = flow.constant(u32, @intFromEnum(Constant.one));
    const next_turns = flow.integerAdd(old_turns, one);
    const next_decisions = flow.integerAdd(old_decisions, one);
    var next_counters = flow.productReplace(0, resumed_counters, next_turns);
    next_counters = flow.productReplace(1, next_counters, next_decisions);
    const resumed_goal = flow.productExtract(0, resumed_state);
    const resumed_history = flow.productExtract(1, resumed_state);
    const next_state = flow.productConstruct(
        strategy.State(Definition),
        .{ resumed_goal, resumed_history, next_counters },
    );
    const action_value = decision.value;
    const dispatch_state = next_state;
    emitDispatch(Definition, &flow, action_value, dispatch_state, loop_block);
    return flow.finish(Definition.Result);
}

fn ReflectiveLowering(comptime Definition: type, comptime Strategy: type) type {
    @setEvalBranchQuota(10_000_000);
    const Builder = flow_module.Flow(.{
        .schema_types = schemaTypes(Definition, Strategy),
        .limits = flow_module.Limits{
            .maximum_values = 256,
            .maximum_blocks = 64,
            .maximum_instructions = 192,
            .maximum_operands = 384,
            .maximum_parameters = 192,
            .maximum_requests = 32,
            .maximum_edge_arguments = 384,
        },
    });
    comptime var flow = Builder.init("agent-reflective-react-v1");
    const goal = flow.begin(Definition.Goal);
    const history = flow.vectorEmpty(strategy.History(Definition));
    const zero = flow.constant(u32, @intFromEnum(Constant.zero));
    const counters = flow.productConstruct(
        budget.Counters,
        .{ zero, zero, zero, zero },
    );
    const initial_state = flow.productConstruct(
        strategy.State(Definition),
        .{ goal, history, counters },
    );
    const loop_block = flow.block(.loop_header, .{strategy.State(Definition)});
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
    const propose = flow.block(.segment, .{strategy.State(Definition)});
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
    const instructions = flow.constant(
        boundary.Text(Definition.instructions.len),
        @intFromEnum(Constant.instructions),
    );
    const catalog = flow.constant(
        strategy.ActionCatalog(Definition),
        @intFromEnum(Constant.action_catalog),
    );
    const propose_goal = flow.productExtract(0, propose_state);
    const propose_history = flow.productExtract(1, propose_state);
    const propose_counters = flow.productExtract(2, propose_state);
    const propose_phase = flow.constant(
        budget.DecisionPhase,
        @intFromEnum(Constant.initial_phase),
    );
    const no_candidate = flow.optionalNone(?Definition.Action);
    const proposal_request = flow.productConstruct(
        Strategy.DecisionRequestType(Definition),
        .{
            instructions,
            catalog,
            propose_goal,
            propose_counters,
            propose_phase,
            propose_history,
            no_candidate,
        },
    );
    const proposal = flow.perform(
        decisionSiteType(Definition, Strategy),
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
    const proposal_history = flow.productExtract(1, proposal_state);
    const counted_proposal_state = flow.productConstruct(
        strategy.State(Definition),
        .{ proposal_goal, proposal_history, counted_proposal_counters },
    );

    const reflection_loop = flow.block(.loop_header, .{
        Definition.Action,
        strategy.State(Definition),
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
        strategy.State(Definition),
    });
    const reflection_budget_check = flow.block(.segment, .{
        Definition.Action,
        strategy.State(Definition),
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
        strategy.State(Definition),
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
    const reflect_history = flow.productExtract(1, reflect_state);
    const reflect_counters = flow.productExtract(2, reflect_state);
    const reflect_phase = flow.constant(
        budget.DecisionPhase,
        @intFromEnum(Constant.reflect_phase),
    );
    const some_candidate = flow.optionalSome(
        ?Definition.Action,
        reflect_candidate,
    );
    const reflect_request = flow.productConstruct(
        Strategy.DecisionRequestType(Definition),
        .{
            instructions,
            catalog,
            reflect_goal,
            reflect_counters,
            reflect_phase,
            reflect_history,
            some_candidate,
        },
    );
    const reflected = flow.perform(
        decisionSiteType(Definition, Strategy),
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
    const reflected_history = flow.productExtract(1, reflected_state);
    const counted_reflection_state = flow.productConstruct(
        strategy.State(Definition),
        .{ reflected_goal, reflected_history, counted_reflection_counters },
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
    const dispatch_history = flow.productExtract(1, dispatch_state);
    const counted_dispatch_state = flow.productConstruct(
        strategy.State(Definition),
        .{ dispatch_goal, dispatch_history, counted_dispatch_counters },
    );
    emitDispatch(
        Definition,
        &flow,
        dispatch_candidate,
        counted_dispatch_state,
        loop_block,
    );
    return flow.finish(Definition.Result);
}

fn ReactBody(comptime Definition: type, comptime Strategy: type) type {
    const Lowering = ReactLowering(Definition, Strategy);
    return struct {
        pub const InitialArgs = Definition.Goal;
        pub const Result = Definition.Result;
        pub const Failure = Definition.Failure;
        pub const constants = .{
            strategy.instructionsValue(Definition),
            strategy.catalogValue(Definition),
            @as(u32, 0),
            @as(u32, 1),
            Definition.budget.maximum_turns,
            Definition.budget.maximum_decisions,
            Definition.budget.maximum_effect_actions,
            Definition.budget.maximum_child_actions,
            Definition.history.maximum_observations,
            budget.DecisionPhase.decide,
            strategy.failureNamed(Definition, "budget_exhausted"),
            strategy.failureNamed(Definition, "history_overflow"),
        };
        pub const effect_sites = effectSites(Definition, Strategy);
        pub const schema_types = Lowering.schema_types;
        pub const control_ir = Lowering.control_ir;
        pub const compiler_limits: boundary.ir.CompilerLimits = .{
            .maximum_values = 256,
            .maximum_blocks = 64,
            .maximum_constructors = 256,
            .maximum_environment_fields = 128,
            .maximum_invariant_terms = 64,
            .maximum_generated_operations = 32_768,
        };
    };
}

fn ReflectiveBody(comptime Definition: type, comptime Strategy: type) type {
    const Lowering = ReflectiveLowering(Definition, Strategy);
    return struct {
        pub const InitialArgs = Definition.Goal;
        pub const Result = Definition.Result;
        pub const Failure = Definition.Failure;
        pub const constants = .{
            strategy.instructionsValue(Definition),
            strategy.catalogValue(Definition),
            @as(u32, 0),
            @as(u32, 1),
            Definition.budget.maximum_turns,
            Definition.budget.maximum_decisions,
            Definition.budget.maximum_effect_actions,
            Definition.budget.maximum_child_actions,
            Definition.history.maximum_observations,
            budget.DecisionPhase.propose,
            strategy.failureNamed(Definition, "budget_exhausted"),
            strategy.failureNamed(Definition, "history_overflow"),
            budget.DecisionPhase.reflect,
            Strategy.normalized_config.reflection_rounds,
        };
        pub const effect_sites = effectSites(Definition, Strategy);
        pub const schema_types = Lowering.schema_types;
        pub const control_ir = Lowering.control_ir;
        pub const compiler_limits: boundary.ir.CompilerLimits = .{
            .maximum_values = 256,
            .maximum_blocks = 64,
            .maximum_constructors = 256,
            .maximum_environment_fields = 128,
            .maximum_invariant_terms = 64,
            .maximum_generated_operations = 32_768,
        };
    };
}

fn assertStrategy(comptime Definition: type, comptime Strategy: type) void {
    if (!@hasDecl(Strategy, "semantic_identity") or
        !@hasDecl(Strategy, "kind") or
        !@hasDecl(Strategy, "validate") or
        !@hasDecl(Strategy, "DecisionRequestType"))
    {
        @compileError("agent compile requires a RuntimeStrategy structural contract");
    }
    Strategy.validate(Definition);
    const DecisionRequest = Strategy.DecisionRequestType(Definition);
    if (@typeInfo(DecisionRequest) == .pointer) {
        @compileError("agent RuntimeStrategy DecisionRequest must be Boundary-portable");
    }
    boundary.schema.assertPortable(DecisionRequest);
    if (boundary.schema.maximumEncodedSize(DecisionRequest) >
        Definition.decision.maximum_request_bytes)
    {
        @compileError(
            "agent RuntimeStrategy DecisionRequest exceeds " ++
                "decision.maximum_request_bytes",
        );
    }
}

fn assertProgramBodyEffects(
    comptime Definition: type,
    comptime Strategy: type,
    comptime Body: type,
) void {
    if (!@hasDecl(Body, "effect_sites")) {
        @compileError("agent RuntimeStrategy Body must declare effect_sites");
    }
    const expected = effectSites(Definition, Strategy);
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
    comptime options: anytype,
) type {
    comptime assertStrategy(DefinitionType, StrategyType);
    if (!@hasField(@TypeOf(options), "machine")) {
        @compileError("agent.compile options require .machine");
    }
    inline for (std.meta.fields(@TypeOf(options))) |field| {
        if (!std.mem.eql(u8, field.name, "machine")) {
            @compileError("agent.compile unknown option '" ++ field.name ++ "'");
        }
    }
    const Body = switch (StrategyType.kind) {
        .react => ReactBody(DefinitionType, StrategyType),
        .reflective => ReflectiveBody(DefinitionType, StrategyType),
        .custom => StrategyType.ProgramBody(DefinitionType),
    };
    comptime assertProgramBodyEffects(DefinitionType, StrategyType, Body);
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
    const compiled_manifest = manifest.compiled(
        definition_manifest,
        strategy_manifest,
        MachineType,
    );

    return struct {
        pub const Definition = DefinitionType;
        pub const Strategy = StrategyType;
        pub const Program = ProgramType;
        pub const Machine = MachineType;
        pub const DefinitionManifest = definition_manifest;
        pub const StrategyManifest = strategy_manifest;
        pub const Manifest = compiled_manifest;
        pub const DefinitionManifestBytes = manifest.encodeDefinition(
            DefinitionType,
            definition_manifest,
        );
        pub const StrategyManifestBytes = manifest.encodeStrategy(
            StrategyType,
            strategy_manifest,
        );
        pub const ManifestBytes = manifest.encodeCompiled(compiled_manifest);
        pub const DecisionSite = decisionSiteType(DefinitionType, StrategyType);
        pub const ActionSites = effectSites(DefinitionType, StrategyType);
    };
}

comptime {
    _ = action;
}
