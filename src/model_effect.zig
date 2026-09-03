const action_profile = @import("typed_action_profile.zig");
const boundary = @import("boundary");
const json = @import("json.zig");
const model = @import("model.zig");
const openai_responses_v2 = @import("protocol/openai_responses_v2.zig");
const std = @import("std");

pub const semantic_identity = "agent.model.invoke.v2";
pub const openai_responses_protocol_identity =
    openai_responses_v2.protocol_identity;

pub const MessageRole = enum {
    system,
    developer,
    user,
    assistant,
};

pub const TruncationPolicy = enum { disabled };

pub const TransportFailure = enum {
    unavailable,
    denied,
    interrupted,
    response_too_large,
};

pub const ProviderFailureKind = enum {
    http_status,
    response_failed,
    response_incomplete,
};

pub const UnsupportedResponse = enum {
    unsupported_protocol,
    unsupported_parameter,
    malformed_json,
    invalid_utf8,
    unsupported_status,
    unsupported_output_item,
    mixed_refusal,
    normalization_limit,
};

fn maximumModelIdLength(comptime models: anytype) usize {
    var maximum: usize = 1;
    inline for (models) |Model| maximum = @max(maximum, Model.model_id.len);
    return maximum;
}

fn maximumTemperatureLength(comptime models: anytype) usize {
    var maximum: usize = 1;
    inline for (models) |Model| {
        if (@TypeOf(Model.parameters) != void and
            @hasField(@TypeOf(Model.parameters), "temperature"))
        {
            maximum = @max(maximum, Model.parameters.temperature.len);
        }
    }
    return maximum;
}

fn skillMessage(comptime Skill: type) []const u8 {
    return std.fmt.comptimePrint(
        "Skill {s}\n{s}\n{s}",
        .{ Skill.id, Skill.description, Skill.instructions },
    );
}

fn maximumMessageLength(
    comptime Prompt: type,
    comptime prompts: anytype,
    comptime skills: anytype,
) usize {
    var maximum = Prompt.maximum_length;
    inline for (prompts) |AuthoredPrompt| {
        maximum = @max(maximum, AuthoredPrompt.content.len);
    }
    inline for (skills) |Skill| {
        maximum = @max(maximum, skillMessage(Skill).len);
    }
    return maximum;
}

fn maximumActionNameLength(comptime actions: anytype) usize {
    var maximum: usize = 1;
    inline for (actions) |Descriptor| maximum = @max(maximum, Descriptor.name.len);
    return maximum;
}

fn maximumActionDescriptionLength(comptime actions: anytype) usize {
    var maximum: usize = 1;
    inline for (actions) |Descriptor| {
        maximum = @max(maximum, Descriptor.description.len);
    }
    return maximum;
}

fn actionPayload(comptime Action: type, comptime index: usize) type {
    return @typeInfo(Action).@"union".fields[index].type;
}

fn actionTag(comptime Action: type, comptime index: usize) u32 {
    const info = @typeInfo(Action).@"union";
    const Tag = info.tag_type.?;
    return @intCast(@intFromEnum(@field(Tag, info.fields[index].name)));
}

fn maximumToolSchemaLength(
    comptime Action: type,
    comptime actions: anytype,
) usize {
    var maximum: usize = 2;
    inline for (actions, 0..) |_, index| {
        maximum = @max(maximum, json.ToolSchema(actionPayload(Action, index)).value.len);
    }
    return maximum;
}

fn maximumArgumentsJsonLength(comptime Action: type) usize {
    var maximum: usize = 2;
    inline for (@typeInfo(Action).@"union".fields) |field| {
        maximum = @max(
            maximum,
            json.maximumToolArgumentsByteLength(field.type),
        );
    }
    return maximum;
}

fn messageRole(comptime role: anytype) MessageRole {
    return switch (role) {
        .system => .system,
        .developer => .developer,
        .user => .user,
    };
}

