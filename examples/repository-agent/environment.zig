//! Compiled adapters; the authored program owns action selection and budgets.
const std = @import("std");
const native = @import("agent_native");
const t = @import("application_types");
const tools = @import("tools.zig");
const contracts = @import("agent_contracts");
const Adapter = native.responses.Adapter(t.P);

pub const demo_input: t.Input = .{ .task = .{ .bytes = "Explain the fixture's entry point using source evidence." } };
pub const demo_answer: t.Answer = .{ .message = .{ .bytes = "Focus on observable behavior." } };

/// Borrowed for the lifetime of joined workers. Admission supplies immutable
/// snapshot/profile data separately from the nonpersistent transport credential.
pub const State = struct {
    snapshot: native.repository.Snapshot,
    profile_identity: [32]u8,
    provider: native.responses.Environment,
    offline: bool,
};

pub const handlers = [_]native.Declaration{
    native.leaf(void, t.Bindings, .{ .identity = t.bindings_identity, .resource_role = "snapshot" }, bindings),
    native.leaf(t.ListRequest, t.ListObservation, .{ .identity = t.list_identity, .resource_role = "snapshot" }, list),
    native.leaf(t.ReadRequest, t.ReadObservation, .{ .identity = t.read_identity, .resource_role = "snapshot" }, read),
    native.question(t.Question, t.Answer, .{ .identity = t.question_identity, .resource_role = "user", .answer_schema_id = t.answer_schema_id }, present),
    native.inbox.declaration(t.Message),
    providerDeclaration(),
};

fn state(ctx: native.Context) !*const State {
    const value: *const State = @ptrCast(@alignCast(ctx.environment orelse return error.MissingConfiguration));
    var hash: [32]u8 = undefined;
    std.crypto.hash.sha2.Sha256.hash(ctx.profile, &hash, .{});
    if (!std.mem.eql(u8, &hash, &value.profile_identity)) return error.IncompatibleProfile;
    return value;
}
fn bindings(ctx: native.Context, _: void) !t.Bindings {
    const frozen = try state(ctx);
    const settings = try native.responses.settings(ctx.allocator, ctx.profile);
    const effort = std.meta.stringToEnum(@typeInfo(@FieldType(t.P.ReasoningConfig, "effort")).optional.child, settings.effort.bytes) orelse return error.InvalidConfiguration;
    return .{
        .profile = frozen.profile_identity,
        .snapshot = frozen.snapshot.identity,
        .files = @intCast(frozen.snapshot.files().len),
        .excluded_entries = frozen.snapshot.decoded.value.excluded_entries,
        .model = settings.model,
        .parameters = .{ .max_output_tokens = settings.max_output_tokens, .temperature = null, .reasoning = .{ .effort = effort, .summary = null } },
        .maximum_provider_response_bytes = settings.response_bytes,
        .instructions = .{ .bytes = @embedFile("instructions.txt") },
    };
}
fn list(ctx: native.Context, request: t.ListRequest) !t.ListObservation {
    return tools.list(ctx.allocator, (try state(ctx)).snapshot, request);
}
fn read(ctx: native.Context, request: t.ReadRequest) !t.ReadObservation {
    return tools.read(ctx.allocator, (try state(ctx)).snapshot, request);
}
fn present(ctx: native.Context, question: t.Question) !native.json.Value {
    var value = native.json.object();
    try native.json.put(ctx.allocator, &value, "prompt", native.json.string(question.prompt.bytes));
    return value;
}
fn providerDeclaration() native.Declaration {
    var declaration = Adapter.declaration();
    declaration.capture.?.acquire = acquire;
    return declaration;
}
fn acquire(ctx: native.Context, bytes: []const u8) !native.registry.Acquisition {
    const frozen = state(ctx) catch |err| return .{ .definitely_not_sent = err };
    if (frozen.offline) return offlineAcquire(ctx, bytes);
    var provider_context = ctx;
    provider_context.environment = @ptrCast(@constCast(&frozen.provider));
    return Adapter.acquire(provider_context, bytes);
}

const Config = struct {
    workspace: contracts.Text(128),
    snapshot_root: contracts.Text(4096),
    responses: native.responses.Settings,
};
fn digest(bytes: []const u8) [32]u8 {
    var value: [32]u8 = undefined;
    std.crypto.hash.sha2.Sha256.hash(bytes, &value, .{});
    return value;
}
fn hex(a: std.mem.Allocator, bytes: []const u8) ![]const u8 {
    return a.dupe(u8, &std.fmt.bytesToHex(digest(bytes), .lower));
}

pub fn taskInput(a: std.mem.Allocator, text: []const u8) !t.Input {
    if (text.len > 2048 or !std.unicode.utf8ValidateSlice(text)) return error.InvalidParams;
    return .{ .task = .{ .bytes = try a.dupe(u8, text) } };
}

