const boundary = @import("boundary");
const std = @import("std");

fn RepeatedTuple(comptime T: type, comptime count: usize) type {
    var types: [count]type = undefined;
    for (&types) |*item| item.* = T;
    return std.meta.Tuple(&types);
}

fn PayloadTuple(comptime Action: type) type {
    const fields = @typeInfo(Action).@"union".fields;
    var types: [fields.len]type = undefined;
    inline for (fields, 0..) |field, index| types[index] = field.type;
    return std.meta.Tuple(&types);
}

fn defaultValue(comptime T: type) T {
    if (comptime boundary.schema.isTextType(T) or
        boundary.schema.isBytesType(T) or
        boundary.schema.isVectorType(T))
    {
        return T.empty();
    }
    return switch (@typeInfo(T)) {
        .void => {},
        .bool => false,
        .int => 0,
        .optional => null,
        .array => |info| [_]info.child{defaultValue(info.child)} ** info.len,
        .@"enum" => |info| @field(T, info.fields[0].name),
        .@"struct" => |info| blk: {
            var result: T = undefined;
            inline for (info.fields) |field| {
                @field(result, field.name) = defaultValue(field.type);
            }
            break :blk result;
        },
        .@"union" => |info| @unionInit(
            T,
            info.fields[0].name,
            defaultValue(info.fields[0].type),
        ),
        else => @compileError("agent typed action profile lacks a default for " ++ @typeName(T)),
    };
}

fn payloadDefaultValues(comptime Action: type) PayloadTuple(Action) {
    var result: PayloadTuple(Action) = undefined;
    inline for (@typeInfo(Action).@"union".fields, 0..) |field, index| {
        result[index] = defaultValue(field.type);
    }
    return result;
}

fn indexValues(comptime count: usize) RepeatedTuple(u32, count) {
    var result: RepeatedTuple(u32, count) = undefined;
    inline for (0..count) |index| result[index] = @intCast(index);
    return result;
}

fn maximumFields(comptime Action: type) usize {
    var maximum: usize = 1;
    inline for (@typeInfo(Action).@"union".fields) |field| {
        maximum = @max(maximum, @typeInfo(field.type).@"struct".fields.len);
    }
    return maximum;
}

fn policyDeniedFailure(comptime failures: anytype) @TypeOf(failures.invalid_variant) {
    if (@hasField(@TypeOf(failures), "policy_denied")) return failures.policy_denied;
    return failures.invalid_variant;
}

fn fixedValues(comptime failures: anytype) @TypeOf(.{
    failures.arithmetic_overflow,
    failures.capacity_exceeded,
    failures.invalid_index,
    failures.invalid_utf8,
    failures.malformed,
    failures.invalid_variant,
    failures.incomplete,
    failures.response_error,
    failures.unsupported,
    failures.multiple_calls,
    failures.refusal,
    failures.transport,
    failures.http,
    policyDeniedFailure(failures),
    @as(void, {}),
    false,
    true,
    @as(i8, 0),
    @as(u32, 0),
    @as(u32, 1),
    @as(u32, '\n'),
    failures.unknown_action,
}) {
    return .{
        failures.arithmetic_overflow,
        failures.capacity_exceeded,
        failures.invalid_index,
        failures.invalid_utf8,
        failures.malformed,
        failures.invalid_variant,
        failures.incomplete,
        failures.response_error,
        failures.unsupported,
        failures.multiple_calls,
        failures.refusal,
        failures.transport,
        failures.http,
        policyDeniedFailure(failures),
        @as(void, {}),
        false,
        true,
        @as(i8, 0),
        @as(u32, 0),
        @as(u32, 1),
        @as(u32, '\n'),
        failures.unknown_action,
    };
}

