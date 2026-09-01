const std = @import("std");
const boundary = @import("boundary");
const final_policy = @import("final_policy.zig");
const identity = @import("identity.zig");

fn semanticConfigDigest(
    comptime Config: type,
    comptime config: Config,
    comptime policy: ?final_policy.Policy,
) [32]u8 {
    var hasher = identity.Hasher.init(.{});
    identity.bytes(&hasher, "agent-epistemics-semantic-config/v1");
    boundary.schema.updateCanonicalHash(Config, config, &hasher) catch unreachable;
    if (policy) |selected| switch (selected) {
        .none => identity.bytes(&hasher, "final:none"),
        .latest_observation_bool => |requirement| {
            identity.bytes(&hasher, "final:latest-observation-bool");
            identity.bytes(&hasher, requirement.observation_name);
            identity.bytes(&hasher, requirement.field_name);
            identity.unsigned(&hasher, @intFromBool(requirement.expected));
        },
    } else identity.bytes(&hasher, "final:custom-lowering");
    return identity.finish(&hasher);
}

pub const Overflow = enum { fail, drop_oldest };

/// Open, non-accumulating Agent 3 epistemics for systems whose Goal already is
/// the complete decision prompt. It introduces no lifetime counter or budget.
pub fn systemStateless(comptime config: anytype) type {
    if (@typeInfo(@TypeOf(config)).@"struct".fields.len != 0) {
        @compileError("agent.epistemics.systemStateless accepts only an empty config");
    }
    return struct {
        pub const system_semantic_identity = "agent.epistemics.system-stateless.v1";
        pub fn MemoryType(comptime _: anytype) type {
            return void;
        }
        pub fn DecisionViewType(comptime _: anytype) type {
            return void;
        }
        pub fn schemaTypes(comptime _: anytype) @TypeOf(.{}) {
            return .{};
        }
        pub fn emitInitial(comptime _: anytype, flow: anytype, _: anytype, comptime context: anytype) @import("flow.zig").Value(void) {
            return flow.constant(void, context.unit_index);
        }
        pub fn emitObserve(comptime _: anytype, flow: anytype, _: anytype, _: anytype, comptime context: anytype) @import("flow.zig").Value(void) {
            return flow.constant(void, context.unit_index);
        }
        pub fn emitProject(comptime _: anytype, flow: anytype, memory: anytype) @import("flow.zig").Value(void) {
            return flow.copy(memory);
        }
        pub fn emitPrompt(comptime source: anytype, _: anytype, goal: anytype, _: anytype, comptime _: anytype) @import("flow.zig").Value(source.Goal) {
            return goal;
        }
        pub fn emitModelIndex(comptime _: anytype, flow: anytype, _: anytype, comptime context: anytype) @import("flow.zig").Value(u32) {
            return flow.constant(u32, context.zero_u32_index);
        }
        pub fn emitActionAllowed(comptime _: anytype, flow: anytype, _: anytype, _: anytype, comptime context: anytype) @import("flow.zig").Value(bool) {
            return flow.constant(bool, context.true_index);
        }
        pub fn emitSkillActive(comptime _: anytype, flow: anytype, _: anytype, comptime _: usize, comptime context: anytype) @import("flow.zig").Value(bool) {
            return flow.constant(bool, context.true_index);
        }
        pub fn emitFinalAllowed(comptime _: anytype, flow: anytype, _: anytype, _: anytype, comptime context: anytype) @import("flow.zig").Value(bool) {
            return flow.constant(bool, context.true_index);
        }
    };
}

