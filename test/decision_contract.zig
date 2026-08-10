const std = @import("std");
const boundary = @import("boundary");
const agent = @import("agent");
const actuality = @import("repository_repair_actuality");

const Contract = agent.decision.jsonContract(actuality.Compiled);

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
