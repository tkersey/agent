//! Pure Agent value support. All bytes follow Boundary 2's public value encoding.
//! This module imports no source compiler, evaluator, or process framing codec.
const std = @import("std");
const data = @import("boundary_data");
const p = data.program;
const wire = data.wire;
/// Pure JSON projections share this module identity with the ordinary codecs.
pub const json = @import("model_json.zig");

/// One ordinary inbox result shared by authoring and native environments.
/// The message identity and value stay bound across saved-reply recovery.
pub const inbox_semantic_identity = "agent.input.inbox.v1";
pub fn InboxReply(comptime Message: type) type {
    return union(enum) {
        empty: void,
        message: struct { id: Text(128), value: Message },
    };
}

pub const Error = wire.Error || std.mem.Allocator.Error || error{InvalidValue};
pub const Descriptor = data.schema.Descriptor;

pub fn Text(comptime maximum: u64) type {
    return struct {
        pub const agent_value_kind = .text;
        pub const max_length: ?u64 = maximum;
        bytes: []const u8,
    };
}

pub fn Bytes(comptime maximum: u64) type {
    return struct {
        pub const agent_value_kind = .bytes;
        pub const max_length: ?u64 = maximum;
        bytes: []const u8,
    };
}

pub const Utf8 = struct {
    pub const agent_value_kind = .text;
    pub const max_length: ?u64 = null;
    bytes: []const u8,
};

pub fn Vector(comptime Element: type, comptime maximum: u64) type {
    return struct {
        pub const agent_value_kind = .vector;
        pub const max_length = maximum;
        pub const Child = Element;
        items: []const Element,
    };
}

fn wrapped(comptime T: type) bool {
    return switch (@typeInfo(T)) {
        .@"struct" => @hasDecl(T, "agent_value_kind"),
        else => false,
    };
}

fn requireInteger(comptime T: type) void {
    const bits = @typeInfo(T).int.bits;
    if (bits != 8 and bits != 16 and bits != 32 and bits != 64)
        @compileError("Agent portable integers must have width 8, 16, 32, or 64");
}

fn enumTags(comptime T: type) [@typeInfo(T).@"enum".field_values.len]u32 {
    const info = @typeInfo(T).@"enum";
    if (info.mode != .exhaustive) @compileError("Agent portable enums must be exhaustive");
    var tags: [info.field_values.len]u32 = undefined;
    inline for (info.field_values, 0..) |value, index| {
        if (value < 0 or value > std.math.maxInt(u32))
            @compileError("Agent portable enum tags must fit u32");
        tags[index] = @intCast(value);
    }
    std.mem.sort(u32, &tags, {}, std.sort.asc(u32));
    return tags;
}

/// Derive a schema through an ordinary public Boundary Builder's schema method.
/// Recursive algebraic types may instead use explicit Boundary schema catalogs.
pub fn schema(comptime T: type, builder: anytype) !p.Id {
    if (comptime wrapped(T)) return wrapperSchema(T, builder);
    return switch (@typeInfo(T)) {
        .void => builder.schema(.unit),
        .bool => builder.schema(.boolean),
        .int => blk: {
            comptime requireInteger(T);
            const info = @typeInfo(T).int;
            const name = comptime std.fmt.comptimePrint("{s}{d}", .{
                if (info.signedness == .signed) "i" else "u", info.bits,
            });
            break :blk builder.schema(@unionInit(p.Schema, name, {}));
        },
        .@"enum" => blk: {
            const tags = comptime enumTags(T);
            break :blk builder.schema(.{ .enumeration = &tags });
        },
        .@"struct" => |info| blk: {
            var fields: [info.field_types.len]p.Id = undefined;
            inline for (info.field_types, info.field_attrs, 0..) |FieldType, attrs, index| {
                if (attrs.@"comptime") @compileError("Agent portable fields must be runtime values");
                fields[index] = try schema(FieldType, builder);
            }
            break :blk builder.schema(.{ .product = &fields });
        },
        .@"union" => |info| blk: {
            if (info.tag_type == null) @compileError("Agent requires tagged unions");
            var variants: [info.field_types.len]p.Id = undefined;
            inline for (info.field_types, 0..) |FieldType, index|
                variants[index] = try schema(FieldType, builder);
            break :blk builder.schema(.{ .sum = &variants });
        },
        .optional => |info| blk: {
            const unit = try builder.schema(.unit);
            const child = try schema(info.child, builder);
            break :blk builder.schema(.{ .sum = &.{ unit, child } });
        },
        .array => |info| builder.schema(.{ .array = .{
            .element = try schema(info.child, builder),
            .length = info.len,
        } }),
        .pointer => |info| blk: {
            if (info.size != .slice or info.sentinel_ptr != null)
                @compileError("Agent portable pointers must be unsentinelled slices");
            if (info.child == u8) break :blk builder.schema(.bytes);
            break :blk builder.schema(.{ .seq = try schema(info.child, builder) });
        },
        else => @compileError("Unsupported Agent portable value type: " ++ @typeName(T)),
    };
}

