const std = @import("std");
const agent = @import("agent");
const native = @import("agent_native");
const contracts = agent.contracts;
const model = agent.model_invocation;
const P = model.Profile(union(enum) { finish: struct { value: u64 }, inspect: struct { value: u64 } }, .{
    .{ .name = "finish", .description = "Finish with evidence." },
    .{ .name = "inspect", .description = "Inspect an invariant." },
}, .{ .model_id_bytes = 128, .temperature_bytes = 32, .maximum_messages = 4, .message_bytes = 1024, .maximum_output_items = 8, .call_id_bytes = 64, .arguments_json_bytes = 256, .result_text_bytes = 1024, .provider_response_bytes = 4096 });
const Adapter = native.adaptive_responses.Adapter(P);
const Admission = native.adaptive_responses.Admission(P);
const Ref = model.ArtifactReference;
const Objects = struct {
    items: std.ArrayList([]const u8) = .empty,
    fn add(self: *Objects, a: std.mem.Allocator, bytes: []const u8) !Ref {
        try self.items.append(a, bytes);
        return .{ .digest = digest(bytes), .bytes = bytes.len };
    }
    fn read(owner: *anyopaque, a: std.mem.Allocator, ref: native.registry.ObjectReference, limit: usize) ![]u8 {
        const self: *Objects = @ptrCast(@alignCast(owner));
        for (self.items.items) |bytes| if (bytes.len == ref.bytes and bytes.len <= limit and std.mem.eql(u8, &digest(bytes), &ref.digest)) return a.dupe(u8, bytes);
        return error.MissingArtifact;
    }
};
fn digest(bytes: []const u8) [32]u8 {
    var out: [32]u8 = undefined;
    std.crypto.hash.sha2.Sha256.hash(bytes, &out, .{});
    return out;
}
fn http(a: std.mem.Allocator, prepared: []const u8) !native.json.Value {
    var decoded = try contracts.decodeOwned(Adapter.Prepared, a, prepared);
    defer decoded.deinit();
    return (try native.json.parse(a, decoded.value.body.bytes, .{})).value;
}
fn capture(ctx: native.registry.ProjectionContext, objects: *Objects, request: P.AdaptiveRequest, call: []const u8) !P.AdaptiveResult {
    const a = ctx.allocator;
    const encoded = try contracts.encodeOwned(P.AdaptiveRequest, a, request);
    const prepared = try Adapter.prepare(ctx, encoded);
    _ = try objects.add(a, prepared);
    const raw = try contracts.encodeOwned(native.responses.Raw, a, .{ .status = 200, .identity_encoding = true, .request_id = null, .body = .{ .bytes = call } });
    _ = try objects.add(a, raw);
    const projection = try Adapter.interpret(ctx, encoded, prepared, raw);
    for (projection.objects) |object| _ = try objects.add(a, object);
    const decoded = try contracts.decodeOwned(P.AdaptiveResult, a, projection.reply);
    return decoded.value; // The fixture's arena owns all returned slices.
}

