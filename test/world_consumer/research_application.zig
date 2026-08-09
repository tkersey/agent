const agent = @import("agent");
const boundary = @import("boundary");
const world = @import("world");

const Goal = struct { subject: u32 };
const Result = struct { answer: u32 };
const Failure = enum {
    budget_exhausted,
    history_overflow,
    arithmetic_overflow,
    invalid_variant,
    capacity_exceeded,
    authored_abort,
};
const Action = union(enum) {
    search: u32,
    read: u32,
    delegate: u32,
    final: Result,
    abort: Failure,
};
const Observation = union(enum) {
    search: u32,
    read: u32,
    delegate: u32,
};

const Search = boundary.effect.site(18, "research.search.v1", u32, u32);
const Read = boundary.effect.site(19, "document.read.v1", u32, u32);
const Delegate = boundary.effect.site(20, "agent.invoke.v1", u32, u32);

pub const Definition = agent.define(.{
    .name = "research-agent",
    .version = "1.0.0",
    .instructions = "Research the supplied subject, use only declared actions, and return a typed final result.",
    .Goal = Goal,
    .Action = Action,
    .Observation = Observation,
    .Result = Result,
    .Failure = Failure,
    .decision = .{
        .interface = "model.decide.v1",
        .maximum_request_bytes = 128 * 1024,
        .maximum_result_bytes = 16 * 1024,
    },
    .actions = .{
        agent.action.effect(.search, .search, Search, .{
            .name = "search",
            .description = "Search for evidence relevant to the goal.",
            .class = .tool,
        }),
        agent.action.effect(.read, .read, Read, .{
            .name = "read",
            .description = "Read one selected source.",
            .class = .tool,
        }),
        agent.action.effect(.delegate, .delegate, Delegate, .{
            .name = "delegate",
            .description = "Delegate one bounded subproblem.",
            .class = .child_agent,
        }),
        agent.action.final(.final, .{
            .name = "final",
            .description = "Return the completed typed result.",
        }),
        agent.action.fail(.abort, .{
            .name = "abort",
            .description = "Terminate with an authored failure.",
        }),
    },
    .budget = .{
        .maximum_turns = 24,
        .maximum_decisions = 48,
        .maximum_effect_actions = 48,
        .maximum_child_actions = 8,
    },
    .history = .{
        .maximum_observations = 32,
        .overflow = .fail,
    },
});

pub const Compiled = agent.compile(Definition, agent.strategy.react(.{}), .{
    .machine = .{
        .maximum_frames = 64,
        .maximum_state_bytes = 4 * 1024 * 1024,
        .maximum_machine_fuel = 10_000_000,
    },
});

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
    .name = "research-agent",
    .version = "1.0.0",
    .root = Compiled.Machine,
    .handlers = .{},
    .external = .{
        world.external(Compiled.Machine, 0, .{
            .site_identity = Compiled.DecisionSite.semantic_identity,
            .interface = "model.decide.v1",
            .authority = world.Authority.model,
            .maximum_result_bytes = 16 * 1024,
        }),
        world.external(Compiled.Machine, 1, .{
            .site_identity = Compiled.ActionSites[1].semantic_identity,
            .interface = "research.search.v1",
            .authority = world.Authority.network,
            .maximum_result_bytes = 64,
        }),
        world.external(Compiled.Machine, 2, .{
            .site_identity = Compiled.ActionSites[2].semantic_identity,
            .interface = "document.read.v1",
            .authority = world.Authority.network,
            .maximum_result_bytes = 64,
        }),
        world.external(Compiled.Machine, 3, .{
            .site_identity = Compiled.ActionSites[3].semantic_identity,
            .interface = "agent.invoke.v1",
            .authority = world.Authority.child_agent,
            .maximum_result_bytes = 64,
        }),
    },
    .limits = application_limits,
});
