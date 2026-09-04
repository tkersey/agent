const agent = @import("agent");
const boundary = @import("boundary");
const std = @import("std");

const Goal = boundary.Text(64);
const Activate = struct {};
const Result = struct { value: u32 };
const Action = union(enum) {
    activate_skill: Activate,
    finish: Result,
};
const Observation = union(enum) { skill_activated: bool };
const Failure = enum {
    arithmetic_overflow,
    capacity_exceeded,
    invalid_index,
    invalid_utf8,
    malformed,
    invalid_variant,
    incomplete,
    response_error,
    unsupported,
    multiple_calls,
    refusal,
    unknown_action,
    transport,
    http,
};

const ActivateSkill = struct {
    pub const Payload = Activate;
    pub const Observation = bool;

    pub fn emit(flow: anytype, _: anytype, comptime context: anytype) agent.Value(bool) {
        return flow.constant(bool, context.true_index);
    }
};

const actions = .{
    agent.action.local(
        .activate_skill,
        .skill_activated,
        ActivateSkill,
        .{
            .name = "activate_skill",
            .description = "Activate the closed completion skill.",
        },
    ),
    agent.action.final(.finish, .{
        .name = "finish",
        .description = "Return the result after local activation.",
    }),
};

const ActivationEpistemics = struct {
    pub fn MemoryType(comptime _: anytype) type {
        return bool;
    }
    pub fn DecisionViewType(comptime _: anytype) type {
        return bool;
    }
    pub fn schemaTypes(comptime _: anytype) @TypeOf(.{}) {
        return .{};
    }
    pub fn emitInitial(comptime _: anytype, flow: anytype, _: anytype, comptime context: anytype) agent.Value(bool) {
        return flow.constant(bool, context.false_index);
    }
    pub fn emitObserve(comptime _: anytype, flow: anytype, _: anytype, observation: anytype, comptime context: anytype) agent.Value(bool) {
        return flow.sumExtractOrFail(
            0,
            observation,
            flow.constant(Failure, context.invalid_variant_failure_index),
        );
    }
    pub fn emitProject(comptime _: anytype, flow: anytype, memory: anytype) agent.Value(bool) {
        return flow.copy(memory);
    }
    pub fn emitPrompt(comptime _: anytype, _: anytype, goal: anytype, _: anytype, comptime _: anytype) agent.Value(Goal) {
        return goal;
    }
    pub fn emitModelIndex(comptime _: anytype, flow: anytype, memory: anytype, comptime context: anytype) agent.Value(u32) {
        return flow.select(
            memory,
            flow.constant(u32, context.one_u32_index),
            flow.constant(u32, context.zero_u32_index),
        );
    }
    pub fn emitSkillActive(comptime _: anytype, _: anytype, memory: anytype, comptime skill_index: usize, comptime _: anytype) agent.Value(bool) {
        if (skill_index != 1) unreachable;
        return memory;
    }
    pub fn emitActionAllowed(comptime _: anytype, flow: anytype, _: anytype, _: anytype, comptime context: anytype) agent.Value(bool) {
        return flow.constant(bool, context.true_index);
    }
    pub fn emitFinalAllowed(comptime _: anytype, _: anytype, memory: anytype, _: anytype, comptime _: anytype) agent.Value(bool) {
        return memory;
    }
};

const System = agent.system(.{
    .name = "local-skill-activation-proof",
    .version = "3.0.0",
    .Goal = Goal,
    .Action = Action,
    .Observation = Observation,
    .Result = Result,
    .Failure = Failure,
    .models = .{ agent.model(.{
        .name = "primary",
        .protocol = agent.protocol.openaiResponsesV2.Profile,
        .model = "fixture-model-v1",
        .parameters = .{},
    }), agent.model(.{
        .name = "fallback",
        .protocol = agent.protocol.openaiResponsesV2.Profile,
        .model = "fallback-model-v2",
        .parameters = .{ .max_output_tokens = @as(u32, 321) },
    }) },
    .prompts = .{agent.prompt.literal(.{
        .role = .user,
        .content = "Activate the closed skill, then finish.",
    })},
    .skills = .{
        agent.skill(.{
            .id = "activation-control",
            .description = "Expose local activation.",
            .instructions = "Activate the completion skill first.",
            .role = .developer,
            .position = .before_user,
            .activation = .always,
            .actions = .{"activate_skill"},
        }),
        agent.skill(.{
            .id = "completion",
            .description = "Expose completion after activation.",
            .instructions = "Finish with the requested result.",
            .role = .developer,
            .position = .before_user,
            .activation = .explicit,
            .actions = .{"finish"},
        }),
    },
    .actions = actions,
    .strategy = agent.strategy.react(.{}),
    .epistemics = agent.epistemics.system(.{
        .semantic_identity = "agent.epistemics.local-activation-proof.v1",
        .implementation = ActivationEpistemics,
    }),
    .failures = .{
        .arithmetic_overflow = Failure.arithmetic_overflow,
        .capacity_exceeded = Failure.capacity_exceeded,
        .invalid_index = Failure.invalid_index,
        .invalid_utf8 = Failure.invalid_utf8,
        .malformed = Failure.malformed,
        .invalid_variant = Failure.invalid_variant,
        .incomplete = Failure.incomplete,
        .response_error = Failure.response_error,
        .unsupported = Failure.unsupported,
        .multiple_calls = Failure.multiple_calls,
        .refusal = Failure.refusal,
        .unknown_action = Failure.unknown_action,
        .transport = Failure.transport,
        .http = Failure.http,
    },
    .representation = .{
        .response_bytes = 1024,
        .image_bytes = 256 * 1024,
        .flow_limits = agent.FlowLimits{
            .maximum_functions = 16,
            .maximum_values = 4096,
            .maximum_blocks = 512,
            .maximum_instructions = 4096,
            .maximum_operands = 8192,
            .maximum_parameters = 4096,
            .maximum_requests = 32,
            .maximum_edge_arguments = 8192,
        },
        .schema_types = .{ Goal, Activate, Result, Action, Observation, Failure },
    },
});

test "local skill activation lowers without a residual host effect" {
    var effect_suspensions: usize = 0;
    for (System.Program.control_ir.blocks) |block| switch (block.terminator) {
        .@"suspend" => |suspension| if (suspension.kind == .effect) {
            try std.testing.expectEqual(@as(?u32, 0), suspension.site_id);
            effect_suspensions += 1;
        },
        else => {},
    };
    try std.testing.expectEqual(@as(usize, 1), effect_suspensions);
    const Image = System.Program.image();
    try std.testing.expect(std.mem.indexOf(u8, &Image.bytes, "fixture-model-v1") != null);
    try std.testing.expect(std.mem.indexOf(u8, &Image.bytes, "fallback-model-v2") != null);
    var workspace: boundary.image.ValidationWorkspace = .{};
    const validated = try boundary.image.validateImageView(&Image.bytes, &workspace);
    try std.testing.expectEqual(@as(u32, 1), validated.catalogs.effect_count);
}
