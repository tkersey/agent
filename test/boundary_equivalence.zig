const std = @import("std");
const agent = @import("agent");
const boundary = @import("boundary");
const Research = @import("research_agent");

const Definition = Research.Definition;
const Strategy = agent.strategy.react(.{});
const Epistemics = Research.Epistemics;
const Memory = Epistemics.MemoryType(Definition);
const DecisionTurn = agent.strategy.DecisionTurn(Definition, Strategy, Epistemics);
const DecisionSite = agent.strategy.DecisionSiteFor(Definition, DecisionTurn);
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

const reference_value_types = [_]boundary.ir.ValueType{
    .{ .schema = 0 },
    .{ .schema = 6 },
    .{ .schema = 4 },
    .{ .schema = 7 },
    .{ .schema = 5 },
    .{ .scalar = .unit },
    .{ .schema = 3 },
    .{ .schema = 1 },
    .{ .scalar = .boolean },
    .{ .schema = 1 },
    .{ .schema = 2 },
    .{ .schema = 8 },
};

const reference_blocks = [_]boundary.ir.Block{
    .{
        .id = 0,
        .role = .loop_header,
        .parameters = &.{0},
        .instructions = &.{
            .{ .kind = .constant, .result = 1, .operands = &.{}, .operation = .{ .constant = 0 } },
            .{ .kind = .constant, .result = 2, .operands = &.{}, .operation = .{ .constant = 1 } },
            .{ .kind = .constant, .result = 3, .operands = &.{}, .operation = .{ .constant = 2 } },
            .{ .kind = .pure, .result = 4, .operands = &.{}, .operation = .vector_empty },
            .{ .kind = .constant, .result = 5, .operands = &.{}, .operation = .{ .constant = 3 } },
            .{ .kind = .pure, .result = 6, .operands = &.{ 1, 0, 2, 3, 4, 5 }, .operation = .product_construct },
        },
        .terminator = .{ .@"suspend" = .{
            .kind = .effect,
            .site_id = 0,
            .request_values = &.{6},
            .continuation = .{ .target = 1, .arguments = &.{.@"resume"} },
            .resume_type = .{ .schema = 1 },
        } },
    },
    .{
        .id = 1,
        .role = .after_handler,
        .parameters = &.{7},
        .instructions = &.{
            .{ .kind = .pure, .result = 8, .operands = &.{7}, .operation = .{ .sum_tag_is = 3 } },
        },
        .terminator = .{ .branch = .{
            .condition = 8,
            .then_edge = .{ .target = 2, .arguments = &.{.{ .value = 7 }} },
            .else_edge = .{ .target = 3, .arguments = &.{} },
        } },
    },
    .{
        .id = 2,
        .role = .terminal_handoff,
        .parameters = &.{9},
        .instructions = &.{
            .{ .kind = .pure, .result = 10, .operands = &.{9}, .operation = .{ .sum_extract = 3 } },
        },
        .terminator = .{ .return_value = 10 },
    },
    .{
        .id = 3,
        .role = .terminal_handoff,
        .parameters = &.{},
        .instructions = &.{
            .{ .kind = .constant, .result = 11, .operands = &.{}, .operation = .{ .constant = 4 } },
        },
        .terminator = .{ .fail_value = 11 },
    },
};

const ReferenceBody = struct {
    pub const InitialArgs = Definition.Goal;
    pub const Result = Definition.Result;
    pub const Failure = Definition.Failure;
    pub const constants = .{
        Generated.DecisionContract.canonical_digest,
        agent.Counters{ .turns = 0, .decisions = 0, .effect_actions = 0, .child_actions = 0 },
        agent.DecisionPhase.decide,
        @as(void, {}),
        Definition.Failure.invalid_variant,
    };
    pub const effect_sites = boundary.effect.row(.{DecisionSite});
    pub const schema_types = .{
        Definition.Goal,
        Definition.Action,
        Definition.Result,
        DecisionTurn,
        agent.Counters,
        Memory,
        [32]u8,
        agent.DecisionPhase,
        Definition.Failure,
    };
    pub const control_ir: boundary.ir.Program = .{
        .label = "independent-research-final-reference",
        .value_types = &reference_value_types,
        .blocks = &reference_blocks,
        .entry = 0,
        .result_type = .{ .schema = 2 },
    };
};

pub const DirectMachine = boundary.program(
    "independent-research-final-reference",
    ReferenceBody,
).compile(machine_options);

fn runFinalPath(comptime Machine: type) !u32 {
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
    const turn = decision.value.s0;
    try std.testing.expectEqualSlices(
        u8,
        &Generated.DecisionContract.canonical_digest,
        &turn.contract_digest,
    );
    try std.testing.expectEqual(@as(u32, 7), turn.goal.subject);
    try std.testing.expectEqual(agent.DecisionPhase.decide, turn.phase);
    try std.testing.expectEqual(@as(u32, 0), turn.context.len());
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
    return done.value().answer;
}

test "Agent v2 exposes one ordinary Boundary reducer without a runtime side path" {
    try std.testing.expect(Generated.Program.control_ir.blocks.len != 0);
    try std.testing.expect(!@hasDecl(Generated, "run"));
    try std.testing.expect(!@hasDecl(Generated, "session"));
}

test "generated and independently authored Boundary reducers agree on the final path" {
    try std.testing.expectEqual(@as(u32, 303), try runFinalPath(Generated.Machine));
    try std.testing.expectEqual(@as(u32, 303), try runFinalPath(DirectMachine));
}
