//! The strict model JSON subset and its self-describing argument codecs.
//! Model-visible answers are data. This module grants no operation authority.
const std = @import("std");
const contracts = @import("agent_contracts");
pub const json = @import("model_json.zig");

pub const FieldKind = enum { text, signed_integer, unsigned_integer, boolean, enumeration };
pub const DecodeFailure = enum {
    malformed,
    duplicate_field,
    unknown_field,
    missing_field,
    wrong_type,
    integer_range,
    capacity,
};

fn checkField(comptime name: []const u8, comptime T: type) void {
    if (json.isText(T)) {
        _ = json.maximumTextBytes(T);
        return;
    }
    switch (@typeInfo(T)) {
        .bool => {},
        .int => |info| if (info.bits != 8 and info.bits != 16 and
            info.bits != 32 and info.bits != 64)
        {
            @compileError("Agent model codec integer width is unsupported: " ++ name);
        },
        .@"enum" => |info| {
            if (!info.is_exhaustive)
                @compileError("Agent model codec requires an exhaustive enum: " ++ name);
            for (info.fields) |field| if (field.value < 0 or field.value > std.math.maxInt(u32))
                @compileError("Agent model codec enum tags must fit u32: " ++ name);
        },
        else => @compileError("Agent model codec is unsupported for '" ++ name ++
            "': " ++ @typeName(T)),
    }
}

pub fn checkPayload(comptime T: type) void {
    if (json.isText(T)) @compileError("Agent model payload must be a product or enum");
    switch (@typeInfo(T)) {
        .@"struct" => |info| {
            if (info.is_tuple) @compileError("Agent model codec does not admit tuple payloads");
            for (info.fields) |field| checkField(field.name, field.type);
        },
        .@"enum" => checkField("value", T),
        else => @compileError("Agent model payload must be a product or enum: " ++
            @typeName(T)),
    }
}

fn fieldCount(comptime T: type) usize {
    return if (@typeInfo(T) == .@"enum") 1 else @typeInfo(T).@"struct".fields.len;
}

pub fn Profile(comptime Answer: type) type {
    if (@typeInfo(Answer) != .@"union" or @typeInfo(Answer).@"union".tag_type == null)
        @compileError("Agent model Answer must be a tagged union");
    const variants = @typeInfo(Answer).@"union".fields;
    const maxima = comptime blk: {
        var names: usize = 1;
        var fields: usize = 0;
        var enums: usize = 0;
        for (variants) |variant| {
            checkPayload(variant.type);
            fields = @max(fields, fieldCount(variant.type));
            if (@typeInfo(variant.type) == .@"enum") {
                names = @max(names, "value".len);
                const info = @typeInfo(variant.type).@"enum";
                enums = @max(enums, info.fields.len);
                for (info.fields) |field| names = @max(names, field.name.len);
            } else for (@typeInfo(variant.type).@"struct".fields) |field| {
                names = @max(names, field.name.len);
                if (@typeInfo(field.type) == .@"enum") {
                    const info = @typeInfo(field.type).@"enum";
                    enums = @max(enums, info.fields.len);
                    for (info.fields) |member| names = @max(names, member.name.len);
                }
            }
        }
        break :blk .{ .names = names, .fields = fields, .enums = enums };
    };
    return struct {
        pub const FieldName = contracts.Text(maxima.names);
        pub const EnumNames = contracts.Vector(FieldName, maxima.enums);
        pub const EnumTags = contracts.Vector(u32, maxima.enums);
        pub const Field = struct {
            name: FieldName,
            kind: FieldKind,
            bit_width: u16,
            maximum_bytes: u32,
            enum_names: EnumNames,
            enum_tags: EnumTags,
        };
        pub const Codec = contracts.Vector(Field, maxima.fields);
        pub const Decoded = union(enum) { decoded: Answer, invalid: DecodeFailure };

        fn fieldValue(comptime name: []const u8, comptime T: type) Field {
            const enumeration = comptime if (@typeInfo(T) == .@"enum") blk: {
                const members = @typeInfo(T).@"enum".fields;
                var names: [members.len]FieldName = undefined;
                var tags: [members.len]u32 = undefined;
                for (members, 0..) |member, i| {
                    names[i] = .{ .bytes = member.name };
                    tags[i] = @intCast(member.value);
                }
                const frozen_names = names;
                const frozen_tags = tags;
                break :blk .{ .names = frozen_names, .tags = frozen_tags };
            } else .{ .names = [_]FieldName{}, .tags = [_]u32{} };
            return .{
                .name = .{ .bytes = name },
                .kind = if (json.isText(T)) .text else switch (@typeInfo(T)) {
                    .bool => .boolean,
                    .int => |info| if (info.signedness == .signed)
                        .signed_integer
                    else
                        .unsigned_integer,
                    .@"enum" => .enumeration,
                    else => unreachable,
                },
                .bit_width = if (@typeInfo(T) == .int) @bitSizeOf(T) else 0,
                .maximum_bytes = if (json.isText(T)) @intCast(json.maximumTextBytes(T)) else 0,
                .enum_names = .{ .items = &(comptime enumeration.names) },
                .enum_tags = .{ .items = &(comptime enumeration.tags) },
            };
        }

        /// Type-owned immutable metadata, never a slice into a live native stack.
        pub fn value(comptime index: usize) Codec {
            const Payload = variants[index].type;
            const values = comptime blk: {
                var result: [fieldCount(Payload)]Field = undefined;
                if (@typeInfo(Payload) == .@"enum") {
                    result[0] = fieldValue("value", Payload);
                } else for (@typeInfo(Payload).@"struct".fields, 0..) |field, i| {
                    result[i] = fieldValue(field.name, field.type);
                }
                break :blk result;
            };
            return .{ .items = &values };
        }
    };
}
