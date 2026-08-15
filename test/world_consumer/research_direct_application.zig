const base = @import("base_application");
const direct = @import("direct_reference");
const world = @import("world");

const Machine = direct.DirectMachine;

pub const App = world.application(.{
    .name = "research-agent",
    .version = "1.0.0",
    .root = Machine,
    .handlers = .{},
    .external = .{
        world.external(Machine, 0, .{
            .site_identity = Machine.EffectRow.site(0).semantic_identity,
            .interface = "model.decide.v1",
            .authority = world.Authority.model,
            .maximum_result_bytes = 16 * 1024,
        }),
        world.external(Machine, 1, .{
            .site_identity = Machine.EffectRow.site(1).semantic_identity,
            .interface = "research.search.v1",
            .authority = world.Authority.network,
            .maximum_result_bytes = 64,
        }),
        world.external(Machine, 2, .{
            .site_identity = Machine.EffectRow.site(2).semantic_identity,
            .interface = "document.read.v1",
            .authority = world.Authority.network,
            .maximum_result_bytes = 64,
        }),
        world.external(Machine, 3, .{
            .site_identity = Machine.EffectRow.site(3).semantic_identity,
            .interface = "agent.invoke.v1",
            .authority = world.Authority.child_agent,
            .maximum_result_bytes = 64,
        }),
    },
    .limits = base.application_limits,
});
