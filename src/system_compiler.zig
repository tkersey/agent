const std = @import("std");
const boundary = @import("boundary");
const action = @import("action.zig");
const action_decode = @import("action_decode.zig");
const flow_module = @import("flow.zig");
const openai_profile = @import("openai_profile.zig");
const openai_response = @import("openai_response.zig");
const request = @import("request.zig");

fn assertEffectFree(
    comptime label: []const u8,
    flow: anytype,
    before_suspensions: anytype,
    before_returns: anytype,
) void {
    if (!std.meta.eql(flow.suspensionCount(), before_suspensions)) {
        @compileError(label ++ " must not introduce a residual effect");
    }
    if (!std.meta.eql(flow.returnHandoffCount(), before_returns)) {
        @compileError(label ++ " must not return the enclosing system");
    }
}

fn effectCount(comptime source: anytype) usize {
    var count: usize = 0;
    inline for (source.actions) |Descriptor| {
        if (Descriptor.kind == .effect) count += 1;
    }
    return count;
}

fn effectSites(comptime source: anytype, comptime Profile: type) [1 + effectCount(source)]type {
    var result: [1 + effectCount(source)]type = undefined;
    result[0] = Profile.ProtocolType.Site(0);
    var next: usize = 1;
    inline for (source.actions) |Descriptor| {
        if (Descriptor.kind == .effect) {
            result[next] = Descriptor.Site;
            next += 1;
        }
    }
    return result;
}

fn unionFieldIndex(comptime T: type, comptime name: []const u8) u16 {
    inline for (@typeInfo(T).@"union".fields, 0..) |field, index| {
        if (std.mem.eql(u8, field.name, name)) return @intCast(index);
    }
    @compileError("agent system union has no field named '" ++ name ++ "'");
}

fn skillReferencesAction(
    comptime Skill: type,
    comptime action_name: []const u8,
) bool {
    inline for (Skill.actions) |name| {
        if (std.mem.eql(u8, name, action_name)) return true;
    }
    return false;
}

fn activeSkills(
    comptime source: anytype,
    comptime Epistemics: type,
    flow: anytype,
    memory: anytype,
    comptime context: anytype,
) [source.skills.len]flow_module.Value(bool) {
    var result: [source.skills.len]flow_module.Value(bool) = undefined;
    inline for (source.skills, 0..) |Skill, index| {
        const before_suspensions = flow.suspensionCount();
        const before_returns = flow.returnHandoffCount();
        result[index] = if (Skill.activation == .always)
            flow.constant(bool, context.true_index)
        else
            Epistemics.emitSkillActive(source, flow, memory, index, context);
        assertEffectFree(
            "agent epistemics emitSkillActive",
            flow,
            before_suspensions,
            before_returns,
        );
    }
    return result;
}

fn offeredActions(
    comptime source: anytype,
    flow: anytype,
    active_skills: [source.skills.len]flow_module.Value(bool),
    comptime context: anytype,
) [source.actions.len]flow_module.Value(bool) {
    var result: [source.actions.len]flow_module.Value(bool) = undefined;
    inline for (source.actions, 0..) |Descriptor, action_index| {
        var offered = flow.constant(bool, if (source.skills.len == 0)
            context.true_index
        else
            context.false_index);
        inline for (source.skills, 0..) |Skill, skill_index| {
            if (skillReferencesAction(Skill, Descriptor.name)) {
                offered = flow.booleanOr(offered, active_skills[skill_index]);
            }
        }
        result[action_index] = offered;
    }
    return result;
}

fn selectedWasOffered(
    comptime source: anytype,
    flow: anytype,
    selected: anytype,
    offered_mask: flow_module.Value(u32),
    comptime context: anytype,
) flow_module.Value(bool) {
    var result = flow.constant(bool, context.false_index);
    var bit = flow.constant(u32, context.one_u32_index);
    inline for (0..source.actions.len) |index| {
        const is_offered = flow.integerNotEqual(
            flow.integerBitAnd(offered_mask, bit),
            flow.constant(u32, context.zero_u32_index),
        );
        result = flow.booleanOr(
            result,
            flow.booleanAnd(flow.sumTagIs(index, selected), is_offered),
        );
        if (index + 1 < source.actions.len) {
            bit = flow.integerAddOrFail(
                bit,
                bit,
                flow.constant(context.Failure, context.arithmetic_failure_index),
            );
        }
    }
    return result;
}

