const agent = @import("agent");
const boundary = @import("boundary");
const world = @import("world");

const Goal = struct { task: u32 };
const WriteRequest = struct { path: u32, content: u32 };
const Result = struct { revision: u32 };
const Failure = enum {
    budget_exhausted,
    history_overflow,
    arithmetic_overflow,
    invalid_variant,
    capacity_exceeded,
    authored_abort,
};
const Action = union(enum) {
    read_file: u32,
    write_file: WriteRequest,
    request_approval: u32,
    final: Result,
    abort: Failure,
};
const Observation = union(enum) {
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
    .Goal = Goal,
    .Action = Action,
    .Observation = Observation,
    .Result = Result,
    .Failure = Failure,
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

pub const Compiled = agent.compile(
    Definition,
    agent.strategy.reflective(.{ .reflection_rounds = 1 }),
    .{
        .machine = .{
            .maximum_frames = 64,
            .maximum_state_bytes = 4 * 1024 * 1024,
            .maximum_machine_fuel = 10_000_000,
        },
    },
);

pub const application_limits = .{
    .maximum_manifest_bytes = 64 * 1024,
    .maximum_initial_args_bytes = 4096,
    .maximum_state_bytes = 5 * 1024 * 1024,
    .maximum_payload_bytes = 256 * 1024,
    .maximum_result_bytes = 256 * 1024,
    .maximum_host_claim_bytes = 8 * 1024,
    .maximum_host_metadata_bytes = 8 * 1024,
    .maximum_failure_bytes = 8 * 1024,
    .maximum_internal_handlers = 0,
    .maximum_residual_effects = 4,
    .maximum_fuel_per_step = 100_000,
    .maximum_frame_depth = 64,
    .maximum_provider_depth = 1,
};

pub const App = world.application(.{
    .name = "coding-agent-reflective",
    .version = "1.0.0",
    .root = Compiled.Machine,
    .handlers = .{},
    .external = .{
        world.external(Compiled.Machine, 0, .{
            .site_identity = Compiled.DecisionSite.semantic_identity,
            .interface = "model.decide.v1",
            .authority = world.Authority.model,
            .maximum_result_bytes = 12 * 1024,
        }),
        world.external(Compiled.Machine, 1, .{
            .site_identity = Compiled.ActionSites[1].semantic_identity,
            .interface = "file.read.v1",
            .authority = world.Authority.file_read,
            .maximum_result_bytes = 64,
        }),
        world.external(Compiled.Machine, 2, .{
            .site_identity = Compiled.ActionSites[2].semantic_identity,
            .interface = "file.write.v1",
            .authority = world.Authority.file_write,
            .maximum_result_bytes = 64,
        }),
        world.external(Compiled.Machine, 3, .{
            .site_identity = Compiled.ActionSites[3].semantic_identity,
            .interface = "human.approve.v1",
            .authority = world.Authority.human,
            .maximum_result_bytes = 64,
        }),
    },
    .limits = application_limits,
});
