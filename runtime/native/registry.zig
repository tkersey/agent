//! Static compiled adapters. Requests must match identity, both canonical
//! schemas, and a current launch/task grant before adapter code can run.
const std = @import("std");
const data = @import("boundary_data");
const contracts = @import("agent_contracts");
const values = @import("values.zig");
const json = @import("json.zig");
const state = @import("state.zig");

/// Pure projection inputs: immutable objects and frozen task bindings, with no
/// I/O, credentials, evaluator, or mutable store supplied to adapter code.
pub const ProjectionContext = struct {
    allocator: std.mem.Allocator,
    task: state.TaskId,
    tenant: []const u8,
    profile: []const u8,
    objects: struct {
        owner: *anyopaque,
        read: *const fn (*anyopaque, std.mem.Allocator, state.Reference, usize) anyerror![]u8,
    },

    pub fn object(self: ProjectionContext, ref: state.Reference, limit: usize) ![]u8 {
        return self.objects.read(self.objects.owner, self.allocator, ref, limit);
    }
};
pub const Projection = struct {
    reply: []const u8,
    /// Immutable replay artifacts are committed atomically with the reply.
    objects: []const []const u8 = &.{},
};
pub const CaptureAdapter = struct {
    prepare: *const fn (ProjectionContext, []const u8) anyerror![]u8,
    interpret: *const fn (ProjectionContext, []const u8, []const u8, []const u8) anyerror!Projection,
};

pub const Grant = struct {
    identity: []const u8,
    resource_role: []const u8,
    resource_identity: [32]u8,
};
pub const Authority = struct {
    grants: []const Grant,
    principal: []const u8,
    tenant: []const u8,
    inference: bool = false,
    revoked: bool = false,
    disclosure: bool = true,
};
pub const Context = struct {
    allocator: std.mem.Allocator,
    io: std.Io,
    authority: *const Authority,
    task_id: []const u8,
    /// Application/environment handles only; no evaluator handle is supplied.
    environment: ?*anyopaque = null,
    cancellation: ?*const std.atomic.Value(bool) = null,

    pub fn checkCancellation(self: Context) error{Canceled}!void {
        if (self.cancellation) |flag| if (flag.load(.acquire)) return error.Canceled;
    }
};
pub const Kind = enum { leaf, question, inbox };
pub const Declaration = struct {
    identity: []const u8,
    resource_role: []const u8,
    kind: Kind,
    inference: bool = false,
    background: bool = false,
    /// invoke receives prepared bytes and returns an uninterpreted capture.
    capture: ?CaptureAdapter = null,
    payload_schema: *const fn (std.mem.Allocator) anyerror![]u8,
    resume_schema: *const fn (std.mem.Allocator) anyerror![]u8,
    invoke: ?*const fn (Context, []const u8) anyerror![]u8 = null,
    present: ?*const fn (Context, []const u8) anyerror!json.Value = null,
    answer: ?*const fn (std.mem.Allocator, json.Value) anyerror![]u8 = null,
    answer_schema_id: ?[]const u8 = null,
};
pub const Entry = struct {
    declaration: Declaration,
    payload_schema: []const u8,
    resume_schema: []const u8,
};

pub const Registry = struct {
    arena: std.heap.ArenaAllocator,
    entries: []const Entry,

    pub fn init(a: std.mem.Allocator, declarations: []const Declaration) !Registry {
        if (declarations.len > 64) return error.Capacity;
        var arena = std.heap.ArenaAllocator.init(a);
        errdefer arena.deinit();
        const storage = arena.allocator();
        const entries = try storage.alloc(Entry, declarations.len);
        for (declarations, entries, 0..) |declaration, *entry, i| {
            if (declaration.identity.len == 0 or declaration.resource_role.len == 0) return error.InvalidCapability;
            for (declarations[0..i]) |prior| if (std.mem.eql(u8, prior.identity, declaration.identity)) return error.DuplicateCapability;
            if (declaration.kind == .leaf and declaration.invoke == null) return error.InvalidCapability;
            if (declaration.capture != null and (declaration.kind != .leaf or !declaration.background)) return error.InvalidCapability;
            if (declaration.kind == .question and (declaration.present == null or declaration.answer == null or declaration.answer_schema_id == null)) return error.InvalidCapability;
            entry.* = .{
                .declaration = declaration,
                .payload_schema = try declaration.payload_schema(storage),
                .resume_schema = try declaration.resume_schema(storage),
            };
        }
        return .{ .arena = arena, .entries = entries };
    }
    pub fn deinit(self: *Registry) void {
        self.arena.deinit();
        self.* = undefined;
    }

    pub fn admit(self: Registry, request: data.invocation.Request, authority: Authority, image_identity: [32]u8) !Entry {
        if (authority.revoked) return error.Denied;
        const entry = try self.resolve(request, image_identity);
        const declaration = entry.declaration;
        if (declaration.inference and !authority.inference) return error.Denied;
        for (authority.grants) |grant| {
            if (std.mem.eql(u8, grant.identity, declaration.identity) and std.mem.eql(u8, grant.resource_role, declaration.resource_role)) return entry;
        }
        return error.Denied;
    }

    /// Schema/identity resolution does not authorize fresh I/O. Recovery uses
    /// this path to consume a saved reply without requiring a new spend grant.
    pub fn resolve(self: Registry, request: data.invocation.Request, image_identity: [32]u8) !Entry {
        if (!std.mem.eql(u8, &request.binding.program_identity, &image_identity)) return error.Denied;
        for (self.entries) |entry| {
            const declaration = entry.declaration;
            if (!std.mem.eql(u8, request.binding.semantic_identity, declaration.identity)) continue;
            if (!std.mem.eql(u8, request.binding.payload_schema, entry.payload_schema) or
                !std.mem.eql(u8, request.binding.resume_schema, entry.resume_schema)) return error.CapabilitySchemaMismatch;
            return entry;
        }
        return error.MissingCapability;
    }
};

