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

fn nextRequest(
    comptime Machine: type,
    state: Machine.State,
    fuel: *u64,
) !Machine.Request {
    return switch (try Machine.step(state, fuel)) {
        .request => |request| request,
        else => error.UnexpectedMachineStep,
    };
}

fn resumeRequest(
    comptime Machine: type,
    state: Machine.State,
    request: Machine.Request,
    value: anytype,
) !void {
    const prepared = try Machine.prepareResume(state, request);
    defer Machine.deinitPreparedResume(prepared);
    try Machine.@"resume"(prepared, value);
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

    try std.testing.expectEqualSlices(
        u8,
        &ResearchReact.DefinitionManifestBytes,
        &ResearchReflective.DefinitionManifestBytes,
    );
    try std.testing.expect(!std.mem.eql(
        u8,
        &ResearchReact.StrategyManifestBytes,
        &ResearchReflective.StrategyManifestBytes,
    ));
    try std.testing.expect(!std.mem.eql(
        u8,
        &ResearchReact.ManifestBytes,
        &ResearchReflective.ManifestBytes,
    ));
    try std.testing.expectEqualStrings(
        "AGT_DEF1",
        ResearchReact.DefinitionManifestBytes[0..8],
    );
    try std.testing.expect(std.mem.indexOf(
        u8,
        &ResearchReact.DefinitionManifestBytes,
        Research.Definition.instructions,
    ) != null);
    try std.testing.expectEqualSlices(
        u8,
        &ResearchReact.DefinitionManifest.semantic_digest,
        ResearchReact.DefinitionManifestBytes[ResearchReact.DefinitionManifestBytes.len - 32 ..],
    );
    try std.testing.expectEqualSlices(
        u8,
        &ResearchReact.StrategyManifest.semantic_digest,
        ResearchReact.StrategyManifestBytes[ResearchReact.StrategyManifestBytes.len - 32 ..],
    );
    try std.testing.expectEqualSlices(
        u8,
        &ResearchReact.Manifest.semantic_digest,
        ResearchReact.ManifestBytes[ResearchReact.ManifestBytes.len - 32 ..],
    );
}

test "Research ReAct performs decision search decision read decision final" {
    const Machine = ResearchReact.Machine;
    const state = try Machine.initialState(
        std.testing.allocator,
        Research.ResearchGoal{ .subject = 7 },
    );
    defer Machine.deinitState(state);
    var fuel: u64 = 100_000;

    const decide_search = try nextRequest(Machine, state, &fuel);
    switch (decide_search.value) {
        .s0 => |request| {
            try std.testing.expectEqual(@as(u32, 7), request.goal.subject);
            try std.testing.expectEqual(@as(u32, 0), request.counters.decisions);
        },
        else => return error.UnexpectedEffectSite,
    }
    try resumeRequest(
        Machine,
        state,
        decide_search,
        Research.ResearchAction{ .search = 11 },
    );
    const search = try nextRequest(Machine, state, &fuel);
    switch (search.value) {
        .s1 => |payload| try std.testing.expectEqual(@as(u32, 11), payload),
        else => return error.UnexpectedEffectSite,
    }
    try resumeRequest(Machine, state, search, @as(u32, 22));

    const decide_read = try nextRequest(Machine, state, &fuel);
    switch (decide_read.value) {
        .s0 => |request| {
            try std.testing.expectEqual(@as(u32, 1), request.counters.turns);
            try std.testing.expectEqual(@as(u32, 1), request.counters.decisions);
            try std.testing.expectEqual(@as(u32, 1), request.counters.effect_actions);
            const observed = (try request.history.get(0)).?;
            switch (observed) {
                .search => |value| try std.testing.expectEqual(@as(u32, 22), value),
                else => return error.UnexpectedObservation,
            }
        },
        else => return error.UnexpectedEffectSite,
    }
    try resumeRequest(
        Machine,
        state,
        decide_read,
        Research.ResearchAction{ .read = 33 },
    );
    const read = try nextRequest(Machine, state, &fuel);
    switch (read.value) {
        .s2 => |payload| try std.testing.expectEqual(@as(u32, 33), payload),
        else => return error.UnexpectedEffectSite,
    }
    try resumeRequest(Machine, state, read, @as(u32, 44));

    const decide_final = try nextRequest(Machine, state, &fuel);
    try resumeRequest(
        Machine,
        state,
        decide_final,
        Research.ResearchAction{ .final = .{ .answer = 55 } },
    );
    const done = switch (try Machine.step(state, &fuel)) {
        .done => |value| value,
        else => return error.UnexpectedMachineStep,
    };
    defer done.deinit();
    try std.testing.expectEqual(@as(u32, 55), done.value().answer);
}