/// Admit one custom staged Agent 3 epistemic strategy. Its methods emit
/// deterministic Boundary computation; no runtime callback is retained.
pub fn system(comptime spec: anytype) type {
    if (!@hasField(@TypeOf(spec), "semantic_identity") or
        !@hasField(@TypeOf(spec), "implementation"))
    {
        @compileError("agent.epistemics.system requires semantic_identity and implementation");
    }
    if (spec.semantic_identity.len == 0) {
        @compileError("agent system epistemics semantic identity must not be empty");
    }
    const Implementation = spec.implementation;
    inline for (.{
        "MemoryType",
        "DecisionViewType",
        "schemaTypes",
        "emitInitial",
        "emitObserve",
        "emitProject",
        "emitPrompt",
        "emitSkillActive",
        "emitActionAllowed",
        "emitFinalAllowed",
    }) |name| {
        if (!@hasDecl(Implementation, name)) {
            @compileError("agent system epistemics implementation is incomplete: " ++ name);
        }
    }
    return struct {
        pub const system_semantic_identity = spec.semantic_identity;
        pub const prompt_is_json_escaped = if (@hasDecl(
            Implementation,
            "prompt_is_json_escaped",
        )) Implementation.prompt_is_json_escaped else false;
        pub const MemoryType = Implementation.MemoryType;
        pub const DecisionViewType = Implementation.DecisionViewType;
        pub const schemaTypes = Implementation.schemaTypes;
        pub const emitInitial = Implementation.emitInitial;
        pub const emitObserve = Implementation.emitObserve;
        pub const emitProject = Implementation.emitProject;
        pub const emitPrompt = Implementation.emitPrompt;
        pub fn emitModelIndex(
            comptime source: anytype,
            flow: anytype,
            memory: anytype,
            comptime context: anytype,
        ) @import("flow.zig").Value(u32) {
            if (@hasDecl(Implementation, "emitModelIndex")) {
                return Implementation.emitModelIndex(
                    source,
                    flow,
                    memory,
                    context,
                );
            }
            if (source.models.len != 1) {
                @compileError("agent multi-model system epistemics must emit a deterministic model index");
            }
            return flow.constant(u32, context.zero_u32_index);
        }
        pub const emitSkillActive = Implementation.emitSkillActive;
        pub const emitActionAllowed = Implementation.emitActionAllowed;
        pub const emitFinalAllowed = Implementation.emitFinalAllowed;
    };
}

fn rejectRuntimePointers(comptime T: type, comptime surface: []const u8) void {
    switch (@typeInfo(T)) {
        .pointer => @compileError("agent EpistemicStrategy " ++ surface ++ " must be Boundary-portable"),
        .array => |info| rejectRuntimePointers(info.child, surface),
        .optional => |info| rejectRuntimePointers(info.child, surface),
        .@"struct" => |info| inline for (info.fields) |field| {
            rejectRuntimePointers(field.type, surface);
        },
        .@"union" => |info| inline for (info.fields) |field| {
            rejectRuntimePointers(field.type, surface);
        },
        else => {},
    }
}

fn failureNamed(
    comptime Definition: type,
    comptime name: []const u8,
) Definition.Failure {
    inline for (std.meta.fields(Definition.Failure)) |field| {
        if (comptime std.mem.eql(u8, field.name, name)) {
            return @field(Definition.Failure, field.name);
        }
    }
    @compileError("agent EpistemicStrategy requires Definition.Failure variant '" ++ name ++ "'");
}

fn observationIndex(
    comptime Observation: type,
    comptime requirement: final_policy.LatestObservationBool,
) u16 {
    return final_policy.observationIndex(Observation, requirement);
}

fn finalAllowedVerbatim(
    comptime Definition: type,
    comptime policy: final_policy.Policy,
    flow: anytype,
    memory: anytype,
    result: anytype,
    comptime context: anytype,
) @import("flow.zig").Value(bool) {
    _ = result;
    switch (policy) {
        .none => return flow.constant(bool, context.true_index),
        .latest_observation_bool => |requirement| {
            const length = flow.vectorLength(memory);
            const empty = flow.compareEqZero(length);
            const rejected = flow.block(.segment, .{});
            const inspect = flow.block(.segment, .{ @TypeOf(memory).Type, u32 });
            flow.branch(empty, rejected, .{}, inspect, .{ memory, length });

            _ = flow.enter(rejected);
            const no = flow.constant(bool, context.false_index);
            const joined = flow.block(.segment, .{bool});
            flow.jump(joined, .{no});

            const inspect_values = flow.enter(inspect);
            const one = flow.constant(u32, context.one_index);
            const last = flow.integerSubtract(inspect_values[1], one);
            const observation = flow.vectorGet(inspect_values[0], last);
            const matches = flow.sumTagIs(
                observationIndex(Definition.Observation, requirement),
                observation,
            );
            const inspect_field = flow.block(.segment, .{Definition.Observation});
            flow.branch(matches, inspect_field, .{observation}, rejected, .{});

            const field_values = flow.enter(inspect_field);
            const payload = flow.sumExtract(
                observationIndex(Definition.Observation, requirement),
                field_values[0],
            );
            const observed = flow.productExtract(
                final_policy.payloadFieldIndex(Definition.Observation, requirement),
                payload,
            );
            if (requirement.expected) {
                flow.jump(joined, .{observed});
            } else {
                const expected_false = flow.block(.segment, .{});
                const expected_true = flow.block(.segment, .{});
                flow.branch(observed, expected_false, .{}, expected_true, .{});
                _ = flow.enter(expected_false);
                flow.jump(joined, .{flow.constant(bool, context.false_index)});
                _ = flow.enter(expected_true);
                flow.jump(joined, .{flow.constant(bool, context.true_index)});
            }
            return flow.enter(joined)[0];
        },
    }
}

