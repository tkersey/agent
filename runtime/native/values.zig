//! Native client values use the existing ordinary Agent codecs and schemas.
//! JSON only projects those values; it is not an alternate World wire format.
const std = @import("std");
const data = @import("boundary_data");
const contracts = @import("agent_contracts");
const json = @import("json.zig");
pub const schemas = @import("agent_json_schema");
pub const Error = error{InvalidParams} || std.mem.Allocator.Error;

pub fn fromJson(comptime T: type, a: std.mem.Allocator, value: json.Value) Error!T {
    if (comptime schemas.isText(T)) {
        const text = try json.text(value);
        if (text.len > schemas.maximumTextBytes(T) or !std.unicode.utf8ValidateSlice(text)) return error.InvalidParams;
        return .{ .bytes = text };
    }
    if (@typeInfo(T) == .@"struct" and @hasDecl(T, "agent_value_kind")) {
        if (T.agent_value_kind == .bytes) {
            const text = try json.text(value);
            const size = std.base64.url_safe_no_pad.Decoder.calcSizeForSlice(text) catch return error.InvalidParams;
            if (size > T.max_length.?) return error.InvalidParams;
            const bytes = try a.alloc(u8, size);
            std.base64.url_safe_no_pad.Decoder.decode(bytes, text) catch return error.InvalidParams;
            // Require canonical trailing bits and forbid padded aliases.
            const encoded = try a.alloc(u8, std.base64.url_safe_no_pad.Encoder.calcSize(size));
            if (!std.mem.eql(u8, text, std.base64.url_safe_no_pad.Encoder.encode(encoded, bytes))) return error.InvalidParams;
            return .{ .bytes = bytes };
        }
        if (T.agent_value_kind == .vector) {
            if (value != .array or value.array.items.len > T.max_length) return error.InvalidParams;
            const result = try a.alloc(T.Child, value.array.items.len);
            for (result, value.array.items) |*slot, child| slot.* = try fromJson(T.Child, a, child);
            return .{ .items = result };
        }
    }
    return switch (@typeInfo(T)) {
        .void => if (value == .object and value.object.count() == 0) {} else error.InvalidParams,
        .bool => if (value == .bool) value.bool else error.InvalidParams,
        .int => |info| if (info.bits == 64) try json.decimal(T, value) else if (value == .number_string) try json.integer(T, value.number_string) else error.InvalidParams,
        .@"enum" => std.meta.stringToEnum(T, try json.text(value)) orelse error.InvalidParams,
        .optional => |info| if (value == .null) null else try fromJson(info.child, a, value),
        .array => |info| blk: {
            if (value != .array or value.array.items.len != info.len) return error.InvalidParams;
            var result: T = undefined;
            for (&result, value.array.items) |*slot, child| slot.* = try fromJson(info.child, a, child);
            break :blk result;
        },
        .@"struct" => |info| blk: {
            if (value != .object or value.object.count() != info.field_names.len) return error.InvalidParams;
            var result: T = undefined;
            inline for (info.field_names, info.field_types) |name, FieldType| {
                @field(result, name) = try fromJson(FieldType, a, value.object.get(name) orelse return error.InvalidParams);
            }
            break :blk result;
        },
        .@"union" => |info| blk: {
            if (value != .object or value.object.count() != 2) return error.InvalidParams;
            const tag = try json.text(value.object.get("tag") orelse return error.InvalidParams);
            const child = value.object.get("value") orelse return error.InvalidParams;
            inline for (info.field_names, info.field_types) |name, FieldType| {
                if (std.mem.eql(u8, tag, name)) break :blk @unionInit(T, name, try fromJson(FieldType, a, child));
            }
            return error.InvalidParams;
        },
        else => @compileError("unsupported native client contract: " ++ @typeName(T)),
    };
}

