const action_decode = @import("action_decode.zig");
const boundary = @import("boundary");
const staged = @import("staged_json.zig");
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
        else => @compileError("agent action profile lacks a default for " ++ @typeName(T)),
    };
}

fn totalFields(comptime Action: type) usize {
    var total: usize = 0;
    inline for (@typeInfo(Action).@"union".fields) |action_field| {
        total += switch (@typeInfo(action_field.type)) {
            .@"struct" => |info| info.fields.len,
            else => @compileError("agent action decoder requires struct payloads"),
        };
    }
    return total;
}

fn actionNameValues(
    comptime NameText: type,
    comptime actions: anytype,
) RepeatedTuple(NameText, actions.len) {
    var result: RepeatedTuple(NameText, actions.len) = undefined;
    inline for (actions, 0..) |Descriptor, index| {
        result[index] = NameText.fromSlice(Descriptor.name) catch unreachable;
    }
    return result;
}

fn payloadDefaultValues(comptime Action: type) PayloadTuple(Action) {
    var result: PayloadTuple(Action) = undefined;
    inline for (@typeInfo(Action).@"union".fields, 0..) |field, index| {
        result[index] = defaultValue(field.type);
    }
    return result;
}

fn seenValues(
    comptime Action: type,
    comptime Seen: type,
) RepeatedTuple(Seen, @typeInfo(Action).@"union".fields.len) {
    var result: RepeatedTuple(
        Seen,
        @typeInfo(Action).@"union".fields.len,
    ) = undefined;
    inline for (@typeInfo(Action).@"union".fields, 0..) |field, index| {
        const count = @typeInfo(field.type).@"struct".fields.len;
        var seen = Seen.empty();
        for (0..count) |_| seen.push(false) catch unreachable;
        result[index] = seen;
    }
    return result;
}

fn fieldNameValues(
    comptime Action: type,
    comptime Text: type,
) RepeatedTuple(Text, totalFields(Action)) {
    var result: RepeatedTuple(Text, totalFields(Action)) = undefined;
    comptime var next: usize = 0;
    inline for (@typeInfo(Action).@"union".fields) |action_field| {
        inline for (@typeInfo(action_field.type).@"struct".fields) |field| {
            result[next] = Text.fromSlice(field.name) catch unreachable;
            next += 1;
        }
    }
    return result;
}

fn fieldIndexValues(comptime count: usize) RepeatedTuple(u32, count) {
    var result: RepeatedTuple(u32, count) = undefined;
    inline for (0..count) |index| result[index] = @intCast(index);
    return result;
}

fn policyDeniedFailure(comptime failures: anytype) @TypeOf(failures.invalid_variant) {
    if (@hasField(@TypeOf(failures), "policy_denied")) {
        return failures.policy_denied;
    }
    return failures.invalid_variant;
}

