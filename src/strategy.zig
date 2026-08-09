const std = @import("std");
const boundary = @import("boundary");
const action = @import("action.zig");
const budget = @import("budget.zig");

pub const Kind = enum {
    react,
    reflective,
    custom,
};

pub const ReactConfig = struct {};
pub const ReflectiveConfig = struct {
    reflection_rounds: u32,
};

pub fn effectCount(comptime Definition: type) usize {
    var result: usize = 0;
    inline for (0..Definition.action_count) |index| {
        if (Definition.ActionDescriptor(index).kind == .effect) result += 1;
    }
    return result;
}

fn effectOrdinal(comptime Definition: type, comptime action_index: usize) u32 {
    var ordinal: u32 = 1;
    inline for (0..action_index) |index| {
        if (Definition.ActionDescriptor(index).kind == .effect) ordinal += 1;
    }
    return ordinal;
}

pub fn ActionSite(comptime Definition: type, comptime action_index: usize) type {
    const Descriptor = Definition.ActionDescriptor(action_index);
    if (Descriptor.kind != .effect) {
        @compileError("agent requested an effect site for a non-effect action");
    }
    return boundary.effect.site(
        effectOrdinal(Definition, action_index),
        Descriptor.Site.semantic_identity,
        Descriptor.Site.Payload,
        Descriptor.Site.Resume,
    );
}

pub fn DecisionSiteFor(
    comptime Definition: type,
    comptime DecisionRequestType: type,
) type {
    return boundary.effect.site(
        0,
        Definition.decision.interface,
        DecisionRequestType,
        Definition.Action,
    );
}

pub fn effectSitesFor(
    comptime Definition: type,
    comptime DecisionRequestType: type,
) [1 + effectCount(Definition)]type {
    var result: [1 + effectCount(Definition)]type = undefined;
    result[0] = DecisionSiteFor(Definition, DecisionRequestType);
    var next: usize = 1;
    inline for (0..Definition.action_count) |index| {
        if (Definition.ActionDescriptor(index).kind == .effect) {
            result[next] = ActionSite(Definition, index);
            next += 1;
        }
    }
    return result;
}

pub fn DecisionSite(comptime Definition: type, comptime Strategy: type) type {
    return DecisionSiteFor(Definition, Strategy.DecisionRequestType(Definition));
}

pub fn effectSites(
    comptime Definition: type,
    comptime Strategy: type,
) [1 + effectCount(Definition)]type {
    return effectSitesFor(Definition, Strategy.DecisionRequestType(Definition));
}

fn maximumActionNameBytes(comptime Definition: type) usize {
    var result: usize = 1;
    inline for (0..Definition.action_count) |index| {
        result = @max(result, Definition.ActionDescriptor(index).name.len);
    }
    return result;
}

fn maximumActionDescriptionBytes(comptime Definition: type) usize {
    var result: usize = 1;
    inline for (0..Definition.action_count) |index| {
        result = @max(result, Definition.ActionDescriptor(index).description.len);
    }
    return result;
}

pub fn ActionCatalogEntry(comptime Definition: type) type {
    return struct {
        name: boundary.Text(maximumActionNameBytes(Definition)),
        description: boundary.Text(maximumActionDescriptionBytes(Definition)),
        payload_schema_digest: [32]u8,
        kind: action.Kind,
    };
}

pub fn History(comptime Definition: type) type {
    return boundary.Vector(
        Definition.Observation,
        Definition.history.maximum_observations,
    );
}

pub fn ActionCatalog(comptime Definition: type) type {
    return boundary.Vector(ActionCatalogEntry(Definition), Definition.action_count);
}

pub fn State(comptime Definition: type) type {
    return struct {
        goal: Definition.Goal,
        history: History(Definition),
        counters: budget.Counters,
    };
}

