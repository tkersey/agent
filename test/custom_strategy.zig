const std = @import("std");
const agent = @import("agent");
const boundary = @import("boundary");

const Action = union(enum) { final: u32 };
const Failure = enum {
    budget_exhausted,
    history_overflow,
    arithmetic_overflow,
    invalid_variant,
    capacity_exceeded,
};

const Definition = agent.define(.{
    .name = "custom-strategy-fixture",
    .version = "2.0.0",
    .instructions = "Return the typed final result.",
    .Goal = u32,
    .Action = Action,
    .Observation = void,
    .Result = u32,
    .Failure = Failure,
    .decision = .{
        .interface = "fixture.custom-decide.v2",
        .maximum_request_bytes = 4096,
        .maximum_result_bytes = 64,
    },
    .actions = .{agent.action.final(.final, .{
        .name = "final",
        .description = "Return the exact typed result.",
    })},
    .budget = .{
        .maximum_turns = 1,
        .maximum_decisions = 1,
        .maximum_effect_actions = 0,
        .maximum_child_actions = 0,
    },
});

const Config = struct { identity_marker: u32 };
const StrategyOnlySchema = struct { marker: u32 };
const CustomImplementation = struct {
    pub fn validate(comptime _: type, comptime _: Config) void {}

    pub fn DecisionLocalType(comptime _: type, comptime _: Config) type {
        return u32;
    }

    pub fn StateSchemaTypes(comptime _: type, comptime _: Config) @TypeOf(.{StrategyOnlySchema}) {
        return .{StrategyOnlySchema};
    }

    pub fn topology(comptime _: type, comptime _: Config, comptime runtime: type) agent.RuntimeTopology {
        return runtime.react();
    }

    pub fn emitDecisionLocal(
        comptime _: type,
        comptime _: Config,
        flow: anytype,
        goal: anytype,
        _: anytype,
        _: anytype,
    ) agent.Value(u32) {
        _ = flow;
        return goal;
    }
};

fn Strategy(comptime marker: u32) type {
    return agent.strategy.custom(.{
        .semantic_identity = "fixture.custom-strategy.v2",
        .config = Config{ .identity_marker = marker },
        .implementation = CustomImplementation,
        .action_coverage = .{"final"},
    });
}

const Epistemics = agent.epistemics.verbatim(.{
    .maximum_observations = 0,
    .overflow = .fail,
    .final = agent.final_policy.none,
});

fn compiled(comptime marker: u32) type {
    return agent.compile(Definition, Strategy(marker), Epistemics, .{
        .machine = .{
            .maximum_frames = 8,
            .maximum_state_bytes = 64 * 1024,
            .maximum_machine_fuel = 4096,
        },
    });
}

const Compiled = compiled(7);
const OtherConfig = compiled(8);

fn ConstantEpistemicImplementation(comptime marker: u32) type {
    return struct {
        pub fn validate(comptime _: type, comptime _: void) void {}
        pub fn Memory(comptime _: type, comptime _: void) type {
            return u32;
        }
        pub fn DecisionView(comptime _: type, comptime _: void) type {
            return u32;
        }
        pub fn StateSchemaTypes(comptime _: type, comptime _: void) @TypeOf(.{u32}) {
            return .{u32};
        }
        pub fn initialMemory(comptime _: type, comptime _: void) u32 {
            return marker;
        }
        pub fn emitObserve(comptime _: type, comptime _: void, flow: anytype, memory: anytype, _: anytype, comptime _: anytype) agent.Value(u32) {
            return flow.copy(memory);
        }
        pub fn emitProject(comptime _: type, comptime _: void, flow: anytype, memory: anytype) agent.Value(u32) {
            return flow.copy(memory);
        }
        pub fn emitFinalAllowed(comptime _: type, comptime _: void, flow: anytype, _: anytype, _: anytype, comptime context: anytype) agent.Value(bool) {
            return flow.constant(bool, context.true_index);
        }
    };
}

fn constantEpistemics(comptime marker: u32) type {
    return agent.epistemics.custom(.{
        .semantic_identity = "fixture.constant-epistemics.v1",
        .config = {},
        .implementation = ConstantEpistemicImplementation(marker),
    });
}

fn constantCompiled(comptime marker: u32) type {
    return agent.compile(Definition, agent.strategy.react(.{}), constantEpistemics(marker), .{
        .machine = .{
            .maximum_frames = 8,
            .maximum_state_bytes = 64 * 1024,
            .maximum_machine_fuel = 4096,
        },
    });
}

test "custom RuntimeStrategy selects compiler-owned ReAct topology" {
    comptime var found_strategy_schema = false;
    inline for (Compiled.SchemaTypes) |Schema| {
        if (Schema == StrategyOnlySchema) found_strategy_schema = true;
    }
    try std.testing.expect(found_strategy_schema);
    const Machine = Compiled.Machine;
    const state = try Machine.initialState(std.testing.allocator, @as(u32, 12));
    defer Machine.deinitState(state);
    var fuel: u64 = 4096;

    const decision = switch (try Machine.step(state, &fuel)) {
        .request => |request| request,
        else => return error.UnexpectedMachineStep,
    };
    switch (decision.value) {
        .s0 => |turn| {
            try std.testing.expectEqual(@as(u32, 12), turn.goal);
            try std.testing.expectEqual(@as(u32, 12), turn.strategy_local);
        },
    }
    {
        const prepared = try Machine.prepareResume(state, decision);
        defer Machine.deinitPreparedResume(prepared);
        try Machine.@"resume"(prepared, Action{ .final = 44 });
    }

    const done = switch (try Machine.step(state, &fuel)) {
        .done => |result| result,
        else => return error.UnexpectedMachineStep,
    };
    defer done.deinit();
    try std.testing.expectEqual(@as(u32, 44), done.value().*);
}

test "custom config changes strategy and Machine identity without runtime callbacks" {
    try std.testing.expect(!std.mem.eql(
        u8,
        &Compiled.StrategyManifest.config_value_digest,
        &OtherConfig.StrategyManifest.config_value_digest,
    ));
    try std.testing.expect(!std.mem.eql(
        u8,
        &Compiled.Machine.Manifest.machine_contract_digest,
        &OtherConfig.Machine.Manifest.machine_contract_digest,
    ));
    try std.testing.expect(!@hasDecl(Compiled.Strategy, "ProgramBody"));
    _ = boundary;
}

test "epistemics lowering identity includes canonical Program constants" {
    const Seven = constantCompiled(7);
    const Eight = constantCompiled(8);
    try std.testing.expectEqualSlices(
        u8,
        &Seven.StrategyManifest.control_ir_digest,
        &Eight.StrategyManifest.control_ir_digest,
    );
    try std.testing.expect(!std.mem.eql(
        u8,
        &Seven.EpistemicsManifest.initial_lowering_digest,
        &Eight.EpistemicsManifest.initial_lowering_digest,
    ));
}