fn boolMask(
    flow: anytype,
    values: anytype,
    comptime context: anytype,
) flow_module.Value(u32) {
    var result = flow.constant(u32, context.zero_u32_index);
    var bit = flow.constant(u32, context.one_u32_index);
    inline for (values, 0..) |value, index| {
        result = flow.integerBitOr(
            result,
            flow.select(value, bit, flow.constant(u32, context.zero_u32_index)),
        );
        if (index + 1 < values.len) bit = flow.integerAdd(bit, bit);
    }
    return result;
}

pub fn ReactBody(comptime source: anytype) type {
    if (comptime !boundary.schema.isTextType(source.Goal)) {
        @compileError("Agent 3 default ReAct currently requires a Text Goal prompt");
    }
    if (!@hasField(@TypeOf(source.representation), "request_bytes") or
        !@hasField(@TypeOf(source.representation), "response_bytes") or
        !@hasField(@TypeOf(source.representation), "schema_types"))
    {
        @compileError("Agent 3 ReAct representation requires request_bytes, response_bytes, and schema_types");
    }
    inline for (source.models) |DeclaredModel| {
        if (DeclaredModel.protocol != @import("protocol/openai_responses_v1.zig").Profile) {
            @compileError("Agent 3 ReAct milestone supports OpenAI Responses v1");
        }
    }
    const ResponseBytes = boundary.Bytes(source.representation.response_bytes);
    const Profile = openai_profile.Profile(
        source.Failure,
        ResponseBytes,
        source.Action,
        source.actions,
        source.models,
        source.prompts,
        source.skills,
        source.failures,
        source.representation.request_bytes,
    );
    const Context = Profile.Context;
    const Protocol = Profile.ProtocolType;
    const Epistemics = source.epistemics;
    const Memory = Epistemics.MemoryType(source);
    const DecisionView = Epistemics.DecisionViewType(source);
    const RuntimeState = if (Epistemics.prompt_is_json_escaped)
        Memory
    else
        struct { goal: source.Goal, memory: Memory };
    const system_flow_limits: flow_module.Limits = if (@hasField(
        @TypeOf(source.representation),
        "flow_limits",
    )) source.representation.flow_limits else .{
        .maximum_functions = 32,
        .maximum_values = 4096,
        .maximum_blocks = 512,
        .maximum_instructions = 8192,
        .maximum_operands = 16_384,
        .maximum_parameters = 8192,
        .maximum_requests = 128,
        .maximum_edge_arguments = 16_384,
    };
    const Builder = flow_module.Flow(.{
        .schema_types = source.representation.schema_types ++
            Epistemics.schemaTypes(source) ++ Profile.schemaTypes() ++
            .{RuntimeState},
        .limits = system_flow_limits,
    });
    comptime var flow = Builder.init(source.name ++ ":react-v1");
    flow.setPhase(.agent_initialization);
    const goal = flow.begin(source.Goal);
    flow.setPhase(.agent_model_resume);
    const helpers = openai_response.declare(&flow, ResponseBytes);
    flow.setPhase(.agent_model_request);
    const request_helpers = request.declareSystem(&flow, Profile);
    flow.setPhase(.agent_initialization);
    const before_initial_suspensions = flow.suspensionCount();
    const before_initial_returns = flow.returnHandoffCount();
    const memory = Epistemics.emitInitial(source, &flow, goal, Context);
    assertEffectFree("agent epistemics emitInitial", &flow, before_initial_suspensions, before_initial_returns);
    const initial_state = if (Epistemics.prompt_is_json_escaped)
        memory
    else
        flow.productConstruct(RuntimeState, .{ goal, memory });
    const loop = flow.block(.loop_header, .{RuntimeState});
    flow.jump(loop, .{initial_state});
    const runtime_state = flow.enter(loop)[0];
    const current_goal = if (Epistemics.prompt_is_json_escaped)
        goal
    else
        flow.productExtract(0, runtime_state);
    const current_memory = if (Epistemics.prompt_is_json_escaped)
        runtime_state
    else
        flow.productExtract(1, runtime_state);
    flow.setPhase(.agent_memory_projection);
    const before_project_suspensions = flow.suspensionCount();
    const before_project_returns = flow.returnHandoffCount();
    const view: flow_module.Value(DecisionView) = Epistemics.emitProject(
        source,
        &flow,
        current_memory,
    );
    assertEffectFree("agent epistemics emitProject", &flow, before_project_suspensions, before_project_returns);
    flow.setPhase(.agent_prompt_render);
    const before_prompt_suspensions = flow.suspensionCount();
    const before_prompt_returns = flow.returnHandoffCount();
    const prompt = Epistemics.emitPrompt(source, &flow, current_goal, view, Context);
    assertEffectFree("agent epistemics emitPrompt", &flow, before_prompt_suspensions, before_prompt_returns);
    flow.setPhase(.agent_skill_activation);
    const active_skills = activeSkills(source, Epistemics, &flow, current_memory, Context);
    flow.setPhase(.agent_tool_selection);
    const offered_actions = offeredActions(source, &flow, active_skills, Context);
    flow.setPhase(.agent_model_request);
    const before_model_suspensions = flow.suspensionCount();
    const before_model_returns = flow.returnHandoffCount();
    const model_index = Epistemics.emitModelIndex(
        source,
        &flow,
        current_memory,
        Context,
    );
    assertEffectFree("agent epistemics emitModelIndex", &flow, before_model_suspensions, before_model_returns);
    const active_mask = boolMask(&flow, active_skills, Context);
    const offered_mask = boolMask(&flow, offered_actions, Context);
    const model_request = if (Epistemics.prompt_is_json_escaped)
        request.emitSystemEscaped(
            Profile,
            &flow,
            request_helpers,
            prompt,
            model_index,
            active_mask,
            offered_mask,
            Context,
        )
    else
        request.emitSystem(
            Profile,
            &flow,
            request_helpers,
            prompt,
            model_index,
            active_mask,
            offered_mask,
            Context,
        );
    const model = flow.perform(
        Protocol.Site(0),
        model_request,
        .{runtime_state},
    );
    flow.setPhase(.agent_model_resume);
    const response_path = flow.block(.segment, .{ Protocol.Response, RuntimeState });
    const transport_failure = flow.block(.terminal_handoff, .{});
    flow.branch(
        flow.sumTagIs(0, model.value),
        response_path,
        .{ model.value, model.carried[0] },
        transport_failure,
        .{},
    );
    _ = flow.enter(transport_failure);
    flow.failValue(flow.constant(source.Failure, Context.transport_failure_index));
    const response_values = flow.enter(response_path);
    const response = flow.sumExtractOrFail(
        0,
        response_values[0],
        flow.constant(source.Failure, Context.malformed_failure_index),
    );
    const parse = flow.block(.segment, .{ ResponseBytes, RuntimeState });
    const http_failure = flow.block(.terminal_handoff, .{});
    flow.branch(
        flow.integerEqual(
            flow.productExtract(0, response),
            flow.constant(u16, Context.http_ok_index),
        ),
        parse,
        .{ flow.productExtract(1, response), response_values[1] },
        http_failure,
        .{},
    );
    _ = flow.enter(http_failure);
    flow.failValue(flow.constant(source.Failure, Context.http_failure_index));
    const parse_values = flow.enter(parse);
    const parsed = flow.call(
        helpers.parse_response,
        .{flow.productConstruct(@import("staged_json.zig").Cursor(ResponseBytes), .{
            parse_values[0],
            flow.constant(u32, Context.zero_u32_index),
        })},
        .{parse_values[1]},
    );
    const selected = action_decode.emit(
        &flow,
        source.Action,
        source.actions,
        ResponseBytes,
        parsed.value,
        helpers.core,
        Context,
    );
    flow.setPhase(.agent_action_admission);
    const resumed_memory = if (Epistemics.prompt_is_json_escaped)
        parsed.carried[0]
    else
        flow.productExtract(1, parsed.carried[0]);
    const resumed_active_skills = activeSkills(
        source,
        Epistemics,
        &flow,
        resumed_memory,
        Context,
    );
    const resumed_offered_actions = offeredActions(
        source,
        &flow,
        resumed_active_skills,
        Context,
    );
    const resumed_offered_mask = boolMask(&flow, resumed_offered_actions, Context);
    const before_policy_suspensions = flow.suspensionCount();
    const before_policy_returns = flow.returnHandoffCount();
    const policy_allowed = Epistemics.emitActionAllowed(
        source,
        &flow,
        resumed_memory,
        selected,
        Context,
    );
    assertEffectFree("agent epistemics emitActionAllowed", &flow, before_policy_suspensions, before_policy_returns);
    const allowed = flow.booleanAnd(
        selectedWasOffered(
            source,
            &flow,
            selected,
            resumed_offered_mask,
            Context,
        ),
        policy_allowed,
    );
    const dispatch = flow.block(.segment, .{ source.Action, RuntimeState });
    const denied = flow.block(.terminal_handoff, .{});
    flow.branch(
        allowed,
        dispatch,
        .{ selected, parsed.carried[0] },
        denied,
        .{},
    );
    _ = flow.enter(denied);
    flow.failValue(flow.constant(source.Failure, Context.policy_denied_failure_index));
    flow.setPhase(.agent_tool_dispatch);
    var dispatch_values = flow.enter(dispatch);
    inline for (@typeInfo(source.Action).@"union".fields, 0..) |_, action_index| {
        const matched = flow.block(.segment, .{ source.Action, RuntimeState });
        const next = flow.block(.segment, .{ source.Action, RuntimeState });
        flow.branch(
            flow.sumTagIs(action_index, dispatch_values[0]),
            matched,
            dispatch_values,
            next,
            dispatch_values,
        );
        const values = flow.enter(matched);
        const Descriptor = source.actions[action_index];
        const payload = flow.sumExtractOrFail(
            action_index,
            values[0],
            flow.constant(source.Failure, Context.invalid_variant_failure_index),
        );
        switch (Descriptor.kind) {
            .effect => {
                flow.setPhase(.agent_tool_dispatch);
                const performed = flow.perform(
                    Descriptor.Site,
                    payload,
                    .{values[1]},
                );
                flow.setPhase(.agent_observation_fold);
                const observation = flow.sumConstruct(
                    source.Observation,
                    unionFieldIndex(source.Observation, Descriptor.observation_name),
                    performed.value,
                );
                const performed_memory = if (Epistemics.prompt_is_json_escaped)
                    performed.carried[0]
                else
                    flow.productExtract(1, performed.carried[0]);
                const before_observe_suspensions = flow.suspensionCount();
                const before_observe_returns = flow.returnHandoffCount();
                const next_memory = Epistemics.emitObserve(
                    source,
                    &flow,
                    performed_memory,
                    observation,
                    Context,
                );
                assertEffectFree("agent epistemics emitObserve", &flow, before_observe_suspensions, before_observe_returns);
                const next_state = if (Epistemics.prompt_is_json_escaped)
                    next_memory
                else
                    flow.productReplace(1, performed.carried[0], next_memory);
                if (source.strategy.repeat_after_observation) {
                    flow.jump(loop, .{next_state});
                } else {
                    flow.failValue(flow.constant(source.Failure, Context.policy_denied_failure_index));
                }
            },
            .local => {
                flow.setPhase(.agent_tool_dispatch);
                const before_local_suspensions = flow.suspensionCount();
                const before_local_returns = flow.returnHandoffCount();
                const local_payload = Descriptor.Local.emit(
                    &flow,
                    payload,
                    Context,
                );
                assertEffectFree("agent local action emit", &flow, before_local_suspensions, before_local_returns);
                flow.setPhase(.agent_observation_fold);
                const observation = flow.sumConstruct(
                    source.Observation,
                    unionFieldIndex(source.Observation, Descriptor.observation_name),
                    local_payload,
                );
                const local_memory = if (Epistemics.prompt_is_json_escaped)
                    values[1]
                else
                    flow.productExtract(1, values[1]);
                const before_observe_suspensions = flow.suspensionCount();
                const before_observe_returns = flow.returnHandoffCount();
                const next_memory = Epistemics.emitObserve(
                    source,
                    &flow,
                    local_memory,
                    observation,
                    Context,
                );
                assertEffectFree("agent epistemics emitObserve", &flow, before_observe_suspensions, before_observe_returns);
                const next_state = if (Epistemics.prompt_is_json_escaped)
                    next_memory
                else
                    flow.productReplace(1, values[1], next_memory);
                if (source.strategy.repeat_after_observation) {
                    flow.jump(loop, .{next_state});
                } else {
                    flow.failValue(flow.constant(source.Failure, Context.policy_denied_failure_index));
                }
            },
            .final => {
                flow.setPhase(.agent_final_admission);
                if (!source.strategy.allow_completion) {
                    flow.failValue(flow.constant(source.Failure, Context.policy_denied_failure_index));
                } else {
                    const final_memory = if (Epistemics.prompt_is_json_escaped)
                        values[1]
                    else
                        flow.productExtract(1, values[1]);
                    const before_final_suspensions = flow.suspensionCount();
                    const before_final_returns = flow.returnHandoffCount();
                    const final_allowed = Epistemics.emitFinalAllowed(
                        source,
                        &flow,
                        final_memory,
                        payload,
                        Context,
                    );
                    assertEffectFree("agent epistemics emitFinalAllowed", &flow, before_final_suspensions, before_final_returns);
                    const complete = flow.block(.terminal_handoff, .{source.Result});
                    flow.branch(final_allowed, complete, .{payload}, denied, .{});
                    flow.setPhase(.agent_completion);
                    flow.returnValue(flow.enter(complete)[0]);
                }
            },
            .fail => flow.failValue(payload),
        }
        dispatch_values = flow.enter(next);
    }
    flow.failValue(flow.constant(source.Failure, Context.invalid_variant_failure_index));
    flow.setPhase(.agent_model_request);
    request.defineSystem(&flow, Profile, request_helpers, Context);
    flow.setPhase(.agent_model_resume);
    openai_response.define(&flow, ResponseBytes, helpers, Context);
    const Lowering = flow.finish(source.Result);
    const sites = effectSites(source, Profile);
    return struct {
        pub const InitialArgs = source.Goal;
        pub const Result = source.Result;
        pub const Failure = source.Failure;
        pub const constants = Profile.constantValues();
        pub const effect_sites = boundary.effect.row(sites);
        pub const schema_types = Lowering.schema_types;
        pub const control_ir = Lowering.control_ir;
        pub const SourcePhaseMap = Lowering.SourcePhaseMap;
        pub const source_phase_map = Lowering.source_phase_map;
        pub const compiler_limits: boundary.ir.CompilerLimits = .{
            .maximum_values = control_ir.value_types.len,
            .maximum_blocks = control_ir.blocks.len,
            .maximum_constructors = 768,
            .maximum_environment_fields = 256,
            .maximum_invariant_terms = 128,
            .maximum_generated_operations = 32_768,
        };
        pub const maximum_image_bytes: usize = if (@hasField(
            @TypeOf(source.representation),
            "image_bytes",
        )) source.representation.image_bytes else 16 * 1024 * 1024;
    };
}
