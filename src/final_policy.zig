const std = @import("std");

pub const Kind = enum {
    none,
    latest_observation_bool,
};

pub const LatestObservationBool = struct {
    observation_name: []const u8,
    field_name: []const u8,
    expected: bool,
};

pub const Policy = union(Kind) {
    none: void,
    latest_observation_bool: LatestObservationBool,
};

pub const none = Policy{ .none = {} };

/// Require the most recent retained Observation to carry one exact bool value
/// before a final Action may return its Result.
pub fn latestObservationBool(
    comptime observation_variant: anytype,
    comptime field: anytype,
    comptime expected: bool,
) Policy {
    return .{ .latest_observation_bool = .{
        .observation_name = @tagName(observation_variant),
        .field_name = @tagName(field),
        .expected = expected,
    } };
}

fn observationPayload(
    comptime Observation: type,
    comptime name: []const u8,
) type {
    const info = switch (@typeInfo(Observation)) {
        .@"union" => |union_info| union_info,
        else => @compileError("agent final policy requires a tagged Observation union"),
    };
    inline for (info.fields) |variant| {
        if (std.mem.eql(u8, variant.name, name)) return variant.type;
    }
    @compileError(
        "agent final policy Observation has no variant named '" ++ name ++ "'",
    );
}

fn payloadField(
    comptime Payload: type,
    comptime name: []const u8,
) std.builtin.Type.StructField {
    const info = switch (@typeInfo(Payload)) {
        .@"struct" => |struct_info| struct_info,
        else => @compileError("agent final policy observation payload must be a product"),
    };
    inline for (info.fields) |field| {
        if (std.mem.eql(u8, field.name, name)) return field;
    }
    @compileError(
        "agent final policy observation payload has no field named '" ++ name ++ "'",
    );
}

pub fn validate(
    comptime Observation: type,
    comptime actions: anytype,
    comptime policy: Policy,
) void {
    switch (policy) {
        .none => {},
        .latest_observation_bool => |requirement| {
            const Payload = observationPayload(
                Observation,
                requirement.observation_name,
            );
            const field = payloadField(Payload, requirement.field_name);
            if (field.type != bool) {
                @compileError("agent final policy observation field must be bool");
            }
            var produced = false;
            inline for (actions) |Descriptor| {
                if (Descriptor.kind == .effect and std.mem.eql(
                    u8,
                    Descriptor.observation_name,
                    requirement.observation_name,
                )) {
                    produced = true;
                }
            }
            if (!produced) {
                @compileError(
                    "agent final policy observation variant must be produced by a declared effect action",
                );
            }
        },
    }
}

pub fn observationIndex(
    comptime Observation: type,
    comptime requirement: LatestObservationBool,
) u16 {
    inline for (@typeInfo(Observation).@"union".fields, 0..) |variant, index| {
        if (std.mem.eql(u8, variant.name, requirement.observation_name)) {
            return @intCast(index);
        }
    }
    unreachable;
}

pub fn payloadFieldIndex(
    comptime Observation: type,
    comptime requirement: LatestObservationBool,
) u16 {
    const Payload = observationPayload(Observation, requirement.observation_name);
    inline for (@typeInfo(Payload).@"struct".fields, 0..) |field, index| {
        if (std.mem.eql(u8, field.name, requirement.field_name)) {
            return @intCast(index);
        }
    }
    unreachable;
}
