//! Bounded JSON admission shared by client framing and native provider captures.
//! No number is rounded, and duplicate object names never become trusted data.
const std = @import("std");
pub const Value = std.json.Value;
pub const Limits = struct {
    bytes: usize = 1024 * 1024 - 1,
    depth: usize = 32,
    tokens: usize = 65_536,
    members: usize = 4096,
};
pub const Error = error{ InvalidJson, DuplicateKey, Capacity } || std.mem.Allocator.Error;

pub fn parse(allocator: std.mem.Allocator, bytes: []const u8, limits: Limits) Error!std.json.Parsed(Value) {
    if (bytes.len > limits.bytes) return error.Capacity;
    if (!std.unicode.utf8ValidateSlice(bytes)) return error.InvalidJson;
    // Scan before tree allocation. Scanner stack allocation is also bounded by
    // stopping on the first over-depth opening token.
    var scanner = std.json.Scanner.initCompleteInput(allocator, bytes);
    defer scanner.deinit();
    var depth: usize = 0;
    var tokens: usize = 0;
    while (true) {
        const token = scanner.next() catch |err| return switch (err) {
            error.OutOfMemory => error.OutOfMemory,
            else => error.InvalidJson,
        };
        switch (token) {
            .end_of_document => break,
            .object_begin, .array_begin => {
                depth += 1;
                if (depth > limits.depth) return error.Capacity;
                tokens += 1;
            },
            .object_end, .array_end => {
                if (depth == 0) return error.InvalidJson;
                depth -= 1;
                tokens += 1;
            },
            .partial_string, .partial_string_escaped_1, .partial_string_escaped_2, .partial_string_escaped_3, .partial_string_escaped_4, .partial_number => {},
            else => tokens += 1,
        }
        if (tokens > limits.tokens) return error.Capacity;
    }
    var parsed = std.json.parseFromSlice(Value, allocator, bytes, .{
        .allocate = .alloc_always,
        .parse_numbers = false,
        .duplicate_field_behavior = .@"error",
        .max_value_len = limits.bytes,
    }) catch |err| return switch (err) {
        error.DuplicateField => error.DuplicateKey,
        error.OutOfMemory => error.OutOfMemory,
        else => error.InvalidJson,
    };
    errdefer parsed.deinit();
    try memberBounds(parsed.value, limits.members);
    return parsed;
}

fn memberBounds(value: Value, maximum: usize) Error!void {
    switch (value) {
        .object => |map| {
            if (map.count() > maximum) return error.Capacity;
            for (map.values()) |child| try memberBounds(child, maximum);
        },
        .array => |array| for (array.items) |child| try memberBounds(child, maximum),
        else => {},
    }
}

pub fn object() Value {
    return .{ .object = .empty };
}
pub fn put(allocator: std.mem.Allocator, value: *Value, key: []const u8, child: Value) !void {
    try value.object.put(allocator, key, child);
}
pub fn string(value: []const u8) Value {
    return .{ .string = value };
}
pub fn number(allocator: std.mem.Allocator, value: anytype) !Value {
    return .{ .number_string = try std.fmt.allocPrint(allocator, "{d}", .{value}) };
}
pub fn get(value: Value, key: []const u8) ?Value {
    return if (value == .object) value.object.get(key) else null;
}
pub fn text(value: Value) error{InvalidParams}![]const u8 {
    return if (value == .string) value.string else error.InvalidParams;
}

/// Canonical decimal string, including exact range admission. JSON numbers
/// deliberately use a different helper: counters cannot arrive as numbers.
pub fn decimal(comptime T: type, value: Value) error{InvalidParams}!T {
    return integer(T, try text(value));
}
fn integer(comptime T: type, bytes: []const u8) error{InvalidParams}!T {
    if (bytes.len == 0 or bytes.len > 20) return error.InvalidParams;
    var digits = bytes;
    if (bytes[0] == '-') {
        if (@typeInfo(T).int.signedness != .signed or bytes.len < 2) return error.InvalidParams;
        digits = bytes[1..];
        if (std.mem.eql(u8, digits, "0")) return error.InvalidParams;
    }
    if (digits.len > 1 and digits[0] == '0') return error.InvalidParams;
    for (digits) |byte| if (byte < '0' or byte > '9') return error.InvalidParams;
    return std.fmt.parseInt(T, bytes, 10) catch error.InvalidParams;
}

