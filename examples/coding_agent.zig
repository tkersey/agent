const agent = @import("agent");
const boundary = @import("boundary");

pub const CodingGoal = struct { task: u32 };
pub const WriteRequest = struct { path: u32, content: u32 };
pub const CodingResult = struct { revision: u32 };
pub const CodingFailure = enum {
    budget_exhausted,
    history_overflow,
    arithmetic_overflow,
    invalid_variant,
    capacity_exceeded,
    authored_abort,
};
pub const CodingAction = union(enum) {
    read_file: u32,
    write_file: WriteRequest,
    request_approval: u32,
    final: CodingResult,
    abort: CodingFailure,
};
pub const CodingObservation = union(enum) {
    read_file: u32,
    write_file: u32,
    request_approval: bool,
};

const ReadFile = boundary.effect.site(91, "file.read.v1", u32, u32);
const WriteFile = boundary.effect.site(92, "file.write.v1", WriteRequest, u32);
const Approval = boundary.effect.site(93, "human.approve.v1", u32, bool);

pub const Definition = agent.define(.{
    .name = "coding-agent",
    .version = "1.0.0",
    .instructions = "Inspect the target, request approval before mutation, and return the typed revision.",
    .Goal = CodingGoal,
    .Action = CodingAction,
    .Observation = CodingObservation,
    .Result = CodingResult,
    .Failure = CodingFailure,
    .decision = .{
        .interface = "model.decide.v1",
        .maximum_request_bytes = 96 * 1024,
        .maximum_result_bytes = 12 * 1024,
    },
    .actions = .{
        agent.action.effect(.read_file, .read_file, ReadFile, .{
            .name = "read_file",
            .description = "Read one declared file.",
            .class = .tool,
        }),
        agent.action.effect(.write_file, .write_file, WriteFile, .{
            .name = "write_file",
            .description = "Write one approved file mutation.",
            .class = .tool,
        }),
        agent.action.effect(.request_approval, .request_approval, Approval, .{
            .name = "request_approval",
            .description = "Request human approval before mutation.",
            .class = .human,
        }),
        agent.action.final(.final, .{
            .name = "final",
            .description = "Return the completed typed revision.",
        }),
        agent.action.fail(.abort, .{
            .name = "abort",
            .description = "Terminate with an authored failure.",
        }),
    },
    .budget = .{
        .maximum_turns = 16,
        .maximum_decisions = 32,
        .maximum_effect_actions = 24,
        .maximum_child_actions = 0,
    },
    .history = .{
        .maximum_observations = 16,
        .overflow = .fail,
    },
});
