const std = @import("std");
const boundary = @import("boundary");
const action = @import("action.zig");
const identity = @import("identity.zig");

pub const format_version = "agent-decision-json-contract/v1";
const maximum_contract_bytes = 1024 * 1024;

pub const Variant = struct {
    name: []const u8,
    kind: action.Kind,
    payload_schema_digest: [32]u8,
};

const CountingWriter = struct {
    length: usize = 0,

    fn raw(self: *@This(), value: []const u8) void {
        self.length = std.math.add(usize, self.length, value.len) catch
            @compileError("agent decision contract length overflows usize");
        if (self.length > maximum_contract_bytes) {
            @compileError("agent decision contract exceeds maximum_contract_bytes");
        }
    }

    fn byte(self: *@This(), value: u8) void {
        self.raw(&.{value});
    }
};

fn FixedWriter(comptime capacity: usize) type {
    return struct {
        bytes: [capacity]u8 = undefined,
        cursor: usize = 0,

        fn raw(self: *@This(), value: []const u8) void {
            const end = std.math.add(usize, self.cursor, value.len) catch
                @compileError("agent decision contract length overflows usize");
            if (end > capacity) {
                @compileError("agent decision contract writer capacity mismatch");
            }
            @memcpy(self.bytes[self.cursor..end], value);
            self.cursor = end;
        }

        fn byte(self: *@This(), value: u8) void {
            self.raw(&.{value});
        }

        fn finish(self: @This()) [capacity]u8 {
            if (self.cursor != capacity) {
                @compileError("agent decision contract writer left trailing capacity");
            }
            return self.bytes;
        }
    };
}

