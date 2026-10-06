//! One stdin reader and stdout writer; protocol admission grants no effects.
const std = @import("std");
const json = @import("json.zig");
const protocol = @import("protocol.zig");
const registry = @import("registry.zig");
const discovery = @import("discovery.zig");

const Connection = struct {
    application: *const discovery.Application,
    instance: []const u8,
    initialized: bool = false,
    closing: bool = false,
    limits: protocol.Limits = .{},

    fn call(self: *Connection, a: std.mem.Allocator, request: protocol.Call) !json.Value {
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
            // The durable owner is added separately. Never advertise or accept
            // nondurable task mutations as if they satisfied agent-host/1.0.
            try json.put(a, &capabilities, "task_events", .{ .bool = false });
            try json.put(a, &capabilities, "message_input", .{ .bool = false });
            try json.put(a, &capabilities, "task_execution", .{ .bool = false });
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
            else => return protocol.failure(a, request.id, .UnsupportedCapability, "correct_request"),
        }
    }

    fn member(self: *Connection, a: std.mem.Allocator, value: json.Value, batch: bool) !?json.Value {
        return switch (protocol.admit(value, self.limits, batch)) {
            .notification => null,
            .failure => |fault| try protocol.failure(a, fault.id, fault.kind, "correct_request"),
            .call => |request| try self.call(a, request),
        };
    }

    fn frame(self: *Connection, a: std.mem.Allocator, bytes: []const u8) !?json.Value {
        const parsed = json.parse(a, bytes, .{}) catch |err| {
            if (err == error.Capacity or err == error.OutOfMemory) self.closing = true;
            return try protocol.failure(a, .null, if (err == error.DuplicateKey) .InvalidRequest else .ParseError, "correct_request");
        };
        if (parsed.value != .array) return self.member(a, parsed.value, false);
        protocol.batchPreflight(parsed.value.array.items, self.limits) catch |err| {
            if (err == error.DuplicateId) self.closing = true;
            return try protocol.failure(a, .null, .InvalidRequest, "correct_request");
        };
        var results: std.array_list.Managed(json.Value) = .init(a);
        for (parsed.value.array.items) |value| if (try self.member(a, value, true)) |result| try results.append(result);
        return if (results.items.len == 0) null else .{ .array = results };
    }
};

pub fn run(comptime Types: type, comptime Environment: type, init: std.process.Init, assets: discovery.Assets) !u8 {
    var args = init.minimal.args.iterate();
    _ = args.next();
    const command = args.next() orelse "--help";
    if (std.mem.eql(u8, command, "--help")) {
        if (args.next() != null) return 64;
        try std.Io.File.stdout().writeStreamingAll(init.io, "Agent native application\n\n--help\ndescribe-build\nlicenses\ndemo --offline\nserve --transport stdio --offline\n\nDevelopment build: durable task execution is not yet enabled.\n");
        return 0;
    }
    if (std.mem.eql(u8, command, "describe-build") or std.mem.eql(u8, command, "licenses")) {
        if (args.next() != null) return 64;
        try std.Io.File.stdout().writeStreamingAll(init.io, assets.manifest);
        try std.Io.File.stdout().writeStreamingAll(init.io, "\n");
        return 0;
    }
    const demo = std.mem.eql(u8, command, "demo");
    if (demo) {
        if (!std.mem.eql(u8, args.next() orelse return 64, "--offline") or args.next() != null) return 64;
    } else if (!std.mem.eql(u8, command, "serve")) return 64 else if (!std.mem.eql(u8, args.next() orelse return 64, "--transport") or
        !std.mem.eql(u8, args.next() orelse return 64, "stdio") or
        !std.mem.eql(u8, args.next() orelse return 64, "--offline") or args.next() != null) return 64;

    // A finite whole-host allocation domain includes parsing and asset admission.
    const memory = try init.gpa.alloc(u8, 64 * 1024 * 1024);
    defer init.gpa.free(memory);
    var fixed = std.heap.FixedBufferAllocator.init(memory);
    const a = fixed.allocator();
    var handlers = try registry.Registry.init(a, &Environment.handlers);
    defer handlers.deinit();
    var application = try discovery.Application.init(Types, a, assets, handlers);
    defer application.deinit();
    if (demo) {
        const result = try @import("demo.zig").run(Types, Environment, init.io, a, assets, application, handlers);
        try std.Io.File.stdout().writeStreamingAll(init.io, try json.canonical(a, result));
        try std.Io.File.stdout().writeStreamingAll(init.io, "\n");
        return 0;
    }
    var identity: [16]u8 = undefined;
    try init.io.randomSecure(&identity);
    const instance = std.fmt.bytesToHex(identity, .lower);
    var connection = Connection{ .application = &application, .instance = &instance };
    const frame_buffer = try a.alloc(u8, connection.limits.frame_bytes - 1);
    var framing = protocol.Framer{ .buffer = frame_buffer };
    var input: [8192]u8 = undefined;
    while (!connection.closing) {
        const count = try std.Io.File.stdin().readStreaming(init.io, &.{&input});
        if (count == 0) {
            framing.eof() catch return 64;
            return 0;
        }
        var cursor: usize = 0;
        while (cursor < count and !connection.closing) {
            const read = framing.push(input[cursor..count]) catch return 64;
            cursor += read.consumed;
            if (read.frame) |bytes| {
                // All request/response allocations die before accepting another
                // frame. The permanent FBA prefix is not reset or reinitialized.
                var arena = std.heap.ArenaAllocator.init(a);
                defer arena.deinit();
                if (try connection.frame(arena.allocator(), bytes)) |response| {
                    const encoded = try json.canonical(arena.allocator(), response);
                    if (encoded.len >= connection.limits.frame_bytes) return 64;
                    try std.Io.File.stdout().writeStreamingAll(init.io, encoded);
                    try std.Io.File.stdout().writeStreamingAll(init.io, "\n");
                }
            }
        }
    }
    return 64;
}