/// Explicit bounded transcript epistemics for migration and differential proof.
pub fn verbatim(comptime config: anytype) type {
    if (!@hasField(@TypeOf(config), "maximum_observations") or
        !@hasField(@TypeOf(config), "overflow") or
        !@hasField(@TypeOf(config), "final"))
    {
        @compileError("agent.epistemics.verbatim requires maximum_observations, overflow, and final");
    }
    if (config.maximum_observations > std.math.maxInt(u32)) {
        @compileError("agent.epistemics.verbatim maximum_observations exceeds u32");
    }
    const overflow: Overflow = config.overflow;
    const policy: final_policy.Policy = config.final;
    return struct {
        pub const semantic_identity = "agent.epistemics.verbatim.v1";
        pub const is_verbatim = true;
        pub const Config = struct {
            maximum_observations: u32,
            overflow: Overflow,
        };
        pub const normalized_config = Config{
            .maximum_observations = @intCast(config.maximum_observations),
            .overflow = overflow,
        };
        pub const semantic_config_digest = semanticConfigDigest(Config, normalized_config, policy);
        pub const semantic_lowering_digest = identity.digestBytes("agent.epistemics.verbatim.lowering.v1");
        pub const final_policy_value = policy;
        pub const has_implementation_constant_values = false;
        pub const lowering_complexity: usize = 1;
        pub fn constantValues(comptime Definition: type) @TypeOf(.{
            @as(u32, normalized_config.maximum_observations),
            if (overflow == .fail)
                failureNamed(Definition, "history_overflow")
            else
                @as(void, {}),
        }) {
            return comptime .{
                @as(u32, normalized_config.maximum_observations),
                if (overflow == .fail)
                    failureNamed(Definition, "history_overflow")
                else
                    @as(void, {}),
            };
        }

        pub fn constantContext(comptime Definition: type, comptime base: u16) type {
            _ = Definition;
            return struct {
                pub const zero_index: u16 = 0;
                pub const one_index: u16 = 1;
                pub const initial_memory_index: u16 = 10;
                pub const true_index: u16 = 11;
                pub const false_index: u16 = 12;
                pub const maximum_observations_index: u16 = base;
                pub const history_overflow_index: u16 = base + 1;
            };
        }

        pub fn validate(comptime Definition: type) void {
            if (normalized_config.maximum_observations == 0) {
                inline for (0..Definition.action_count) |index| {
                    if (Definition.ActionDescriptor(index).kind == .effect) {
                        @compileError("agent verbatim epistemics requires positive capacity for effect actions");
                    }
                }
            }
            if (overflow == .fail) _ = failureNamed(Definition, "history_overflow");
            if (overflow == .drop_oldest) _ = failureNamed(Definition, "invalid_index");
            final_policy.validate(Definition.Observation, Definition.actions, policy);
        }

        pub fn MemoryType(comptime Definition: type) type {
            return boundary.Vector(Definition.Observation, normalized_config.maximum_observations);
        }

        pub fn DecisionViewType(comptime Definition: type) type {
            return MemoryType(Definition);
        }

        pub fn StateSchemaTypes(comptime Definition: type) @TypeOf(.{MemoryType(Definition)}) {
            return .{MemoryType(Definition)};
        }

        pub fn initialMemory(comptime Definition: type) MemoryType(Definition) {
            return MemoryType(Definition).empty();
        }

        pub fn emitInitial(
            comptime Definition: type,
            flow: anytype,
            _: anytype,
            comptime context: anytype,
        ) @import("flow.zig").Value(MemoryType(Definition)) {
            return flow.constant(MemoryType(Definition), context.initial_memory_index);
        }

        pub fn emitObserve(
            comptime Definition: type,
            flow: anytype,
            memory: anytype,
            observation: anytype,
            comptime context: anytype,
        ) @import("flow.zig").Value(MemoryType(Definition)) {
            const append = flow.block(.segment, .{ MemoryType(Definition), Definition.Observation });
            if (overflow == .fail) {
                const length = flow.vectorLength(memory);
                const maximum = flow.constant(u32, context.maximum_observations_index);
                const full = flow.integerGreaterEqual(length, maximum);
                const fail = flow.block(.terminal_handoff, .{});
                flow.branch(full, fail, .{}, append, .{ memory, observation });
                _ = flow.enter(fail);
                flow.failValue(flow.constant(Definition.Failure, context.history_overflow_index));
            } else {
                const length = flow.vectorLength(memory);
                const maximum = flow.constant(u32, context.maximum_observations_index);
                const full = flow.integerGreaterEqual(length, maximum);
                const shift = flow.block(.loop_header, .{ MemoryType(Definition), Definition.Observation, u32, u32 });
                flow.branch(
                    full,
                    shift,
                    .{ memory, observation, flow.constant(u32, context.one_index), length },
                    append,
                    .{ memory, observation },
                );
                const values = flow.enter(shift);
                const complete = flow.integerGreaterEqual(values[2], values[3]);
                const done = flow.block(.segment, .{ MemoryType(Definition), Definition.Observation, u32 });
                const move = flow.block(.segment, .{ MemoryType(Definition), Definition.Observation, u32, u32 });
                flow.branch(complete, done, .{ values[0], values[1], values[3] }, move, values);
                const moving = flow.enter(move);
                const source = flow.vectorGet(moving[0], moving[2]);
                const one = flow.constant(u32, context.one_index);
                const target = flow.integerSubtract(moving[2], one);
                const shifted = flow.vectorSet(moving[0], target, source);
                flow.jump(shift, .{ shifted, moving[1], flow.integerAdd(moving[2], one), moving[3] });
                const finished = flow.enter(done);
                const truncated = flow.vectorTruncate(
                    finished[0],
                    flow.integerSubtract(finished[2], flow.constant(u32, context.one_index)),
                );
                flow.jump(append, .{ truncated, finished[1] });
            }
            const values = flow.enter(append);
            return flow.vectorPush(values[0], values[1]);
        }

        pub fn emitObserveKnown(
            comptime Definition: type,
            flow: anytype,
            memory: anytype,
            comptime observation_index: u16,
            observation: anytype,
            comptime context: anytype,
        ) @import("flow.zig").Value(MemoryType(Definition)) {
            _ = observation_index;
            return emitObserve(Definition, flow, memory, observation, context);
        }

        pub fn emitObservePayload(
            comptime Definition: type,
            flow: anytype,
            memory: anytype,
            comptime observation_index: u16,
            payload: anytype,
            comptime context: anytype,
        ) @import("flow.zig").Value(MemoryType(Definition)) {
            return emitObserveKnown(
                Definition,
                flow,
                memory,
                observation_index,
                flow.sumConstruct(Definition.Observation, observation_index, payload),
                context,
            );
        }

        pub fn emitProject(
            comptime Definition: type,
            flow: anytype,
            memory: anytype,
        ) @import("flow.zig").Value(DecisionViewType(Definition)) {
            return flow.copy(memory);
        }

        pub fn emitActionAllowed(
            comptime Definition: type,
            flow: anytype,
            memory: anytype,
            action: anytype,
            comptime context: anytype,
        ) @import("flow.zig").Value(bool) {
            _ = Definition;
            _ = memory;
            _ = action;
            return flow.constant(bool, context.true_index);
        }

        pub fn emitFinalAllowed(
            comptime Definition: type,
            flow: anytype,
            memory: anytype,
            result: anytype,
            comptime context: anytype,
        ) @import("flow.zig").Value(bool) {
            return finalAllowedVerbatim(Definition, policy, flow, memory, result, context);
        }
    };
}