fn writeJsonString(writer: anytype, comptime value: []const u8) void {
    if (!std.unicode.utf8ValidateSlice(value)) {
        @compileError("agent decision contract names must be valid UTF-8");
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

fn writeIntegerSchema(comptime T: type, writer: anytype) void {
    writer.raw("{\"type\":\"integer\",\"minimum\":");
    writer.raw(std.fmt.comptimePrint("{d}", .{std.math.minInt(T)}));
    writer.raw(",\"maximum\":");
    writer.raw(std.fmt.comptimePrint("{d}", .{std.math.maxInt(T)}));
    writer.byte('}');
}

fn writeEnumSchema(comptime T: type, writer: anytype) void {
    const info = @typeInfo(T).@"enum";
    writer.raw("{\"type\":\"string\",\"enum\":[");
    inline for (info.fields, 0..) |field, index| {
        if (index != 0) writer.byte(',');
        writeJsonString(writer, field.name);
    }
    writer.raw("]}");
}

fn writeStructSchema(comptime T: type, writer: anytype) void {
    const info = @typeInfo(T).@"struct";
    if (info.is_tuple) {
        writer.raw("{\"type\":\"array\",\"prefixItems\":[");
        inline for (info.fields, 0..) |field, index| {
            if (index != 0) writer.byte(',');
            writeSchema(field.type, writer);
        }
        writer.raw("],\"items\":false,\"minItems\":");
        writeUnsigned(writer, info.fields.len);
        writer.raw(",\"maxItems\":");
        writeUnsigned(writer, info.fields.len);
        writer.byte('}');
        return;
    }

    writer.raw("{\"type\":\"object\",\"properties\":{");
    inline for (info.fields, 0..) |field, index| {
        if (index != 0) writer.byte(',');
        writeJsonString(writer, field.name);
        writer.byte(':');
        writeSchema(field.type, writer);
    }
    writer.raw("},\"required\":[");
    inline for (info.fields, 0..) |field, index| {
        if (index != 0) writer.byte(',');
        writeJsonString(writer, field.name);
    }
    writer.raw("],\"additionalProperties\":false}");
}

fn writeUnionSchema(comptime T: type, writer: anytype) void {
    const info = @typeInfo(T).@"union";
    if (info.tag_type == null) {
        @compileError("agent decision contract requires tagged union payloads");
    }
    writer.raw("{\"oneOf\":[");
    inline for (info.fields, 0..) |field, index| {
        if (index != 0) writer.byte(',');
        writer.raw("{\"type\":\"object\",\"properties\":{\"variant\":{\"const\":");
        writeJsonString(writer, field.name);
        writer.raw("},\"value\":");
        writeSchema(field.type, writer);
        writer.raw("},\"required\":[\"variant\",\"value\"],\"additionalProperties\":false}");
    }
    writer.raw("]}");
}

fn writeSchema(comptime T: type, writer: anytype) void {
    if (comptime boundary.schema.isTextType(T)) {
        writer.raw("{\"type\":\"string\",\"maxLength\":");
        writeUnsigned(writer, T.maximum_length);
        writer.byte('}');
        return;
    }
    if (comptime boundary.schema.isBytesType(T)) {
        writer.raw("{\"type\":\"array\",\"items\":{\"type\":\"integer\",\"minimum\":0,\"maximum\":255},\"maxItems\":");
        writeUnsigned(writer, T.maximum_length);
        writer.byte('}');
        return;
    }
    if (comptime boundary.schema.isVectorType(T)) {
        writer.raw("{\"type\":\"array\",\"items\":");
        writeSchema(T.ElementType, writer);
        writer.raw(",\"maxItems\":");
        writeUnsigned(writer, T.maximum_length);
        writer.byte('}');
        return;
    }

    switch (@typeInfo(T)) {
        .void => writer.raw("{\"type\":\"object\",\"properties\":{},\"additionalProperties\":false}"),
        .bool => writer.raw("{\"type\":\"boolean\"}"),
        .int => writeIntegerSchema(T, writer),
        .array => |info| {
            writer.raw("{\"type\":\"array\",\"items\":");
            writeSchema(info.child, writer);
            writer.raw(",\"minItems\":");
            writeUnsigned(writer, info.len);
            writer.raw(",\"maxItems\":");
            writeUnsigned(writer, info.len);
            writer.byte('}');
        },
        .optional => |info| {
            writer.raw("{\"anyOf\":[{\"type\":\"null\"},");
            writeSchema(info.child, writer);
            writer.raw("]}");
        },
        .@"enum" => writeEnumSchema(T, writer),
        .@"struct" => writeStructSchema(T, writer),
        .@"union" => writeUnionSchema(T, writer),
        else => @compileError("agent decision contract encountered a nonportable payload type"),
    }
}

fn actionPayload(comptime Definition: type, comptime index: usize) type {
    return @typeInfo(Definition.Action).@"union".fields[index].type;
}

fn writeActionBranch(
    comptime Definition: type,
    comptime index: usize,
    writer: anytype,
) void {
    const Descriptor = Definition.ActionDescriptor(index);
    writer.raw("{\"type\":\"object\",\"properties\":{\"action\":{\"const\":");
    writeJsonString(writer, Descriptor.name);
    writer.raw("},\"arguments\":");
    writeSchema(actionPayload(Definition, index), writer);
    writer.raw("},\"required\":[\"action\",\"arguments\"],\"additionalProperties\":false}");
}

fn writeContractSchema(comptime Definition: type, writer: anytype) void {
    writer.raw("{\"$schema\":\"https://json-schema.org/draft/2020-12/schema\",\"title\":\"agent-action-v1\",\"type\":\"object\",\"oneOf\":[");
    inline for (0..Definition.action_count) |index| {
        if (index != 0) writer.byte(',');
        writeActionBranch(Definition, index, writer);
    }
    writer.raw("]}");
}

fn contractLength(comptime Definition: type) usize {
    var writer = CountingWriter{};
    writeContractSchema(Definition, &writer);
    return writer.length;
}

fn contractBytes(comptime Definition: type) [contractLength(Definition)]u8 {
    var writer = FixedWriter(contractLength(Definition)){};
    writeContractSchema(Definition, &writer);
    return writer.finish();
}

fn variantCatalog(
    comptime Definition: type,
) [Definition.action_count]Variant {
    var result: [Definition.action_count]Variant = undefined;
    inline for (0..Definition.action_count) |index| {
        const Descriptor = Definition.ActionDescriptor(index);
        result[index] = .{
            .name = Descriptor.name,
            .kind = Descriptor.kind,
            .payload_schema_digest = boundary.schema.schemaDigest(
                actionPayload(Definition, index),
            ),
        };
    }
    return result;
}

fn contractDigest(
    action_schema_digest: [32]u8,
    schema_bytes: []const u8,
) [32]u8 {
    var hasher = identity.Hasher.init(.{});
    identity.bytes(&hasher, format_version);
    hasher.update(&action_schema_digest);
    identity.bytes(&hasher, schema_bytes);
    return identity.finish(&hasher);
}

/// Project a compiled Agent's closed Action algebra into strict provider-neutral JSON.
/// The projection is build-time metadata; canonical Boundary Action bytes remain
/// the sole semantic authority admitted by the Machine.
pub fn jsonContract(comptime Compiled: type) type {
    @setEvalBranchQuota(10_000_000);
    if (!@hasDecl(Compiled, "Definition") or !@hasDecl(Compiled, "Program")) {
        @compileError("agent.decision.jsonContract requires a CompiledAgent type");
    }
    const Definition = Compiled.Definition;
    const action_digest = boundary.schema.schemaDigest(Definition.Action);
    const schema_bytes = contractBytes(Definition);
    const variants = variantCatalog(Definition);
    const digest = contractDigest(action_digest, &schema_bytes);

    return struct {
        pub const format_version = @import("decision_contract.zig").format_version;
        pub const action_schema_digest = action_digest;
        pub const json_schema_bytes = schema_bytes;
        pub const variant_catalog = variants;
        pub const canonical_digest = digest;
    };
}