pub fn DecisionRequest(comptime Definition: type) type {
    return struct {
        instructions: boundary.Text(Definition.instructions.len),
        action_catalog: ActionCatalog(Definition),
        goal: Definition.Goal,
        counters: budget.Counters,
        phase: budget.DecisionPhase,
        history: History(Definition),
    };
}

pub fn ReflectiveDecisionRequest(comptime Definition: type) type {
    return struct {
        instructions: boundary.Text(Definition.instructions.len),
        action_catalog: ActionCatalog(Definition),
        goal: Definition.Goal,
        counters: budget.Counters,
        phase: budget.DecisionPhase,
        history: History(Definition),
        candidate: ?Definition.Action,
    };
}

fn actionPayload(comptime Definition: type, comptime index: usize) type {
    return @typeInfo(Definition.Action).@"union".fields[index].type;
}

pub fn instructionsValue(comptime Definition: type) boundary.Text(Definition.instructions.len) {
    return boundary.Text(Definition.instructions.len).fromSlice(
        Definition.instructions,
    ) catch unreachable;
}

pub fn catalogValue(comptime Definition: type) ActionCatalog(Definition) {
    var result = ActionCatalog(Definition).empty();
    inline for (0..Definition.action_count) |index| {
        const Descriptor = Definition.ActionDescriptor(index);
        result.push(.{
            .name = boundary.Text(maximumActionNameBytes(Definition)).fromSlice(
                Descriptor.name,
            ) catch unreachable,
            .description = boundary.Text(maximumActionDescriptionBytes(Definition)).fromSlice(
                Descriptor.description,
            ) catch unreachable,
            .payload_schema_digest = boundary.schema.schemaDigest(
                actionPayload(Definition, index),
            ),
            .kind = Descriptor.kind,
        }) catch unreachable;
    }
    return result;
}

/// Reusable compile-time ReAct strategy software.
pub fn react(comptime config: anytype) type {
    if (@typeInfo(@TypeOf(config)).@"struct".fields.len != 0) {
        @compileError("agent.strategy.react v1 accepts only an empty config");
    }
    return struct {
        pub const semantic_identity = "agent.strategy.react.v1";
        pub const kind = Kind.react;
        pub const Config = ReactConfig;
        pub const normalized_config = Config{};

        pub fn validate(comptime Definition: type) void {
            _ = failureNamed(Definition, "budget_exhausted");
            _ = failureNamed(Definition, "history_overflow");
            _ = failureNamed(Definition, "arithmetic_overflow");
            _ = failureNamed(Definition, "invalid_variant");
            _ = failureNamed(Definition, "capacity_exceeded");
            if (Definition.history.overflow == .drop_oldest) {
                _ = failureNamed(Definition, "invalid_index");
            }
        }

        pub fn DecisionRequestType(comptime Definition: type) type {
            return DecisionRequest(Definition);
        }

        pub fn StateSchemaTypes(
            comptime Definition: type,
        ) @TypeOf(.{ History(Definition), State(Definition) }) {
            return .{ History(Definition), State(Definition) };
        }
    };
}

/// Reusable compile-time Reflective ReAct strategy software.
pub fn reflective(comptime config: anytype) type {
    if (!@hasField(@TypeOf(config), "reflection_rounds")) {
        @compileError("agent.strategy.reflective requires .reflection_rounds");
    }
    inline for (std.meta.fields(@TypeOf(config))) |field| {
        if (!std.mem.eql(u8, field.name, "reflection_rounds")) {
            @compileError("agent.strategy.reflective unknown config field '" ++ field.name ++ "'");
        }
    }
    if (config.reflection_rounds == 0 or config.reflection_rounds > 64) {
        @compileError("agent.strategy.reflective reflection_rounds must be in 1...64");
    }
    return struct {
        pub const semantic_identity = "agent.strategy.reflective-react.v1";
        pub const kind = Kind.reflective;
        pub const Config = ReflectiveConfig;
        pub const normalized_config = Config{
            .reflection_rounds = @as(u32, config.reflection_rounds),
        };

        pub fn validate(comptime Definition: type) void {
            _ = failureNamed(Definition, "budget_exhausted");
            _ = failureNamed(Definition, "history_overflow");
            _ = failureNamed(Definition, "arithmetic_overflow");
            _ = failureNamed(Definition, "invalid_variant");
            _ = failureNamed(Definition, "capacity_exceeded");
            if (Definition.history.overflow == .drop_oldest) {
                _ = failureNamed(Definition, "invalid_index");
            }
        }

        pub fn DecisionRequestType(comptime Definition: type) type {
            return ReflectiveDecisionRequest(Definition);
        }

        pub fn StateSchemaTypes(
            comptime Definition: type,
        ) @TypeOf(.{
            History(Definition),
            State(Definition),
            Definition.Action,
        }) {
            return .{ History(Definition), State(Definition), Definition.Action };
        }
    };
}

