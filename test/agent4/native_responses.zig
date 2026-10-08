const std = @import("std");
const agent = @import("agent");
const native = @import("agent_native");
const contracts = agent.contracts;
const P = agent.model_invocation.Profile(union(enum) { choose: struct { value: u64 } }, .{.{ .name = "choose", .description = "Choose an exact integer." }}, .{
    .model_id_bytes = 128,
    .temperature_bytes = 32,
    .maximum_messages = 4,
    .message_bytes = 256,
    .maximum_output_items = 8,
    .call_id_bytes = 64,
    .arguments_json_bytes = 256,
    .result_text_bytes = 256,
    .provider_response_bytes = 4096,
});
const Adapter = native.responses.Adapter(P);
const profile = "{\"responses\":{\"endpoint\":\"https://example.test/v1/responses\",\"audience\":\"openai-fixture\",\"model\":\"fixture-model\",\"effort\":\"medium\",\"max_output_tokens\":4096,\"request_bytes\":16384,\"response_bytes\":4096,\"timeout_ms\":1000}}";
fn digest(bytes: []const u8) [32]u8 {
    var out: [32]u8 = undefined;
    std.crypto.hash.sha2.Sha256.hash(bytes, &out, .{});
    return out;
}
const Objects = struct {
    bytes: ?[]const u8 = null,
    raw: ?[]const u8 = null,
    fn read(owner: *anyopaque, a: std.mem.Allocator, ref: native.registry.ObjectReference, limit: usize) ![]u8 {
        const self: *Objects = @ptrCast(@alignCast(owner));
        for ([_]?[]const u8{ self.bytes, self.raw }) |candidate| if (candidate) |bytes| {
            if (bytes.len <= limit and bytes.len == ref.bytes and std.mem.eql(u8, &digest(bytes), &ref.digest)) return a.dupe(u8, bytes);
        };
        return error.MissingArtifact;
    }
};
fn request() P.ReferenceRequest {
    return .{ .profile = digest(profile), .replay = null, .results = .{ .items = &.{} }, .invocation = .{
        .protocol = .{ .bytes = agent.model_invocation.protocol_identity },
        .model = .{ .bytes = "fixture-model" },
        .parameters = .{ .max_output_tokens = 4096, .temperature = null, .reasoning = .{ .effort = .medium, .summary = null } },
        .messages = .{ .items = &.{.{ .role = .user, .content = .{ .bytes = "inspect 雪" } }} },
        .tools = P.allDeclarations(),
        .selection = .{ .minimum_calls = 0, .maximum_calls = 1, .parallel_calls = false },
        .response_policy = .{ .store = false, .stream = false, .background = false, .truncation = .disabled },
        .normalization_limits = P.normalizationLimits(),
        .maximum_provider_response_bytes = 4096,
    } };
}