fn testEndpoint(endpoint: []const u8) bool {
    // The explicit test profile has a non-secret built-in token and only a
    // canonical loopback HTTPS Responses URL. It cannot receive credentials.
    for ([_][]const u8{ "https://127.0.0.1:", "https://[::1]:", "https://localhost:" }) |prefix| {
        if (!std.mem.startsWith(u8, endpoint, prefix)) continue;
        const rest = endpoint[prefix.len..];
        const slash = std.mem.indexOfScalar(u8, rest, '/') orelse return false;
        if (slash == 0 or !std.mem.eql(u8, rest[slash..], "/v1/responses")) return false;
        for (rest[0..slash]) |byte| if (byte < '0' or byte > '9') return false;
        return (std.fmt.parseInt(u16, rest[0..slash], 10) catch return false) != 0;
    }
    return false;
}

/// The host owns this allocation region until all workers have joined. Frozen
/// inputs come only from the task owner; reopening never reads snapshot_root.
pub fn configure(a: std.mem.Allocator, io: std.Io, options: native.configuration.Options, frozen: ?native.tasks.FrozenInputs, assets: native.discovery.Assets) !native.configuration.Admitted {
    if (options.test_provider and (options.offline or options.credential_path != null or options.trust_root_path == null)) return error.InvalidConfiguration;
    const selected_mode = if (options.offline) "offline" else if (options.test_provider) "controlled-test" else "live";
    var configuration: ?Config = null;
    var configuration_digest: ?[]const u8 = null;
    if (options.config_path) |path| {
        const bytes = try native.configuration.readFile(a, io, path, 256 * 1024, false);
        const parsed = try native.json.parse(a, bytes, .{ .bytes = 256 * 1024 });
        configuration = try native.values.fromJson(Config, a, parsed.value);
        if (configuration.?.workspace.bytes.len == 0) return error.InvalidConfiguration;
        configuration_digest = try hex(a, try native.json.canonical(a, parsed.value));
    }
    if (options.offline and (configuration != null or options.credential_path != null or options.trust_root_path != null)) return error.InvalidConfiguration;
    var profile_bytes: []const u8 = undefined;
    var resource_bytes: []const u8 = undefined;
    if (frozen) |saved| {
        if (saved.resources.len != 1) return error.MissingArtifact;
        profile_bytes = saved.profile;
        resource_bytes = saved.resources[0];
    } else {
        if (!options.offline and configuration == null) return error.MissingConfiguration;
        const settings: native.responses.Settings = if (configuration) |value| value.responses else .{
            .endpoint = .{ .bytes = "https://offline.invalid/v1/responses" },
            .audience = .{ .bytes = "offline-fixture" },
            .model = .{ .bytes = "fixture-model" },
            .effort = .{ .bytes = "medium" },
            .max_output_tokens = 4096,
            .request_bytes = 256 * 1024,
            .response_bytes = 512 * 1024,
            .timeout_ms = 1000,
        };
        if (configuration) |value| {
            resource_bytes = try native.repository.capture(a, io, value.snapshot_root.bytes);
        } else {
            const content = "pub fn main() void {\n    // The offline fixture has no external effects.\n}\n";
            resource_bytes = try contracts.encodeOwned(native.repository.Record, a, .{ .version = 1, .excluded_entries = 0, .files = .{ .items = &.{.{ .path = .{ .bytes = "src/main.zig" }, .sha256 = digest(content), .contents = .{ .bytes = content } }} } });
        }
        var profile = native.json.object();
        try native.json.put(a, &profile, "mode", native.json.string(selected_mode));
        try native.json.put(a, &profile, "application", native.json.string(t.application_id));
        try native.json.put(a, &profile, "assets", native.json.string(try hex(a, assets.application)));
        try native.json.put(a, &profile, "configuration_digest", native.json.string(configuration_digest orelse try hex(a, "repository-agent.offline.v1")));
        try native.json.put(a, &profile, "workspace", native.json.string(if (configuration) |value| value.workspace.bytes else "offline-fixture"));
        try native.json.put(a, &profile, "responses", try native.values.toJson(native.responses.Settings, a, settings));
        try native.json.put(a, &profile, "snapshot", try native.values.toJson(native.registry.ObjectReference, a, .{ .digest = digest(resource_bytes), .bytes = resource_bytes.len }));
        profile_bytes = try native.json.canonical(a, profile);
    }
    const profile = (try native.json.parse(a, profile_bytes, .{ .bytes = 256 * 1024 })).value;
    const mode = try native.json.text(native.json.get(profile, "mode") orelse return error.InvalidConfiguration);
    if (!std.mem.eql(u8, mode, selected_mode)) return error.IncompatibleProfile;
    if (!std.mem.eql(u8, try native.json.text(native.json.get(profile, "application") orelse return error.InvalidConfiguration), t.application_id) or
        !std.mem.eql(u8, try native.json.text(native.json.get(profile, "assets") orelse return error.InvalidConfiguration), try hex(a, assets.application))) return error.IncompatibleProfile;
    if (configuration_digest) |expected| {
        if (!std.mem.eql(u8, expected, try native.json.text(native.json.get(profile, "configuration_digest") orelse return error.InvalidConfiguration))) return error.IncompatibleProfile;
    }
    const reference = try native.values.fromJson(native.registry.ObjectReference, a, native.json.get(profile, "snapshot") orelse return error.InvalidConfiguration);
    if (reference.bytes != resource_bytes.len or !std.mem.eql(u8, &reference.digest, &digest(resource_bytes))) return error.InvalidSnapshot;
    const settings = try native.responses.settings(a, profile_bytes);
    if (settings.response_bytes > 512 * 1024 or std.meta.stringToEnum(@typeInfo(@FieldType(t.P.ReasoningConfig, "effort")).optional.child, settings.effort.bytes) == null) return error.InvalidConfiguration;
    if (!options.offline) {
        if (options.test_provider) {
            if (!testEndpoint(settings.endpoint.bytes)) return error.InvalidConfiguration;
        } else if (!std.mem.eql(u8, settings.endpoint.bytes, "https://api.openai.com/v1/responses")) return error.InvalidConfiguration;
    }
    var token: []const u8 = if (options.test_provider) "qualification-only" else "";
    if (options.credential_path) |path| token = std.mem.trim(u8, try native.configuration.readFile(a, io, path, 16 * 1024, true), "\r\n");
    const trust_root = if (options.trust_root_path) |path| try native.configuration.readFile(a, io, path, 256 * 1024, false) else null;
    const adapter = try a.create(State);
    adapter.* = .{ .snapshot = try native.repository.Snapshot.open(a, resource_bytes), .profile_identity = digest(profile_bytes), .provider = .{ .token = token, .approved_endpoint = settings.endpoint.bytes, .trust_root = trust_root }, .offline = options.offline };
    const resources = try a.alloc([]const u8, 1);
    resources[0] = resource_bytes;
    return .{ .id = if (options.offline) "offline" else if (options.test_provider) "controlled-test" else "fixed", .bytes = profile_bytes, .resources = resources, .environment = adapter };
}

