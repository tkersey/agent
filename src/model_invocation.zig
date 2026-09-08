//! Agent 4 semantic model effects. Values are constructed by authored BPI2;
//! the environment only marshals the declared provider protocol and normalizes.
const std = @import("std");
const contracts = @import("agent_contracts");
const codecs = @import("model_codec.zig");
const models = @import("model.zig");

pub const semantic_identity = "agent.model.invoke.v3";
pub const protocol_identity = "agent.model.protocol.openai-responses-v2";
pub const MessageRole = enum { system, developer, user, assistant };
pub const TruncationPolicy = enum { disabled };
pub const TransportFailure = enum { unavailable, denied, interrupted, response_too_large };
pub const ProviderFailureKind = enum { http_status, response_failed, response_incomplete };
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

/// Every capacity is an application's declared value representation policy.
/// These capacities are neither turn budgets nor limits on program lifetime.
pub const Limits = struct {
    model_id_bytes: u32,
    temperature_bytes: u32,
    maximum_messages: u32,
    message_bytes: u32,
    maximum_output_items: u32,
    call_id_bytes: u32,
    arguments_json_bytes: u32,
    result_text_bytes: u32,
    provider_response_bytes: u32,
};

pub const Selection = struct {
    minimum_calls: u32,
    maximum_calls: u32,
    parallel_calls: bool,
};
pub const ResponsePolicy = struct {
    store: bool,
    stream: bool,
    background: bool,
    truncation: TruncationPolicy,
};
pub const NormalizationLimits = struct {
    maximum_output_items: u32,
    maximum_call_id_bytes: u32,
    maximum_name_bytes: u32,
    maximum_arguments_bytes: u32,
    maximum_argument_name_bytes: u32,
    maximum_argument_fields: u32,
    maximum_result_text_bytes: u32,
};

fn checkDeclarations(comptime Answer: type, comptime declarations: anytype) void {
    const info = @typeInfo(Answer).@"union";
    if (declarations.len != info.fields.len)
        @compileError("Agent model requires one declaration per Answer variant");
    inline for (declarations, 0..) |declaration, index| {
        inline for (std.meta.fields(@TypeOf(declaration))) |field| {
            if (!std.mem.eql(u8, field.name, "name") and
                !std.mem.eql(u8, field.name, "description"))
                @compileError("Agent model declaration has unknown field '" ++ field.name ++ "'");
        }
        const name: []const u8 = declaration.name;
        if (name.len == 0 or name.len > 64)
            @compileError("Agent model declaration name must contain 1 through 64 bytes");
        for (name) |byte| if (!std.ascii.isAlphanumeric(byte) and byte != '_' and byte != '-')
            @compileError("Agent model declaration name must match [A-Za-z0-9_-]{1,64}");
        if (!std.unicode.utf8ValidateSlice(declaration.description))
            @compileError("Agent model declaration description must be UTF-8");
        inline for (declarations, 0..) |earlier, earlier_index| {
            if (earlier_index < index and std.mem.eql(u8, earlier.name, name))
                @compileError("Agent model declaration name is duplicated");
        }
    }
}

