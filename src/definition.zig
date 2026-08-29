const std = @import("std");
const boundary = @import("boundary");
const action = @import("action.zig");
const budget_types = @import("budget.zig");

pub const maximum_instructions_bytes = 256 * 1024;
pub const maximum_action_name_bytes = 128;
pub const maximum_action_description_bytes = 4096;

pub const DecisionProtocol = struct {
    interface: []const u8,
    maximum_request_bytes: usize,
    maximum_result_bytes: usize,
};

pub const Kind = enum {
    process,
    episode,
};

fn taggedUnionInfo(comptime T: type, comptime surface: []const u8) std.builtin.Type.Union {
    return switch (@typeInfo(T)) {
        .@"union" => |info| blk: {
            const Tag = info.tag_type orelse
                @compileError("agent " ++ surface ++ " must be a tagged union");
            if (!@typeInfo(Tag).@"enum".is_exhaustive) {
                @compileError("agent " ++ surface ++ " must be exhaustive");
            }
            break :blk info;
        },
        else => @compileError("agent " ++ surface ++ " must be a tagged union"),
    };
}

fn unionFieldType(
    comptime T: type,
    comptime field_name: []const u8,
    comptime surface: []const u8,
) type {
    const info = taggedUnionInfo(T, surface);
    inline for (info.fields) |field| {
        if (std.mem.eql(u8, field.name, field_name)) return field.type;
    }
    @compileError(
        "agent " ++ surface ++ " has no variant named '" ++ field_name ++ "'",
    );
}

fn validateEffectSite(comptime Descriptor: type) void {
    if (!@hasDecl(Descriptor, "Site")) {
        @compileError("agent effect action requires a typed Boundary effect site");
    }
    const Site = Descriptor.Site;
    if (!@hasDecl(Site, "Payload") or !@hasDecl(Site, "Resume") or
        !@hasDecl(Site, "semantic_identity") or !@hasDecl(Site, "site_id"))
    {
        @compileError("agent effect action site does not satisfy the Boundary effect contract");
    }
    boundary.schema.assertPortable(Site.Payload);
    boundary.schema.assertPortable(Site.Resume);
    if (Site.semantic_identity.len == 0) {
        @compileError("agent effect action site identity must not be empty");
    }
}

fn rejectPointerBearingType(comptime T: type, comptime surface: []const u8) void {
    switch (@typeInfo(T)) {
        .pointer => @compileError("agent " ++ surface ++ " must be Boundary-portable"),
        .array => |info| rejectPointerBearingType(info.child, surface),
        .optional => |info| rejectPointerBearingType(info.child, surface),
        .@"struct" => |info| inline for (info.fields) |field| {
            rejectPointerBearingType(field.type, surface);
        },
        .@"union" => |info| inline for (info.fields) |field| {
            rejectPointerBearingType(field.type, surface);
        },
        else => {},
    }
}

fn assertDefinitionPortable(comptime T: type, comptime surface: []const u8) void {
    rejectPointerBearingType(T, surface);
    boundary.schema.assertPortable(T);
}

