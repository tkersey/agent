const agent = @import("agent");
const boundary = @import("boundary");

pub const Goal = boundary.Text(32);
pub const Result = struct { value: u8 };
pub const Failure = enum {
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
pub const Action = union(enum) { done: Result };
pub const Observation = union(enum) { noop: void };

pub const failures = .{
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
};

pub fn System(comptime representation_config: anytype, comptime Epistemics: type) type {
    return SystemWithFailures(representation_config, Epistemics, failures);
}

pub fn SystemWithFailures(
    comptime representation_config: anytype,
    comptime Epistemics: type,
    comptime failure_mapping: anytype,
) type {
    return agent.system(.{
        .name = "invalid-react-system",
        .version = "3.0.0",
        .Goal = Goal,
        .Action = Action,
        .Observation = Observation,
        .Result = Result,
        .Failure = Failure,
        .models = .{agent.model(.{
            .name = "primary",
            .protocol = agent.protocol.openaiResponsesV2.Profile,
            .model = "fixture-model",
            .parameters = .{},
        })},
        .prompts = .{agent.prompt.literal(.{
            .role = .system,
            .content = "Finish.",
        })},
        .skills = .{},
        .actions = .{agent.action.final(.done, .{
            .name = "done",
            .description = "Return.",
        })},
        .strategy = agent.strategy.react(.{}),
        .epistemics = Epistemics,
        .failures = failure_mapping,
        .representation = representation_config,
    });
}

pub fn representation() @TypeOf(.{
    .response_bytes = @as(u32, 1024),
    .maximum_provider_response_bytes = @as(u32, 8192),
    .image_bytes = @as(u32, 256 * 1024),
    .schema_types = .{ Goal, Result, Action, Observation, Failure },
}) {
    return .{
        .response_bytes = 1024,
        .maximum_provider_response_bytes = 8192,
        .image_bytes = 256 * 1024,
        .schema_types = .{ Goal, Result, Action, Observation, Failure },
    };
}

pub const Stateless = agent.epistemics.systemStateless(.{});

pub const WrongPrompt = agent.epistemics.system(.{
    .semantic_identity = "fixture.wrong-prompt.v1",
    .implementation = struct {
        pub fn MemoryType(comptime _: anytype) type {
            return bool;
        }
        pub fn DecisionViewType(comptime _: anytype) type {
            return bool;
        }
        pub fn PromptType(comptime _: anytype) type {
            return boundary.Text(1);
        }
        pub fn schemaTypes(comptime _: anytype) @TypeOf(.{}) {
            return .{};
        }
        pub fn emitInitial(comptime _: anytype, flow: anytype, _: anytype, comptime context: anytype) agent.Value(bool) {
            return flow.constant(bool, context.false_index);
        }
        pub fn emitObserve(comptime _: anytype, flow: anytype, memory: anytype, _: anytype, comptime _: anytype) agent.Value(bool) {
            return flow.copy(memory);
        }
        pub fn emitProject(comptime _: anytype, flow: anytype, memory: anytype) agent.Value(bool) {
            return flow.copy(memory);
        }
        pub fn emitPrompt(comptime _: anytype, _: anytype, goal: anytype, _: anytype, comptime _: anytype) agent.Value(Goal) {
            return goal;
        }
        pub fn emitSkillActive(comptime _: anytype, flow: anytype, _: anytype, comptime _: usize, comptime context: anytype) agent.Value(bool) {
            return flow.constant(bool, context.false_index);
        }
        pub fn emitActionAllowed(comptime _: anytype, flow: anytype, _: anytype, _: anytype, comptime context: anytype) agent.Value(bool) {
            return flow.constant(bool, context.true_index);
        }
        pub fn emitFinalAllowed(comptime _: anytype, flow: anytype, _: anytype, _: anytype, comptime context: anytype) agent.Value(bool) {
            return flow.constant(bool, context.true_index);
        }
    },
});

pub const MutatingFlow = agent.epistemics.system(.{
    .semantic_identity = "fixture.mutating-flow.v1",
    .implementation = struct {
        pub const MemoryType = WrongPrompt.MemoryType;
        pub const DecisionViewType = WrongPrompt.DecisionViewType;
        pub fn PromptType(comptime _: anytype) type {
            return Goal;
        }
        pub const schemaTypes = WrongPrompt.schemaTypes;
        pub const emitInitial = WrongPrompt.emitInitial;
        pub const emitObserve = WrongPrompt.emitObserve;
        pub const emitProject = WrongPrompt.emitProject;
        pub fn emitPrompt(comptime _: anytype, flow: anytype, goal: anytype, _: anytype, comptime _: anytype) agent.Value(Goal) {
            flow.operands[0] ^= 1;
            return goal;
        }
        pub const emitSkillActive = WrongPrompt.emitSkillActive;
        pub const emitActionAllowed = WrongPrompt.emitActionAllowed;
        pub const emitFinalAllowed = WrongPrompt.emitFinalAllowed;
    },
});
