const agent = @import("agent");
const boundary = @import("boundary");
const world = @import("world");
const definition = @import("definition.zig");

pub const Compiled = definition.Compiled;
pub const DecisionContract = agent.decision.contract(Compiled);
pub const ActionJsonContract = agent.decision.jsonContract(Compiled);
pub const wasm_stack_size_bytes: u32 = 128 * 1024 * 1024;
pub const wasm_initial_pages: u32 = 4096;
pub const wasm_maximum_pages: u32 = 4096;

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
    .name = "router-policy-adequacy",
    .version = "1.0.0",
    .root = Compiled.Machine,
    .handlers = .{},
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
            .interface = "repo.list.v2",
            .authority = world.Authority.file_read,
            .maximum_attempts = 3,
            .maximum_result_bytes = maximumResultBytes(Compiled.ActionSites[1]),
        }),
        world.external(Compiled.Machine, Compiled.ActionSites[2].site_id, .{
            .site_identity = Compiled.ActionSites[2].semantic_identity,
            .interface = "repo.read.v2",
            .authority = world.Authority.file_read,
            .maximum_attempts = 3,
            .maximum_result_bytes = maximumResultBytes(Compiled.ActionSites[2]),
        }),
        world.external(Compiled.Machine, Compiled.ActionSites[3].site_id, .{
            .site_identity = Compiled.ActionSites[3].semantic_identity,
            .interface = "repo.search.v2",
            .authority = world.Authority.file_read,
            .maximum_attempts = 3,
            .maximum_result_bytes = maximumResultBytes(Compiled.ActionSites[3]),
        }),
        world.external(Compiled.Machine, Compiled.ActionSites[4].site_id, .{
            .site_identity = Compiled.ActionSites[4].semantic_identity,
            .interface = "repo.test.v2",
            .authority_requirements = authorityRequirements(.{ world.Authority.file_read, world.Authority.file_write }),
            .maximum_attempts = 1,
            .maximum_result_bytes = maximumResultBytes(Compiled.ActionSites[4]),
        }),
        world.external(Compiled.Machine, Compiled.ActionSites[5].site_id, .{
            .site_identity = Compiled.ActionSites[5].semantic_identity,
            .interface = "repo.replace.approved.v2",
            .authority_requirements = authorityRequirements(.{ world.Authority.file_write, world.Authority.human }),
            .maximum_attempts = 1,
            .maximum_result_bytes = maximumResultBytes(Compiled.ActionSites[5]),
        }),
    },
    .limits = .{
        .maximum_initial_args_bytes = 8 * 1024,
        .maximum_state_bytes = 512 * 1024,
        .maximum_payload_bytes = 256 * 1024,
        .maximum_result_bytes = 64 * 1024,
        .maximum_host_claim_bytes = 16 * 1024,
        .maximum_host_metadata_bytes = 16 * 1024,
        .maximum_failure_bytes = 64 * 1024,
        .maximum_internal_handlers = 0,
        .maximum_residual_effects = 6,
        .maximum_fuel_per_step = 100_000,
        .maximum_frame_depth = 32,
        .maximum_provider_depth = 1,
    },
});

pub const App = Application;

test "application preserves the locked ABI and resource tuple" {
    const std = @import("std");
    try std.testing.expectEqual(@as(u32, 2), Compiled.Manifest.boundary_machine_abi);
    try std.testing.expectEqual(@as(u32, 512 * 1024), Application.Limits.maximum_state_bytes);
    try std.testing.expectEqual(@as(u32, 6), Application.Limits.maximum_residual_effects);
    try std.testing.expectEqual(@as(u64, 100_000), Application.Limits.maximum_fuel_per_step);
    try std.testing.expectEqual(@as(u32, 32), Application.Limits.maximum_frame_depth);
    try std.testing.expectEqual(@as(u32, 4096), wasm_initial_pages);
    try std.testing.expectEqual(wasm_initial_pages, wasm_maximum_pages);
}
