const agent = @import("agent");
const base = @import("base_application");
const world = @import("world");

pub const Compiled = agent.compile(
    base.Definition,
    agent.strategy.reflective(.{ .reflection_rounds = 1 }),
    .{
        .machine = .{
            .maximum_frames = 64,
            .maximum_state_bytes = 4 * 1024 * 1024,
            .maximum_machine_fuel = 10_000_000,
        },
    },
);

pub const App = world.application(.{
    .name = "research-agent-reflective",
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
    .limits = base.application_limits,
});
