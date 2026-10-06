//! One stdin reader and stdout writer; protocol admission grants no effects.
const std = @import("std");
const json = @import("json.zig");
const protocol = @import("protocol.zig");
const registry = @import("registry.zig");
const discovery = @import("discovery.zig");
const client_api = @import("client.zig");
const tasks = @import("tasks.zig");
const Namespace = @import("namespace.zig").Namespace;
const transport_api = @import("transport.zig");
const Worker = @import("worker.zig").Worker;
const world = @import("world");
const c = @import("native_c");

fn Connection(comptime Types: type) type {
    return struct {
        application: *const discovery.Application,
        instance: []const u8,
        initialized: bool = false,
        closing: bool = false,
        limits: protocol.Limits = .{},
        client: ?*client_api.Client(Types) = null,

        fn call(self: *@This(), a: std.mem.Allocator, request: protocol.Call) !json.Value {
            if (request.method == .initialize) {
                if (self.initialized) return protocol.failure(a, request.id, .ProtocolState, "correct_request");
                const versions = request.params.object.get("protocol_versions").?;
                if (versions != .array or versions.array.items.len == 0 or versions.array.items.len > 16)
                    return protocol.failure(a, request.id, .InvalidParams, "correct_request");
                var supported = false;
                for (versions.array.items) |version| {
                    if (version != .string or version.string.len > 128) return protocol.failure(a, request.id, .InvalidParams, "correct_request");
                    supported = supported or std.mem.eql(u8, version.string, protocol.version);
                }
                if (json.get(request.params, "client_info")) |info| {
                    protocol.closed(info, .{ .required = &.{ "name", "version" } }) catch
                        return protocol.failure(a, request.id, .InvalidParams, "correct_request");
                    for (info.object.values()) |value| if (value != .string or value.string.len > 128)
                        return protocol.failure(a, request.id, .InvalidParams, "correct_request");
                }
                if (!supported) {
                    self.closing = true;
                    var fault = try protocol.failure(a, request.id, .ProtocolState, "correct_request");
                    var versions_out: std.array_list.Managed(json.Value) = .init(a);
                    try versions_out.append(json.string(protocol.version));
                    const error_value = fault.object.getPtr("error").?;
                    try json.put(a, error_value.object.getPtr("data").?, "supported_versions", .{ .array = versions_out });
                    return fault;
                }
                self.initialized = true;
                var result = json.object();
                try json.put(a, &result, "protocol_version", json.string(protocol.version));
                try json.put(a, &result, "server_instance_id", json.string(self.instance));
                var info = json.object();
                try json.put(a, &info, "name", json.string("Agent native host"));
                try json.put(a, &info, "version", json.string("1.0.0-dev"));
                try json.put(a, &result, "server_info", info);
                try json.put(a, &result, "build_manifest_id", json.string(self.application.manifest_id));
                const limits_bytes = try std.json.Stringify.valueAlloc(a, self.limits, .{});
                const limits = try json.parse(a, limits_bytes, .{});
                try json.put(a, &result, "limits", limits.value);
                var capabilities = json.object();
                var messages = false;
                if (self.client) |client| for (client.service.handlers.entries) |entry| {
                    messages = messages or entry.declaration.kind == .inbox;
                };
                try json.put(a, &capabilities, "task_events", .{ .bool = self.client != null });
                try json.put(a, &capabilities, "message_input", .{ .bool = messages });
                try json.put(a, &capabilities, "task_execution", .{ .bool = self.client != null });
                try json.put(a, &result, "capabilities", capabilities);
                return protocol.response(a, request.id, result);
            }
            if (!self.initialized) return protocol.failure(a, request.id, .ProtocolState, "correct_request");
            switch (request.method) {
                .ping => {
                    var result = json.object();
                    try json.put(a, &result, "server_instance_id", json.string(self.instance));
                    return protocol.response(a, request.id, result);
                },
                .describe => {
                    const result = self.application.describe(a, request.params) catch |err| return protocol.failure(a, request.id, if (err == error.NotFound) .NotFound else .InvalidParams, "correct_request");
                    return protocol.response(a, request.id, result);
                },
                else => {
                    const client = self.client orelse return protocol.failure(a, request.id, .UnsupportedCapability, "correct_request");
                    const result = client.call(a, request.method, request.params) catch |err| {
                        const kind = failureKind(err);
                        return protocol.failure(a, request.id, kind, if (kind == .StorageUnavailable) "retry_same_operation_or_inspect" else "correct_request");
                    };
                    return protocol.response(a, request.id, result);
                },
            }
        }

        fn member(self: *@This(), a: std.mem.Allocator, value: json.Value, batch: bool) !?json.Value {
            return switch (protocol.admit(value, self.limits, batch)) {
                .notification => null,
                .failure => |fault| try protocol.failure(a, fault.id, fault.kind, "correct_request"),
                .call => |request| try self.call(a, request),
            };
        }

        fn frame(self: *@This(), a: std.mem.Allocator, value: json.Value) !?json.Value {
            if (self.client) |client| client.batch = value == .array;
            if (value != .array) return self.member(a, value, false);
            protocol.batchPreflight(value.array.items, self.limits) catch |err| {
                if (err == error.DuplicateId) self.closing = true;
                return try protocol.failure(a, .null, .InvalidRequest, "correct_request");
            };
            var results: std.array_list.Managed(json.Value) = .init(a);
            for (value.array.items) |item| if (try self.member(a, item, true)) |result| try results.append(result);
            return if (results.items.len == 0) null else .{ .array = results };
        }
    };
}

