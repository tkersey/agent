const world = @import("world");
const boundary = @import("boundary");
const agent = @import("../src/root.zig");
const factory = @import("repository_repair_definition.zig");

pub const Actuality = factory.RepositoryRepair(agent, boundary);
pub const Compiled = Actuality.Compiled;
pub const Contract = agent.decision.jsonContract(Compiled);
pub const wasm_stack_size_bytes: u32 = 128 * 1024 * 1024;

/// Artifact-resident packaging metadata used by the release verifier. This is
/// not part of World Application ABI v1 and carries no runtime authority.
pub export fn agent_actuality_wasm_stack_size_bytes() u32 {
    return wasm_stack_size_bytes;
}

fn authorityRequirements(comptime authorities: anytype) u64 {
    var result: u64 = 0;
    inline for (authorities) |authority| {
        result |= @as(u64, 1) << @intFromEnum(authority);
    }
    return result;
}

fn maximumResultBytes(comptime Site: type) u32 {
    return @intCast(boundary.schema.maximumEncodedSize(Site.Resume));
}

pub const Application = world.application(.{
    .name = "repository-repair-actuality",
    .version = "2.0.0",
    .root = Compiled.Machine,
    .external = .{
        world.external(Compiled.Machine, Compiled.DecisionSite.site_id, .{
            .site_identity = Compiled.DecisionSite.semantic_identity,
            .interface = "model.decide.v1",
            .authority_requirements = authorityRequirements(.{ world.Authority.model, world.Authority.network }),
            .maximum_attempts = 1,
            .maximum_result_bytes = maximumResultBytes(Compiled.DecisionSite),
        }),
        world.external(Compiled.Machine, Compiled.ActionSites[1].site_id, .{
            .site_identity = Compiled.ActionSites[1].semantic_identity,
            .interface = "repo.list.v1",
            .authority = world.Authority.file_read,
            .maximum_attempts = 3,
            .maximum_result_bytes = maximumResultBytes(Compiled.ActionSites[1]),
        }),
        world.external(Compiled.Machine, Compiled.ActionSites[2].site_id, .{
            .site_identity = Compiled.ActionSites[2].semantic_identity,
            .interface = "repo.read.v1",
            .authority = world.Authority.file_read,
            .maximum_attempts = 3,
            .maximum_result_bytes = maximumResultBytes(Compiled.ActionSites[2]),
        }),
        world.external(Compiled.Machine, Compiled.ActionSites[3].site_id, .{
            .site_identity = Compiled.ActionSites[3].semantic_identity,
            .interface = "repo.search.v1",
            .authority = world.Authority.file_read,
            .maximum_attempts = 3,
            .maximum_result_bytes = maximumResultBytes(Compiled.ActionSites[3]),
        }),
        world.external(Compiled.Machine, Compiled.ActionSites[4].site_id, .{
            .site_identity = Compiled.ActionSites[4].semantic_identity,
            .interface = "repo.test.v1",
            .authority_requirements = authorityRequirements(.{ world.Authority.file_read, world.Authority.file_write }),
            .maximum_attempts = 1,
            .maximum_result_bytes = maximumResultBytes(Compiled.ActionSites[4]),
        }),
        world.external(Compiled.Machine, Compiled.ActionSites[5].site_id, .{
            .site_identity = Compiled.ActionSites[5].semantic_identity,
            .interface = "repo.replace.approved.v1",
            .authority_requirements = authorityRequirements(.{ world.Authority.file_write, world.Authority.human }),
            .maximum_attempts = 1,
            .maximum_result_bytes = maximumResultBytes(Compiled.ActionSites[5]),
        }),
    },
    .limits = .{
        .maximum_initial_args_bytes = 8 << 10,
        .maximum_state_bytes = 512 << 10,
        .maximum_payload_bytes = 160 << 10,
        .maximum_result_bytes = 40 << 10,
        .maximum_host_claim_bytes = 4 << 10,
        .maximum_host_metadata_bytes = 4 << 10,
        .maximum_failure_bytes = 4 << 10,
        .maximum_fuel_per_step = 100_000,
        .maximum_frame_depth = 32,
    },
});
