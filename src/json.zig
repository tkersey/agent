const std = @import("std");
const boundary = @import("boundary");

const CountingWriter = struct {
    length: usize = 0,

    fn byte(self: *@This(), _: u8) void {
        self.length += 1;
    }

    fn raw(self: *@This(), value: []const u8) void {
        self.length += value.len;
    }
};

fn FixedWriter(comptime capacity: usize) type {
    return struct {
        bytes: [capacity]u8 = undefined,
        cursor: usize = 0,

        fn byte(self: *@This(), value: u8) void {
            if (self.cursor >= capacity) @compileError("agent JSON writer overflow");
            self.bytes[self.cursor] = value;
            self.cursor += 1;
        }

        fn raw(self: *@This(), value: []const u8) void {
            if (value.len > capacity - self.cursor) {
                @compileError("agent JSON writer overflow");
            }
            @memcpy(self.bytes[self.cursor..][0..value.len], value);
            self.cursor += value.len;
        }

        fn finish(self: @This()) [capacity]u8 {
            if (self.cursor != capacity) @compileError("agent JSON writer underflow");
            return self.bytes;
        }
    };
}

fn writeString(writer: anytype, comptime value: []const u8) void {
    if (!std.unicode.utf8ValidateSlice(value)) {
        @compileError("agent JSON source string must be valid UTF-8");
    }
    const hex = "0123456789abcdef";
    writer.byte('"');
    inline for (value) |byte| switch (byte) {
        '"' => writer.raw("\\\""),
        '\\' => writer.raw("\\\\"),
        0x08 => writer.raw("\\b"),
        0x0c => writer.raw("\\f"),
        '\n' => writer.raw("\\n"),
        '\r' => writer.raw("\\r"),
        '\t' => writer.raw("\\t"),
        0x00...0x07, 0x0b, 0x0e...0x1f => {
            writer.raw("\\u00");
            writer.byte(hex[byte >> 4]);
            writer.byte(hex[byte & 0x0f]);
        },
        else => writer.byte(byte),
    };
    writer.byte('"');
}

fn writeUnsigned(writer: anytype, comptime value: anytype) void {
    writer.raw(std.fmt.comptimePrint("{d}", .{value}));
}

fn writeSchema(comptime T: type, writer: anytype) void {
    if (comptime boundary.schema.isTextType(T)) {
        writer.raw("{\"type\":\"string\",\"maxLength\":");
        writeUnsigned(writer, T.maximum_length);
        writer.byte('}');
        return;
    }
    switch (@typeInfo(T)) {
        .void => writer.raw("{\"type\":\"object\",\"properties\":{},\"additionalProperties\":false}"),
        .bool => writer.raw("{\"type\":\"boolean\"}"),
        .int => {
            writer.raw("{\"type\":\"integer\",\"minimum\":");
            writer.raw(std.fmt.comptimePrint("{d}", .{std.math.minInt(T)}));
            writer.raw(",\"maximum\":");
            writer.raw(std.fmt.comptimePrint("{d}", .{std.math.maxInt(T)}));
            writer.byte('}');
        },
        .@"enum" => |info| {
            writer.raw("{\"type\":\"string\",\"enum\":[");
            inline for (info.fields, 0..) |field, index| {
                if (index != 0) writer.byte(',');
                writeString(writer, field.name);
            }
            writer.raw("]}");
        },
        .@"struct" => |info| {
            if (info.is_tuple) {
                @compileError("agent JSON tuple schemas are not implemented yet");
            }
            writer.raw("{\"type\":\"object\",\"properties\":{");
            inline for (info.fields, 0..) |field, index| {
                if (index != 0) writer.byte(',');
                writeString(writer, field.name);
                writer.byte(':');
                writeSchema(field.type, writer);
            }
            writer.raw("},\"required\":[");
            inline for (info.fields, 0..) |field, index| {
                if (index != 0) writer.byte(',');
                writeString(writer, field.name);
            }
            writer.raw("],\"additionalProperties\":false}");
        },
        else => @compileError("agent JSON schema does not support " ++ @typeName(T)),
    }
}

fn writeToolSchema(comptime T: type, writer: anytype) void {
    if (@typeInfo(T) == .@"enum") {
        writer.raw("{\"type\":\"object\",\"properties\":{\"value\":");
        writeSchema(T, writer);
        writer.raw("},\"required\":[\"value\"],\"additionalProperties\":false}");
    } else {
        writeSchema(T, writer);
    }
}

/// Canonical provider-neutral JSON Schema bytes for one strict Action payload.
pub fn Schema(comptime T: type) type {
    const length = comptime blk: {
        @setEvalBranchQuota(100_000);
        var writer = CountingWriter{};
        writeSchema(T, &writer);
        break :blk writer.length;
    };
    const bytes = comptime blk: {
        @setEvalBranchQuota(100_000);
        var writer = FixedWriter(length){};
        writeSchema(T, &writer);
        break :blk writer.finish();
    };
    return struct {
        pub const value = bytes;
    };
}

/// Canonical provider tool schema. Non-product authored-failure payloads use
/// one explicit `value` field because provider function inputs are objects.
pub fn ToolSchema(comptime T: type) type {
    const length = comptime blk: {
        @setEvalBranchQuota(100_000);
        var writer = CountingWriter{};
        writeToolSchema(T, &writer);
        break :blk writer.length;
    };
    const bytes = comptime blk: {
        @setEvalBranchQuota(100_000);
        var writer = FixedWriter(length){};
        writeToolSchema(T, &writer);
        break :blk writer.finish();
    };
    return struct {
        pub const value = bytes;
    };
}

fn maximumValueBytes(comptime T: type) usize {
    if (comptime boundary.schema.isTextType(T)) {
        return 2 + 6 * T.maximum_length;
    }
    return switch (@typeInfo(T)) {
        .void => 2,
        .bool => 5,
        .int => @max(
            std.fmt.comptimePrint("{d}", .{std.math.minInt(T)}).len,
            std.fmt.comptimePrint("{d}", .{std.math.maxInt(T)}).len,
        ),
        .@"enum" => |info| blk: {
            var maximum: usize = 2;
            inline for (info.fields) |field| {
                maximum = @max(maximum, 2 + 6 * field.name.len);
            }
            break :blk maximum;
        },
        .@"struct" => |info| blk: {
            var maximum: usize = 2;
            inline for (info.fields, 0..) |field, index| {
                if (index != 0) maximum += 1;
                maximum += 2 + 6 * field.name.len + 1;
                maximum += maximumValueBytes(field.type);
            }
            break :blk maximum;
        },
        else => @compileError(
            "agent JSON value bound does not support " ++ @typeName(T),
        ),
    };
}

pub fn maximumToolArgumentsByteLength(comptime T: type) usize {
    return if (@typeInfo(T) == .@"enum")
        10 + maximumValueBytes(T)
    else
        maximumValueBytes(T);
}