fn validateDefinition(comptime spec: anytype, comptime kind: Kind) void {
    @setEvalBranchQuota(1_000_000);
    if (@hasField(@TypeOf(spec), "history")) {
        @compileError("agent v2 Definition no longer accepts .history; choose an EpistemicStrategy");
    }
    if (@hasField(@TypeOf(spec), "final_policy")) {
        @compileError("agent v2 Definition no longer accepts .final_policy; final admission belongs to EpistemicStrategy");
    }
    if (spec.name.len == 0) @compileError("agent definition name must not be empty");
    if (spec.version.len == 0) @compileError("agent definition version must not be empty");
    if (spec.instructions.len == 0) {
        @compileError("agent definition instructions must not be empty");
    }
    if (spec.instructions.len > maximum_instructions_bytes) {
        @compileError("agent definition instructions exceed maximum_instructions_bytes");
    }

    const action_info = taggedUnionInfo(spec.Action, "Action");

    assertDefinitionPortable(spec.Goal, "Goal");
    assertDefinitionPortable(spec.Observation, "Observation");
    assertDefinitionPortable(spec.Result, "Result");
    assertDefinitionPortable(spec.Failure, "Failure");
    assertDefinitionPortable(spec.Action, "Action");

    if (spec.actions.len != action_info.fields.len) {
        @compileError("agent action algebra must contain exactly one descriptor per Action variant");
    }

    if (spec.decision.interface.len == 0) {
        @compileError("agent decision interface must not be empty");
    }
    if (spec.decision.maximum_request_bytes == 0 or
        spec.decision.maximum_result_bytes == 0)
    {
        @compileError("agent decision byte maxima must be positive");
    }
    if (boundary.schema.maximumEncodedSize(spec.Action) >
        spec.decision.maximum_result_bytes)
    {
        @compileError(
            "agent Action schema exceeds decision.maximum_result_bytes",
        );
    }

    if (kind == .episode) {
        if (!@hasField(@TypeOf(spec), "budget")) {
            @compileError("agent episode requires Budget");
        }
        if (spec.budget.maximum_turns == 0) {
            @compileError("agent maximum_turns must be positive");
        }
        if (spec.budget.maximum_decisions == 0) {
            @compileError("agent maximum_decisions must be positive");
        }
    } else if (@hasField(@TypeOf(spec), "budget")) {
        @compileError(
            "agent process finite policy belongs in typed Memory and admission laws, not Budget",
        );
    }

    var final_count: usize = 0;
    var effect_count: usize = 0;
    var child_count: usize = 0;
    inline for (spec.actions, 0..) |Descriptor, descriptor_index| {
        if (Descriptor.name.len == 0 or Descriptor.name.len > maximum_action_name_bytes) {
            @compileError("agent action stable name is empty or exceeds its bound");
        }
        if (Descriptor.description.len > maximum_action_description_bytes) {
            @compileError("agent action description exceeds its bound");
        }

        _ = unionFieldType(spec.Action, Descriptor.action_name, "Action");
        inline for (spec.actions, 0..) |Earlier, earlier_index| {
            if (earlier_index < descriptor_index) {
                if (std.mem.eql(u8, Earlier.action_name, Descriptor.action_name)) {
                    @compileError("agent Action variant has duplicate descriptors");
                }
                if (std.mem.eql(u8, Earlier.name, Descriptor.name)) {
                    @compileError("agent action stable name is duplicated");
                }
            }
        }

        const ActionPayload = unionFieldType(
            spec.Action,
            Descriptor.action_name,
            "Action",
        );
        switch (Descriptor.kind) {
            .effect => {
                effect_count += 1;
                if (Descriptor.class == .child_agent) child_count += 1;
                validateEffectSite(Descriptor);
                if (ActionPayload != Descriptor.Site.Payload) {
                    @compileError("agent effect action payload differs from EffectSite.Payload");
                }
                const ObservationPayload = unionFieldType(
                    spec.Observation,
                    Descriptor.observation_name,
                    "Observation",
                );
                if (ObservationPayload != Descriptor.Site.Resume) {
                    @compileError("agent observation payload differs from EffectSite.Resume");
                }
            },
            .final => {
                final_count += 1;
                if (ActionPayload != spec.Result) {
                    @compileError("agent final action payload differs from Definition.Result");
                }
            },
            .fail => {
                if (ActionPayload != spec.Failure) {
                    @compileError("agent fail action payload differs from Definition.Failure");
                }
            },
        }
    }

    if (kind == .episode) {
        if (final_count == 0) @compileError("agent action algebra requires a final action");
        if (effect_count != 0 and spec.budget.maximum_effect_actions == 0) {
            @compileError("agent maximum_effect_actions disables a declared effect action");
        }
        if (child_count != 0 and spec.budget.maximum_child_actions == 0) {
            @compileError("agent maximum_child_actions disables a declared child_agent action");
        }
    }
}

fn descriptorFor(
    comptime spec: anytype,
    comptime action_index: usize,
) type {
    const action_fields = taggedUnionInfo(spec.Action, "Action").fields;
    if (action_index >= action_fields.len) {
        @compileError("agent Action descriptor index is out of bounds");
    }
    inline for (spec.actions) |Descriptor| {
        if (std.mem.eql(
            u8,
            Descriptor.action_name,
            action_fields[action_index].name,
        )) return Descriptor;
    }
    unreachable;
}