pub fn toJson(comptime T: type, a: std.mem.Allocator, value: T) std.mem.Allocator.Error!json.Value {
    if (comptime schemas.isText(T)) return json.string(value.bytes);
    if (@typeInfo(T) == .@"struct" and @hasDecl(T, "agent_value_kind")) {
        if (T.agent_value_kind == .bytes) {
            const result = try a.alloc(u8, std.base64.url_safe_no_pad.Encoder.calcSize(value.bytes.len));
            return json.string(std.base64.url_safe_no_pad.Encoder.encode(result, value.bytes));
        }
        if (T.agent_value_kind == .vector) {
            var array: std.array_list.Managed(json.Value) = .init(a);
            for (value.items) |child| try array.append(try toJson(T.Child, a, child));
            return .{ .array = array };
        }
    }
    return switch (@typeInfo(T)) {
        .void => json.object(a),
        .bool => .{ .bool = value },
        .int => |info| if (info.bits == 64) json.string(try std.fmt.allocPrint(a, "{d}", .{value})) else try json.number(a, value),
        .@"enum" => json.string(@tagName(value)),
        .optional => |info| if (value) |child| try toJson(info.child, a, child) else .null,
        .array => |info| blk: {
            var array: std.array_list.Managed(json.Value) = .init(a);
            for (value) |child| try array.append(try toJson(info.child, a, child));
            break :blk .{ .array = array };
        },
        .@"struct" => |info| blk: {
            var result = json.object(a);
            inline for (info.field_names, info.field_types) |name, FieldType| try json.put(&result, name, try toJson(FieldType, a, @field(value, name)));
            break :blk result;
        },
        .@"union" => |info| blk: {
            var result = json.object(a);
            try json.put(&result, "tag", json.string(@tagName(value)));
            inline for (info.field_names, info.field_types) |name, FieldType| {
                if (std.mem.eql(u8, @tagName(value), name)) try json.put(&result, "value", try toJson(FieldType, a, @field(value, name)));
            }
            break :blk result;
        },
        else => @compileError("unsupported native client contract: " ++ @typeName(T)),
    };
}

pub fn encodeClient(comptime T: type, a: std.mem.Allocator, value: json.Value) ![]u8 {
    var arena = std.heap.ArenaAllocator.init(a);
    defer arena.deinit();
    return contracts.encodeOwned(T, a, try fromJson(T, arena.allocator(), value));
}

const Catalog = struct {
    allocator: std.mem.Allocator,
    types: std.ArrayList(data.program.Schema) = .empty,
    pub fn schema(self: *Catalog, shape: data.program.Schema) std.mem.Allocator.Error!u64 {
        const owned: data.program.Schema = switch (shape) {
            .product => |fields| .{ .product = try self.allocator.dupe(u64, fields) },
            .sum => |fields| .{ .sum = try self.allocator.dupe(u64, fields) },
            .enumeration => |tags| .{ .enumeration = try self.allocator.dupe(u32, tags) },
            else => shape,
        };
        const id = self.types.items.len;
        try self.types.append(self.allocator, owned);
        return @intCast(id);
    }
};

/// A data catalog, not a source compiler. Canonicalization and encoding remain
/// owned by Boundary; handler schemas and authored schemas share that owner.
pub fn schemaBytes(comptime T: type, a: std.mem.Allocator) ![]u8 {
    var arena = std.heap.ArenaAllocator.init(a);
    defer arena.deinit();
    var catalog = Catalog{ .allocator = arena.allocator() };
    const root = try contracts.schema(T, &catalog);
    return data.schema.encodeOwned(a, catalog.types.items, root);
}

test "client mapping preserves full-width values and rejects coercion and unknown fields" {
    var arena = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena.deinit();
    const a = arena.allocator();
    const Record = struct { count: u64, text: contracts.Text(16), bytes: contracts.Bytes(4), choice: ?bool };
    var parsed = try json.parse(a, "{\"count\":\"18446744073709551615\",\"text\":\"雪\",\"bytes\":\"AP8\",\"choice\":null}", .{});
    defer parsed.deinit();
    const encoded = try encodeClient(Record, a, parsed.value);
    var decoded = try contracts.decodeOwned(Record, a, encoded);
    defer decoded.deinit();
    try std.testing.expectEqual(std.math.maxInt(u64), decoded.value.count);
    try std.testing.expectEqualSlices(u8, &.{ 0, 255 }, decoded.value.bytes.bytes);
    const result = try toJson(Record, a, decoded.value);
    try std.testing.expectEqualStrings("18446744073709551615", result.object.get("count").?.string);
    try parsed.value.object.put("count", .{ .number_string = "18446744073709551615" });
    try std.testing.expectError(error.InvalidParams, fromJson(Record, a, parsed.value));
    try parsed.value.object.put("count", .{ .string = "1" });
    try parsed.value.object.put("extra", .null);
    try std.testing.expectError(error.InvalidParams, fromJson(Record, a, parsed.value));
    var schema = try json.parse(a, &schemas.ClientSchema(Record).value, .{});
    defer schema.deinit();
    try std.testing.expectEqualStrings("string", schema.value.object.get("properties").?.object.get("count").?.object.get("type").?.string);
}
