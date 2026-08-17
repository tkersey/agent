const boundary = @import("boundary");

/// Closed semantic kind for one Action variant.
pub const Kind = enum {
    effect,
    final,
    fail,
};

/// Diagnostic classification only; receiver policy remains external.
pub const Class = enum {
    model,
    tool,
    memory,
    human,
    child_agent,
    custom,
};

fn metadataName(comptime metadata: anytype) []const u8 {
    if (!@hasField(@TypeOf(metadata), "name")) {
        @compileError("agent action metadata requires .name");
    }
    return metadata.name;
}

fn metadataDescription(comptime metadata: anytype) []const u8 {
    if (!@hasField(@TypeOf(metadata), "description")) {
        @compileError("agent action metadata requires .description");
    }
    return metadata.description;
}

fn metadataClass(comptime metadata: anytype) Class {
    if (!@hasField(@TypeOf(metadata), "class")) return .custom;

    const class = metadata.class;
    const ClassType = @TypeOf(class);
    if (ClassType != Class and ClassType != @TypeOf(.custom)) {
        @compileError("agent action metadata .class must have type agent.action.Class");
    }
    return class;
}

/// Bind one Action variant to one statically known typed Boundary effect site.
pub fn effect(
    comptime action_variant: anytype,
    comptime observation_variant: anytype,
    comptime EffectSite: type,
    comptime metadata: anytype,
) type {
    const resolved_class = metadataClass(metadata);
    return struct {
        pub const kind = Kind.effect;
        pub const action_name = @tagName(action_variant);
        pub const observation_name = @tagName(observation_variant);
        pub const Site = EffectSite;
        pub const name = metadataName(metadata);
        pub const description = metadataDescription(metadata);
        pub const class = resolved_class;
    };
}

/// Bind one Action variant directly to the agent's typed Result.
pub fn final(
    comptime action_variant: anytype,
    comptime metadata: anytype,
) type {
    const resolved_class = metadataClass(metadata);
    return struct {
        pub const kind = Kind.final;
        pub const action_name = @tagName(action_variant);
        pub const name = metadataName(metadata);
        pub const description = metadataDescription(metadata);
        pub const class = resolved_class;
    };
}

/// Bind one Action variant directly to the agent's authored Failure.
pub fn fail(
    comptime action_variant: anytype,
    comptime metadata: anytype,
) type {
    const resolved_class = metadataClass(metadata);
    return struct {
        pub const kind = Kind.fail;
        pub const action_name = @tagName(action_variant);
        pub const name = metadataName(metadata);
        pub const description = metadataDescription(metadata);
        pub const class = resolved_class;
    };
}

comptime {
    _ = boundary.effect;
}