pub fn Profile(comptime source: anytype, comptime Prompt: type) type {
    if (comptime !boundary.schema.isTextType(Prompt)) {
        @compileError("Agent semantic model invocation requires a Text prompt");
    }
    const minimum_arguments_json_bytes = maximumArgumentsJsonLength(source.Action);
    const maximum_arguments_json_bytes = if (@hasField(
        @TypeOf(source.representation),
        "maximum_arguments_json_bytes",
    )) source.representation.maximum_arguments_json_bytes else source.representation.response_bytes;
    if (maximum_arguments_json_bytes < minimum_arguments_json_bytes) {
        @compileError(std.fmt.comptimePrint(
            "Agent maximum_arguments_json_bytes must be at least {d} bytes for admitted Action JSON",
            .{minimum_arguments_json_bytes},
        ));
    }
    const maximum_provider_response_bytes = if (@hasField(
        @TypeOf(source.representation),
        "maximum_provider_response_bytes",
    )) source.representation.maximum_provider_response_bytes else source.representation.response_bytes + 4096;
    if (maximum_provider_response_bytes == 0 or
        maximum_provider_response_bytes > std.math.maxInt(u32))
    {
        @compileError("Agent maximum_provider_response_bytes must fit positive u32");
    }
    const ModelId = boundary.Text(maximumModelIdLength(source.models));
    const ProtocolIdentity = boundary.Text(
        openai_responses_protocol_identity.len,
    );
    const Temperature = boundary.Text(maximumTemperatureLength(source.models));
    const MessageText = boundary.Text(maximumMessageLength(
        Prompt,
        source.prompts,
        source.skills,
    ));
    const ToolName = boundary.Text(maximumActionNameLength(source.actions));
    const ToolDescription = boundary.Text(maximumActionDescriptionLength(
        source.actions,
    ));
    const ToolSchema = boundary.Bytes(maximumToolSchemaLength(
        source.Action,
        source.actions,
    ));
    const ArgumentsJson = boundary.Bytes(maximum_arguments_json_bytes);
    const ResultText = boundary.Text(source.representation.response_bytes);
    const CallId = boundary.Text(256);

    const ReasoningConfig = struct {
        effort: ?model.ReasoningEffort,
        summary: ?model.ReasoningSummary,
    };
    const ModelParameters = struct {
        max_output_tokens: ?u32,
        temperature: ?Temperature,
        reasoning: ?ReasoningConfig,
    };
    const ModelChoice = struct {
        id: ModelId,
        parameters: ModelParameters,
    };
    const Models = boundary.Vector(ModelChoice, source.models.len);

    const Message = struct {
        role: MessageRole,
        content: MessageText,
    };
    const Messages = boundary.Vector(
        Message,
        source.prompts.len + source.skills.len + 1,
    );
    const PromptMessages = boundary.Vector(Message, source.prompts.len);
    const SkillMessages = boundary.Vector(Message, source.skills.len);

    const ActionProfile = action_profile.Profile(
        source.Failure,
        source.Action,
        source.failures,
    );
    const ArgumentFieldName = ActionProfile.FieldNameType;
    const ArgumentFieldKind = ActionProfile.FieldKindType;
    const ArgumentFieldContract = ActionProfile.FieldContractType;
    const ArgumentCodec = ActionProfile.ArgumentCodecType;
    const ArgumentDecodeFailure = ActionProfile.DecodeFailureType;
    const DecodedAction = ActionProfile.DecodedActionType;

    const ToolDeclaration = struct {
        action_ordinal: u32,
        action_tag: u32,
        name: ToolName,
        description: ToolDescription,
        input_schema_json: ToolSchema,
        strict: bool,
        argument_codec: ArgumentCodec,
    };
    const Tools = boundary.Vector(ToolDeclaration, source.actions.len);

    const ToolSelectionPolicy = struct {
        minimum_calls: u32,
        maximum_calls: u32,
        parallel_calls: bool,
    };
    const ResponsePolicy = struct {
        store: bool,
        stream: bool,
        background: bool,
        truncation: TruncationPolicy,
    };
    const NormalizationLimits = struct {
        maximum_output_items: u32,
        maximum_call_id_bytes: u32,
        maximum_name_bytes: u32,
        maximum_arguments_bytes: u32,
        maximum_argument_name_bytes: u32,
        maximum_argument_fields: u32,
        maximum_result_text_bytes: u32,
    };
    const ModelInvocation = struct {
        protocol: ProtocolIdentity,
        model: ModelId,
        parameters: ModelParameters,
        messages: Messages,
        tools: Tools,
        selection: ToolSelectionPolicy,
        response_policy: ResponsePolicy,
        normalization_limits: NormalizationLimits,
        maximum_provider_response_bytes: u32,
    };

    const FunctionCall = struct {
        call_id: CallId,
        name: ToolName,
        arguments_json: ArgumentsJson,
        tool_ordinal_claim: u32,
        decoded_action: DecodedAction,
    };
    const OutputMessage = struct {
        role: MessageRole,
        content: ResultText,
    };
    const ReasoningOutput = struct { summary: ResultText };
    const OutputItem = union(enum) {
        function_call: FunctionCall,
        message: OutputMessage,
        reasoning: ReasoningOutput,
    };
    const OutputItems = boundary.Vector(OutputItem, 32);
    const ModelOutput = struct {
        items: OutputItems,
        normalized_output_digest: [32]u8,
    };
    const ProviderFailure = struct {
        kind: ProviderFailureKind,
        http_status: u16,
    };
    const ModelResult = union(enum) {
        output: ModelOutput,
        refusal: ResultText,
        transport_failure: TransportFailure,
        provider_failure: ProviderFailure,
        unsupported_response: UnsupportedResponse,
    };
    const Site = boundary.effect.site(
        0,
        semantic_identity,
        ModelInvocation,
        ModelResult,
    );

    return struct {
        pub const ModelIdType = ModelId;
        pub const ProtocolIdentityType = ProtocolIdentity;
        pub const TemperatureType = Temperature;
        pub const MessageTextType = MessageText;
        pub const ToolNameType = ToolName;
        pub const ToolDescriptionType = ToolDescription;
        pub const ToolSchemaType = ToolSchema;
        pub const ArgumentsJsonType = ArgumentsJson;
        pub const ResultTextType = ResultText;
        pub const CallIdType = CallId;
        pub const ReasoningConfigType = ReasoningConfig;
        pub const ModelParametersType = ModelParameters;
        pub const ModelChoiceType = ModelChoice;
        pub const ModelsType = Models;
        pub const MessageType = Message;
        pub const MessagesType = Messages;
        pub const PromptMessagesType = PromptMessages;
        pub const SkillMessagesType = SkillMessages;
        pub const ToolDeclarationType = ToolDeclaration;
        pub const ToolsType = Tools;
        pub const ArgumentFieldNameType = ArgumentFieldName;
        pub const ArgumentFieldKindType = ArgumentFieldKind;
        pub const ArgumentFieldContractType = ArgumentFieldContract;
        pub const ArgumentCodecType = ArgumentCodec;
        pub const ArgumentDecodeFailureType = ArgumentDecodeFailure;
        pub const DecodedActionType = DecodedAction;
        pub const ToolSelectionPolicyType = ToolSelectionPolicy;
        pub const ResponsePolicyType = ResponsePolicy;
        pub const NormalizationLimitsType = NormalizationLimits;
        pub const ModelInvocationType = ModelInvocation;
        pub const FunctionCallType = FunctionCall;
        pub const OutputMessageType = OutputMessage;
        pub const ReasoningOutputType = ReasoningOutput;
        pub const OutputItemType = OutputItem;
        pub const OutputItemsType = OutputItems;
        pub const ModelOutputType = ModelOutput;
        pub const ProviderFailureType = ProviderFailure;
        pub const ModelResultType = ModelResult;
        pub const SiteType = Site;
        pub const ActionProfileType = ActionProfile;
        pub const ActionContext = ActionProfile.Context;

        pub fn schemaTypes() @TypeOf(
            ActionProfile.schemaTypes() ++ .{
                ModelId,
                ProtocolIdentity,
                Temperature,
                MessageText,
                ToolName,
                ToolDescription,
                ToolSchema,
                ArgumentsJson,
                ResultText,
                CallId,
                MessageRole,
                model.ReasoningEffort,
                model.ReasoningSummary,
                TruncationPolicy,
                TransportFailure,
                ProviderFailureKind,
                UnsupportedResponse,
                ReasoningConfig,
                ModelParameters,
                ModelChoice,
                Models,
                Message,
                Messages,
                PromptMessages,
                SkillMessages,
                ToolDeclaration,
                Tools,
                ToolSelectionPolicy,
                ResponsePolicy,
                NormalizationLimits,
                ModelInvocation,
                FunctionCall,
                OutputMessage,
                ReasoningOutput,
                OutputItem,
                OutputItems,
                ModelOutput,
                ProviderFailure,
                ModelResult,
            },
        ) {
            return ActionProfile.schemaTypes() ++ .{
                ModelId,
                ProtocolIdentity,
                Temperature,
                MessageText,
                ToolName,
                ToolDescription,
                ToolSchema,
                ArgumentsJson,
                ResultText,
                CallId,
                MessageRole,
                model.ReasoningEffort,
                model.ReasoningSummary,
                TruncationPolicy,
                TransportFailure,
                ProviderFailureKind,
                UnsupportedResponse,
                ReasoningConfig,
                ModelParameters,
                ModelChoice,
                Models,
                Message,
                Messages,
                PromptMessages,
                SkillMessages,
                ToolDeclaration,
                Tools,
                ToolSelectionPolicy,
                ResponsePolicy,
                NormalizationLimits,
                ModelInvocation,
                FunctionCall,
                OutputMessage,
                ReasoningOutput,
                OutputItem,
                OutputItems,
                ModelOutput,
                ProviderFailure,
                ModelResult,
            };
        }

        fn parametersValue(comptime Model: type) ModelParameters {
            const parameters = Model.parameters;
            const maximum_tokens: ?u32 = if (@TypeOf(parameters) != void and
                @hasField(@TypeOf(parameters), "max_output_tokens"))
                parameters.max_output_tokens
            else
                null;
            const temperature: ?Temperature = if (@TypeOf(parameters) != void and
                @hasField(@TypeOf(parameters), "temperature"))
                Temperature.fromSlice(parameters.temperature) catch unreachable
            else
                null;
            const reasoning: ?ReasoningConfig = if (@TypeOf(parameters) != void and
                @hasField(@TypeOf(parameters), "reasoning"))
                .{
                    .effort = if (@hasField(
                        @TypeOf(parameters.reasoning),
                        "effort",
                    )) parameters.reasoning.effort else null,
                    .summary = if (@hasField(
                        @TypeOf(parameters.reasoning),
                        "summary",
                    )) parameters.reasoning.summary else null,
                }
            else
                null;
            return .{
                .max_output_tokens = maximum_tokens,
                .temperature = temperature,
                .reasoning = reasoning,
            };
        }

        fn modelsValue() Models {
            var result = Models.empty();
            inline for (source.models) |Model| {
                result.push(.{
                    .id = ModelId.fromSlice(Model.model_id) catch unreachable,
                    .parameters = parametersValue(Model),
                }) catch unreachable;
            }
            return result;
        }

        fn promptsValue() PromptMessages {
            var result = PromptMessages.empty();
            inline for (source.prompts) |AuthoredPrompt| {
                result.push(.{
                    .role = messageRole(AuthoredPrompt.prompt_role),
                    .content = MessageText.fromSlice(
                        AuthoredPrompt.content,
                    ) catch unreachable,
                }) catch unreachable;
            }
            return result;
        }

        fn skillsValue() SkillMessages {
            var result = SkillMessages.empty();
            inline for (source.skills) |Skill| {
                result.push(.{
                    .role = messageRole(Skill.role),
                    .content = MessageText.fromSlice(
                        skillMessage(Skill),
                    ) catch unreachable,
                }) catch unreachable;
            }
            return result;
        }

        fn toolDeclarationsValue() Tools {
            var result = Tools.empty();
            inline for (source.actions, 0..) |Descriptor, index| {
                result.push(.{
                    .action_ordinal = @intCast(index),
                    .action_tag = actionTag(source.Action, index),
                    .name = ToolName.fromSlice(Descriptor.name) catch unreachable,
                    .description = ToolDescription.fromSlice(
                        Descriptor.description,
                    ) catch unreachable,
                    .input_schema_json = ToolSchema.fromSlice(
                        &json.ToolSchema(actionPayload(source.Action, index)).value,
                    ) catch unreachable,
                    .strict = true,
                    .argument_codec = ActionProfile.codecValue(index),
                }) catch unreachable;
            }
            return result;
        }

        fn requiredSelectionValue() ToolSelectionPolicy {
            return .{
                .minimum_calls = 1,
                .maximum_calls = 1,
                .parallel_calls = false,
            };
        }

        fn optionalSelectionValue() ToolSelectionPolicy {
            return .{
                .minimum_calls = 0,
                .maximum_calls = 1,
                .parallel_calls = false,
            };
        }

        pub fn constantValues() @TypeOf(
            ActionProfile.constantValues() ++ .{
                ProtocolIdentity.fromSlice(
                    openai_responses_protocol_identity,
                ) catch unreachable,
                modelsValue(),
                promptsValue(),
                skillsValue(),
                toolDeclarationsValue(),
                requiredSelectionValue(),
                optionalSelectionValue(),
                ResponsePolicy{
                    .store = false,
                    .stream = false,
                    .background = false,
                    .truncation = .disabled,
                },
                NormalizationLimits{
                    .maximum_output_items = 32,
                    .maximum_call_id_bytes = CallId.maximum_length,
                    .maximum_name_bytes = ToolName.maximum_length,
                    .maximum_arguments_bytes = ArgumentsJson.maximum_length,
                    .maximum_argument_name_bytes = ArgumentFieldName.maximum_length,
                    .maximum_argument_fields = ArgumentCodec.maximum_length,
                    .maximum_result_text_bytes = ResultText.maximum_length,
                },
                @as(u32, maximum_provider_response_bytes),
                MessageRole.user,
            },
        ) {
            const Result = @TypeOf(ActionProfile.constantValues() ++ .{
                ProtocolIdentity.fromSlice(
                    openai_responses_protocol_identity,
                ) catch unreachable,
                modelsValue(),
                promptsValue(),
                skillsValue(),
                toolDeclarationsValue(),
                requiredSelectionValue(),
                optionalSelectionValue(),
                ResponsePolicy{
                    .store = false,
                    .stream = false,
                    .background = false,
                    .truncation = .disabled,
                },
                NormalizationLimits{
                    .maximum_output_items = 32,
                    .maximum_call_id_bytes = CallId.maximum_length,
                    .maximum_name_bytes = ToolName.maximum_length,
                    .maximum_arguments_bytes = ArgumentsJson.maximum_length,
                    .maximum_argument_name_bytes = ArgumentFieldName.maximum_length,
                    .maximum_argument_fields = ArgumentCodec.maximum_length,
                    .maximum_result_text_bytes = ResultText.maximum_length,
                },
                @as(u32, maximum_provider_response_bytes),
                MessageRole.user,
            });
            var result: Result = undefined;
            comptime var next: usize = 0;
            inline for (ActionProfile.constantValues()) |value| {
                result[next] = value;
                next += 1;
            }
            inline for (.{
                ProtocolIdentity.fromSlice(
                    openai_responses_protocol_identity,
                ) catch unreachable,
                modelsValue(),
                promptsValue(),
                skillsValue(),
                toolDeclarationsValue(),
                requiredSelectionValue(),
                optionalSelectionValue(),
                ResponsePolicy{
                    .store = false,
                    .stream = false,
                    .background = false,
                    .truncation = .disabled,
                },
                NormalizationLimits{
                    .maximum_output_items = 32,
                    .maximum_call_id_bytes = CallId.maximum_length,
                    .maximum_name_bytes = ToolName.maximum_length,
                    .maximum_arguments_bytes = ArgumentsJson.maximum_length,
                    .maximum_argument_name_bytes = ArgumentFieldName.maximum_length,
                    .maximum_argument_fields = ArgumentCodec.maximum_length,
                    .maximum_result_text_bytes = ResultText.maximum_length,
                },
                @as(u32, maximum_provider_response_bytes),
                MessageRole.user,
            }) |value| {
                result[next] = value;
                next += 1;
            }
            return result;
        }

        const semantic_start: u16 = ActionProfile.constant_count;
        pub const protocol_index: u16 = semantic_start;
        pub const models_index: u16 = semantic_start + 1;
        pub const prompts_index: u16 = semantic_start + 2;
        pub const skills_index: u16 = semantic_start + 3;
        pub const tool_declarations_index: u16 = semantic_start + 4;
        pub const selection_index: u16 = semantic_start + 5;
        pub const optional_selection_index: u16 = semantic_start + 6;
        pub const response_policy_index: u16 = semantic_start + 7;
        pub const normalization_limits_index: u16 = semantic_start + 8;
        pub const maximum_response_bytes_index: u16 = semantic_start + 9;
        pub const user_role_index: u16 = semantic_start + 10;
    };
}