/// Admit compiler-only deterministic working-set epistemics.
pub fn custom(comptime spec: anytype) type {
    if (!@hasField(@TypeOf(spec), "semantic_identity") or
        !@hasField(@TypeOf(spec), "config") or
        !@hasField(@TypeOf(spec), "implementation"))
    {
        @compileError("agent.epistemics.custom requires semantic_identity, config, and implementation");
    }
    if (spec.semantic_identity.len == 0) {
        @compileError("agent.epistemics.custom semantic_identity must not be empty");
    }
    const ConfigType = @TypeOf(spec.config);
    rejectRuntimePointers(ConfigType, "Config");
    boundary.schema.assertPortable(ConfigType);
    const Implementation = spec.implementation;
    if (!@hasDecl(Implementation, "semantic_identity") or Implementation.semantic_identity.len == 0) {
        @compileError("agent custom EpistemicStrategy implementation requires a non-empty semantic_identity");
    }
    const admitted_lowering_complexity: usize = if (@hasDecl(Implementation, "lowering_complexity"))
        Implementation.lowering_complexity
    else
        1;
    if (admitted_lowering_complexity == 0) {
        @compileError("agent custom EpistemicStrategy lowering_complexity must be positive");
    }
    if ((@hasDecl(Implementation, "emitActionAllowedKnown") or
        @hasDecl(Implementation, "actionAlwaysAllowedKnown")) and
        !@hasDecl(Implementation, "emitActionAllowed"))
    {
        @compileError("agent specialized action admission requires emitActionAllowed fallback");
    }
    return struct {
        pub const semantic_identity = spec.semantic_identity;
        pub const is_verbatim = false;
        pub const Config = ConfigType;
        pub const normalized_config: Config = spec.config;
        pub const semantic_config_digest = semanticConfigDigest(Config, normalized_config, null);
        pub const semantic_lowering_digest = identity.digestBytes(Implementation.semantic_identity);
        pub const has_implementation_constant_values = @hasDecl(Implementation, "constantValues");
        pub const lowering_complexity: usize = admitted_lowering_complexity;

        pub fn constantValues(comptime Definition: type) @TypeOf(if (@hasDecl(Implementation, "constantValues"))
            Implementation.constantValues(Definition, normalized_config)
        else
            .{@as(void, {})}) {
            if (comptime @hasDecl(Implementation, "constantValues")) {
                return comptime Implementation.constantValues(Definition, normalized_config);
            }
            return comptime .{@as(void, {})};
        }

        pub fn constantContext(comptime Definition: type, comptime base: u16) type {
            if (comptime @hasDecl(Implementation, "constantContext")) {
                return Implementation.constantContext(Definition, normalized_config, base);
            }
            const custom_count: u16 = @intCast(constantValues(Definition).len);
            return struct {
                pub const zero_index: u16 = 0;
                pub const one_index: u16 = 1;
                pub const initial_memory_index: u16 = 10;
                pub const true_index: u16 = 11;
                pub const false_index: u16 = 12;
                pub const zero_u8_index: u16 = base + custom_count + 1;
                pub const one_u8_index: u16 = base + custom_count + 2;
                pub const two_u8_index: u16 = base + custom_count + 3;
            };
        }

        pub fn validate(comptime Definition: type) void {
            inline for (.{ "Memory", "DecisionView", "initialMemory", "emitObserve", "emitProject", "emitFinalAllowed" }) |name| {
                if (!@hasDecl(Implementation, name)) {
                    @compileError("agent custom EpistemicStrategy is missing " ++ name);
                }
            }
            Implementation.validate(Definition, normalized_config);
            rejectRuntimePointers(MemoryType(Definition), "Memory");
            rejectRuntimePointers(DecisionViewType(Definition), "DecisionView");
            boundary.schema.assertPortable(MemoryType(Definition));
            boundary.schema.assertPortable(DecisionViewType(Definition));
        }

        pub fn MemoryType(comptime Definition: type) type {
            return Implementation.Memory(Definition, normalized_config);
        }

        pub fn DecisionViewType(comptime Definition: type) type {
            return Implementation.DecisionView(Definition, normalized_config);
        }

        pub fn StateSchemaTypes(comptime Definition: type) @TypeOf(Implementation.StateSchemaTypes(Definition, normalized_config)) {
            return Implementation.StateSchemaTypes(Definition, normalized_config);
        }

        pub fn initialMemory(comptime Definition: type) MemoryType(Definition) {
            return Implementation.initialMemory(Definition, normalized_config);
        }

        pub fn emitInitial(comptime Definition: type, flow: anytype, goal: anytype, comptime context: anytype) @import("flow.zig").Value(MemoryType(Definition)) {
            if (@hasDecl(Implementation, "emitInitial")) {
                const before_suspensions = flow.suspensionSnapshot();
                const before_returns = flow.returnSnapshot();
                const result = Implementation.emitInitial(Definition, normalized_config, flow, goal, context);
                if (!std.meta.eql(flow.suspensionSnapshot(), before_suspensions)) {
                    @compileError("agent custom EpistemicStrategy emitInitial must be effect-free");
                }
                if (!std.meta.eql(flow.returnSnapshot(), before_returns)) {
                    @compileError("agent custom EpistemicStrategy emitInitial must not terminate the Agent program");
                }
                return result;
            }
            return flow.constant(MemoryType(Definition), context.initial_memory_index);
        }

        pub fn emitObserve(comptime Definition: type, flow: anytype, memory: anytype, observation: anytype, comptime context: anytype) @import("flow.zig").Value(MemoryType(Definition)) {
            const before_suspensions = flow.suspensionSnapshot();
            const before_returns = flow.returnSnapshot();
            const result = Implementation.emitObserve(Definition, normalized_config, flow, memory, observation, context);
            if (!std.meta.eql(flow.suspensionSnapshot(), before_suspensions)) {
                @compileError("agent custom EpistemicStrategy emitObserve must be effect-free");
            }
            if (!std.meta.eql(flow.returnSnapshot(), before_returns)) {
                @compileError("agent custom EpistemicStrategy emitObserve must not terminate the Agent program");
            }
            return result;
        }

        pub fn emitObserveKnown(
            comptime Definition: type,
            flow: anytype,
            memory: anytype,
            comptime observation_index: u16,
            observation: anytype,
            comptime context: anytype,
        ) @import("flow.zig").Value(MemoryType(Definition)) {
            if (@hasDecl(Implementation, "emitObserveKnown")) {
                const before_suspensions = flow.suspensionSnapshot();
                const before_returns = flow.returnSnapshot();
                const result = Implementation.emitObserveKnown(
                    Definition,
                    normalized_config,
                    flow,
                    memory,
                    observation_index,
                    observation,
                    context,
                );
                if (!std.meta.eql(flow.suspensionSnapshot(), before_suspensions)) {
                    @compileError("agent custom EpistemicStrategy emitObserveKnown must be effect-free");
                }
                if (!std.meta.eql(flow.returnSnapshot(), before_returns)) {
                    @compileError("agent custom EpistemicStrategy emitObserveKnown must not terminate the Agent program");
                }
                return result;
            }
            return emitObserve(Definition, flow, memory, observation, context);
        }

        pub fn emitObservePayload(
            comptime Definition: type,
            flow: anytype,
            memory: anytype,
            comptime observation_index: u16,
            payload: anytype,
            comptime context: anytype,
        ) @import("flow.zig").Value(MemoryType(Definition)) {
            if (@hasDecl(Implementation, "emitObservePayload")) {
                const before_suspensions = flow.suspensionSnapshot();
                const before_returns = flow.returnSnapshot();
                const result = Implementation.emitObservePayload(
                    Definition,
                    normalized_config,
                    flow,
                    memory,
                    observation_index,
                    payload,
                    context,
                );
                if (!std.meta.eql(flow.suspensionSnapshot(), before_suspensions)) {
                    @compileError("agent custom EpistemicStrategy emitObservePayload must be effect-free");
                }
                if (!std.meta.eql(flow.returnSnapshot(), before_returns)) {
                    @compileError("agent custom EpistemicStrategy emitObservePayload must not terminate the Agent program");
                }
                return result;
            }
            return emitObserveKnown(
                Definition,
                flow,
                memory,
                observation_index,
                flow.sumConstruct(Definition.Observation, observation_index, payload),
                context,
            );
        }

        pub fn emitProject(comptime Definition: type, flow: anytype, memory: anytype) @import("flow.zig").Value(DecisionViewType(Definition)) {
            const before_suspensions = flow.suspensionSnapshot();
            const before_returns = flow.returnSnapshot();
            const result = Implementation.emitProject(Definition, normalized_config, flow, memory);
            if (!std.meta.eql(flow.suspensionSnapshot(), before_suspensions)) {
                @compileError("agent custom EpistemicStrategy emitProject must be effect-free");
            }
            if (!std.meta.eql(flow.returnSnapshot(), before_returns)) {
                @compileError("agent custom EpistemicStrategy emitProject must not terminate the Agent program");
            }
            return result;
        }

        pub fn emitActionAllowed(comptime Definition: type, flow: anytype, memory: anytype, action: anytype, comptime context: anytype) @import("flow.zig").Value(bool) {
            if (!@hasDecl(Implementation, "emitActionAllowed")) {
                return flow.constant(bool, context.true_index);
            }
            const before_suspensions = flow.suspensionSnapshot();
            const before_returns = flow.returnSnapshot();
            const allowed = Implementation.emitActionAllowed(Definition, normalized_config, flow, memory, action, context);
            if (!std.meta.eql(flow.suspensionSnapshot(), before_suspensions)) {
                @compileError("agent custom EpistemicStrategy emitActionAllowed must be effect-free");
            }
            if (!std.meta.eql(flow.returnSnapshot(), before_returns)) {
                @compileError("agent custom EpistemicStrategy emitActionAllowed must not terminate the Agent program");
            }
            return allowed;
        }

        pub fn emitActionAllowedKnown(
            comptime Definition: type,
            flow: anytype,
            memory: anytype,
            comptime action_index: u16,
            action: anytype,
            comptime context: anytype,
        ) @import("flow.zig").Value(bool) {
            if (!@hasDecl(Implementation, "emitActionAllowedKnown")) {
                return emitActionAllowed(Definition, flow, memory, action, context);
            }
            const before_suspensions = flow.suspensionSnapshot();
            const before_returns = flow.returnSnapshot();
            const allowed = Implementation.emitActionAllowedKnown(
                Definition,
                normalized_config,
                flow,
                memory,
                action_index,
                action,
                context,
            );
            if (!std.meta.eql(flow.suspensionSnapshot(), before_suspensions)) {
                @compileError("agent custom EpistemicStrategy emitActionAllowedKnown must be effect-free");
            }
            if (!std.meta.eql(flow.returnSnapshot(), before_returns)) {
                @compileError("agent custom EpistemicStrategy emitActionAllowedKnown must not terminate the Agent program");
            }
            return allowed;
        }

        pub fn actionAlwaysAllowedKnown(
            comptime Definition: type,
            comptime action_index: u16,
        ) bool {
            if (!@hasDecl(Implementation, "actionAlwaysAllowedKnown")) {
                return !@hasDecl(Implementation, "emitActionAllowed");
            }
            return Implementation.actionAlwaysAllowedKnown(
                Definition,
                normalized_config,
                action_index,
            );
        }

        pub fn emitFinalAllowed(comptime Definition: type, flow: anytype, memory: anytype, result: anytype, comptime context: anytype) @import("flow.zig").Value(bool) {
            const before_suspensions = flow.suspensionSnapshot();
            const before_returns = flow.returnSnapshot();
            const allowed = Implementation.emitFinalAllowed(Definition, normalized_config, flow, memory, result, context);
            if (!std.meta.eql(flow.suspensionSnapshot(), before_suspensions)) {
                @compileError("agent custom EpistemicStrategy emitFinalAllowed must be effect-free");
            }
            if (!std.meta.eql(flow.returnSnapshot(), before_returns)) {
                @compileError("agent custom EpistemicStrategy emitFinalAllowed must not terminate the Agent program");
            }
            return allowed;
        }
    };
}
