//! Embedded application/handler agreement and offline protocol discovery.
const std = @import("std");
const data = @import("boundary_data");
const json = @import("json.zig");
const values = @import("values.zig");
const protocol = @import("protocol.zig");
const registry = @import("registry.zig");
const contracts = @import("agent_contracts");

pub const Assets = struct { image: []const u8, application: []const u8, manifest: []const u8 };

pub fn digest(a: std.mem.Allocator, bytes: []const u8) ![]const u8 {
    var hash: [32]u8 = undefined;
    std.crypto.hash.sha2.Sha256.hash(bytes, &hash, .{});
    return a.dupe(u8, &std.fmt.bytesToHex(hash, .lower));
}

pub const Application = struct {
    arena: std.heap.ArenaAllocator,
    metadata: json.Value,
    manifest: json.Value,
    manifest_id: []const u8,
    image_identity: [32]u8,
    protocol_schema: json.Value = .null,
    protocol_schema_sha256: []const u8 = "",

    pub fn init(comptime Types: type, a: std.mem.Allocator, assets: Assets, handlers: registry.Registry) !Application {
        var arena = std.heap.ArenaAllocator.init(a);
        errdefer arena.deinit();
        const storage = arena.allocator();
        const metadata = try json.parse(storage, assets.application, .{ .bytes = 16 * 1024 * 1024 });
        const manifest = try json.parse(storage, assets.manifest, .{ .bytes = 256 * 1024 });
        try sameField(metadata.value, "format", "agent-native-application/v1");
        try sameField(metadata.value, "application_id", Types.application_id);
        try sameField(metadata.value, "application_version", Types.application_version);
        try sameField(metadata.value, "client_mapping", "agent-client-values/1.0");
        try sameField(metadata.value, "program_sha256", try digest(storage, assets.image));
        try sameField(manifest.value, "format", "agent-native-build/v1");
        try sameField(manifest.value, "state_format", std.fmt.comptimePrint("agent-native-state/{d}", .{@import("store.zig").format}));
        try sameField(manifest.value, "program_sha256", try digest(storage, assets.image));
        try sameField(manifest.value, "application_assets_sha256", try digest(storage, assets.application));
        const admitted = try data.program_image.Admitted.decode(storage, assets.image);
        defer admitted.deinit();
        const image_identity = admitted.identity();
        try sameField(metadata.value, "program_identity", &std.fmt.bytesToHex(image_identity, .lower));
        inline for (.{ .{ "input", Types.Input, Types.input_schema_id }, .{ "output", Types.Output, Types.output_schema_id }, .{ "failure", Types.Failure, Types.failure_schema_id }, .{ "answer", Types.Answer, Types.answer_schema_id }, .{ "message", Types.Message, Types.message_schema_id } }) |item| {
            const schema = json.get(metadata.value, item[0]) orelse return error.InvalidAssets;
            try sameField(schema, "schema_id", item[2]);
            const bytes = try values.schemaBytes(item[1], storage);
            try sameField(schema, "wire_sha256", try digest(storage, bytes));
            const client = try json.parse(storage, &values.schemas.ClientSchema(item[1]).value, .{});
            if (!std.mem.eql(u8, try json.canonical(storage, client.value), try json.canonical(storage, json.get(schema, "json") orelse return error.InvalidAssets)))
                return error.InvalidAssets;
        }
        const capabilities = json.get(metadata.value, "capabilities") orelse return error.InvalidAssets;
        if (capabilities != .array or capabilities.array.items.len != handlers.entries.len) return error.InvalidAssets;
        for (handlers.entries) |entry| {
            switch (entry.declaration.kind) {
                .question => {
                    if (!std.mem.eql(u8, entry.declaration.answer_schema_id.?, Types.answer_schema_id) or
                        !std.mem.eql(u8, entry.resume_schema, try values.schemaBytes(Types.Answer, storage))) return error.InvalidAssets;
                },
                .inbox => {
                    if (!std.mem.eql(u8, entry.payload_schema, try values.schemaBytes(void, storage)) or
                        !std.mem.eql(u8, entry.resume_schema, try values.schemaBytes(contracts.InboxReply(Types.Message), storage))) return error.InvalidAssets;
                },
                .leaf => {},
            }
            var matches: usize = 0;
            for (capabilities.array.items) |capability| {
                const id = json.get(capability, "identity") orelse return error.InvalidAssets;
                if (id != .string or !std.mem.eql(u8, id.string, entry.declaration.identity)) continue;
                matches += 1;
                try sameField(capability, "resource_role", entry.declaration.resource_role);
                try sameField(capability, "payload_sha256", try digest(storage, entry.payload_schema));
                try sameField(capability, "resume_sha256", try digest(storage, entry.resume_schema));
            }
            if (matches != 1) return error.InvalidAssets;
        }
        const protocol_schema = try @import("schemas.zig").document(storage, metadata.value, .{});
        return .{ .arena = arena, .metadata = metadata.value, .manifest = manifest.value, .manifest_id = try digest(storage, assets.manifest), .image_identity = image_identity, .protocol_schema = protocol_schema, .protocol_schema_sha256 = try digest(storage, try json.canonical(storage, protocol_schema)) };
    }
    pub fn deinit(self: *Application) void {
        self.arena.deinit();
        self.* = undefined;
    }

    /// This projection is deliberately bounded; larger schema/resource assets
    /// are retained for the authorized artifact service rather than truncated.
    pub fn describe(self: Application, a: std.mem.Allocator, params: json.Value) !json.Value {
        if (json.get(params, "application_id")) |id| {
            const expected = try json.text(self.metadata.object.get("application_id").?);
            if (id != .string or !std.mem.eql(u8, id.string, expected)) return error.NotFound;
        }
        const cursor: usize = if (json.get(params, "cursor")) |value| try json.decimal(usize, value) else 0;
        const limit: usize = if (json.get(params, "limit")) |value| blk: {
            if (value != .number_string) return error.InvalidParams;
            break :blk try json.integer(usize, value.number_string);
        } else 16;
        if (limit == 0 or limit > 16) return error.InvalidParams;
        const info = @typeInfo(protocol.Method).@"enum";
        if (cursor > info.field_names.len) return error.InvalidParams;
        const end = @min(info.field_names.len, cursor + limit);
        var methods: std.array_list.Managed(json.Value) = .init(a);
        inline for (info.field_names, 0..) |name, i| {
            if (i >= cursor and i < end) {
                var method = json.object();
                try json.put(a, &method, "name", json.string(name));
                const fields = protocol.fields(@field(protocol.Method, name));
                var required: std.array_list.Managed(json.Value) = .init(a);
                var optional: std.array_list.Managed(json.Value) = .init(a);
                for (fields.required) |key| try required.append(json.string(key));
                for (fields.optional) |key| try optional.append(json.string(key));
                try json.put(a, &method, "required_fields", .{ .array = required });
                try json.put(a, &method, "optional_fields", .{ .array = optional });
                try json.put(a, &method, "params_schema", json.string("#/$defs/" ++ name ++ ".params"));
                try json.put(a, &method, "result_schema", json.string("#/$defs/" ++ name ++ ".result"));
                try methods.append(method);
            }
        }
        var result = json.object();
        try json.put(a, &result, "methods", .{ .array = methods });
        try json.put(a, &result, "next_cursor", if (end < info.field_names.len) json.string(try std.fmt.allocPrint(a, "{d}", .{end})) else .null);
        var app = json.object();
        for ([_][]const u8{ "application_id", "application_version", "client_mapping", "input", "output", "failure", "answer", "message", "capabilities" }) |key|
            try json.put(a, &app, key, self.metadata.object.get(key) orelse return error.InvalidAssets);
        try json.put(a, &result, "application", app);
        try json.put(a, &result, "execution_mode", json.string("offline"));
        try json.put(a, &result, "protocol_schema", self.protocol_schema);
        return result;
    }
};

pub fn sameField(object: json.Value, name: []const u8, expected: []const u8) !void {
    const field = json.get(object, name) orelse return error.InvalidAssets;
    if (field != .string or !std.mem.eql(u8, field.string, expected)) return error.InvalidAssets;
}
