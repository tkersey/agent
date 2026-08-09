const std = @import("std");
const agent = @import("agent");
const boundary = @import("boundary");

const Action = union(enum) {
    final: u32,
};

const Failure = enum {
    invalid_variant,
};

const Definition = agent.define(.{
    .name = "custom-strategy-fixture",
    .version = "1.0.0",
    .instructions = "Return the typed final result.",
    .Goal = u32,
    .Action = Action,
    .Observation = void,
    .Result = u32,
    .Failure = Failure,
    .decision = .{
        .interface = "fixture.custom-decide.v1",
        .maximum_request_bytes = 8,
        .maximum_result_bytes = 8,
    },
    .actions = .{
        agent.action.final(.final, .{
            .name = "final",
            .description = "Return the exact typed result.",
        }),
    },
    .budget = .{
        .maximum_turns = 1,
        .maximum_decisions = 1,
        .maximum_effect_actions = 0,
        .maximum_child_actions = 0,
    },
    .history = .{
        .maximum_observations = 0,
        .overflow = .fail,
    },
});

const Config = struct {
    request_marker: u32,
};

const CustomImplementation = struct {
    pub fn validate(comptime _: type, comptime _: Config) void {}

    pub fn DecisionRequest(comptime _: type, comptime _: Config) type {
        return struct {
            goal: u32,
            marker: u32,
        };
    }

    pub fn StateSchemaTypes(comptime _: type, comptime config: Config) @TypeOf(.{
        DecisionRequest(void, config),
    }) {
        return .{DecisionRequest(void, config)};
    }

    pub fn Body(comptime AgentDefinition: type, comptime config: Config) type {
        const Request = DecisionRequest(AgentDefinition, config);
        const Builder = agent.Flow(.{
            .schema_types = .{ AgentDefinition.Action, Request },
        });
        comptime var flow = Builder.init("custom-strategy-fixture-v1");
        const goal = flow.begin(AgentDefinition.Goal);
        const marker = flow.constant(u32, 0);
        const request = flow.productConstruct(Request, .{ goal, marker });
        const decision = flow.perform(
            agent.strategy.DecisionSiteFor(AgentDefinition, Request),
            request,
            .{},
        );
        flow.returnValue(flow.sumExtract(0, decision.value));
        const Lowering = flow.finish(AgentDefinition.Result);
        return struct {
            pub const InitialArgs = AgentDefinition.Goal;
            pub const Result = AgentDefinition.Result;
            pub const Failure = AgentDefinition.Failure;
            pub const constants = .{config.request_marker};
            pub const effect_sites = agent.strategy.effectSitesFor(
                AgentDefinition,
                Request,
            );
            pub const schema_types = Lowering.schema_types;
            pub const control_ir = Lowering.control_ir;
        };
    }
};

fn Strategy(comptime marker: u32) type {
    return agent.strategy.custom(.{
        .semantic_identity = "fixture.custom-strategy.v1",
        .config = Config{ .request_marker = marker },
        .implementation = CustomImplementation,
        .action_coverage = .{"final"},
    });
}

const Compiled = agent.compile(Definition, Strategy(7), .{
    .machine = .{
        .maximum_frames = 8,
        .maximum_state_bytes = 64 * 1024,
        .maximum_machine_fuel = 1024,
    },
});

const OtherConfig = agent.compile(Definition, Strategy(8), .{
    .machine = .{
        .maximum_frames = 8,
        .maximum_state_bytes = 64 * 1024,
        .maximum_machine_fuel = 1024,
    },
});

test "downstream strategy lowers through public Flow and is erased" {
    const Machine = Compiled.Machine;
    const state = try Machine.initialState(std.testing.allocator, @as(u32, 12));
    defer Machine.deinitState(state);
    var fuel: u64 = 512;

    const decision = switch (try Machine.step(state, &fuel)) {
        .request => |request| request,
        else => return error.UnexpectedMachineStep,
    };
    switch (decision.value) {
        .s0 => |request| {
            try std.testing.expectEqual(@as(u32, 12), request.goal);
            try std.testing.expectEqual(@as(u32, 7), request.marker);
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
}

comptime {
    if (@hasDecl(Compiled, "run") or @hasDecl(Compiled, "session")) {
        @compileError("CompiledAgent must expose no runtime strategy object");
    }
    _ = boundary;
}