test "adaptive projection retains audit captures while hard eviction starts explicit clean input" {
    var arena = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena.deinit();
    const a = arena.allocator();
    var objects: Objects = .{};
    const skill_body = "UNIQUE-SKILL-PAYLOAD: inspect state-transition preservation.";
    const skill = try objects.add(a, skill_body);
    const catalog = try objects.add(a, try contracts.encodeOwned(P.AdaptiveCatalog, a, .{ .skills = .{ .items = &.{.{
        .id = .{ .bytes = "invariant" },
        .version = .{ .bytes = "1" },
        .description = .{ .bytes = "Inspect invariants." },
        .instructions = skill,
        .tools = .{ false, true },
    }} } }));
    const inference: model.AdaptiveInferenceProfile = .{
        .id = .{ .bytes = "analysis" },
        .model = .{ .bytes = "fixture-model-a" },
        .reasoning_mode = .standard,
        .reasoning_context = .current_turn,
        .efforts = .{ .items = &.{ .medium, .high } },
        .effort_update = false,
        .explicit_cache = true,
        .additional_tools = true,
        .cache_diagnostics = true,
        .opaque_family = .{ .bytes = "fixture-a" },
        .max_output_tokens = 4096,
        .request_bytes = 16384,
        .response_bytes = 4096,
        .timeout_ms = 1000,
    };
    const policy: P.AdaptivePolicy = .{
        .schema = .{ .bytes = P.adaptive_policy_identity },
        .endpoint = .{ .bytes = "https://example.test/v1/responses" },
        .audience = .{ .bytes = "fixture" },
        .profiles = .{ .items = &.{inference} },
        .catalog = catalog,
        .core_tools = .{ true, false },
        .permitted_tools = .{ true, true },
        .model_attempts = 16,
        .control_transitions = 16,
    };
    var frozen = native.json.object();
    try native.json.put(a, &frozen, "adaptive", try native.values.toJson(P.AdaptivePolicy, a, policy));
    const profile_bytes = try native.json.canonical(a, frozen);
    const ctx: native.registry.ProjectionContext = .{ .allocator = a, .task = @splat(7), .tenant = "fixture", .profile = profile_bytes, .objects = .{ .owner = &objects, .read = Objects.read } };
    var handlers = try native.Registry.init(a, &.{Adapter.declaration()});
    defer handlers.deinit();
    const Model = agent.model(.{ .name = "adaptive-fixture", .model = "fixture-model-a", .parameters = .{ .max_output_tokens = @as(u32, 4096), .reasoning = .{ .effort = .medium } }, .protocol = struct {
        pub const semantic_identity = model.protocol_identity;
    } });
    var invocation = try P.templateValue(Model, .{ .items = &.{
        .{ .role = .developer, .content = .{ .bytes = "Use actual evidence and approved tools." } },
        .{ .role = .user, .content = .{ .bytes = "Inspect the snapshot." } },
    } }, .{ .minimum_calls = 1, .maximum_calls = 1, .parallel_calls = false });
    invocation.tools.items = P.allDeclarations().items[0..1];
    var request: P.AdaptiveRequest = .{
        .invocation = invocation,
        .policy = digest(profile_bytes),
        .selection = .{ .profile_id = inference.id, .profile_digest = try Admission.profileDigest(a, inference), .effective_effort = .medium, .control_revision = 0 },
        .plan = .{ .epoch = 0, .reason = .initial, .watermark = 0, .eviction_generation = 0, .prior = null, .handoff = null, .catalog = catalog, .skills = .{ .items = &.{} } },
        .materialized = .{ true, false },
        .offered = .{ true, false },
        .results = .{ .items = &.{} },
    };
    const first = try capture(ctx, &objects, request, "{\"id\":\"response-1\",\"status\":\"completed\",\"error\":null,\"output\":[{\"type\":\"function_call\",\"status\":\"completed\",\"call_id\":\"call-1\",\"name\":\"finish\",\"arguments\":\"{\\\"value\\\":1}\"}]}");
    try std.testing.expect(first.replay_status == .complete and first.usage == null);
    request.plan.prior = first.replay;
    request.plan.watermark = first.replay.?.watermark;
    request.invocation.messages.items = &.{};
    request.results.items = &.{.{ .call_id = .{ .bytes = "call-1" }, .output = .{ .bytes = "Continue the investigation." } }};
    request.selection.control_revision = 1;
    var loaded = [_]model.SkillMaterialization{.{ .resource = skill, .skill_id = .{ .bytes = "invariant" }, .version = .{ .bytes = "1" }, .residency = .resident, .active = true, .introduced_at = 1 }};
    request.plan.skills.items = &loaded;
    request.materialized = .{ true, true };
    request.offered = .{ true, true };
    request.invocation.tools = P.allDeclarations();
    const loaded_bytes = try Adapter.prepare(ctx, try contracts.encodeOwned(P.AdaptiveRequest, a, request));
    const loaded_http = try http(a, loaded_bytes);
    try std.testing.expectEqual(1, loaded_http.object.get("tools").?.array.items.len);
    try std.testing.expectEqual(2, loaded_http.object.get("tool_choice").?.object.get("tools").?.array.items.len);
    try std.testing.expect(std.mem.indexOf(u8, loaded_bytes, skill_body) != null);
    const second = try capture(ctx, &objects, request, "{\"id\":\"response-2\",\"status\":\"completed\",\"error\":null,\"output\":[{\"type\":\"reasoning\",\"summary\":[],\"encrypted_content\":\"OPAQUE-WITH-SKILL\"},{\"type\":\"function_call\",\"status\":\"completed\",\"call_id\":\"call-2\",\"name\":\"inspect\",\"arguments\":\"{\\\"value\\\":2}\"}],\"usage\":{\"input_tokens\":100,\"output_tokens\":10,\"input_tokens_details\":{\"cached_tokens\":40,\"cache_write_tokens\":20},\"output_tokens_details\":{\"reasoning_tokens\":5}}}");
    try std.testing.expectEqual(@as(?u64, 20), second.usage.?.cache_write_tokens);
    request.plan.prior = second.replay;
    request.plan.watermark = second.replay.?.watermark;
    request.results.items = &.{.{ .call_id = .{ .bytes = "call-2" }, .output = .{ .bytes = "Observed invariant retained." } }};
    loaded[0].active = false;
    request.offered = .{ true, false };
    request.selection.control_revision = 2;
    const inactive = try Adapter.prepare(ctx, try contracts.encodeOwned(P.AdaptiveRequest, a, request));
    try std.testing.expect(std.mem.indexOf(u8, inactive, skill_body) != null);
    try std.testing.expectEqual(1, (try http(a, inactive)).object.get("tool_choice").?.object.get("tools").?.array.items.len);
    // Hard removal without a new epoch and seed is forbidden before dispatch.
    request.plan.skills.items = &.{};
    request.materialized = .{ true, false };
    request.invocation.tools.items = P.allDeclarations().items[0..1];
    try std.testing.expectError(error.InvalidContext, Adapter.prepare(ctx, try contracts.encodeOwned(P.AdaptiveRequest, a, request)));
    request.plan.epoch = 1;
    request.plan.reason = .eviction;
    request.plan.eviction_generation = 1;
    const seed: P.AdaptiveSeed = .{
        .schema = .{ .bytes = P.adaptive_seed_identity },
        .policy = request.policy,
        .task = ctx.task,
        .tenant = .{ .bytes = ctx.tenant },
        .audience = policy.audience,
        .selection = request.selection,
        .epoch = 1,
        .watermark = request.plan.watermark,
        .eviction_generation = 1,
        .source = second.replay.?,
        .messages = .{ .items = &.{ .{ .role = .developer, .content = .{ .bytes = "Use actual evidence and approved tools." } }, .{ .role = .user, .content = .{ .bytes = "Inspect the snapshot. Verified observation: invariant retained. Remaining calls: 14." } } } },
    };
    request.plan.handoff = try objects.add(a, try contracts.encodeOwned(P.AdaptiveSeed, a, seed));
    const evicted = try Adapter.prepare(ctx, try contracts.encodeOwned(P.AdaptiveRequest, a, request));
    const evicted_http = try native.json.canonical(a, try http(a, evicted));
    try std.testing.expect(std.mem.indexOf(u8, evicted_http, skill_body) == null);
    try std.testing.expect(std.mem.indexOf(u8, evicted_http, "OPAQUE-WITH-SKILL") == null);
    try std.testing.expect(std.mem.indexOf(u8, evicted_http, "\"name\":\"inspect\"") == null);
    try std.testing.expect(std.mem.indexOf(u8, evicted_http, "Verified observation") != null);
    // Original captures and the original projection remain byte-identical.
    try std.testing.expect(std.mem.indexOf(u8, loaded_bytes, skill_body) != null);
    var graft = request;
    graft.plan.prior.?.task[0] ^= 1;
    try std.testing.expectError(error.InvalidContext, Adapter.prepare(ctx, try contracts.encodeOwned(P.AdaptiveRequest, a, graft)));
}