fn wrapperSchema(comptime T: type, builder: anytype) !p.Id {
    if (T.agent_value_kind == .vector) return builder.schema(.{ .vector = .{
        .element = try schema(T.Child, builder),
        .maximum = T.max_length,
    } });
    if (T.agent_value_kind == .text) {
        if (T.max_length == null) return builder.schema(.text);
        return builder.schema(.{ .bounded_text = T.max_length.? });
    }
    return builder.schema(.{ .bounded_bytes = T.max_length.? });
}

/// Canonical export of an explicit (including recursive) public schema catalog.
/// Upstream admission rejects internal resources and every containing schema.
pub fn descriptorOwned(
    allocator: std.mem.Allocator,
    types: []const p.Schema,
    root: p.Id,
) data.schema.Error!data.schema.Owned {
    return data.schema.canonicalize(allocator, types, root);
}

pub fn encodeOwned(comptime T: type, allocator: std.mem.Allocator, value: T) Error![]u8 {
    var measure: wire.Writer = .{};
    try write(T, value, &measure);
    const bytes = try allocator.alloc(u8, measure.position);
    errdefer allocator.free(bytes);
    var output: wire.Writer = .{ .output = bytes };
    try write(T, value, &output);
    return bytes;
}

/// A decoded value owns all of its byte and element slices through this arena.
pub fn Decoded(comptime T: type) type {
    return struct {
        arena: std.heap.ArenaAllocator,
        value: T,
        pub fn deinit(self: *@This()) void {
            self.arena.deinit();
            self.* = undefined;
        }
    };
}

pub fn decodeOwned(
    comptime T: type,
    allocator: std.mem.Allocator,
    bytes: []const u8,
) Error!Decoded(T) {
    var arena = std.heap.ArenaAllocator.init(allocator);
    errdefer arena.deinit();
    var input: wire.Reader = .{ .input = bytes };
    const value = try read(T, arena.allocator(), &input);
    try input.finish();
    return .{ .arena = arena, .value = value };
}

fn checkBlob(comptime T: type, bytes: []const u8) Error!void {
    if (T.max_length) |maximum| if (bytes.len > maximum) return error.InvalidValue;
    if (T.agent_value_kind == .text and !std.unicode.utf8ValidateSlice(bytes))
        return error.InvalidUtf8;
}

fn write(comptime T: type, value: T, output: *wire.Writer) Error!void {
    if (comptime wrapped(T)) {
        if (T.agent_value_kind == .vector) {
            if (value.items.len > T.max_length) return error.InvalidValue;
            return writeSlice(T.Child, value.items, output);
        }
        try checkBlob(T, value.bytes);
        return output.bytes(value.bytes);
    }
    switch (@typeInfo(T)) {
        .void => {},
        .bool => try output.byte(@intFromBool(value)),
        .int => {
            comptime requireInteger(T);
            try output.fixed(T, value);
        },
        .@"enum" => {
            _ = comptime enumTags(T);
            try output.fixed(u32, @intCast(@backingInt(value)));
        },
        .@"struct" => |info| inline for (info.field_names, info.field_types) |field_name, FieldType|
            try write(FieldType, @field(value, field_name), output),
        .@"union" => |info| {
            if (info.tag_type == null) @compileError("Agent requires tagged unions");
            inline for (info.field_names, info.field_types, 0..) |field_name, FieldType, index| {
                if (std.meta.activeTag(value) == @field(info.tag_type.?, field_name)) {
                    try output.natural(index);
                    try write(FieldType, @field(value, field_name), output);
                    return;
                }
            }
        },
        .optional => |info| {
            try output.natural(if (value == null) 0 else 1);
            if (value) |present| try write(info.child, present, output);
        },
        .array => |info| for (value) |element| try write(info.child, element, output),
        .pointer => |info| {
            if (info.size != .slice or info.sentinel_ptr != null)
                @compileError("Agent portable pointers must be unsentinelled slices");
            try writeSlice(info.child, value, output);
        },
        else => @compileError("Unsupported Agent portable value type: " ++ @typeName(T)),
    }
}