/// Explicit deterministic provider fixture. It examines the rendered request,
/// so it exercises the same call/result pairing and capture/projection owners.
/// This is never selected for a live profile and carries no mutable phase state.
fn offlineAcquire(ctx: native.Context, bytes: []const u8) !native.registry.Acquisition {
    const a = ctx.allocator;
    const request = (try native.json.parse(a, bytes, .{ .bytes = 256 * 1024 })).value;
    const input = native.json.get(request, "input") orelse return .{ .definitely_not_sent = error.InvalidPreparedRequest };
    if (input != .array) return .{ .definitely_not_sent = error.InvalidPreparedRequest };
    var prior_calls: usize = 0;
    for (input.array.items) |item| if (native.json.get(item, "type")) |kind| {
        if (kind == .string and std.mem.eql(u8, kind.string, "function_call")) prior_calls += 1;
    };
    const action: []const u8 = switch (prior_calls) {
        0 => "list",
        1 => "read",
        2 => "ask",
        else => "report",
    };
    const arguments: []const u8 = switch (prior_calls) {
        0 => "{\"prefix\":\"\",\"after\":\"\"}",
        1 => "{\"path\":\"src/main.zig\",\"start\":0,\"maximum\":4096}",
        2 => "{\"question\":\"Should the report focus on observable behavior?\"}",
        else => "{\"summary\":\"The fixture entry point has an empty body and performs no external operations.\",\"evidence_index\":0}",
    };
    var item = native.json.object();
    try native.json.put(a, &item, "type", native.json.string("function_call"));
    try native.json.put(a, &item, "status", native.json.string("completed"));
    try native.json.put(a, &item, "call_id", native.json.string(try std.fmt.allocPrint(a, "offline-{d}", .{prior_calls})));
    try native.json.put(a, &item, "name", native.json.string(action));
    try native.json.put(a, &item, "arguments", native.json.string(arguments));
    var output: std.array_list.Managed(native.json.Value) = .init(a);
    try output.append(item);
    var response = native.json.object();
    try native.json.put(a, &response, "status", native.json.string("completed"));
    try native.json.put(a, &response, "error", .null);
    try native.json.put(a, &response, "output", .{ .array = output });
    const body = try native.json.canonical(a, response);
    return .{ .captured = try contracts.encodeOwned(native.responses.Raw, a, .{ .status = 200, .identity_encoding = true, .request_id = null, .body = .{ .bytes = body } }) };
}
