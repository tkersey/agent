const std = @import("std");
const agent = @import("agent");
const Research = @import("research_agent");
const Coding = @import("coding_agent");

const machine_options = .{
    .maximum_frames = 64,
    .maximum_state_bytes = 4 * 1024 * 1024,
    .maximum_machine_fuel = 10_000_000,
};

pub const ResearchReact = agent.compile(
    Research.Definition,
    agent.strategy.react(.{}),
    .{ .machine = machine_options },
);
pub const ResearchReflective = agent.compile(
    Research.Definition,
    agent.strategy.reflective(.{ .reflection_rounds = 1 }),
    .{ .machine = machine_options },
);
pub const CodingReact = agent.compile(
    Coding.Definition,
    agent.strategy.react(.{}),
    .{ .machine = machine_options },
);
pub const CodingReflective = agent.compile(
    Coding.Definition,
    agent.strategy.reflective(.{ .reflection_rounds = 1 }),
    .{ .machine = machine_options },
);

fn distinct(comptime Left: type, comptime Right: type) bool {
    return !std.mem.eql(
        u8,
        &Left.Machine.Manifest.machine_contract_digest,
        &Right.Machine.Manifest.machine_contract_digest,
    );
}

test "two definitions by two strategies produce four distinct Machines" {
    try std.testing.expect(distinct(ResearchReact, ResearchReflective));
    try std.testing.expect(distinct(CodingReact, CodingReflective));
    try std.testing.expect(distinct(ResearchReact, CodingReact));
    try std.testing.expect(distinct(ResearchReflective, CodingReflective));

    try std.testing.expectEqual(@as(usize, 4), ResearchReact.Machine.Manifest.effect_site_count);
    try std.testing.expectEqual(@as(usize, 4), CodingReact.Machine.Manifest.effect_site_count);
    try std.testing.expect(
        ResearchReact.Program.control_ir.blocks.len !=
            ResearchReflective.Program.control_ir.blocks.len,
    );
    try std.testing.expect(
        CodingReact.Program.control_ir.blocks.len !=
            CodingReflective.Program.control_ir.blocks.len,
    );
}

test "agent manifests bind definitions strategies and Boundary Machines" {
    try std.testing.expectEqualStrings("AGT_DEF1", &ResearchReact.DefinitionManifest.magic);
    try std.testing.expectEqualStrings("AGT_STR1", &ResearchReact.StrategyManifest.magic);
    try std.testing.expectEqualStrings("AGT_CMP1", &ResearchReact.Manifest.magic);

    try std.testing.expectEqualSlices(
        u8,
        &ResearchReact.DefinitionManifest.semantic_digest,
        &ResearchReflective.DefinitionManifest.semantic_digest,
    );
    try std.testing.expect(!std.mem.eql(
        u8,
        &ResearchReact.DefinitionManifest.semantic_digest,
        &CodingReact.DefinitionManifest.semantic_digest,
    ));
    try std.testing.expect(!std.mem.eql(
        u8,
        &ResearchReact.StrategyManifest.semantic_digest,
        &ResearchReflective.StrategyManifest.semantic_digest,
    ));
    try std.testing.expect(!std.mem.eql(
        u8,
        &ResearchReact.StrategyManifest.control_ir_digest,
        &ResearchReflective.StrategyManifest.control_ir_digest,
    ));
    try std.testing.expect(!std.mem.eql(
        u8,
        &ResearchReact.Manifest.semantic_digest,
        &ResearchReflective.Manifest.semantic_digest,
    ));
    try std.testing.expectEqualSlices(
        u8,
        &ResearchReact.Machine.Manifest.machine_contract_digest,
        &ResearchReact.Manifest.boundary_machine_contract_digest,
    );
    try std.testing.expectEqual(@as(u32, 2), ResearchReact.Manifest.boundary_machine_abi);
}