fn failureKind(err: anyerror) protocol.Kind {
    return switch (err) {
        error.Denied, error.UnknownTask, error.NotFound => .NotFound,
        error.OperationConflict => .OperationConflict,
        error.StaleInteraction, error.QuestionMismatch => .StaleInteraction,
        error.AnswerConflict => .AnswerConflict,
        error.CursorExpired => .CursorExpired,
        error.Capacity, error.OutOfMemory, error.Overloaded => .Overloaded,
        error.TerminalTask, error.StaleRevision, error.UnsettledOccurrence, error.IncompatibleProfile, error.ShuttingDown => .StateConflict,
        error.MissingArtifact, error.ArtifactUnavailable => .ArtifactUnavailable,
        error.UnsupportedCapability => .UnsupportedCapability,
        error.StorageUnavailable, error.CorruptState => .StorageUnavailable,
        error.InvalidParams, error.InvalidValue, error.InvalidJson, error.Overflow, error.InvalidCharacter => .InvalidParams,
        else => .InternalError,
    };
}

pub fn run(comptime Types: type, comptime Environment: type, init: std.process.Init, assets: discovery.Assets) !u8 {
    var args = init.minimal.args.iterate();
    _ = args.next();
    const command = args.next() orelse "--help";
    if (std.mem.eql(u8, command, "--help")) {
        if (args.next() != null) return 64;
        try std.Io.File.stdout().writeStreamingAll(init.io, "Agent native application\n\n--help\ndescribe-build\nlicenses\ndemo --offline --state-dir PATH\nserve --transport stdio --offline [--state-dir PATH]\n\nA state directory enables durable tasks. Without it, serve provides discovery only.\n");
        return 0;
    }
    if (std.mem.eql(u8, command, "describe-build") or std.mem.eql(u8, command, "licenses")) {
        if (args.next() != null) return 64;
        try std.Io.File.stdout().writeStreamingAll(init.io, assets.manifest);
        try std.Io.File.stdout().writeStreamingAll(init.io, "\n");
        return 0;
    }
    const demo = std.mem.eql(u8, command, "demo");
    if (!demo and !std.mem.eql(u8, command, "serve")) return 64;
    var offline = false;
    var stdio = false;
    var state_path: ?[]const u8 = null;
    while (args.next()) |arg| {
        if (std.mem.eql(u8, arg, "--offline") and !offline) offline = true else if (std.mem.eql(u8, arg, "--transport") and !stdio and !demo) {
            if (!std.mem.eql(u8, args.next() orelse return 64, "stdio")) return 64;
            stdio = true;
        } else if (std.mem.eql(u8, arg, "--state-dir") and state_path == null) state_path = args.next() orelse return 64 else return 64;
    }
    if (!offline or (!demo and !stdio) or (demo and state_path == null)) return 64;

    // Main-thread allocations are reclaimable and bounded. Workers use their
    // own preallocated region, so this accounting never races with worker I/O.
    var budget: world.AllocationBudget = .{ .parent = init.gpa, .limit = 64 * 1024 * 1024 };
    const a = budget.allocator();
    var handlers = try registry.Registry.init(a, &Environment.handlers);
    defer handlers.deinit();
    var application = try discovery.Application.init(Types, a, assets, handlers);
    defer application.deinit();
    var identity: [16]u8 = undefined;
    try init.io.randomSecure(&identity);
    const instance = std.fmt.bytesToHex(identity, .lower);
    var namespace: ?Namespace = null;
    defer if (namespace) |*owner| owner.close() catch {};
    if (state_path) |path| namespace = Namespace.open(a, init.io, path) catch |err| return switch (err) {
        error.Busy => 75,
        error.UnsafeStatePath, error.ForeignNamespace => 64,
        else => 74,
    };
    var profile_arena = std.heap.ArenaAllocator.init(a);
    defer profile_arena.deinit();
    const profile_allocator = profile_arena.allocator();
    const grants = try profile_allocator.alloc(registry.Grant, handlers.entries.len);
    for (handlers.entries, grants) |entry, *grant| grant.* = .{ .identity = entry.declaration.identity, .resource_role = entry.declaration.resource_role, .resource_identity = application.image_identity };
    const profile_bytes = try std.json.Stringify.valueAlloc(profile_allocator, .{ .mode = "offline", .application = Types.application_id, .assets = try discovery.digest(profile_allocator, assets.application) }, .{});
    const profile: tasks.Profile = .{ .id = "offline", .bytes = profile_bytes, .authority = .{ .grants = grants, .principal = try std.fmt.allocPrint(profile_allocator, "uid:{d}", .{c.geteuid()}), .tenant = "local" } };
    var service: ?tasks.Service(Types) = null;
    defer if (service) |*owner| owner.close(a) catch {};
    if (namespace) |*owner| service = try tasks.Service(Types).init(a, init.io, owner, assets, &application, handlers, profile);
    var client: ?client_api.Client(Types) = null;
    if (service) |*owner| client = .{ .service = owner };
    if (demo) {
        var arena = std.heap.ArenaAllocator.init(a);
        defer arena.deinit();
        const result = try @import("demo.zig").run(Types, Environment, arena.allocator(), &service.?, &client.?, &instance);
        try std.Io.File.stdout().writeStreamingAll(init.io, try json.canonical(arena.allocator(), result));
        try std.Io.File.stdout().writeStreamingAll(init.io, "\n");
        return 0;
    }
    var connection: Connection(Types) = .{ .application = &application, .instance = &instance, .client = if (client) |*value| value else null };
    return serve(Types, init.io, a, &connection);
}