test "native Responses v1 independently specified capture corpus" {
    var arena = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena.deinit();
    const a = arena.allocator();
    var objects: Objects = .{};
    const ctx: native.registry.ProjectionContext = .{ .allocator = a, .task = @splat(7), .tenant = "fixture", .profile = profile, .objects = .{ .owner = &objects, .read = Objects.read } };
    var handlers = try native.Registry.init(a, &.{Adapter.declaration()});
    defer handlers.deinit();
    const req = try contracts.encodeOwned(P.ReferenceRequest, a, request());
    const rendered = try Adapter.prepare(ctx, req);
    const fixture = try native.json.parse(a, @embedFile("native-responses-v1.json"), .{});
    const reference = try native.json.parse(a, @embedFile("native_model_reference"), .{});
    const references = reference.value.object.get("items").?.array.items;
    var compared: usize = 0;
    const cases = fixture.value.object.get("cases").?.array.items;
    for (cases) |case| {
        const name = case.object.get("name").?.string;
        const raw = try contracts.encodeOwned(native.responses.Raw, a, .{ .status = 200, .identity_encoding = true, .request_id = null, .body = .{ .bytes = case.object.get("body").?.string } });
        const projection = try Adapter.interpret(ctx, req, rendered, raw);
        var result = try contracts.decodeOwned(P.ReferenceResult, a, projection.reply);
        defer result.deinit();
        try std.testing.expectEqualStrings(case.object.get("result").?.string, @tagName(result.value.result));
        try std.testing.expectEqualStrings(case.object.get("replay").?.string, @tagName(result.value.replay_status));
        if (case.object.get("reason")) |reason| try std.testing.expectEqualStrings(reason.string, @tagName(result.value.result.unsupported_response));
        if (case.object.get("usage")) |expected| {
            const available = result.value.usage orelse return error.MissingUsage;
            try std.testing.expectEqual(try native.json.numberInteger(u64, expected.object.get("input_tokens").?.number_string), available.input_tokens);
            try std.testing.expectEqual(try native.json.numberInteger(u64, expected.object.get("output_tokens").?.number_string), available.output_tokens);
            try std.testing.expectEqual(try native.json.numberInteger(u64, expected.object.get("cached_input_tokens").?.number_string), available.cached_input_tokens.?);
            try std.testing.expectEqual(@as(?u64, available.output_tokens), projection.output_tokens);
            try std.testing.expect(result.value.replay == null and projection.objects.len == 0);
        }
        if (case.object.get("usage_absent") != null) {
            try std.testing.expect(result.value.usage == null);
            try std.testing.expect(projection.output_tokens == null);
        }
        for (references) |expected| if (std.mem.eql(u8, name, expected.object.get("name").?.string)) {
            const encoded = try contracts.encodeOwned(P.Result, a, result.value.result);
            const hex = expected.object.get("result").?.string;
            const expected_bytes = try a.alloc(u8, hex.len / 2);
            _ = try std.fmt.hexToBytes(expected_bytes, hex);
            try std.testing.expectEqualSlices(u8, expected_bytes, encoded);
            compared += 1;
        };
        if (std.mem.eql(u8, name, "reasoning and phase")) {
            try std.testing.expect(result.value.usage == null);
            var artifact = try contracts.decodeOwned(P.Context, a, projection.objects[0]);
            defer artifact.deinit();
            const replay = try native.json.parse(a, artifact.value.items.bytes, .{});
            try std.testing.expectEqualStrings("opaque+/=", replay.value.array.items[1].object.get("encrypted_content").?.string);
            try std.testing.expectEqualStrings("commentary", replay.value.array.items[2].object.get("phase").?.string);
        }
        // Two supplied fields exceed this profile's one-field bound before
        // duplicate-field decoding. The JS bytes independently assert it too.
        if (std.mem.eql(u8, name, "duplicate arguments")) try std.testing.expectEqual(.capacity, result.value.result.output.items.items[0].function_call.decoded_action.invalid);
        if (std.mem.eql(u8, name, "integral usage spellings")) {
            try std.testing.expectEqual(@as(u64, 12), result.value.usage.?.input_tokens);
            try std.testing.expectEqual(@as(u64, 7), result.value.usage.?.output_tokens);
            try std.testing.expectEqual(@as(?u64, 0), result.value.usage.?.cached_input_tokens);
            try std.testing.expectEqual(@as(?u64, 7), projection.output_tokens);
        }
        if (std.mem.eql(u8, name, "exact integer call")) {
            try std.testing.expectEqual(@as(u64, 9007199254740993), result.value.result.output.items.items[0].function_call.decoded_action.decoded.choose.value);
            try std.testing.expectEqual(@as(?u64, 0), result.value.usage.?.cached_input_tokens);
            objects.bytes = projection.objects[0];
            objects.raw = raw;
            var next = request();
            next.replay = result.value.replay;
            next.invocation.messages = .{ .items = &.{.{ .role = .user, .content = .{ .bytes = "follow up" } }} };
            const missing = try contracts.encodeOwned(P.ReferenceRequest, a, next);
            try std.testing.expectError(error.MissingCallResult, Adapter.prepare(ctx, missing));
            next.results = .{ .items = &.{.{ .call_id = .{ .bytes = "call_1" }, .output = .{ .bytes = "acquired evidence" } }} };
            const paired = try Adapter.prepare(ctx, try contracts.encodeOwned(P.ReferenceRequest, a, next));
            const parsed = try native.json.parse(a, paired, .{});
            const input = parsed.value.object.get("input").?.array.items;
            try std.testing.expectEqual(4, input.len);
            try std.testing.expectEqualStrings("function_call_output", input[2].object.get("type").?.string);
            try std.testing.expectEqualStrings("follow up", input[3].object.get("content").?.string);
            next.profile[0] ^= 1;
            try std.testing.expectError(error.IncompatibleProfile, Adapter.prepare(ctx, try contracts.encodeOwned(P.ReferenceRequest, a, next)));
            next.profile[0] ^= 1;
            next.replay.?.task[0] ^= 1;
            try std.testing.expectError(error.InvalidContext, Adapter.prepare(ctx, try contracts.encodeOwned(P.ReferenceRequest, a, next)));
            next.replay.?.task[0] ^= 1;
            objects.raw = null;
            try std.testing.expectError(error.MissingArtifact, Adapter.prepare(ctx, try contracts.encodeOwned(P.ReferenceRequest, a, next)));
            objects.raw = raw;
            var artifact = try contracts.decodeOwned(P.Context, a, projection.objects[0]);
            defer artifact.deinit();
            artifact.value.task[0] ^= 1;
            const other_task = try contracts.encodeOwned(P.Context, a, artifact.value);
            objects.bytes = other_task;
            next.replay.?.digest = digest(other_task);
            next.replay.?.bytes = other_task.len;
            try std.testing.expectError(error.InvalidContext, Adapter.prepare(ctx, try contracts.encodeOwned(P.ReferenceRequest, a, next)));
            objects.bytes = null;
            try std.testing.expectError(error.MissingArtifact, Adapter.prepare(ctx, try contracts.encodeOwned(P.ReferenceRequest, a, next)));
        }
    }
    const nonintersection = reference.value.object.get("explicit_nonintersection").?.array.items;
    try std.testing.expectEqual(3, nonintersection.len);
    try std.testing.expectEqual(cases.len - nonintersection.len, compared);
    var bad = request();
    var tools = [_]P.ToolDeclaration{P.allDeclarations().items[0]};
    tools[0].strict = false;
    bad.invocation.tools = .{ .items = &tools };
    try std.testing.expectError(error.InvalidDeclaration, Adapter.prepare(ctx, try contracts.encodeOwned(P.ReferenceRequest, a, bad)));
    const too_small = try std.mem.replaceOwned(u8, a, profile, "16384", "1");
    var bounded = ctx;
    bounded.profile = too_small;
    bad = request();
    bad.profile = digest(too_small);
    try std.testing.expectError(error.Capacity, Adapter.prepare(bounded, try contracts.encodeOwned(P.ReferenceRequest, a, bad)));
    const throttled = try contracts.encodeOwned(native.responses.Raw, a, .{ .status = 429, .identity_encoding = true, .request_id = .{ .bytes = "http_429" }, .body = .{ .bytes = "{}" } });
    const failure = try Adapter.interpret(ctx, req, rendered, throttled);
    var http = try contracts.decodeOwned(P.ReferenceResult, a, failure.reply);
    defer http.deinit();
    try std.testing.expectEqual(.http_status, http.value.result.provider_failure.kind);
    try std.testing.expectEqual(429, http.value.result.provider_failure.http_status);
}
