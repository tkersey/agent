const std = @import("std");
const boundary = @import("boundary");
const action = @import("action.zig");
const flow_module = @import("flow.zig");
const model_effect = @import("model_effect.zig");
const typed_action_decode = @import("typed_action_decode.zig");

fn assertEffectFree(
    comptime label: []const u8,
    flow: anytype,
    before_suspensions: anytype,
    before_returns: anytype,
) void {
    if (!std.meta.eql(flow.suspensionSnapshot(), before_suspensions)) {
        @compileError(label ++ " must not introduce a residual effect");
    }
    if (!std.meta.eql(flow.returnSnapshot(), before_returns)) {
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
    result[0] = Profile.SiteType;
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

fn actionAlwaysOffered(
    comptime source: anytype,
    comptime action_name: []const u8,
) bool {
    if (source.skills.len == 0) return true;
    inline for (source.skills) |Skill| {
        if (Skill.activation == .always and
            skillReferencesAction(Skill, action_name)) return true;
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
        const before_suspensions = flow.suspensionSnapshot();
        const before_returns = flow.returnSnapshot();
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
        var offered = flow.constant(
            bool,
            if (actionAlwaysOffered(source, Descriptor.name))
                context.true_index
            else
                context.false_index,
        );
        if (!actionAlwaysOffered(source, Descriptor.name)) {
            inline for (source.skills, 0..) |Skill, skill_index| {
                if (Skill.activation != .always and
                    skillReferencesAction(Skill, Descriptor.name))
                {
                    offered = flow.booleanOr(offered, active_skills[skill_index]);
                }
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
        const is_offered = if (actionAlwaysOffered(
            source,
            source.actions[index].name,
        ))
            flow.constant(bool, context.true_index)
        else
            flow.integerNotEqual(
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
    comptime source: anytype,
    flow: anytype,
    values: anytype,
    comptime context: anytype,
) flow_module.Value(u32) {
    var result = flow.constant(u32, context.zero_u32_index);
    var bit = flow.constant(u32, context.one_u32_index);
    inline for (values, 0..) |value, index| {
        result = flow.integerBitOr(
            result,
            if (actionAlwaysOffered(source, source.actions[index].name))
                bit
            else
                flow.select(
                    value,
                    bit,
                    flow.constant(u32, context.zero_u32_index),
                ),
        );
        if (index + 1 < values.len) bit = flow.integerAdd(bit, bit);
    }
    return result;
}

fn compileIndex(
    flow: anytype,
    comptime index: usize,
    comptime context: anytype,
) flow_module.Value(u32) {
    var result = flow.constant(u32, context.zero_u32_index);
    inline for (0..index) |_| {
        result = flow.integerAdd(
            result,
            flow.constant(u32, context.one_u32_index),
        );
    }
    return result;
}

fn appendConditionalMessage(
    comptime Profile: type,
    flow: anytype,
    messages: flow_module.Value(Profile.MessagesType),
    enabled: flow_module.Value(bool),
    message: flow_module.Value(Profile.MessageType),
    comptime context: anytype,
) flow_module.Value(Profile.MessagesType) {
    const append = flow.block(.segment, .{Profile.MessagesType});
    const joined = flow.block(.segment, .{Profile.MessagesType});
    flow.branch(enabled, append, .{messages}, joined, .{messages});
    const next = flow.vectorPushOrFail(
        flow.enter(append)[0],
        message,
        flow.constant(context.Failure, context.capacity_failure_index),
    );
    flow.jump(joined, .{next});
    return flow.enter(joined)[0];
}

fn appendStaticMessage(
    comptime Profile: type,
    flow: anytype,
    messages: flow_module.Value(Profile.MessagesType),
    message: flow_module.Value(Profile.MessageType),
    comptime context: anytype,
) flow_module.Value(Profile.MessagesType) {
    const next = flow.vectorPushOrFail(
        messages,
        message,
        flow.constant(context.Failure, context.capacity_failure_index),
    );
    const joined = flow.block(.segment, .{Profile.MessagesType});
    flow.jump(joined, .{next});
    return flow.enter(joined)[0];
}

fn semanticMessages(
    comptime source: anytype,
    comptime Profile: type,
    flow: anytype,
    prompt: anytype,
    active_skills: [source.skills.len]flow_module.Value(bool),
    comptime context: anytype,
) flow_module.Value(Profile.MessagesType) {
    var messages = flow.vectorEmpty(Profile.MessagesType);
    inline for (source.prompts, 0..) |_, index| {
        const message = flow.vectorGetOrFail(
            flow.constant(Profile.PromptMessagesType, Profile.prompts_index),
            compileIndex(flow, index, context),
            flow.constant(context.Failure, context.invalid_index_failure_index),
        );
        messages = flow.vectorPushOrFail(
            messages,
            message,
            flow.constant(context.Failure, context.capacity_failure_index),
        );
    }
    inline for (source.skills, 0..) |Skill, index| {
        if (Skill.position != .before_user) continue;
        const message = flow.vectorGetOrFail(
            flow.constant(Profile.SkillMessagesType, Profile.skills_index),
            compileIndex(flow, index, context),
            flow.constant(context.Failure, context.invalid_index_failure_index),
        );
        messages = if (Skill.activation == .always)
            appendStaticMessage(
                Profile,
                flow,
                messages,
                message,
                context,
            )
        else
            appendConditionalMessage(
                Profile,
                flow,
                messages,
                active_skills[index],
                message,
                context,
            );
    }
    const rendered_prompt = flow.textCopyOrFail(
        Profile.MessageTextType,
        prompt,
        flow.constant(u32, context.zero_u32_index),
        flow.textLength(prompt),
        flow.constant(context.Failure, context.capacity_failure_index),
        flow.constant(context.Failure, context.invalid_utf8_failure_index),
    );
    messages = flow.vectorPushOrFail(
        messages,
        flow.productConstruct(Profile.MessageType, .{
            flow.constant(model_effect.MessageRole, Profile.user_role_index),
            rendered_prompt,
        }),
        flow.constant(context.Failure, context.capacity_failure_index),
    );
    inline for (source.skills, 0..) |Skill, index| {
        if (Skill.position != .after_user) continue;
        const message = flow.vectorGetOrFail(
            flow.constant(Profile.SkillMessagesType, Profile.skills_index),
            compileIndex(flow, index, context),
            flow.constant(context.Failure, context.invalid_index_failure_index),
        );
        messages = if (Skill.activation == .always)
            appendStaticMessage(
                Profile,
                flow,
                messages,
                message,
                context,
            )
        else
            appendConditionalMessage(
                Profile,
                flow,
                messages,
                active_skills[index],
                message,
                context,
            );
    }
    return messages;
}

fn appendConditionalTool(
    comptime Profile: type,
    flow: anytype,
    tools: flow_module.Value(Profile.ToolsType),
    enabled: flow_module.Value(bool),
    tool: flow_module.Value(Profile.ToolDeclarationType),
    comptime context: anytype,
) flow_module.Value(Profile.ToolsType) {
    const append = flow.block(.segment, .{Profile.ToolsType});
    const joined = flow.block(.segment, .{Profile.ToolsType});
    flow.branch(enabled, append, .{tools}, joined, .{tools});
    const next = flow.vectorPushOrFail(
        flow.enter(append)[0],
        tool,
        flow.constant(context.Failure, context.capacity_failure_index),
    );
    flow.jump(joined, .{next});
    return flow.enter(joined)[0];
}

fn appendStaticTool(
    comptime Profile: type,
    flow: anytype,
    tools: flow_module.Value(Profile.ToolsType),
    tool: flow_module.Value(Profile.ToolDeclarationType),
    comptime context: anytype,
) flow_module.Value(Profile.ToolsType) {
    const next = flow.vectorPushOrFail(
        tools,
        tool,
        flow.constant(context.Failure, context.capacity_failure_index),
    );
    const joined = flow.block(.segment, .{Profile.ToolsType});
    flow.jump(joined, .{next});
    return flow.enter(joined)[0];
}

fn semanticTools(
    comptime source: anytype,
    comptime Profile: type,
    flow: anytype,
    offered_actions: [source.actions.len]flow_module.Value(bool),
    comptime context: anytype,
) flow_module.Value(Profile.ToolsType) {
    var tools = flow.vectorEmpty(Profile.ToolsType);
    inline for (source.actions, 0..) |Descriptor, index| {
        const tool = flow.vectorGetOrFail(
            flow.constant(Profile.ToolsType, Profile.tool_declarations_index),
            flow.constant(u32, context.action_index_indices[index]),
            flow.constant(context.Failure, context.invalid_index_failure_index),
        );
        tools = if (actionAlwaysOffered(source, Descriptor.name))
            appendStaticTool(
                Profile,
                flow,
                tools,
                tool,
                context,
            )
        else
            appendConditionalTool(
                Profile,
                flow,
                tools,
                offered_actions[index],
                tool,
                context,
            );
    }
    return tools;
}

fn selectedFunctionCall(
    comptime Profile: type,
    flow: anytype,
    output: flow_module.Value(Profile.ModelOutputType),
    comptime context: anytype,
) flow_module.Value(Profile.FunctionCallType) {
    const items = flow.productExtract(0, output);
    const loop = flow.block(.loop_header, .{
        u32,
        u32,
        bool,
        Profile.FunctionCallType,
        Profile.OutputItemsType,
    });
    const empty_call = flow.productConstruct(Profile.FunctionCallType, .{
        flow.textEmpty(Profile.CallIdType),
        flow.textEmpty(Profile.ToolNameType),
        flow.bytesEmpty(Profile.ArgumentsJsonType),
        flow.constant(u32, context.zero_u32_index),
        flow.sumConstruct(
            Profile.DecodedActionType,
            1,
            flow.constant(
                Profile.ArgumentDecodeFailureType,
                context.decode_failure_index,
            ),
        ),
    });
    flow.jump(loop, .{
        flow.constant(u32, context.zero_u32_index),
        flow.constant(u32, context.zero_u32_index),
        flow.constant(bool, context.false_index),
        empty_call,
        items,
    });
    const state = flow.enter(loop);
    const done = flow.block(.segment, .{
        u32,
        bool,
        Profile.FunctionCallType,
    });
    const inspect = flow.block(.segment, .{
        u32,
        u32,
        bool,
        Profile.FunctionCallType,
        Profile.OutputItemsType,
    });
    flow.branch(
        flow.integerGreaterEqual(state[0], flow.vectorLength(state[4])),
        done,
        .{ state[1], state[2], state[3] },
        inspect,
        state,
    );
    const inspecting = flow.enter(inspect);
    const item = flow.vectorGetOrFail(
        inspecting[4],
        inspecting[0],
        flow.constant(context.Failure, context.invalid_index_failure_index),
    );
    const found = flow.block(.segment, .{
        u32,
        u32,
        bool,
        Profile.FunctionCallType,
        Profile.OutputItemsType,
        Profile.OutputItemType,
    });
    const next = flow.block(.segment, .{
        u32,
        u32,
        bool,
        Profile.FunctionCallType,
        Profile.OutputItemsType,
    });
    flow.branch(
        flow.sumTagIs(0, item),
        found,
        .{
            inspecting[0],
            inspecting[1],
            inspecting[2],
            inspecting[3],
            inspecting[4],
            item,
        },
        next,
        inspecting,
    );
    const found_values = flow.enter(found);
    const call = flow.sumExtractOrFail(
        0,
        found_values[5],
        flow.constant(context.Failure, context.invalid_variant_failure_index),
    );
    flow.jump(next, .{
        found_values[0],
        flow.integerAddOrFail(
            found_values[1],
            flow.constant(u32, context.one_u32_index),
            flow.constant(context.Failure, context.arithmetic_failure_index),
        ),
        flow.constant(bool, context.true_index),
        call,
        found_values[4],
    });
    const next_values = flow.enter(next);
    flow.jump(loop, .{
        flow.integerAddOrFail(
            next_values[0],
            flow.constant(u32, context.one_u32_index),
            flow.constant(context.Failure, context.arithmetic_failure_index),
        ),
        next_values[1],
        next_values[2],
        next_values[3],
        next_values[4],
    });

    const finished = flow.enter(done);
    const exactly_one = flow.block(.segment, .{
        bool,
        Profile.FunctionCallType,
    });
    const wrong_count = flow.block(.terminal_handoff, .{u32});
    flow.branch(
        flow.integerEqual(
            finished[0],
            flow.constant(u32, context.one_u32_index),
        ),
        exactly_one,
        .{ finished[1], finished[2] },
        wrong_count,
        .{finished[0]},
    );
    const wrong = flow.enter(wrong_count)[0];
    const multiple = flow.block(.terminal_handoff, .{});
    const absent = flow.block(.terminal_handoff, .{});
    flow.branch(
        flow.integerGreaterEqual(
            wrong,
            flow.constant(u32, context.one_u32_index),
        ),
        multiple,
        .{},
        absent,
        .{},
    );
    _ = flow.enter(multiple);
    flow.failValue(flow.constant(context.Failure, context.multiple_calls_failure_index));
    _ = flow.enter(absent);
    flow.failValue(flow.constant(context.Failure, context.incomplete_failure_index));
    const selected = flow.enter(exactly_one);
    const present = flow.block(.segment, .{Profile.FunctionCallType});
    const missing = flow.block(.terminal_handoff, .{});
    flow.branch(
        selected[0],
        present,
        .{selected[1]},
        missing,
        .{},
    );
    _ = flow.enter(missing);
    flow.failValue(flow.constant(context.Failure, context.incomplete_failure_index));
    return flow.enter(present)[0];
}

fn ReactBodyMode(
    comptime source: anytype,
    comptime ablate_action_argument_decode: bool,
) type {
    if (comptime !boundary.schema.isTextType(source.Goal)) {
        @compileError("Agent 3 default ReAct currently requires a Text Goal prompt");
    }
    if (!@hasField(@TypeOf(source.representation), "response_bytes") or
        !@hasField(@TypeOf(source.representation), "schema_types"))
    {
        @compileError("Agent 3 ReAct representation requires response_bytes and schema_types");
    }
    inline for (source.models) |DeclaredModel| {
        if (DeclaredModel.protocol != @import("protocol/openai_responses_v2.zig").Profile) {
            @compileError("Agent 3 ReAct milestone supports OpenAI Responses v2");
        }
    }
    const Epistemics = source.epistemics;
    if (Epistemics.prompt_is_json_escaped) {
        @compileError("Agent semantic model invocation forbids provider-escaped epistemic prompts");
    }
    const Memory = Epistemics.MemoryType(source);
    const DecisionView = Epistemics.DecisionViewType(source);
    const Prompt = Epistemics.PromptType(source);
    const Profile = model_effect.Profile(source, Prompt);
    const Context = Profile.ActionContext;
    const RuntimeState = struct { goal: source.Goal, memory: Memory };
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
    flow.setPhase(.agent_initialization);
    const before_initial_suspensions = flow.suspensionSnapshot();
    const before_initial_returns = flow.returnSnapshot();
    const memory = Epistemics.emitInitial(source, &flow, goal, Context);
    assertEffectFree("agent epistemics emitInitial", &flow, before_initial_suspensions, before_initial_returns);
    const initial_state = flow.productConstruct(RuntimeState, .{ goal, memory });
    const loop = flow.block(.loop_header, .{RuntimeState});
    flow.jump(loop, .{initial_state});
    const runtime_state = flow.enter(loop)[0];
    const current_goal = flow.productExtract(0, runtime_state);
    const current_memory = flow.productExtract(1, runtime_state);
    flow.setPhase(.agent_memory_projection);
    const before_project_suspensions = flow.suspensionSnapshot();
    const before_project_returns = flow.returnSnapshot();
    const view: flow_module.Value(DecisionView) = Epistemics.emitProject(
        source,
        &flow,
        current_memory,
    );
    assertEffectFree("agent epistemics emitProject", &flow, before_project_suspensions, before_project_returns);
    flow.setPhase(.agent_prompt_render);
    const before_prompt_suspensions = flow.suspensionSnapshot();
    const before_prompt_returns = flow.returnSnapshot();
    const prompt = Epistemics.emitPrompt(source, &flow, current_goal, view, Context);
    assertEffectFree("agent epistemics emitPrompt", &flow, before_prompt_suspensions, before_prompt_returns);
    flow.setPhase(.agent_skill_activation);
    const active_skills = activeSkills(source, Epistemics, &flow, current_memory, Context);
    flow.setPhase(.agent_tool_selection);
    const offered_actions = offeredActions(source, &flow, active_skills, Context);
    flow.setPhase(.agent_model_request);
    const before_model_suspensions = flow.suspensionSnapshot();
    const before_model_returns = flow.returnSnapshot();
    const model_index = Epistemics.emitModelIndex(
        source,
        &flow,
        current_memory,
        Context,
    );
    assertEffectFree("agent epistemics emitModelIndex", &flow, before_model_suspensions, before_model_returns);
    const messages = semanticMessages(
        source,
        Profile,
        &flow,
        prompt,
        active_skills,
        Context,
    );
    const tools = semanticTools(
        source,
        Profile,
        &flow,
        offered_actions,
        Context,
    );
    const selected_model = flow.vectorGetOrFail(
        flow.constant(Profile.ModelsType, Profile.models_index),
        model_index,
        flow.constant(Context.Failure, Context.invalid_index_failure_index),
    );
    const selection = flow.select(
        flow.integerGreaterEqual(
            flow.vectorLength(tools),
            flow.constant(u32, Context.one_u32_index),
        ),
        flow.constant(Profile.ToolSelectionPolicyType, Profile.selection_index),
        flow.constant(
            Profile.ToolSelectionPolicyType,
            Profile.optional_selection_index,
        ),
    );
    const model_request = flow.productConstruct(Profile.ModelInvocationType, .{
        flow.constant(Profile.ProtocolIdentityType, Profile.protocol_index),
        flow.productExtract(0, selected_model),
        flow.productExtract(1, selected_model),
        messages,
        tools,
        selection,
        flow.constant(Profile.ResponsePolicyType, Profile.response_policy_index),
        flow.constant(Profile.NormalizationLimitsType, Profile.normalization_limits_index),
        flow.constant(u32, Profile.maximum_response_bytes_index),
    });
    const model = flow.perform(
        Profile.SiteType,
        model_request,
        .{runtime_state},
    );
    flow.setPhase(.agent_model_resume);
    const response_path = flow.block(.segment, .{
        Profile.ModelResultType,
        RuntimeState,
    });
    const non_output = flow.block(.segment, .{Profile.ModelResultType});
    flow.branch(
        flow.sumTagIs(0, model.value),
        response_path,
        .{ model.value, model.carried[0] },
        non_output,
        .{model.value},
    );
    const non_output_value = flow.enter(non_output)[0];
    const refusal_failure = flow.block(.terminal_handoff, .{});
    const transport_or_later = flow.block(.segment, .{Profile.ModelResultType});
    flow.branch(
        flow.sumTagIs(1, non_output_value),
        refusal_failure,
        .{},
        transport_or_later,
        .{non_output_value},
    );
    _ = flow.enter(refusal_failure);
    flow.failValue(flow.constant(Context.Failure, Context.refusal_failure_index));
    const transport_value = flow.enter(transport_or_later)[0];
    const transport_failure = flow.block(.terminal_handoff, .{});
    const provider_or_unsupported = flow.block(.segment, .{
        Profile.ModelResultType,
    });
    flow.branch(
        flow.sumTagIs(2, transport_value),
        transport_failure,
        .{},
        provider_or_unsupported,
        .{transport_value},
    );
    _ = flow.enter(transport_failure);
    flow.failValue(flow.constant(Context.Failure, Context.transport_failure_index));
    const provider_value = flow.enter(provider_or_unsupported)[0];
    const provider_failure = flow.block(.terminal_handoff, .{Profile.ModelResultType});
    const unsupported_failure = flow.block(.terminal_handoff, .{});
    flow.branch(
        flow.sumTagIs(3, provider_value),
        provider_failure,
        .{provider_value},
        unsupported_failure,
        .{},
    );
    const provider_failure_value = flow.enter(provider_failure)[0];
    const provider_failure_payload = flow.sumExtractOrFail(
        3,
        provider_failure_value,
        flow.constant(Context.Failure, Context.malformed_failure_index),
    );
    flow.failValue(flow.select(
        flow.integerEqual(
            flow.enumToU32(flow.productExtract(0, provider_failure_payload)),
            flow.constant(u32, Context.zero_u32_index),
        ),
        flow.constant(Context.Failure, Context.http_failure_index),
        flow.constant(Context.Failure, Context.response_error_failure_index),
    ));
    _ = flow.enter(unsupported_failure);
    flow.failValue(flow.constant(Context.Failure, Context.unsupported_failure_index));
    const response_values = flow.enter(response_path);
    const output = flow.sumExtractOrFail(
        0,
        response_values[0],
        flow.constant(Context.Failure, Context.malformed_failure_index),
    );
    const call = selectedFunctionCall(Profile, &flow, output, Context);
    if (comptime source.actions.len == 0) {
        flow.failValue(flow.constant(source.Failure, Context.unknown_action_failure_index));
    } else {
        flow.setPhase(.agent_action_argument_decode);
        const selected = if (comptime ablate_action_argument_decode)
            typed_action_decode.emitNameOnly(
                &flow,
                Profile,
                source.Action,
                source.actions,
                call,
                Context,
            )
        else
            typed_action_decode.emit(
                &flow,
                Profile,
                source.Action,
                source.actions,
                call,
                Context,
            );
        flow.setPhase(.agent_action_admission);
        const resumed_memory = flow.productExtract(1, response_values[1]);
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
        const resumed_offered_mask = boolMask(
            source,
            &flow,
            resumed_offered_actions,
            Context,
        );
        const before_policy_suspensions = flow.suspensionSnapshot();
        const before_policy_returns = flow.returnSnapshot();
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
            .{ selected, response_values[1] },
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
                    const before_observe_suspensions = flow.suspensionSnapshot();
                    const before_observe_returns = flow.returnSnapshot();
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
                    const before_local_suspensions = flow.suspensionSnapshot();
                    const before_local_returns = flow.returnSnapshot();
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
                    const before_observe_suspensions = flow.suspensionSnapshot();
                    const before_observe_returns = flow.returnSnapshot();
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
                        const before_final_suspensions = flow.suspensionSnapshot();
                        const before_final_returns = flow.returnSnapshot();
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
    }
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
            .maximum_constructors = 256,
            .maximum_environment_fields = @min(128, control_ir.value_types.len),
            .maximum_invariant_terms = 128,
            .maximum_generated_operations = 32_768,
        };
        pub const maximum_image_bytes: usize = if (@hasField(
            @TypeOf(source.representation),
            "image_bytes",
        )) source.representation.image_bytes else 16 * 1024 * 1024;
    };
}

pub fn ReactBody(comptime source: anytype) type {
    return ReactBodyMode(source, false);
}

/// Tooling-only compiler path. It is not reachable through `agent.system`.
pub fn ReactBodyActionDecodeAblation(comptime source: anytype) type {
    return ReactBodyMode(source, true);
}