/// The union defines answer association; declarations supply its provider names.
/// An answer may propose an operation or answer an ordinary question. Neither
/// kind authorizes dispatch; the enclosing protected composition owns admission.
pub fn Profile(
    comptime Answer: type,
    comptime declarations: anytype,
    comptime limits: Limits,
) type {
    // Only descriptor derivation runs at comptime; application control does not.
    @setEvalBranchQuota(100_000);
    const CodecProfile = codecs.Profile(Answer);
    comptime checkDeclarations(Answer, declarations);
    comptime for (std.meta.fields(Limits)) |field| {
        if (@field(limits, field.name) == 0)
            @compileError("Agent model limit must be positive: " ++ field.name);
    };
    const maxima = comptime blk: {
        var name: usize = 1;
        var description: usize = 0;
        var schema: usize = 2;
        for (declarations, @typeInfo(Answer).@"union".fields) |declaration, variant| {
            name = @max(name, declaration.name.len);
            description = @max(description, declaration.description.len);
            schema = @max(schema, codecs.json.ToolSchema(variant.type).value.len);
            if (limits.arguments_json_bytes <
                codecs.json.maximumToolArgumentsByteLength(variant.type))
                @compileError("Agent model arguments_json_bytes cannot represent every admitted answer");
        }
        break :blk .{ .name = name, .description = description, .schema = schema };
    };
    return struct {
        const Self = @This();
        pub const AnswerType = Answer;
        pub const Interpretation = @import("model_interpretation.zig").Result(Answer);
        pub const BatchInterpretation = @import("model_interpretation.zig").Result([]const Answer);
        pub const InterpretationFailure = @import("model_interpretation.zig").Failure;
        pub const representation = limits;
        pub const declaration_count = declarations.len;
        pub const ArgumentCodec = CodecProfile.Codec;
        pub const DecodedAnswer = CodecProfile.Decoded;
        pub const ModelId = contracts.Text(limits.model_id_bytes);
        pub const Temperature = contracts.Text(limits.temperature_bytes);
        pub const MessageText = contracts.Text(limits.message_bytes);
        pub const ProtocolIdentity = contracts.Text(protocol_identity.len);
        pub const ToolName = contracts.Text(maxima.name);
        pub const ToolDescription = contracts.Text(maxima.description);
        pub const ToolSchema = contracts.Bytes(maxima.schema);
        pub const ArgumentsJson = contracts.Bytes(limits.arguments_json_bytes);
        pub const ResultText = contracts.Text(limits.result_text_bytes);
        pub const CallId = contracts.Text(limits.call_id_bytes);
        pub const ReasoningConfig = struct {
            effort: ?models.ReasoningEffort,
            summary: ?models.ReasoningSummary,
        };
        pub const ModelParameters = struct {
            max_output_tokens: ?u32,
            temperature: ?Temperature,
            reasoning: ?ReasoningConfig,
        };
        pub const Message = struct { role: MessageRole, content: MessageText };
        pub const Messages = contracts.Vector(Message, limits.maximum_messages);
        pub const ToolDeclaration = struct {
            action_ordinal: u32,
            action_tag: u32,
            name: ToolName,
            description: ToolDescription,
            input_schema_json: ToolSchema,
            strict: bool,
            argument_codec: ArgumentCodec,
        };
        pub const Tools = contracts.Vector(ToolDeclaration, declarations.len);
        /// Ordered product fields are the v3 application contract.
        pub const Request = struct {
            protocol: ProtocolIdentity,
            model: ModelId,
            parameters: ModelParameters,
            messages: Messages,
            tools: Tools,
            selection: Selection,
            response_policy: ResponsePolicy,
            normalization_limits: NormalizationLimits,
            maximum_provider_response_bytes: u32,
        };
        pub const FunctionCall = struct {
            call_id: CallId,
            name: ToolName,
            arguments_json: ArgumentsJson,
            tool_ordinal_claim: u32,
            decoded_action: DecodedAnswer,
        };
        pub const OutputItem = union(enum) {
            function_call: FunctionCall,
            message: struct { role: MessageRole, content: ResultText },
            reasoning: struct { summary: ResultText },
        };
        pub const OutputItems = contracts.Vector(OutputItem, limits.maximum_output_items);
        pub const Output = struct {
            items: OutputItems,
            normalized_output_digest: [32]u8,
        };
        /// Sum ordinals are fixed in this order. Nested enums retain explicit u32 tags.
        pub const Result = union(enum) {
            output: Output,
            refusal: ResultText,
            transport_failure: TransportFailure,
            provider_failure: struct { kind: ProviderFailureKind, http_status: u16 },
            unsupported_response: UnsupportedResponse,
        };

        pub fn allDeclarations() Tools {
            const items = comptime blk: {
                var result: [declarations.len]ToolDeclaration = undefined;
                const info = @typeInfo(Answer).@"union";
                for (declarations, info.fields, 0..) |descriptor, variant, index| {
                    result[index] = .{
                        .action_ordinal = @intCast(index),
                        .action_tag = @intCast(@intFromEnum(@field(info.tag_type.?, variant.name))),
                        .name = .{ .bytes = descriptor.name },
                        .description = .{ .bytes = descriptor.description },
                        .input_schema_json = .{ .bytes = &codecs.json.ToolSchema(variant.type).value },
                        .strict = true,
                        .argument_codec = CodecProfile.value(index),
                    };
                }
                break :blk result;
            };
            return .{ .items = &items };
        }

        /// Stage immutable fields separately so equal schemas/codecs/descriptions
        /// share canonical constants across distinct model-visible declarations.
        pub fn declarationValue(builder: anytype, index: usize) !u64 {
            if (index >= declarations.len) return error.InvalidDeclarationIndex;
            const slot = try builder.specialization(u64, "agent.model.declaration/v3", .{
                @typeName(Self), index,
            });
            if (slot.cached) |cached| return cached;
            const declaration = allDeclarations().items[index];
            const fields = @typeInfo(ToolDeclaration).@"struct".fields;
            var values: [fields.len]u64 = undefined;
            inline for (fields, 0..) |field, field_index| {
                values[field_index] = try builder.literal(.{
                    .schema = try contracts.schema(field.type, builder),
                    .bytes = try contracts.encodeOwned(field.type, builder.allocator(), @field(declaration, field.name)),
                });
            }
            const product = try builder.primitive(try contracts.schema(ToolDeclaration, builder), .product, &values, 0);
            return slot.finish(builder, product);
        }

        /// The returned slice belongs to allocator; nested metadata is immutable.
        pub fn declarationsValue(
            allocator: std.mem.Allocator,
            offered: [declarations.len]bool,
        ) !Tools {
            var count: usize = 0;
            for (offered) |present| if (present) {
                count += 1;
            };
            const items = try allocator.alloc(ToolDeclaration, count);
            var next: usize = 0;
            for (offered, allDeclarations().items) |present, declaration| if (present) {
                items[next] = declaration;
                next += 1;
            };
            return .{ .items = items };
        }

        pub fn parametersValue(comptime Model: type) ModelParameters {
            comptime {
                if (!models.isAdmitted(Model)) @compileError("Agent model must use agent.model");
                if (!std.mem.eql(u8, Model.protocol.semantic_identity, protocol_identity))
                    @compileError("Agent model profile uses an unsupported provider protocol");
                if (Model.model_id.len > limits.model_id_bytes)
                    @compileError("Agent model identifier exceeds model_id_bytes");
            }
            const parameters = Model.parameters;
            const has = @TypeOf(parameters) != void;
            const temperature: ?[]const u8 = if (has and @hasField(@TypeOf(parameters), "temperature"))
                parameters.temperature
            else
                null;
            if (temperature != null and temperature.?.len > limits.temperature_bytes)
                @compileError("Agent model temperature exceeds temperature_bytes");
            return .{
                .max_output_tokens = if (has and @hasField(@TypeOf(parameters), "max_output_tokens"))
                    parameters.max_output_tokens
                else
                    null,
                .temperature = if (temperature) |value| .{ .bytes = value } else null,
                .reasoning = if (has and @hasField(@TypeOf(parameters), "reasoning")) .{
                    .effort = if (@hasField(@TypeOf(parameters.reasoning), "effort"))
                        parameters.reasoning.effort
                    else
                        null,
                    .summary = if (@hasField(@TypeOf(parameters.reasoning), "summary"))
                        parameters.reasoning.summary
                    else
                        null,
                } else null,
            };
        }

        pub fn normalizationLimits() NormalizationLimits {
            return .{
                .maximum_output_items = limits.maximum_output_items,
                .maximum_call_id_bytes = limits.call_id_bytes,
                .maximum_name_bytes = maxima.name,
                .maximum_arguments_bytes = limits.arguments_json_bytes,
                .maximum_argument_name_bytes = @intCast(CodecProfile.FieldName.max_length.?),
                .maximum_argument_fields = @intCast(ArgumentCodec.max_length),
                .maximum_result_text_bytes = limits.result_text_bytes,
            };
        }

        /// Authoring convenience. Dynamic prompt and offer construction uses the
        /// same public product/vector terms inside the emitted computation.
        pub fn invocationValue(
            allocator: std.mem.Allocator,
            comptime Model: type,
            messages: Messages,
            offered: [declarations.len]bool,
            selection: Selection,
        ) !Request {
            var request = try templateValue(Model, messages, selection);
            request.tools = try declarationsValue(allocator, offered);
            return request;
        }

        /// Configuration for the checked responder. Its tools are emitted from
        /// the captured offered set, so the template contains no catalog copy.
        pub fn templateValue(
            comptime Model: type,
            messages: Messages,
            selection: Selection,
        ) !Request {
            if (selection.minimum_calls > selection.maximum_calls or
                selection.maximum_calls > limits.maximum_output_items)
                return error.InvalidSelection;
            return .{
                .protocol = .{ .bytes = protocol_identity },
                .model = .{ .bytes = Model.model_id },
                .parameters = parametersValue(Model),
                .messages = messages,
                .tools = .{ .items = &.{} },
                .selection = selection,
                .response_policy = .{
                    .store = false,
                    .stream = false,
                    .background = false,
                    .truncation = .disabled,
                },
                .normalization_limits = normalizationLimits(),
                .maximum_provider_response_bytes = limits.provider_response_bytes,
            };
        }

        /// A shared ordinary external effect declaration, without a native handler.
        pub fn declare(builder: anytype) !u64 {
            const payload = try contracts.schema(Request, builder);
            const result = try contracts.schema(Result, builder);
            const slot = try builder.specialization(u64, semantic_identity, .{ payload, result });
            if (slot.cached) |cached| return cached;
            const effect = try builder.effect(.{
                .identity = semantic_identity,
                .payload = payload,
                .result = result,
            });
            return slot.finish(builder, effect);
        }

        /// Checks the single-answer policy, normalized call association, concrete
        /// variant and request-time offered set. Returns candidate data only.
        pub fn interpreter(builder: anytype) !u64 {
            return @import("model_interpretation.zig").define(Self, builder);
        }

        /// Preserves all admitted candidate calls in their original order.
        /// Candidate count cannot exceed the bounded incoming OutputItems count.
        pub fn interpretAll(builder: anytype) !u64 {
            return @import("model_interpretation.zig").defineAll(Self, builder);
        }
    };
}

/// A question's synthetic answer declaration has no associated executable tool.
pub fn Question(
    comptime Value: type,
    comptime name: []const u8,
    comptime description: []const u8,
    comptime limits: Limits,
) type {
    const Payload = if (@typeInfo(Value) == .@"enum" or
        (@typeInfo(Value) == .@"struct" and !codecs.json.isText(Value)))
        Value
    else
        struct { value: Value };
    const Answer = union(enum) { answer: Payload };
    return Profile(Answer, .{.{ .name = name, .description = description }}, limits);
}
