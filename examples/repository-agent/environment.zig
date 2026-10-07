//! Compiled adapters; the authored program owns action selection and budgets.
const std = @import("std");
const native = @import("agent_native");
const t = @import("application_types");
const tools = @import("tools.zig");
const Adapter = native.responses.Adapter(t.P);

pub const demo_input: t.Input = .{ .task = .{ .bytes = "Explain the fixture's entry point using source evidence." } };
pub const demo_answer: t.Answer = .{ .message = .{ .bytes = "Focus on observable behavior." } };

/// Borrowed for the lifetime of joined workers. Admission supplies immutable
/// snapshot/profile data separately from the nonpersistent transport credential.
pub const State = struct {
    snapshot: native.repository.Snapshot,
    profile_identity: [32]u8,
    provider: native.responses.Environment,
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
    const parsed = try native.json.parse(ctx.allocator, ctx.profile, .{ .bytes = 256 * 1024 });
    const settings = try native.values.fromJson(native.responses.Settings, ctx.allocator, native.json.get(parsed.value, "responses") orelse return error.MissingConfiguration);
    const effort = std.meta.stringToEnum(@typeInfo(@FieldType(@typeInfo(@FieldType(t.P.ModelParameters, "reasoning")).optional.child, "effort")).optional.child, settings.effort.bytes) orelse return error.InvalidConfiguration;
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
    var provider_context = ctx;
    provider_context.environment = @ptrCast(@constCast(&frozen.provider));
    return Adapter.acquire(provider_context, bytes);
}