test "Research Reflective ReAct reflects each selected action" {
    const Machine = ResearchReflective.Machine;
    const state = try Machine.initialState(
        std.testing.allocator,
        Research.ResearchGoal{ .subject = 3 },
    );
    defer Machine.deinitState(state);
    var fuel: u64 = 100_000;

    const propose_search = try nextRequest(Machine, state, &fuel);
    switch (propose_search.value) {
        .s0 => |request| try std.testing.expectEqual(agent.DecisionPhase.propose, request.phase),
        else => return error.UnexpectedEffectSite,
    }
    try resumeRequest(
        Machine,
        state,
        propose_search,
        Research.ResearchAction{ .search = 5 },
    );
    const reflect_search = try nextRequest(Machine, state, &fuel);
    switch (reflect_search.value) {
        .s0 => |request| {
            try std.testing.expectEqual(agent.DecisionPhase.reflect, request.phase);
            try std.testing.expect(request.candidate != null);
        },
        else => return error.UnexpectedEffectSite,
    }
    try resumeRequest(
        Machine,
        state,
        reflect_search,
        Research.ResearchAction{ .search = 6 },
    );
    const search = try nextRequest(Machine, state, &fuel);
    try resumeRequest(Machine, state, search, @as(u32, 7));

    const propose_final = try nextRequest(Machine, state, &fuel);
    try resumeRequest(
        Machine,
        state,
        propose_final,
        Research.ResearchAction{ .final = .{ .answer = 8 } },
    );
    const reflect_final = try nextRequest(Machine, state, &fuel);
    try resumeRequest(
        Machine,
        state,
        reflect_final,
        Research.ResearchAction{ .final = .{ .answer = 9 } },
    );
    const done = switch (try Machine.step(state, &fuel)) {
        .done => |value| value,
        else => return error.UnexpectedMachineStep,
    };
    defer done.deinit();
    try std.testing.expectEqual(@as(u32, 9), done.value().answer);
}

test "Coding ReAct performs read write final" {
    const Machine = CodingReact.Machine;
    const state = try Machine.initialState(
        std.testing.allocator,
        Coding.CodingGoal{ .task = 1 },
    );
    defer Machine.deinitState(state);
    var fuel: u64 = 100_000;

    const decide_read = try nextRequest(Machine, state, &fuel);
    try resumeRequest(
        Machine,
        state,
        decide_read,
        Coding.CodingAction{ .read_file = 10 },
    );
    const read = try nextRequest(Machine, state, &fuel);
    switch (read.value) {
        .s1 => |payload| try std.testing.expectEqual(@as(u32, 10), payload),
        else => return error.UnexpectedEffectSite,
    }
    try resumeRequest(Machine, state, read, @as(u32, 11));

    const decide_write = try nextRequest(Machine, state, &fuel);
    const write_request = Coding.WriteRequest{ .path = 12, .content = 13 };
    try resumeRequest(
        Machine,
        state,
        decide_write,
        Coding.CodingAction{ .write_file = write_request },
    );
    const write = try nextRequest(Machine, state, &fuel);
    switch (write.value) {
        .s2 => |payload| try std.testing.expectEqualDeep(write_request, payload),
        else => return error.UnexpectedEffectSite,
    }
    try resumeRequest(Machine, state, write, @as(u32, 14));

    const decide_final = try nextRequest(Machine, state, &fuel);
    try resumeRequest(
        Machine,
        state,
        decide_final,
        Coding.CodingAction{ .final = .{ .revision = 15 } },
    );
    const done = switch (try Machine.step(state, &fuel)) {
        .done => |value| value,
        else => return error.UnexpectedMachineStep,
    };
    defer done.deinit();
    try std.testing.expectEqual(@as(u32, 15), done.value().revision);
}

test "Coding Reflective ReAct requests approval before mutation" {
    const Machine = CodingReflective.Machine;
    const state = try Machine.initialState(
        std.testing.allocator,
        Coding.CodingGoal{ .task = 2 },
    );
    defer Machine.deinitState(state);
    var fuel: u64 = 100_000;

    const propose_approval = try nextRequest(Machine, state, &fuel);
    try resumeRequest(
        Machine,
        state,
        propose_approval,
        Coding.CodingAction{ .request_approval = 20 },
    );
    const reflect_approval = try nextRequest(Machine, state, &fuel);
    try resumeRequest(
        Machine,
        state,
        reflect_approval,
        Coding.CodingAction{ .request_approval = 21 },
    );
    const approval = try nextRequest(Machine, state, &fuel);
    switch (approval.value) {
        .s3 => |payload| try std.testing.expectEqual(@as(u32, 21), payload),
        else => return error.UnexpectedEffectSite,
    }
    try resumeRequest(Machine, state, approval, true);

    const propose_write = try nextRequest(Machine, state, &fuel);
    const write_request = Coding.WriteRequest{ .path = 22, .content = 23 };
    try resumeRequest(
        Machine,
        state,
        propose_write,
        Coding.CodingAction{ .write_file = write_request },
    );
    const reflect_write = try nextRequest(Machine, state, &fuel);
    try resumeRequest(
        Machine,
        state,
        reflect_write,
        Coding.CodingAction{ .write_file = write_request },
    );
    const write = try nextRequest(Machine, state, &fuel);
    switch (write.value) {
        .s2 => |payload| try std.testing.expectEqualDeep(write_request, payload),
        else => return error.UnexpectedEffectSite,
    }
    try resumeRequest(Machine, state, write, @as(u32, 24));

    const propose_final = try nextRequest(Machine, state, &fuel);
    try resumeRequest(
        Machine,
        state,
        propose_final,
        Coding.CodingAction{ .final = .{ .revision = 25 } },
    );
    const reflect_final = try nextRequest(Machine, state, &fuel);
    try resumeRequest(
        Machine,
        state,
        reflect_final,
        Coding.CodingAction{ .final = .{ .revision = 26 } },
    );
    const done = switch (try Machine.step(state, &fuel)) {
        .done => |value| value,
        else => return error.UnexpectedMachineStep,
    };
    defer done.deinit();
    try std.testing.expectEqual(@as(u32, 26), done.value().revision);
}