fn fixedValues(
    comptime Failure: type,
    comptime failures: anytype,
) @TypeOf(.{
    failures.arithmetic_overflow,
    failures.capacity_exceeded,
    failures.invalid_index,
    failures.invalid_utf8,
    failures.malformed,
    @as(u32, 0),
    @as(u32, 1),
    @as(u32, 4),
    @as(u32, 10),
    @as(u32, 16),
    @as(u32, 64),
    @as(u32, 0x10ffff),
    @as(u32, 0xd800),
    @as(u32, 0xdfff),
    @as(u32, 0x80),
    @as(u32, 0x800),
    @as(u32, 0x10000),
    @as(u32, 0xd800),
    @as(u32, 0xdbff),
    @as(u32, 0xdc00),
    @as(u32, 0xdfff),
    @as(u32, 0x400),
    @as(u32, 0x10000),
    @as(u32, 0xffffffff),
    @as(u32, '"'),
    @as(u32, '\\'),
    @as(u32, '/'),
    @as(u32, 8),
    @as(u32, 12),
    @as(u32, '\n'),
    @as(u32, '\r'),
    @as(u32, '\t'),
    @as(u8, ' '),
    @as(u8, '\t'),
    @as(u8, '\n'),
    @as(u8, '\r'),
    @as(u8, '0'),
    @as(u8, '9'),
    @as(u8, 'a'),
    @as(u8, 'f'),
    @as(u8, 'A'),
    @as(u8, 'F'),
    @as(u8, 0xc2),
    @as(u8, 0xdf),
    @as(u8, 0xef),
    @as(u8, 0xf4),
    @as(u8, 0xc0),
    @as(u8, 0xe0),
    @as(u8, 0xf0),
    @as(u8, 0x80),
    @as(u8, 0xbf),
    @as(u8, '"'),
    @as(u8, '\\'),
    @as(u8, '/'),
    @as(u8, 0x80),
    @as(u8, 'u'),
    @as(u8, 'b'),
    @as(u8, 'n'),
    @as(u8, 'r'),
    @as(u8, 't'),
    @as(u8, '{'),
    @as(u8, '}'),
    @as(u8, '['),
    @as(u8, ']'),
    @as(u8, ':'),
    @as(u8, ','),
    @as(u8, '-'),
    @as(u8, '+'),
    @as(u8, '.'),
    @as(u8, 'e'),
    @as(u8, 'E'),
    @as(u8, 'l'),
    @as(u8, 's'),
    true,
    @as(u8, 1),
    @as(u8, 2),
    @as(u8, 3),
    @as(u8, 4),
    @as(u8, 5),
    @as(u8, 6),
    @as(u8, 7),
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
    @as(i8, 0),
    @as(u64, 0),
    @as(u64, 10),
    failures.unknown_action,
}) {
    _ = Failure;
    return .{
        failures.arithmetic_overflow,
        failures.capacity_exceeded,
        failures.invalid_index,
        failures.invalid_utf8,
        failures.malformed,
        @as(u32, 0),
        @as(u32, 1),
        @as(u32, 4),
        @as(u32, 10),
        @as(u32, 16),
        @as(u32, 64),
        @as(u32, 0x10ffff),
        @as(u32, 0xd800),
        @as(u32, 0xdfff),
        @as(u32, 0x80),
        @as(u32, 0x800),
        @as(u32, 0x10000),
        @as(u32, 0xd800),
        @as(u32, 0xdbff),
        @as(u32, 0xdc00),
        @as(u32, 0xdfff),
        @as(u32, 0x400),
        @as(u32, 0x10000),
        @as(u32, 0xffffffff),
        @as(u32, '"'),
        @as(u32, '\\'),
        @as(u32, '/'),
        @as(u32, 8),
        @as(u32, 12),
        @as(u32, '\n'),
        @as(u32, '\r'),
        @as(u32, '\t'),
        @as(u8, ' '),
        @as(u8, '\t'),
        @as(u8, '\n'),
        @as(u8, '\r'),
        @as(u8, '0'),
        @as(u8, '9'),
        @as(u8, 'a'),
        @as(u8, 'f'),
        @as(u8, 'A'),
        @as(u8, 'F'),
        @as(u8, 0xc2),
        @as(u8, 0xdf),
        @as(u8, 0xef),
        @as(u8, 0xf4),
        @as(u8, 0xc0),
        @as(u8, 0xe0),
        @as(u8, 0xf0),
        @as(u8, 0x80),
        @as(u8, 0xbf),
        @as(u8, '"'),
        @as(u8, '\\'),
        @as(u8, '/'),
        @as(u8, 0x80),
        @as(u8, 'u'),
        @as(u8, 'b'),
        @as(u8, 'n'),
        @as(u8, 'r'),
        @as(u8, 't'),
        @as(u8, '{'),
        @as(u8, '}'),
        @as(u8, '['),
        @as(u8, ']'),
        @as(u8, ':'),
        @as(u8, ','),
        @as(u8, '-'),
        @as(u8, '+'),
        @as(u8, '.'),
        @as(u8, 'e'),
        @as(u8, 'E'),
        @as(u8, 'l'),
        @as(u8, 's'),
        true,
        @as(u8, 1),
        @as(u8, 2),
        @as(u8, 3),
        @as(u8, 4),
        @as(u8, 5),
        @as(u8, 6),
        @as(u8, 7),
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
        @as(i8, 0),
        @as(u64, 0),
        @as(u64, 10),
        failures.unknown_action,
    };
}

