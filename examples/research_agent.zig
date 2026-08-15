const agent = @import("agent");
const boundary = @import("boundary");

pub const ResearchGoal = struct { subject: u32 };
pub const ResearchResult = struct { answer: u32 };
pub const ResearchFailure = enum {
    budget_exhausted,
    history_overflow,
    arithmetic_overflow,
    invalid_variant,
    capacity_exceeded,
    authored_abort,
};
pub const ResearchAction = union(enum) {
    search: u32,
    read: u32,
    delegate: u32,
    final: ResearchResult,
    abort: ResearchFailure,
};
pub const ResearchObservation = union(enum) {
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
    .Goal = ResearchGoal,
    .Action = ResearchAction,
    .Observation = ResearchObservation,
    .Result = ResearchResult,
    .Failure = ResearchFailure,
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
});

pub const Epistemics = agent.epistemics.verbatim(.{
    .maximum_observations = 32,
    .overflow = .fail,
    .final = agent.final_policy.none,
});
