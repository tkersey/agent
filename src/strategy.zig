const std = @import("std");
const boundary = @import("boundary");
const action = @import("action.zig");
const budget = @import("budget.zig");
const runtime_flow = @import("runtime_flow.zig");

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

pub fn DecisionSite(comptime _: type, comptime _: type) type {
    @compileError("agent v2 DecisionSite requires an explicit EpistemicStrategy");
}

pub fn effectSites(
    comptime Definition: type,
    comptime Strategy: type,
    comptime Epistemics: type,
) [1 + effectCount(Definition)]type {
    return effectSitesFor(
        Definition,
        DecisionTurn(Definition, Strategy, Epistemics),
    );
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

pub fn ActionCatalog(comptime Definition: type) type {
    return boundary.Vector(ActionCatalogEntry(Definition), Definition.action_count);
}

pub fn State(comptime Definition: type, comptime Epistemics: type) type {
    return struct {
        goal: Definition.Goal,
        memory: Epistemics.MemoryType(Definition),
        counters: budget.Counters,
    };
}

pub fn DecisionTurn(
    comptime Definition: type,
    comptime Strategy: type,
    comptime Epistemics: type,
) type {
    return struct {
        contract_digest: [32]u8,
        goal: Definition.Goal,
        counters: budget.Counters,
        phase: budget.DecisionPhase,
        context: Epistemics.DecisionViewType(Definition),
        strategy_local: Strategy.DecisionLocalType(Definition),
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
        pub const semantic_identity = "agent.strategy.react.v2";
        pub const kind = Kind.react;
        pub const Config = ReactConfig;
        pub const normalized_config = Config{};

        pub fn validate(comptime Definition: type) void {
            _ = failureNamed(Definition, "budget_exhausted");
            _ = failureNamed(Definition, "arithmetic_overflow");
            _ = failureNamed(Definition, "invalid_variant");
            _ = failureNamed(Definition, "capacity_exceeded");
        }

        pub fn DecisionLocalType(comptime Definition: type) type {
            _ = Definition;
            return void;
        }

        pub fn StateSchemaTypes(comptime Definition: type) @TypeOf(.{void}) {
            _ = Definition;
            return .{void};
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
        pub const semantic_identity = "agent.strategy.reflective-react.v2";
        pub const kind = Kind.reflective;
        pub const Config = ReflectiveConfig;
        pub const normalized_config = Config{
            .reflection_rounds = @as(u32, config.reflection_rounds),
        };

        pub fn validate(comptime Definition: type) void {
            _ = failureNamed(Definition, "budget_exhausted");
            _ = failureNamed(Definition, "arithmetic_overflow");
            _ = failureNamed(Definition, "invalid_variant");
            _ = failureNamed(Definition, "capacity_exceeded");
        }

        pub fn DecisionLocalType(comptime Definition: type) type {
            return ?Definition.Action;
        }

        pub fn StateSchemaTypes(
            comptime Definition: type,
        ) @TypeOf(.{?Definition.Action}) {
            return .{?Definition.Action};
        }
    };
}

/// Admit downstream topology software without granting a Program Body bypass.
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
    const ConfigType = @TypeOf(spec.config);
    rejectRuntimePointers(ConfigType);
    boundary.schema.assertPortable(ConfigType);
    if (!@hasDecl(Implementation, "validate") or
        !@hasDecl(Implementation, "DecisionLocalType") or
        !@hasDecl(Implementation, "topology") or
        !@hasDecl(Implementation, "emitDecisionLocal") or
        !@hasDecl(Implementation, "StateSchemaTypes"))
    {
        @compileError(
            "agent.strategy.custom implementation requires validate, " ++
                "DecisionLocalType, topology, emitDecisionLocal, and StateSchemaTypes",
        );
    }
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
            rejectDecisionLocalPointers(DecisionLocalType(Definition));
            Implementation.validate(Definition, normalized_config);
        }

        pub fn DecisionLocalType(comptime Definition: type) type {
            return Implementation.DecisionLocalType(Definition, normalized_config);
        }

        pub fn StateSchemaTypes(
            comptime Definition: type,
        ) @TypeOf(Implementation.StateSchemaTypes(
            Definition,
            normalized_config,
        )) {
            return Implementation.StateSchemaTypes(Definition, normalized_config);
        }

        pub fn selectedTopology(
            comptime Definition: type,
            comptime Epistemics: type,
        ) runtime_flow.Topology {
            const Facade = runtime_flow.RuntimeFlow(Definition, Epistemics);
            return Implementation.topology(Definition, normalized_config, Facade);
        }

        pub fn emitDecisionLocal(
            comptime Definition: type,
            comptime Epistemics: type,
            flow: anytype,
            goal: @import("flow.zig").Value(Definition.Goal),
            counters: @import("flow.zig").Value(budget.Counters),
            view: @import("flow.zig").Value(Epistemics.DecisionViewType(Definition)),
        ) @import("flow.zig").Value(DecisionLocalType(Definition)) {
            const before_suspensions = flow.suspensionCount();
            const before_control = flow.controlMutationCount();
            const result = Implementation.emitDecisionLocal(
                Definition,
                normalized_config,
                flow,
                goal,
                counters,
                view,
            );
            if (flow.suspensionCount() != before_suspensions) {
                @compileError("agent custom RuntimeStrategy emitDecisionLocal must be effect-free");
            }
            if (flow.controlMutationCount() != before_control) {
                @compileError("agent custom RuntimeStrategy emitDecisionLocal must not alter compiler-owned control topology");
            }
            return result;
        }
    };
}

fn rejectDecisionLocalPointers(comptime T: type) void {
    switch (@typeInfo(T)) {
        .pointer => @compileError(
            "agent RuntimeStrategy DecisionLocalType must be Boundary-portable",
        ),
        .array => |info| rejectDecisionLocalPointers(info.child),
        .optional => |info| rejectDecisionLocalPointers(info.child),
        .@"struct" => |info| inline for (info.fields) |field| {
            rejectDecisionLocalPointers(field.type);
        },
        .@"union" => |info| inline for (info.fields) |field| {
            rejectDecisionLocalPointers(field.type);
        },
        else => {},
    }
}

fn rejectRuntimePointers(comptime T: type) void {
    switch (@typeInfo(T)) {
        .pointer => @compileError(
            "agent RuntimeStrategy config cannot contain runtime callbacks or pointers",
        ),
        .array => |info| rejectRuntimePointers(info.child),
        .optional => |info| rejectRuntimePointers(info.child),
        .@"struct" => |info| inline for (info.fields) |field| {
            rejectRuntimePointers(field.type);
        },
        .@"union" => |info| inline for (info.fields) |field| {
            rejectRuntimePointers(field.type);
        },
        else => {},
    }
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
