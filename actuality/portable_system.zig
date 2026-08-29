const agent = @import("agent");
const boundary = @import("boundary");
const std = @import("std");
const world = @import("world");

pub const Actuality = @import("repository_repair_definition")
    .RepositoryRepair(agent, boundary);

const PolicyApproved = boundary.effect.site(
    0,
    Actuality.ApprovedReplace.semantic_identity,
    Actuality.ReplaceRequest,
    Actuality.ReplaceOutcome,
);

fn ReplacementPolicyBody() type {
    const Builder = agent.Flow(.{
        .schema_types = .{
            Actuality.ReplaceRequest,
            Actuality.ReplaceOutcome,
            Actuality.ReplaceDenied,
            boundary.Text(256),
            Actuality.DigestHex,
            Actuality.FileText,
            Actuality.SummaryText,
        },
    });
    comptime var flow = Builder.init("repository-replacement-policy-v1");
    const proposal = flow.begin(Actuality.ReplaceRequest);
    const path = flow.productExtract(0, proposal);
    const expected_digest = flow.productExtract(1, proposal);
    const replacement = flow.productExtract(2, proposal);
    const rationale = flow.productExtract(3, proposal);
    const path_matches = flow.compareEqZero(flow.textCompare(
        path,
        flow.constant(Actuality.Path, 0),
    ));
    const digest_matches = flow.integerEqual(
        flow.textLength(expected_digest),
        flow.constant(u32, 2),
    );
    const invalid = flow.booleanOr(
        flow.booleanOr(
            flow.booleanNot(path_matches),
            flow.booleanNot(digest_matches),
        ),
        flow.booleanOr(
            flow.compareEqZero(flow.textLength(replacement)),
            flow.compareEqZero(flow.textLength(rationale)),
        ),
    );
    const deny = flow.block(.terminal_handoff, .{});
    const approve = flow.block(.segment, .{Actuality.ReplaceRequest});
    flow.branch(invalid, deny, .{}, approve, .{proposal});

    _ = flow.enter(deny);
    const denied = flow.productConstruct(Actuality.ReplaceDenied, .{
        flow.constant(boundary.Text(256), 1),
    });
    flow.returnValue(flow.sumConstruct(Actuality.ReplaceOutcome, 1, denied));

    const admitted = flow.enter(approve);
    const approved = flow.perform(PolicyApproved, admitted[0], .{});
    flow.returnValue(approved.value);
    const Lowering = flow.finish(Actuality.ReplaceOutcome);

    return struct {
        pub const InitialArgs = Actuality.ReplaceRequest;
        pub const Result = Actuality.ReplaceOutcome;
        pub const Failure = Actuality.Failure;
        pub const constants = .{
            Actuality.Path.fromSlice("src/range.mjs") catch unreachable,
            boundary.Text(256).fromSlice(
                "replacement proposal must target the admitted source path with one SHA-256 digest",
            ) catch unreachable,
            @as(u32, 64),
        };
        pub const effect_sites = .{PolicyApproved};
        pub const schema_types = Lowering.schema_types;
        pub const control_ir = Lowering.control_ir;
    };
}

pub const ReplacementPolicyProgram = boundary.program(
    "repository-replacement-policy-v1",
    ReplacementPolicyBody(),
);

pub const SystemSpec = .{
    .name = "repository-repair-portable-system-v1",
    .root = Actuality.ProcessCompiled.Program,
    .handlers = .{world.systemHandle(.{
        .consumer = Actuality.ProcessCompiled.Program,
        .site = Actuality.ProcessCompiled.ActionSites[5],
        .provider = ReplacementPolicyProgram,
    })},
    .morphisms = .{},
    .external = .{
        Actuality.ProcessCompiled.DecisionSite,
        Actuality.ProcessCompiled.ActionSites[1],
        Actuality.ProcessCompiled.ActionSites[2],
        Actuality.ProcessCompiled.ActionSites[3],
        Actuality.ProcessCompiled.ActionSites[4],
        PolicyApproved,
    },
};

pub const System = world.system(SystemSpec);

test "World links repository replacement policy into one ordinary BPI1" {
    try std.testing.expectEqual(@as(usize, 1), System.internal_handler_count);
    try std.testing.expectEqual(@as(usize, 6), System.residual_effects.count);
    inline for (System.residual_effects.items) |Site| {
        try std.testing.expect(!std.mem.eql(
            u8,
            Site.semantic_identity,
            Actuality.ProposeReplace.semantic_identity,
        ));
    }
    try std.testing.expectEqualStrings(
        Actuality.ApprovedReplace.semantic_identity,
        System.residual_effects.items[5].semantic_identity,
    );
    try std.testing.expect(System.Program.image().bytes.len > 0);
}

test "replacement policy denies proposals outside its portable laws" {
    const Machine = ReplacementPolicyProgram.compile(.{
        .maximum_frames = 8,
        .maximum_state_bytes = 128 * 1024,
        .maximum_machine_fuel = 4096,
    });
    const proposal: Actuality.ReplaceRequest = .{
        .path = try Actuality.Path.fromSlice("test/range.test.mjs"),
        .expected_sha256 = try Actuality.DigestHex.fromSlice("short"),
        .replacement = try Actuality.FileText.fromSlice("replacement"),
        .rationale = try Actuality.SummaryText.fromSlice("rationale"),
    };
    const state = try Machine.initialState(std.testing.allocator, proposal);
    defer Machine.deinitState(state);
    var fuel: u64 = 4096;
    const completed = switch (try Machine.step(state, &fuel)) {
        .done => |value| value,
        else => return error.PolicyDidNotDeny,
    };
    defer completed.deinit();
    switch (completed.value().*) {
        .denied => {},
        else => return error.PolicyReturnedWrongOutcome,
    }
}