pub fn leaf(comptime Payload: type, comptime Reply: type, comptime options: struct {
    identity: []const u8,
    resource_role: []const u8,
    inference: bool = false,
    background: bool = false,
}, comptime handle: fn (Context, Payload) anyerror!Reply) Declaration {
    return .{
        .identity = options.identity,
        .resource_role = options.resource_role,
        .kind = .leaf,
        .inference = options.inference,
        .background = options.background,
        .payload_schema = struct {
            fn schema(a: std.mem.Allocator) ![]u8 {
                return values.schemaBytes(Payload, a);
            }
        }.schema,
        .resume_schema = struct {
            fn schema(a: std.mem.Allocator) ![]u8 {
                return values.schemaBytes(Reply, a);
            }
        }.schema,
        .invoke = struct {
            fn invoke(ctx: Context, bytes: []const u8) ![]u8 {
                var payload = try contracts.decodeOwned(Payload, ctx.allocator, bytes);
                defer payload.deinit();
                const result = try handle(ctx, payload.value);
                return contracts.encodeOwned(Reply, ctx.allocator, result);
            }
        }.invoke,
    };
}

pub fn question(comptime Payload: type, comptime Answer: type, comptime options: struct {
    identity: []const u8,
    resource_role: []const u8,
    answer_schema_id: []const u8,
}, comptime present: fn (Context, Payload) anyerror!json.Value) Declaration {
    return .{
        .identity = options.identity,
        .resource_role = options.resource_role,
        .kind = .question,
        .answer_schema_id = options.answer_schema_id,
        .payload_schema = struct {
            fn schema(a: std.mem.Allocator) ![]u8 {
                return values.schemaBytes(Payload, a);
            }
        }.schema,
        .resume_schema = struct {
            fn schema(a: std.mem.Allocator) ![]u8 {
                return values.schemaBytes(Answer, a);
            }
        }.schema,
        .present = struct {
            fn call(ctx: Context, bytes: []const u8) !json.Value {
                var payload = try contracts.decodeOwned(Payload, ctx.allocator, bytes);
                defer payload.deinit();
                // Presentation may borrow its input, so retain it in the
                // caller's arena by round-tripping the bounded JSON value.
                const shown = try present(ctx, payload.value);
                const encoded = try json.canonical(ctx.allocator, shown);
                return std.json.parseFromSliceLeaky(json.Value, ctx.allocator, encoded, .{ .allocate = .alloc_always, .parse_numbers = false });
            }
        }.call,
        .answer = struct {
            fn encode(a: std.mem.Allocator, value: json.Value) ![]u8 {
                return values.encodeClient(Answer, a, value);
            }
        }.encode,
    };
}

test "capability admission requires the complete schema and current resource grant" {
    const a = std.testing.allocator;
    const increment = struct {
        fn run(_: Context, input: u32) !u32 {
            return std.math.add(u32, input, 1);
        }
    }.run;
    var registry = try Registry.init(a, &.{leaf(u32, u32, .{ .identity = "increment.v1", .resource_role = "local" }, increment)});
    defer registry.deinit();
    const entry = registry.entries[0];
    const binding: data.invocation.Binding = .{ .program_identity = @splat(1), .pending_state_digest = @splat(2), .effect = 0, .semantic_identity = "increment.v1", .payload_schema = entry.payload_schema, .resume_schema = entry.resume_schema, .payload = &.{ 1, 0, 0, 0 } };
    const request = try data.invocation.request(binding);
    const authority: Authority = .{ .principal = "test", .tenant = "test", .grants = &.{.{ .identity = "increment.v1", .resource_role = "local", .resource_identity = @splat(3) }} };
    _ = try registry.admit(request, authority, @splat(1));
    var disabled = authority;
    disabled.grants = &.{};
    try std.testing.expectError(error.Denied, registry.admit(request, disabled, @splat(1)));
    disabled = authority;
    disabled.revoked = true;
    try std.testing.expectError(error.Denied, registry.admit(request, disabled, @splat(1)));
    var wrong = request;
    wrong.binding.resume_schema = &.{};
    try std.testing.expectError(error.CapabilitySchemaMismatch, registry.admit(wrong, authority, @splat(1)));
}