pub fn Profile(
    comptime FailureType: type,
    comptime ArgumentBytes: type,
    comptime NameText: type,
    comptime Action: type,
    comptime actions: anytype,
    comptime failures: anytype,
) type {
    const ArgumentText = boundary.Text(ArgumentBytes.maximum_length);
    const Seen = action_decode.Seen(Action);
    const action_count = @typeInfo(Action).@"union".fields.len;
    const total_fields = totalFields(Action);
    const maximum_fields = Seen.maximum_length;
    return struct {
        pub fn schemaTypes() @TypeOf(.{
            ArgumentBytes,
            ArgumentText,
            Seen,
            staged.Cursor(ArgumentBytes),
            staged.ParsedString(ArgumentBytes),
            staged.ParsedScalar(ArgumentBytes),
            staged.ParsedUnsigned(ArgumentBytes),
            action_decode.ArgumentField(ArgumentBytes),
            action_decode.ArgumentFields(Action, ArgumentBytes),
            action_decode.ArgumentObject(Action, ArgumentBytes),
        }) {
            return .{
                ArgumentBytes,
                ArgumentText,
                Seen,
                staged.Cursor(ArgumentBytes),
                staged.ParsedString(ArgumentBytes),
                staged.ParsedScalar(ArgumentBytes),
                staged.ParsedUnsigned(ArgumentBytes),
                action_decode.ArgumentField(ArgumentBytes),
                action_decode.ArgumentFields(Action, ArgumentBytes),
                action_decode.ArgumentObject(Action, ArgumentBytes),
            };
        }

        pub fn constantValues() @TypeOf(
            fixedValues(FailureType, failures) ++
                actionNameValues(NameText, actions) ++
                payloadDefaultValues(Action) ++
                seenValues(Action, Seen) ++
                fieldNameValues(Action, ArgumentText) ++
                fieldIndexValues(maximum_fields),
        ) {
            const Result = @TypeOf(
                fixedValues(FailureType, failures) ++
                    actionNameValues(NameText, actions) ++
                    payloadDefaultValues(Action) ++
                    seenValues(Action, Seen) ++
                    fieldNameValues(Action, ArgumentText) ++
                    fieldIndexValues(maximum_fields),
            );
            var result: Result = undefined;
            comptime var next: usize = 0;
            inline for (fixedValues(FailureType, failures)) |value| {
                result[next] = value;
                next += 1;
            }
            inline for (actionNameValues(NameText, actions)) |value| {
                result[next] = value;
                next += 1;
            }
            inline for (payloadDefaultValues(Action)) |value| {
                result[next] = value;
                next += 1;
            }
            inline for (seenValues(Action, Seen)) |value| {
                result[next] = value;
                next += 1;
            }
            inline for (fieldNameValues(Action, ArgumentText)) |value| {
                result[next] = value;
                next += 1;
            }
            inline for (fieldIndexValues(maximum_fields)) |value| {
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
            pub const zero_u32_index: u16 = 5;
            pub const one_u32_index: u16 = 6;
            pub const four_u32_index: u16 = 7;
            pub const ten_u32_index: u16 = 8;
            pub const sixteen_u32_index: u16 = 9;
            pub const sixty_four_u32_index: u16 = 10;
            pub const unicode_max_index: u16 = 11;
            pub const surrogate_min_index: u16 = 12;
            pub const surrogate_max_index: u16 = 13;
            pub const utf8_two_scalar_min_index: u16 = 14;
            pub const utf8_three_scalar_min_index: u16 = 15;
            pub const utf8_four_scalar_min_index: u16 = 16;
            pub const high_surrogate_min_index: u16 = 17;
            pub const high_surrogate_max_index: u16 = 18;
            pub const low_surrogate_min_index: u16 = 19;
            pub const low_surrogate_max_index: u16 = 20;
            pub const surrogate_factor_index: u16 = 21;
            pub const supplementary_base_index: u16 = 22;
            pub const invalid_escape_scalar_index: u16 = 23;
            pub const quote_scalar_index: u16 = 24;
            pub const backslash_scalar_index: u16 = 25;
            pub const slash_scalar_index: u16 = 26;
            pub const backspace_scalar_index: u16 = 27;
            pub const form_feed_scalar_index: u16 = 28;
            pub const newline_scalar_index: u16 = 29;
            pub const carriage_return_scalar_index: u16 = 30;
            pub const tab_scalar_index: u16 = 31;
            pub const space_index: u16 = 32;
            pub const tab_index: u16 = 33;
            pub const lf_index: u16 = 34;
            pub const cr_index: u16 = 35;
            pub const zero_char_index: u16 = 36;
            pub const nine_char_index: u16 = 37;
            pub const lower_a_index: u16 = 38;
            pub const lower_f_index: u16 = 39;
            pub const upper_a_index: u16 = 40;
            pub const upper_f_index: u16 = 41;
            pub const utf8_lead_min_index: u16 = 42;
            pub const utf8_two_max_index: u16 = 43;
            pub const utf8_three_max_index: u16 = 44;
            pub const utf8_four_max_index: u16 = 45;
            pub const utf8_two_bias_index: u16 = 46;
            pub const utf8_three_bias_index: u16 = 47;
            pub const utf8_four_bias_index: u16 = 48;
            pub const utf8_continuation_min_index: u16 = 49;
            pub const utf8_continuation_max_index: u16 = 50;
            pub const quote_index: u16 = 51;
            pub const backslash_index: u16 = 52;
            pub const slash_index: u16 = 53;
            pub const ascii_limit_index: u16 = 54;
            pub const lower_u_index: u16 = 55;
            pub const lower_b_index: u16 = 56;
            pub const lower_n_index: u16 = 57;
            pub const lower_r_index: u16 = 58;
            pub const lower_t_index: u16 = 59;
            pub const left_brace_index: u16 = 60;
            pub const right_brace_index: u16 = 61;
            pub const left_bracket_index: u16 = 62;
            pub const right_bracket_index: u16 = 63;
            pub const colon_index: u16 = 64;
            pub const comma_index: u16 = 65;
            pub const minus_index: u16 = 66;
            pub const plus_index: u16 = 67;
            pub const dot_index: u16 = 68;
            pub const lower_e_index: u16 = 69;
            pub const upper_e_index: u16 = 70;
            pub const lower_l_index: u16 = 71;
            pub const lower_s_index: u16 = 72;
            pub const true_index: u16 = 73;
            pub const number_zero_state_index: u16 = 74;
            pub const number_integer_state_index: u16 = 75;
            pub const number_fraction_required_state_index: u16 = 76;
            pub const number_fraction_state_index: u16 = 77;
            pub const number_exponent_start_state_index: u16 = 78;
            pub const number_exponent_sign_state_index: u16 = 79;
            pub const number_exponent_state_index: u16 = 80;
            pub const invalid_variant_failure_index: u16 = 81;
            pub const incomplete_failure_index: u16 = 82;
            pub const response_error_failure_index: u16 = 83;
            pub const unsupported_failure_index: u16 = 84;
            pub const multiple_calls_failure_index: u16 = 85;
            pub const refusal_failure_index: u16 = 86;
            pub const transport_failure_index: u16 = 87;
            pub const http_failure_index: u16 = 88;
            pub const policy_denied_failure_index: u16 = 89;
            pub const unit_index: u16 = 90;
            pub const false_index: u16 = 91;
            pub const zero_i8_index: u16 = 92;
            pub const zero_u64_index: u16 = 93;
            pub const ten_u64_index: u16 = 94;
            pub const unknown_action_failure_index: u16 = 95;
            const action_start: u16 = 96;
            pub const action_name_indices = blk: {
                var result: [action_count]u16 = undefined;
                for (&result, 0..) |*item, index| {
                    item.* = action_start + @as(u16, @intCast(index));
                }
                break :blk result;
            };
            pub const payload_default_indices = blk: {
                var result: [action_count]u16 = undefined;
                for (&result, 0..) |*item, index| {
                    item.* = action_start + action_count + @as(u16, @intCast(index));
                }
                break :blk result;
            };
            pub const seen_indices = blk: {
                var result: [action_count]u16 = undefined;
                for (&result, 0..) |*item, index| {
                    item.* = action_start + action_count * 2 + @as(u16, @intCast(index));
                }
                break :blk result;
            };
            const field_name_start: u16 = action_start + action_count * 3;
            pub const field_name_indices = blk: {
                var result = [_][maximum_fields]u16{
                    [_]u16{0} ** maximum_fields,
                } ** action_count;
                var next: u16 = field_name_start;
                for (@typeInfo(Action).@"union".fields, 0..) |
                    action_field,
                    action_index,
                | {
                    for (@typeInfo(action_field.type).@"struct".fields, 0..) |
                        _,
                        field_index,
                    | {
                        result[action_index][field_index] = next;
                        next += 1;
                    }
                }
                break :blk result;
            };
            const field_index_start: u16 = field_name_start + total_fields;
            pub const field_index_indices = blk: {
                var result: [maximum_fields]u16 = undefined;
                for (&result, 0..) |*item, index| {
                    item.* = field_index_start + @as(u16, @intCast(index));
                }
                break :blk result;
            };
            pub const constant_count: u16 = field_index_start + maximum_fields;
        };
        pub const constant_count: u16 = Context.constant_count;
    };
}
