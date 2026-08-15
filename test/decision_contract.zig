const std = @import("std");
const boundary = @import("boundary");
const agent = @import("agent");
const actuality = @import("repository_repair_actuality");

const Contract = agent.decision.jsonContract(actuality.Compiled);
const StaticContract = agent.decision.contract(actuality.Compiled);

const GuardSite = boundary.effect.site(91, "fixture.contract-guard.v1", void, GuardObservationPayload);
const GuardObservationPayload = struct { passed: bool };
const GuardObservation = union(enum) { run_tests: GuardObservationPayload };
const GuardAction = union(enum) { run_tests: void, final: u32 };
const GuardFailure = enum {
    budget_exhausted,
    history_overflow,
    arithmetic_overflow,
    invalid_variant,
    invalid_index,
    capacity_exceeded,
};
const GuardDefinition = agent.define(.{
    .name = "decision-contract-final-guard",
    .version = "2.0.0",
    .instructions = "Finish only when the selected final guard admits it.",
    .Goal = void,
    .Action = GuardAction,
    .Observation = GuardObservation,
    .Result = u32,
    .Failure = GuardFailure,
    .decision = .{
        .interface = "fixture.contract-guard-decide.v1",
        .maximum_request_bytes = 4096,
        .maximum_result_bytes = 64,
    },
    .actions = .{
        agent.action.effect(.run_tests, .run_tests, GuardSite, .{
            .name = "run_tests",
            .description = "Observe the test result.",
            .class = .tool,
        }),
        agent.action.final(.final, .{ .name = "final", .description = "Finish." }),
    },
    .budget = .{
        .maximum_turns = 2,
        .maximum_decisions = 2,
        .maximum_effect_actions = 1,
        .maximum_child_actions = 0,
    },
});

fn guardedContract(comptime expected: bool) type {
    return agent.compile(
        GuardDefinition,
        agent.strategy.react(.{}),
        agent.epistemics.verbatim(.{
            .maximum_observations = 1,
            .overflow = .fail,
            .final = agent.final_policy.latestObservationBool(.run_tests, .passed, expected),
        }),
        .{ .machine = .{
            .maximum_frames = 8,
            .maximum_state_bytes = 64 * 1024,
            .maximum_machine_fuel = 4096,
        } },
    ).DecisionContract;
}

test "DecisionContract v2 is the exact immutable artifact named by the Machine" {
    try std.testing.expectEqualStrings(
        "agent-decision-contract/v2",
        StaticContract.format_version,
    );
    try std.testing.expectEqualStrings(
        "AGT_DCT2",
        StaticContract.binary_bytes[0..8],
    );
    try std.testing.expectEqualSlices(
        u8,
        &StaticContract.canonical_digest,
        StaticContract.binary_bytes[StaticContract.binary_bytes.len - 32 ..],
    );
    try std.testing.expectEqualSlices(
        u8,
        &StaticContract.canonical_digest,
        &actuality.Compiled.Manifest.decision_contract_digest,
    );
    try std.testing.expectEqualSlices(
        u8,
        &StaticContract.decision_turn_schema_digest,
        &boundary.schema.schemaDigest(actuality.Compiled.DecisionSite.Payload),
    );
}

test "DecisionContract JSON carries static instructions and catalog once" {
    var parsed = try std.json.parseFromSlice(
        std.json.Value,
        std.testing.allocator,
        &StaticContract.json_bytes,
        .{},
    );
    defer parsed.deinit();
    try std.testing.expectEqualStrings(
        actuality.Compiled.Definition.instructions,
        parsed.value.object.get("instructions").?.string,
    );
    try std.testing.expectEqual(
        actuality.Compiled.Definition.action_count,
        parsed.value.object.get("actions").?.array.items.len,
    );
    try std.testing.expect(parsed.value.object.get("definitionSemanticDigest") != null);
    try std.testing.expect(parsed.value.object.get("runtimeStrategySemanticDigest") != null);
    try std.testing.expect(parsed.value.object.get("epistemicStrategySemanticDigest") != null);
    try std.testing.expect(parsed.value.object.get("actionSchemaDigest") != null);
    try std.testing.expect(parsed.value.object.get("decisionTurnSchemaDigest") != null);
    try std.testing.expect(parsed.value.object.get("decisionViewSchemaDigest") != null);
    try std.testing.expect(parsed.value.object.get("resultSchemaDigest") != null);
    try std.testing.expect(parsed.value.object.get("failureSchemaDigest") != null);
    try std.testing.expect(!@hasField(actuality.Compiled.DecisionSite.Payload, "instructions"));
    try std.testing.expect(!@hasField(actuality.Compiled.DecisionSite.Payload, "actions"));
}