fn normalizedDescriptors(comptime spec: anytype) [spec.actions.len]type {
    var result: [spec.actions.len]type = undefined;
    inline for (0..spec.actions.len) |index| {
        result[index] = descriptorFor(spec, index);
    }
    return result;
}

/// Admit immutable typed comptime agent data and close its Action algebra.
pub fn defineEpisode(comptime spec: anytype) type {
    @setEvalBranchQuota(1_000_000);
    comptime validateDefinition(spec, .episode);
    const descriptors = normalizedDescriptors(spec);

    return struct {
        pub const kind = Kind.episode;
        pub const name = spec.name;
        pub const version = spec.version;
        pub const instructions = spec.instructions;

        pub const Goal = spec.Goal;
        pub const Action = spec.Action;
        pub const Observation = spec.Observation;
        pub const Result = spec.Result;
        pub const Failure = spec.Failure;
        pub const actions = spec.actions;

        pub const decision = DecisionProtocol{
            .interface = spec.decision.interface,
            .maximum_request_bytes = spec.decision.maximum_request_bytes,
            .maximum_result_bytes = spec.decision.maximum_result_bytes,
        };
        pub const budget = budget_types.Budget{
            .maximum_turns = spec.budget.maximum_turns,
            .maximum_decisions = spec.budget.maximum_decisions,
            .maximum_effect_actions = spec.budget.maximum_effect_actions,
            .maximum_child_actions = spec.budget.maximum_child_actions,
        };
        pub const action_count = @typeInfo(Action).@"union".fields.len;

        /// Return the unique descriptor in Action declaration order.
        pub fn ActionDescriptor(comptime action_index: usize) type {
            if (action_index >= descriptors.len) {
                @compileError("agent Action descriptor index is out of bounds");
            }
            return descriptors[action_index];
        }

        /// Return the Action declaration index for one stable semantic name.
        pub fn actionIndex(comptime stable_name: []const u8) usize {
            inline for (0..action_count) |index| {
                if (comptime std.mem.eql(
                    u8,
                    ActionDescriptor(index).name,
                    stable_name,
                )) return index;
            }
            @compileError("agent action algebra has no stable name '" ++ stable_name ++ "'");
        }
    };
}

/// Admit an open-ended Agent frontend definition with no universal horizon.
pub fn defineProcess(comptime spec: anytype) type {
    @setEvalBranchQuota(1_000_000);
    comptime validateDefinition(spec, .process);
    const descriptors = normalizedDescriptors(spec);

    return struct {
        pub const kind = Kind.process;
        pub const name = spec.name;
        pub const version = spec.version;
        pub const instructions = spec.instructions;

        pub const Goal = spec.Goal;
        pub const Action = spec.Action;
        pub const Observation = spec.Observation;
        pub const Result = spec.Result;
        pub const Failure = spec.Failure;
        pub const actions = spec.actions;

        pub const decision = DecisionProtocol{
            .interface = spec.decision.interface,
            .maximum_request_bytes = spec.decision.maximum_request_bytes,
            .maximum_result_bytes = spec.decision.maximum_result_bytes,
        };
        pub const action_count = @typeInfo(Action).@"union".fields.len;

        pub fn ActionDescriptor(comptime action_index: usize) type {
            if (action_index >= descriptors.len) {
                @compileError("agent Action descriptor index is out of bounds");
            }
            return descriptors[action_index];
        }

        pub fn actionIndex(comptime stable_name: []const u8) usize {
            inline for (0..action_count) |index| {
                if (comptime std.mem.eql(
                    u8,
                    ActionDescriptor(index).name,
                    stable_name,
                )) return index;
            }
            @compileError("agent action algebra has no stable name '" ++ stable_name ++ "'");
        }
    };
}

/// Compatibility alias for the bounded Agent v2 episode frontend.
pub const define = defineEpisode;

comptime {
    _ = action;
}