pub fn Profile(
    comptime FailureType: type,
    comptime Action: type,
    comptime failures: anytype,
) type {
    const action_count = @typeInfo(Action).@"union".fields.len;
    const FieldName = boundary.Text(256);
    const FieldKind = enum {
        text,
        signed_integer,
        unsigned_integer,
        boolean,
    };
    const FieldContract = struct {
        name: FieldName,
        kind: FieldKind,
        bit_width: u16,
        maximum_bytes: u32,
    };
    const ArgumentCodec = boundary.Vector(FieldContract, maximumFields(Action));
    const DecodeFailure = enum {
        malformed,
        duplicate_field,
        unknown_field,
        missing_field,
        wrong_type,
        integer_range,
        capacity,
    };
    const DecodedAction = union(enum) {
        decoded: Action,
        invalid: DecodeFailure,
    };

    return struct {
        pub const FieldNameType = FieldName;
        pub const FieldKindType = FieldKind;
        pub const FieldContractType = FieldContract;
        pub const ArgumentCodecType = ArgumentCodec;
        pub const DecodeFailureType = DecodeFailure;
        pub const DecodedActionType = DecodedAction;

        pub fn schemaTypes() @TypeOf(.{
            FieldName,
            FieldKind,
            FieldContract,
            ArgumentCodec,
            DecodeFailure,
            DecodedAction,
        }) {
            return .{
                FieldName,
                FieldKind,
                FieldContract,
                ArgumentCodec,
                DecodeFailure,
                DecodedAction,
            };
        }

        pub fn codecValue(comptime action_index: usize) ArgumentCodec {
            const Payload = @typeInfo(Action).@"union".fields[action_index].type;
            var result = ArgumentCodec.empty();
            inline for (@typeInfo(Payload).@"struct".fields) |field| {
                const kind: FieldKind = if (comptime boundary.schema.isTextType(field.type))
                    .text
                else switch (@typeInfo(field.type)) {
                    .bool => .boolean,
                    .int => |info| if (info.signedness == .signed)
                        .signed_integer
                    else
                        .unsigned_integer,
                    else => @compileError(
                        "agent typed action codec field type is not implemented: " ++
                            @typeName(field.type),
                    ),
                };
                result.push(.{
                    .name = FieldName.fromSlice(field.name) catch unreachable,
                    .kind = kind,
                    .bit_width = switch (@typeInfo(field.type)) {
                        .int => @bitSizeOf(field.type),
                        else => 0,
                    },
                    .maximum_bytes = if (comptime boundary.schema.isTextType(field.type))
                        field.type.maximum_length
                    else
                        0,
                }) catch unreachable;
            }
            return result;
        }

        pub fn constantValues() @TypeOf(
            fixedValues(failures) ++ .{DecodeFailure.malformed} ++
                indexValues(action_count) ++
                payloadDefaultValues(Action),
        ) {
            const Result = @TypeOf(
                fixedValues(failures) ++ .{DecodeFailure.malformed} ++
                    indexValues(action_count) ++
                    payloadDefaultValues(Action),
            );
            var result: Result = undefined;
            comptime var next: usize = 0;
            inline for (fixedValues(failures)) |value| {
                result[next] = value;
                next += 1;
            }
            result[next] = DecodeFailure.malformed;
            next += 1;
            inline for (indexValues(action_count)) |value| {
                result[next] = value;
                next += 1;
            }
            inline for (payloadDefaultValues(Action)) |value| {
                result[next] = value;
                next += 1;
            }
            return result;
        }

        pub const Context = struct {
            pub const Failure = FailureType;
            pub const arithmetic_failure_index: u16 = 0;
            pub const capacity_failure_index: u16 = 1;
            pub const invalid_index_failure_index: u16 = 2;
            pub const invalid_utf8_failure_index: u16 = 3;
            pub const malformed_failure_index: u16 = 4;
            pub const invalid_variant_failure_index: u16 = 5;
            pub const incomplete_failure_index: u16 = 6;
            pub const response_error_failure_index: u16 = 7;
            pub const unsupported_failure_index: u16 = 8;
            pub const multiple_calls_failure_index: u16 = 9;
            pub const refusal_failure_index: u16 = 10;
            pub const transport_failure_index: u16 = 11;
            pub const http_failure_index: u16 = 12;
            pub const policy_denied_failure_index: u16 = 13;
            pub const unit_index: u16 = 14;
            pub const false_index: u16 = 15;
            pub const true_index: u16 = 16;
            pub const zero_i8_index: u16 = 17;
            pub const zero_u32_index: u16 = 18;
            pub const one_u32_index: u16 = 19;
            pub const newline_scalar_index: u16 = 20;
            pub const unknown_action_failure_index: u16 = 21;
            pub const decode_failure_index: u16 = 22;
            const index_start: u16 = 23;
            pub const action_index_indices = blk: {
                var result: [action_count]u16 = undefined;
                for (&result, 0..) |*item, index| {
                    item.* = index_start + @as(u16, @intCast(index));
                }
                break :blk result;
            };
            pub const payload_default_indices = blk: {
                var result: [action_count]u16 = undefined;
                for (&result, 0..) |*item, index| {
                    item.* = index_start + action_count + @as(u16, @intCast(index));
                }
                break :blk result;
            };
            pub const constant_count: u16 = index_start + action_count * 2;
        };
        pub const constant_count = Context.constant_count;
    };
}