var interrupts: std.atomic.Value(u32) = .init(0);
fn interrupt(_: c_int) callconv(.c) void {
    _ = interrupts.fetchAdd(1, .monotonic);
}

fn requestIds(value: json.Value, buffer: *[16]transport_api.Id) []const transport_api.Id {
    var count: usize = 0;
    if (value == .array) {
        if (value.array.items.len > 16) return &.{};
        for (value.array.items) |item| if (json.get(item, "id")) |id| {
            buffer[count] = transport_api.Id.from(id) catch continue;
            count += 1;
        };
    } else if (json.get(value, "id")) |id| {
        buffer[0] = transport_api.Id.from(id) catch return &.{};
        count = 1;
    }
    return buffer[0..count];
}

fn serve(comptime Types: type, io: std.Io, a: std.mem.Allocator, connection: *Connection(Types)) !u8 {
    var transport = try transport_api.Transport.init(a, io, connection.limits);
    defer transport.deinit();
    interrupts.store(0, .release);
    const old_pipe = c.signal(c.SIGPIPE, c.SIG_IGN);
    const old_int = c.signal(c.SIGINT, interrupt);
    const old_term = c.signal(c.SIGTERM, interrupt);
    defer {
        _ = c.signal(c.SIGPIPE, old_pipe);
        _ = c.signal(c.SIGINT, old_int);
        _ = c.signal(c.SIGTERM, old_term);
    }
    const worker: ?*Worker = if (connection.client != null) try Worker.init(a, io) else null;
    defer if (worker) |slot| {
        // Unexpected failure with live I/O uses process-crash recovery. Never
        // release the namespace while a thread can still dispatch or publish.
        if (slot.future != null) std.process.exit(74);
        slot.deinit(a) catch {};
    };
    var shutdown_at: ?i64 = null;
    var code: u8 = 0;
    var writable = true;
    var cancelled_owned = false;
    var parked = false;
    var closed_notice = false;
    while (true) {
        var arena = std.heap.ArenaAllocator.init(a);
        defer arena.deinit();
        const frame = arena.allocator();
        var progressed = false;
        const time = transport.now();
        const signals = interrupts.load(.acquire);
        if (signals != 0 and shutdown_at == null) {
            shutdown_at = time;
            if (connection.client) |client| client.shutdown = .cancel;
        }
        if (signals > 1) std.process.exit(2);
        transport.deadlines() catch |err| {
            if (shutdown_at == null) shutdown_at = time;
            if (err == error.FrameTimeout) code = 64 else {
                writable = false;
                if (code == 0) code = 2;
            }
        };
        if (writable) transport.flush(if (connection.client) |client| !client.service.profile.authority.revoked else true) catch {
            writable = false;
            if (shutdown_at == null) shutdown_at = time;
        };
        // During explicit shutdown, bounded reads remain available while work
        // drains. Fatal framing and EOF stop admissions immediately.
        if (!connection.closing and code == 0 and writable and !transport.eof and transport.canAdmit()) {
            const incoming = transport.next() catch |err| blk: {
                if (shutdown_at == null) shutdown_at = time;
                connection.closing = true;
                code = if (err == error.TruncatedFrame or err == error.FrameTooLarge) 64 else 74;
                break :blk null;
            };
            if (incoming) |bytes| {
                const parsed: ?std.json.Parsed(json.Value) = json.parse(frame, bytes, .{}) catch |err| blk: {
                    if (err == error.Capacity or err == error.OutOfMemory) {
                        connection.closing = true;
                        code = 64;
                    }
                    const fault = try protocol.failure(frame, .null, if (err == error.DuplicateKey) .InvalidRequest else .ParseError, "correct_request");
                    if (writable) try transport.enqueue(try json.canonical(frame, fault), &.{}, false);
                    transport.consumed();
                    progressed = true;
                    break :blk null;
                };
                if (parsed) |value| {
                    var id_buffer: [16]transport_api.Id = undefined;
                    const ids = requestIds(value.value, &id_buffer);
                    const admitted = blk: {
                        transport.preflight(ids) catch |err| {
                            if (err == error.DuplicateId) {
                                connection.closing = true;
                                code = 64;
                                const fault = try protocol.failure(frame, .null, .InvalidRequest, "reconnect");
                                if (writable) try transport.enqueue(try json.canonical(frame, fault), &.{}, false);
                                transport.consumed();
                            }
                            break :blk false;
                        };
                        break :blk true;
                    };
                    if (admitted) {
                        if (try connection.frame(frame, value.value)) |response| {
                            const encoded = try json.canonical(frame, response);
                            try transport.enqueue(encoded, ids, connection.client != null);
                        }
                        transport.consumed();
                        progressed = true;
                    }
                }
            }
        }
        if (transport.eof or connection.closing or !writable or (connection.client != null and connection.client.?.shutdown != null)) {
            if (shutdown_at == null) shutdown_at = time;
        }
        if (connection.closing and code == 0) code = 64;
        if (connection.client) |client| {
            const service = client.service;
            const slot = worker.?;
            if (shutdown_at != null and client.shutdown == null) client.shutdown = .park;
            const mode = client.shutdown orelse .park;
            if (shutdown_at != null and mode == .cancel and !cancelled_owned) {
                for (service.owned) |owned| if (owned) |id| {
                    const operation = try std.fmt.allocPrint(frame, "shutdown-{s}-{s}", .{ connection.instance, std.fmt.bytesToHex(id, .lower) });
                    _ = try service.requestCancel(frame, operation, id, "host requested cancellation");
                };
                cancelled_owned = true;
            }
            if (slot.future != null) {
                var task = try service.task(frame, slot.work.task);
                defer task.deinit();
                if (shutdown_at != null or task.value.cancellation != null) slot.cancel();
                if (slot.finished()) {
                    try slot.join();
                    if (slot.reply) |reply| try service.acquire(frame, slot.work, reply) else {
                        try service.unknown(frame, slot.work);
                        if (shutdown_at != null) code = 2;
                    }
                    try slot.release();
                    progressed = true;
                }
            }
            if (!parked and (shutdown_at == null or (mode == .cancel and code == 0))) {
                const step = service.pump(frame) catch |err| blk: {
                    if (shutdown_at == null) shutdown_at = time;
                    code = if (err == error.Denied) 2 else 74;
                    break :blk tasks.Step.idle;
                };
                switch (step) {
                    .work => |work| slot.start(work, service.profile.authority, null) catch {
                        try service.unknown(frame, work);
                    },
                    .progressed, .waiting => progressed = true,
                    .idle => {},
                }
            }
            if (writable and shutdown_at == null and !closed_notice and transport.canAdmit()) {
                if (try client.notification(frame)) |notification| {
                    try transport.enqueue(try json.canonical(frame, notification), &.{}, true);
                    progressed = true;
                }
            }
            if (shutdown_at != null and !parked and slot.future == null and (mode == .park or service.runnable.items.len == 0 or code != 0)) {
                if (!service.namespace.store.fenced) try service.park(frame);
                parked = true;
                for (service.owned) |owned| if (owned) |id| {
                    var task = try service.task(frame, id);
                    defer task.deinit();
                    if (try service.status(frame, task.value) == .unknown or (!task.value.terminal() and task.value.cancellation != null)) {
                        if (code == 0) code = 2;
                    }
                };
            }
        } else if (shutdown_at != null) parked = true;
        if (shutdown_at) |start| {
            if (time - start >= connection.limits.output_stall_ms) {
                // A joined worker is the only ordinary path to releasing the
                // lock. At the hard deadline process exit terminates all native
                // threads together; durable DISPATCHING recovers as UNKNOWN.
                if (worker) |slot| if (slot.future != null) std.process.exit(if (code == 0) 2 else code);
                return if (code == 0 and !parked) 2 else code;
            }
            if (parked) {
                if (!closed_notice and writable and connection.initialized and (code == 0 or code == 2)) {
                    var params = json.object();
                    const mode = if (connection.client) |client| client.shutdown orelse .park else .park;
                    try json.put(frame, &params, "mode", json.string(@tagName(mode)));
                    try json.put(frame, &params, "disposition", json.string(if (code == 2) "incomplete" else if (mode == .cancel) "cancelled" else "parked"));
                    var pending: std.array_list.Managed(json.Value) = .init(frame);
                    if (connection.client) |client| for (client.service.owned) |owned| if (owned) |id| {
                        try pending.append(json.string(try frame.dupe(u8, &std.fmt.bytesToHex(id, .lower))));
                    };
                    try json.put(frame, &params, "recovery_tasks", .{ .array = pending });
                    try transport.enqueue(try json.canonical(frame, try protocol.notification(frame, "server.closed", params)), &.{}, connection.client != null);
                    closed_notice = true;
                }
                if (!writable or transport.count == 0) return code;
            }
        }
        try transport.wait(!connection.closing and transport.canAdmit(), if (progressed) 0 else 20);
    }
}
