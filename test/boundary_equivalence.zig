const std = @import("std");
const agent = @import("agent");
const boundary = @import("boundary");
const Research = @import("research_agent");

const Definition = Research.Definition;
const Strategy = agent.strategy.react(.{});
const Epistemics = Research.Epistemics;
const machine_options: boundary.MachineOptions = .{
    .maximum_frames = 64,
    .maximum_state_bytes = 4 * 1024 * 1024,
    .maximum_machine_fuel = 10_000_000,
};

pub const Generated = agent.compile(
    Definition,
    Strategy,
    Epistemics,
    .{ .machine = machine_options },
);
pub const DirectMachine = Generated.Program.compile(machine_options);

test "Agent v2 exposes the one ordinary Boundary reducer it compiled" {
    try std.testing.expect(Generated.Machine == DirectMachine);
    try std.testing.expectEqualSlices(
        u8,
        &Generated.Machine.Manifest.machine_contract_digest,
        &DirectMachine.Manifest.machine_contract_digest,
    );
    try std.testing.expect(Generated.Program.control_ir.blocks.len != 0);
    try std.testing.expect(!@hasDecl(Generated, "run"));
    try std.testing.expect(!@hasDecl(Generated, "session"));
}

test "the exposed Boundary Machine alone performs continuation" {
    const Machine = DirectMachine;
    const state = try Machine.initialState(
        std.testing.allocator,
        Research.ResearchGoal{ .subject = 7 },
    );
    defer Machine.deinitState(state);
    var fuel: u64 = 100_000;

    const decision = switch (try Machine.step(state, &fuel)) {
        .request => |request| request,
        else => return error.UnexpectedMachineStep,
    };
    {
        const prepared = try Machine.prepareResume(state, decision);
        defer Machine.deinitPreparedResume(prepared);
        try Machine.@"resume"(
            prepared,
            Research.ResearchAction{ .final = .{ .answer = 303 } },
        );
    }

    const done = switch (try Machine.step(state, &fuel)) {
        .done => |result| result,
        else => return error.UnexpectedMachineStep,
    };
    defer done.deinit();
    try std.testing.expectEqual(@as(u32, 303), done.value().answer);
}