/// Decode an already syntax-checked JSON number exactly, including integral
/// fractional/exponent spellings. Client decimal strings use integer() above.
pub fn numberInteger(comptime T: type, bytes: []const u8) error{InvalidParams}!T {
    comptime std.debug.assert(@typeInfo(T).int.bits <= 64);
    if (bytes.len == 0) return error.InvalidParams;
    const negative = bytes[0] == '-';
    const start: usize = @intFromBool(negative);
    const exponent_at = std.mem.indexOfAnyPos(u8, bytes, start, "eE") orelse bytes.len;
    var nonzero = false;
    for (bytes[start..exponent_at]) |byte| nonzero = nonzero or (byte != '0' and byte != '.');
    if (!nonzero) return 0;
    if (@typeInfo(T).int.signedness == .unsigned and negative) return error.InvalidParams;
    var exponent: i32 = 0;
    if (exponent_at != bytes.len) {
        exponent = std.fmt.parseInt(i32, bytes[exponent_at + 1 ..], 10) catch return error.InvalidParams;
        if (exponent < -1_000_000 or exponent > 1_000_000) return error.InvalidParams;
    }
    const dot = std.mem.indexOfScalarPos(u8, bytes[0..exponent_at], start, '.');
    const fraction: i32 = if (dot) |i| std.math.cast(i32, exponent_at - i - 1) orelse return error.InvalidParams else 0;
    var shift = exponent - fraction;
    var end = exponent_at;
    while (shift < 0) : (shift += 1) {
        if (end <= start or bytes[end - 1] != '0') return error.InvalidParams;
        end -= 1;
        if (end > start and bytes[end - 1] == '.') end -= 1;
    }
    var result: u64 = 0;
    const maximum: u64 = @as(u64, @intCast(std.math.maxInt(T))) + @intFromBool(negative);
    for (bytes[start..end]) |byte| {
        if (byte == '.') continue;
        if (byte < '0' or byte > '9') return error.InvalidParams;
        result = std.math.mul(u64, result, 10) catch return error.InvalidParams;
        result = std.math.add(u64, result, byte - '0') catch return error.InvalidParams;
        if (result > maximum) return error.InvalidParams;
    }
    if (result == 0) return 0;
    if (shift > 20) return error.InvalidParams;
    while (shift > 0) : (shift -= 1) {
        result = std.math.mul(u64, result, 10) catch return error.InvalidParams;
        if (result > maximum) return error.InvalidParams;
    }
    if (@typeInfo(T).int.signedness == .signed and negative) {
        if (result == maximum) return std.math.minInt(T);
        return -@as(T, @intCast(result));
    }
    return @intCast(result);
}

/// Numeric RPC IDs additionally stay inside the interoperable safe range.
pub fn safeInteger(bytes: []const u8) error{InvalidParams}!i64 {
    const value = try numberInteger(i64, bytes);
    if (value < -9007199254740991 or value > 9007199254740991) return error.InvalidParams;
    return value;
}

/// Used only after typed admission, for deterministic manifests and request
/// bindings. Sorting does not itself grant authority or admit a schema.
pub fn canonical(allocator: std.mem.Allocator, value: Value) ![]u8 {
    var writer = std.Io.Writer.Allocating.init(allocator);
    errdefer writer.deinit();
    try writeCanonical(allocator, value, &writer.writer);
    return writer.toOwnedSlice();
}
fn writeCanonical(allocator: std.mem.Allocator, value: Value, writer: *std.Io.Writer) !void {
    switch (value) {
        .object => |map| {
            const keys = try allocator.dupe([]const u8, map.keys());
            defer allocator.free(keys);
            std.mem.sort([]const u8, keys, {}, struct {
                fn less(_: void, a: []const u8, b: []const u8) bool {
                    return std.mem.lessThan(u8, a, b);
                }
            }.less);
            try writer.writeByte('{');
            for (keys, 0..) |key, i| {
                if (i != 0) try writer.writeByte(',');
                try std.json.Stringify.value(key, .{}, writer);
                try writer.writeByte(':');
                try writeCanonical(allocator, map.get(key).?, writer);
            }
            try writer.writeByte('}');
        },
        .array => |array| {
            try writer.writeByte('[');
            for (array.items, 0..) |child, i| {
                if (i != 0) try writer.writeByte(',');
                try writeCanonical(allocator, child, writer);
            }
            try writer.writeByte(']');
        },
        else => try std.json.Stringify.value(value, .{}, writer),
    }
}

test "strict JSON preserves integers and rejects duplicate keys unicode and resource excess" {
    const a = std.testing.allocator;
    var exact = try parse(a, "{\"n\":18446744073709551615,\"s\":\"雪\"}", .{});
    defer exact.deinit();
    try std.testing.expectEqualStrings("18446744073709551615", exact.value.object.get("n").?.number_string);
    try std.testing.expectError(error.DuplicateKey, parse(a, "{\"a\":1,\"a\":2}", .{}));
    try std.testing.expectError(error.InvalidJson, parse(a, "\"\\ud800\"", .{}));
    try std.testing.expectError(error.InvalidJson, parse(a, "\"\xff\"", .{}));
    try std.testing.expectError(error.Capacity, parse(a, "[[[]]]", .{ .depth = 2 }));
    try std.testing.expectError(error.Capacity, parse(a, "[0,1,2]", .{ .tokens = 3 }));
    try std.testing.expectError(error.InvalidParams, decimal(u64, .{ .string = "01" }));
    try std.testing.expectEqual(std.math.maxInt(u64), try decimal(u64, .{ .string = "18446744073709551615" }));
    try std.testing.expectEqual(1, try safeInteger("1.0"));
    try std.testing.expectEqual(1, try safeInteger("10e-1"));
    try std.testing.expectEqual(9007199254740991, try safeInteger("9007199254740991.0"));
    try std.testing.expectError(error.InvalidParams, safeInteger("9007199254740992"));
    try std.testing.expectError(error.InvalidParams, safeInteger("1.1"));
}