test "DecisionContract v2 binds the exact provider-neutral action schema bytes" {
    var expected: [32]u8 = undefined;
    std.crypto.hash.sha2.Sha256.hash(
        &StaticContract.action_schema_bytes,
        &expected,
        .{},
    );
    try std.testing.expectEqualSlices(
        u8,
        &expected,
        &StaticContract.action_schema_digest,
    );
}

test "DecisionContract identity binds the verbatim final guard" {
    try std.testing.expect(!std.mem.eql(
        u8,
        &guardedContract(true).canonical_digest,
        &guardedContract(false).canonical_digest,
    ));
}

test "decision contract is deterministic and bound to the Action schema" {
    const Same = agent.decision.jsonContract(actuality.Compiled);
    try std.testing.expectEqualStrings(
        "agent-decision-json-contract/v1",
        Contract.format_version,
    );
    try std.testing.expectEqualSlices(
        u8,
        &boundary.schema.schemaDigest(actuality.Action),
        &Contract.action_schema_digest,
    );
    try std.testing.expectEqualSlices(
        u8,
        &Contract.canonical_digest,
        &Same.canonical_digest,
    );
    try std.testing.expectEqualSlices(
        u8,
        &Contract.json_schema_bytes,
        &Same.json_schema_bytes,
    );
}

test "decision contract closes every action branch in declaration order" {
    try std.testing.expectEqual(@as(usize, 7), Contract.variant_catalog.len);
    try std.testing.expectEqualStrings("list_repository", Contract.variant_catalog[0].name);
    try std.testing.expectEqualStrings("replace_file", Contract.variant_catalog[4].name);
    try std.testing.expectEqualStrings("abort", Contract.variant_catalog[6].name);
    try std.testing.expectEqual(agent.action.Kind.effect, Contract.variant_catalog[0].kind);
    try std.testing.expectEqual(agent.action.Kind.final, Contract.variant_catalog[5].kind);
    try std.testing.expectEqual(agent.action.Kind.fail, Contract.variant_catalog[6].kind);
}

test "decision contract is valid JSON with seven closed branches" {
    var parsed = try std.json.parseFromSlice(
        std.json.Value,
        std.testing.allocator,
        &Contract.json_schema_bytes,
        .{},
    );
    defer parsed.deinit();

    const branches = parsed.value.object.get("oneOf").?.array.items;
    try std.testing.expectEqual(@as(usize, 7), branches.len);
    for (branches) |branch| {
        const object = branch.object;
        try std.testing.expectEqual(false, object.get("additionalProperties").?.bool);
        const required = object.get("required").?.array.items;
        try std.testing.expectEqual(@as(usize, 2), required.len);
        try std.testing.expectEqualStrings("action", required[0].string);
        try std.testing.expectEqualStrings("arguments", required[1].string);
    }
}

test "decision contract emits strict exact action objects" {
    const schema = &Contract.json_schema_bytes;
    try std.testing.expect(std.mem.startsWith(
        u8,
        schema,
        "{\"$schema\":\"https://json-schema.org/draft/2020-12/schema\"",
    ));
    try std.testing.expectEqual(
        @as(usize, 7),
        count(
            schema,
            "\"required\":[\"action\",\"arguments\"],\"additionalProperties\":false}",
        ),
    );
    try std.testing.expectEqual(@as(usize, 1), count(schema, "\"const\":\"read_file\""));
    try std.testing.expectEqual(@as(usize, 1), count(schema, "\"const\":\"replace_file\""));
    try std.testing.expectEqual(@as(usize, 2), count(schema, "\"expected_sha256\""));
    try std.testing.expectEqual(@as(usize, 1), count(schema, "\"maxLength\":32768"));
}

fn count(haystack: []const u8, needle: []const u8) usize {
    var result: usize = 0;
    var remaining = haystack;
    while (std.mem.indexOf(u8, remaining, needle)) |index| {
        result += 1;
        remaining = remaining[index + needle.len ..];
    }
    return result;
}