fn writeSlice(comptime T: type, values: []const T, output: *wire.Writer) Error!void {
    try output.natural(values.len);
    if (T == u8) return output.put(values);
    if (comptime minimumSize(T) == 0) return;
    for (values) |element| try write(T, element, output);
}

/// The minimum wire size lets hostile collection counts reject before allocation.
fn minimumSize(comptime T: type) usize {
    if (comptime wrapped(T)) return 1;
    return switch (@typeInfo(T)) {
        .void => 0,
        .bool => 1,
        .int => @sizeOf(T),
        .@"enum" => 4,
        .@"struct" => |info| blk: {
            var size: usize = 0;
            inline for (info.field_types) |FieldType| size += minimumSize(FieldType);
            break :blk size;
        },
        .array => |info| info.len * minimumSize(info.child),
        .optional, .@"union", .pointer => 1,
        else => @compileError("Unsupported Agent portable value type: " ++ @typeName(T)),
    };
}

fn read(comptime T: type, allocator: std.mem.Allocator, input: *wire.Reader) Error!T {
    if (comptime wrapped(T)) {
        if (T.agent_value_kind == .vector) {
            const count = try input.count();
            if (count > T.max_length) return error.InvalidValue;
            return .{ .items = try readElements(T.Child, allocator, input, count) };
        }
        const bytes = try input.bytes();
        try checkBlob(T, bytes);
        return .{ .bytes = try allocator.dupe(u8, bytes) };
    }
    return switch (@typeInfo(T)) {
        .void => {},
        .bool => switch (try input.byte()) {
            0 => false,
            1 => true,
            else => error.InvalidValue,
        },
        .int => blk: {
            comptime requireInteger(T);
            break :blk input.fixed(T);
        },
        .@"enum" => blk: {
            _ = comptime enumTags(T);
            const tag = try input.fixed(u32);
            inline for (@typeInfo(T).@"enum".field_names, @typeInfo(T).@"enum".field_values) |field_name, field_value| {
                if (tag == field_value) break :blk @field(T, field_name);
            }
            break :blk error.InvalidValue;
        },
        .@"struct" => |info| blk: {
            var result: T = undefined;
            inline for (info.field_names, info.field_types) |field_name, FieldType|
                @field(result, field_name) = try read(FieldType, allocator, input);
            break :blk result;
        },
        .@"union" => |info| blk: {
            if (info.tag_type == null) @compileError("Agent requires tagged unions");
            const tag = try input.natural();
            inline for (info.field_names, info.field_types, 0..) |field_name, FieldType, index| {
                if (tag == index) break :blk @unionInit(T, field_name, try read(FieldType, allocator, input));
            }
            break :blk error.InvalidValue;
        },
        .optional => |info| switch (try input.natural()) {
            0 => null,
            1 => try read(info.child, allocator, input),
            else => error.InvalidValue,
        },
        .array => |info| blk: {
            var result: T = undefined;
            for (&result) |*element| element.* = try read(info.child, allocator, input);
            break :blk result;
        },
        .pointer => |info| blk: {
            if (info.size != .slice or info.sentinel_ptr != null)
                @compileError("Agent portable pointers must be unsentinelled slices");
            break :blk readElements(info.child, allocator, input, try input.count());
        },
        else => @compileError("Unsupported Agent portable value type: " ++ @typeName(T)),
    };
}

fn readElements(
    comptime T: type,
    allocator: std.mem.Allocator,
    input: *wire.Reader,
    count: usize,
) Error![]T {
    const minimum = comptime minimumSize(T);
    if (minimum > 0 and count > (input.input.len - input.position) / minimum)
        return error.Truncated;
    _ = std.math.mul(usize, count, @sizeOf(T)) catch return error.InvalidLength;
    const result = try allocator.alloc(T, count);
    if (comptime minimum == 0) return result;
    for (result) |*element| element.* = try read(T, allocator, input);
    return result;
}