/// Admit downstream compile-time strategy software that lowers through public
/// `agent.Flow` into one ordinary Boundary program body.
pub fn custom(comptime spec: anytype) type {
    if (!@hasField(@TypeOf(spec), "semantic_identity") or
        !@hasField(@TypeOf(spec), "config") or
        !@hasField(@TypeOf(spec), "implementation") or
        !@hasField(@TypeOf(spec), "action_coverage"))
    {
        @compileError(
            "agent.strategy.custom requires semantic_identity, config, " ++
                "implementation, and action_coverage",
        );
    }
    if (spec.semantic_identity.len == 0) {
        @compileError("agent.strategy.custom semantic_identity must not be empty");
    }
    const Implementation = spec.implementation;
    if (!@hasDecl(Implementation, "validate") or
        !@hasDecl(Implementation, "DecisionRequest") or
        !@hasDecl(Implementation, "Body") or
        !@hasDecl(Implementation, "StateSchemaTypes"))
    {
        @compileError(
            "agent.strategy.custom implementation requires validate, " ++
                "DecisionRequest, Body, and StateSchemaTypes",
        );
    }
    const ConfigType = @TypeOf(spec.config);
    boundary.schema.assertPortable(ConfigType);

    return struct {
        pub const semantic_identity = spec.semantic_identity;
        pub const kind = Kind.custom;
        pub const Config = ConfigType;
        pub const normalized_config: Config = spec.config;
        pub const action_coverage = spec.action_coverage;

        pub fn validate(comptime Definition: type) void {
            if (action_coverage.len != Definition.action_count) {
                @compileError(
                    "agent RuntimeStrategy action coverage must contain every Action variant",
                );
            }
            inline for (0..Definition.action_count) |index| {
                if (!std.mem.eql(
                    u8,
                    action_coverage[index],
                    Definition.ActionDescriptor(index).name,
                )) {
                    @compileError(
                        "agent RuntimeStrategy action coverage must follow exhaustive Action declaration order",
                    );
                }
            }
            Implementation.validate(Definition, normalized_config);
        }

        pub fn DecisionRequestType(comptime Definition: type) type {
            return Implementation.DecisionRequest(Definition, normalized_config);
        }

        pub fn StateSchemaTypes(
            comptime Definition: type,
        ) @TypeOf(Implementation.StateSchemaTypes(
            Definition,
            normalized_config,
        )) {
            return Implementation.StateSchemaTypes(Definition, normalized_config);
        }

        pub fn ProgramBody(comptime Definition: type) type {
            return Implementation.Body(Definition, normalized_config);
        }
    };
}

pub fn failureNamed(
    comptime Definition: type,
    comptime name: []const u8,
) Definition.Failure {
    inline for (std.meta.fields(Definition.Failure)) |field| {
        if (comptime std.mem.eql(u8, field.name, name)) {
            return @field(Definition.Failure, field.name);
        }
    }
    @compileError(
        "agent RuntimeStrategy requires Definition.Failure variant '" ++ name ++ "'",
    );
}
