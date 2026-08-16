const std = @import("std");
const boundary = @import("boundary");
const action = @import("action.zig");
const identity = @import("identity.zig");

pub const package_version = "2.3.0";
pub const boundary_package_identity = "tkersey/boundary@v1.5.0";

pub const DefinitionAction = struct {
    kind: action.Kind,
    class: action.Class,
    name_digest: [32]u8,
    description_digest: [32]u8,
    payload_schema_digest: [32]u8,
    observation_name_digest: [32]u8,
    resume_schema_digest: [32]u8,
    effect_identity_digest: [32]u8,
};

pub fn DefinitionManifest(comptime action_count: usize) type {
    return struct {
        magic: [8]u8,
        package_version_digest: [32]u8,
        name_digest: [32]u8,
        version_digest: [32]u8,
        instructions_length: u64,
        instructions_digest: [32]u8,
        goal_schema_digest: [32]u8,
        action_schema_digest: [32]u8,
        observation_schema_digest: [32]u8,
        result_schema_digest: [32]u8,
        failure_schema_digest: [32]u8,
        decision_interface_digest: [32]u8,
        maximum_request_bytes: u64,
        maximum_result_bytes: u64,
        actions: [action_count]DefinitionAction,
        maximum_turns: u32,
        maximum_decisions: u32,
        maximum_effect_actions: u32,
        maximum_child_actions: u32,
        semantic_digest: [32]u8,
    };
}

pub const StrategyManifest = struct {
    magic: [8]u8,
    semantic_identity_digest: [32]u8,
    reflection_rounds: u32,
    config_schema_digest: [32]u8,
    config_value_digest: [32]u8,
    decision_local_schema_digest: [32]u8,
    state_schema_catalog_digest: [32]u8,
    control_ir_digest: [32]u8,
    semantic_digest: [32]u8,
};

pub const EpistemicsManifest = struct {
    magic: [8]u8,
    semantic_identity_digest: [32]u8,
    config_schema_digest: [32]u8,
    config_value_digest: [32]u8,
    memory_schema_digest: [32]u8,
    decision_view_schema_digest: [32]u8,
    state_schema_catalog_digest: [32]u8,
    initial_lowering_digest: [32]u8,
    observe_lowering_digest: [32]u8,
    project_lowering_digest: [32]u8,
    final_guard_lowering_digest: [32]u8,
    semantic_digest: [32]u8,
};

pub const CompiledManifest = struct {
    magic: [8]u8,
    definition_digest: [32]u8,
    strategy_digest: [32]u8,
    epistemics_digest: [32]u8,
    decision_contract_digest: [32]u8,
    maximum_frames: u64,
    maximum_state_bytes: u64,
    maximum_machine_fuel: u64,
    debug_metadata: bool,
    boundary_package_digest: [32]u8,
    boundary_machine_abi: u32,
    boundary_machine_contract_digest: [32]u8,
    residual_effect_catalog_digest: [32]u8,
    semantic_digest: [32]u8,
};

fn actionPayload(comptime Definition: type, comptime index: usize) type {
    return @typeInfo(Definition.Action).@"union".fields[index].type;
}

fn hashDigest(hasher: *identity.Hasher, digest: [32]u8) void {
    hasher.update(&digest);
}

pub fn definition(comptime Definition: type) DefinitionManifest(Definition.action_count) {
    @setEvalBranchQuota(10_000_000);
    var actions: [Definition.action_count]DefinitionAction = undefined;
    var hasher = identity.Hasher.init(.{});
    identity.bytes(&hasher, "agent-definition-manifest/v2");
    identity.bytes(&hasher, package_version);
    identity.bytes(&hasher, Definition.name);
    identity.bytes(&hasher, Definition.version);
    identity.bytes(&hasher, Definition.instructions);
    const goal_digest = boundary.schema.schemaDigest(Definition.Goal);
    const action_digest = boundary.schema.schemaDigest(Definition.Action);
    const observation_digest = boundary.schema.schemaDigest(Definition.Observation);
    const result_digest = boundary.schema.schemaDigest(Definition.Result);
    const failure_digest = boundary.schema.schemaDigest(Definition.Failure);
    hashDigest(&hasher, goal_digest);
    hashDigest(&hasher, action_digest);
    hashDigest(&hasher, observation_digest);
    hashDigest(&hasher, result_digest);
    hashDigest(&hasher, failure_digest);
    identity.bytes(&hasher, Definition.decision.interface);
    identity.unsigned(&hasher, Definition.decision.maximum_request_bytes);
    identity.unsigned(&hasher, Definition.decision.maximum_result_bytes);
    inline for (0..Definition.action_count) |index| {
        const Descriptor = Definition.ActionDescriptor(index);
        const payload_digest = boundary.schema.schemaDigest(
            actionPayload(Definition, index),
        );
        const resume_digest = if (Descriptor.kind == .effect)
            boundary.schema.schemaDigest(Descriptor.Site.Resume)
        else
            [_]u8{0} ** 32;
        const effect_identity_digest = if (Descriptor.kind == .effect)
            identity.digestBytes(Descriptor.Site.semantic_identity)
        else
            [_]u8{0} ** 32;
        const observation_name = if (Descriptor.kind == .effect)
            Descriptor.observation_name
        else
            "";
        actions[index] = .{
            .kind = Descriptor.kind,
            .class = Descriptor.class,
            .name_digest = identity.digestBytes(Descriptor.name),
            .description_digest = identity.digestBytes(Descriptor.description),
            .payload_schema_digest = payload_digest,
            .observation_name_digest = identity.digestBytes(observation_name),
            .resume_schema_digest = resume_digest,
            .effect_identity_digest = effect_identity_digest,
        };
        identity.unsigned(&hasher, @intFromEnum(Descriptor.kind));
        identity.unsigned(&hasher, @intFromEnum(Descriptor.class));
        identity.bytes(&hasher, Descriptor.name);
        identity.bytes(&hasher, Descriptor.description);
        hashDigest(&hasher, payload_digest);
        identity.bytes(&hasher, observation_name);
        hashDigest(&hasher, resume_digest);
        hashDigest(&hasher, effect_identity_digest);
    }
    identity.unsigned(&hasher, Definition.budget.maximum_turns);
    identity.unsigned(&hasher, Definition.budget.maximum_decisions);
    identity.unsigned(&hasher, Definition.budget.maximum_effect_actions);
    identity.unsigned(&hasher, Definition.budget.maximum_child_actions);
    return .{
        .magic = "AGT_DEF2".*,
        .package_version_digest = identity.digestBytes(package_version),
        .name_digest = identity.digestBytes(Definition.name),
        .version_digest = identity.digestBytes(Definition.version),
        .instructions_length = Definition.instructions.len,
        .instructions_digest = identity.digestBytes(Definition.instructions),
        .goal_schema_digest = goal_digest,
        .action_schema_digest = action_digest,
        .observation_schema_digest = observation_digest,
        .result_schema_digest = result_digest,
        .failure_schema_digest = failure_digest,
        .decision_interface_digest = identity.digestBytes(Definition.decision.interface),
        .maximum_request_bytes = Definition.decision.maximum_request_bytes,
        .maximum_result_bytes = Definition.decision.maximum_result_bytes,
        .actions = actions,
        .maximum_turns = Definition.budget.maximum_turns,
        .maximum_decisions = Definition.budget.maximum_decisions,
        .maximum_effect_actions = Definition.budget.maximum_effect_actions,
        .maximum_child_actions = Definition.budget.maximum_child_actions,
        .semantic_digest = identity.finish(&hasher),
    };
}

fn Writer(comptime capacity: usize) type {
    return struct {
        buffer: [capacity]u8 = undefined,
        cursor: usize = 0,

        fn raw(self: *@This(), value: []const u8) void {
            const end = std.math.add(usize, self.cursor, value.len) catch
                @compileError("agent manifest encoded length overflows usize");
            if (end > capacity) @compileError("agent manifest writer capacity mismatch");
            @memcpy(self.buffer[self.cursor..end], value);
            self.cursor = end;
        }

        fn u8Value(self: *@This(), value: u8) void {
            self.raw(&.{value});
        }

        fn u32Value(self: *@This(), value: anytype) void {
            var encoded: [4]u8 = undefined;
            std.mem.writeInt(u32, &encoded, @intCast(value), .big);
            self.raw(&encoded);
        }

        fn u64Value(self: *@This(), value: anytype) void {
            var encoded: [8]u8 = undefined;
            std.mem.writeInt(u64, &encoded, @intCast(value), .big);
            self.raw(&encoded);
        }

        fn byteField(self: *@This(), value: []const u8) void {
            self.u32Value(value.len);
            self.raw(value);
        }

        fn digest(self: *@This(), value: [32]u8) void {
            self.raw(&value);
        }

        fn finish(self: @This()) [capacity]u8 {
            if (self.cursor != capacity) {
                @compileError("agent manifest encoding left trailing capacity");
            }
            return self.buffer;
        }
    };
}

fn addLength(comptime left: usize, comptime right: usize) usize {
    return std.math.add(usize, left, right) catch
        @compileError("agent manifest encoded length overflows usize");
}

fn byteFieldLength(comptime value: []const u8) usize {
    if (value.len > std.math.maxInt(u32)) {
        @compileError("agent manifest byte field exceeds u32 length");
    }
    return addLength(4, value.len);
}

fn definitionEncodedLength(comptime Definition: type) usize {
    var length: usize = 8;
    length = addLength(length, byteFieldLength(package_version));
    length = addLength(length, byteFieldLength(Definition.name));
    length = addLength(length, byteFieldLength(Definition.version));
    length = addLength(length, byteFieldLength(Definition.instructions));
    length = addLength(length, 5 * 32);
    length = addLength(length, byteFieldLength(Definition.decision.interface));
    length = addLength(length, 16 + 4);
    inline for (0..Definition.action_count) |index| {
        const Descriptor = Definition.ActionDescriptor(index);
        const observation_name = if (Descriptor.kind == .effect)
            Descriptor.observation_name
        else
            "";
        const effect_identity = if (Descriptor.kind == .effect)
            Descriptor.Site.semantic_identity
        else
            "";
        length = addLength(length, 2);
        length = addLength(length, byteFieldLength(Descriptor.name));
        length = addLength(length, byteFieldLength(Descriptor.description));
        length = addLength(length, 32);
        length = addLength(length, byteFieldLength(observation_name));
        length = addLength(length, 32);
        length = addLength(length, byteFieldLength(effect_identity));
    }
    return addLength(length, 16 + 32);
}

/// Canonical target-neutral Definition manifest bytes. This is executable
/// provenance output, never an AgentDefinition input.
pub fn encodeDefinition(
    comptime Definition: type,
    value: DefinitionManifest(Definition.action_count),
) [definitionEncodedLength(Definition)]u8 {
    var writer = Writer(definitionEncodedLength(Definition)){};
    writer.raw(&value.magic);
    writer.byteField(package_version);
    writer.byteField(Definition.name);
    writer.byteField(Definition.version);
    writer.byteField(Definition.instructions);
    writer.digest(value.goal_schema_digest);
    writer.digest(value.action_schema_digest);
    writer.digest(value.observation_schema_digest);
    writer.digest(value.result_schema_digest);
    writer.digest(value.failure_schema_digest);
    writer.byteField(Definition.decision.interface);
    writer.u64Value(value.maximum_request_bytes);
    writer.u64Value(value.maximum_result_bytes);
    writer.u32Value(Definition.action_count);
    inline for (0..Definition.action_count) |index| {
        const Descriptor = Definition.ActionDescriptor(index);
        const entry = value.actions[index];
        const observation_name = if (Descriptor.kind == .effect)
            Descriptor.observation_name
        else
            "";
        const effect_identity = if (Descriptor.kind == .effect)
            Descriptor.Site.semantic_identity
        else
            "";
        writer.u8Value(@intFromEnum(entry.kind));
        writer.u8Value(@intFromEnum(entry.class));
        writer.byteField(Descriptor.name);
        writer.byteField(Descriptor.description);
        writer.digest(entry.payload_schema_digest);
        writer.byteField(observation_name);
        writer.digest(entry.resume_schema_digest);
        writer.byteField(effect_identity);
    }
    writer.u32Value(value.maximum_turns);
    writer.u32Value(value.maximum_decisions);
    writer.u32Value(value.maximum_effect_actions);
    writer.u32Value(value.maximum_child_actions);
    writer.digest(value.semantic_digest);
    return writer.finish();
}

fn strategyEncodedLength(comptime Strategy: type) usize {
    const config_size = boundary.schema.encodedSize(
        Strategy.Config,
        Strategy.normalized_config,
    ) catch @compileError("agent strategy config is not canonically encodable");
    var length: usize = 8;
    length = addLength(length, byteFieldLength(package_version));
    length = addLength(length, byteFieldLength(Strategy.semantic_identity));
    length = addLength(length, 4 + 32);
    length = addLength(length, addLength(4, config_size));
    return addLength(length, 4 * 32);
}

/// Canonical target-neutral RuntimeStrategy manifest bytes.
pub fn encodeStrategy(
    comptime Strategy: type,
    value: StrategyManifest,
) [strategyEncodedLength(Strategy)]u8 {
    const config_maximum = boundary.schema.maximumEncodedSize(Strategy.Config);
    var config_buffer: [config_maximum]u8 = undefined;
    const config_length = boundary.schema.encode(
        Strategy.Config,
        Strategy.normalized_config,
        &config_buffer,
    ) catch unreachable;
    var writer = Writer(strategyEncodedLength(Strategy)){};
    writer.raw(&value.magic);
    writer.byteField(package_version);
    writer.byteField(Strategy.semantic_identity);
    writer.u32Value(value.reflection_rounds);
    writer.digest(value.config_schema_digest);
    writer.byteField(config_buffer[0..config_length]);
    writer.digest(value.decision_local_schema_digest);
    writer.digest(value.state_schema_catalog_digest);
    writer.digest(value.control_ir_digest);
    writer.digest(value.semantic_digest);
    return writer.finish();
}

fn epistemicsEncodedLength(comptime Epistemics: type) usize {
    const config_size = boundary.schema.encodedSize(
        Epistemics.Config,
        Epistemics.normalized_config,
    ) catch @compileError("agent epistemics config is not canonically encodable");
    var length: usize = 8;
    length = addLength(length, byteFieldLength(package_version));
    length = addLength(length, byteFieldLength(Epistemics.semantic_identity));
    length = addLength(length, 32);
    length = addLength(length, addLength(4, config_size));
    return addLength(length, 9 * 32);
}

/// Canonical target-neutral EpistemicStrategy manifest bytes.
pub fn encodeEpistemics(
    comptime Epistemics: type,
    value: EpistemicsManifest,
) [epistemicsEncodedLength(Epistemics)]u8 {
    const config_maximum = boundary.schema.maximumEncodedSize(Epistemics.Config);
    var config_buffer: [config_maximum]u8 = undefined;
    const config_length = boundary.schema.encode(
        Epistemics.Config,
        Epistemics.normalized_config,
        &config_buffer,
    ) catch unreachable;
    var writer = Writer(epistemicsEncodedLength(Epistemics)){};
    writer.raw(&value.magic);
    writer.byteField(package_version);
    writer.byteField(Epistemics.semantic_identity);
    writer.digest(value.config_schema_digest);
    writer.byteField(config_buffer[0..config_length]);
    writer.digest(value.config_value_digest);
    writer.digest(value.memory_schema_digest);
    writer.digest(value.decision_view_schema_digest);
    writer.digest(value.state_schema_catalog_digest);
    writer.digest(value.initial_lowering_digest);
    writer.digest(value.observe_lowering_digest);
    writer.digest(value.project_lowering_digest);
    writer.digest(value.final_guard_lowering_digest);
    writer.digest(value.semantic_digest);
    return writer.finish();
}

fn compiledEncodedLength() usize {
    var length: usize = 8 + 4 * 32 + 3 * 8 + 1;
    length = addLength(length, byteFieldLength(boundary_package_identity));
    return addLength(length, 4 + 3 * 32);
}

/// Canonical target-neutral CompiledAgent manifest bytes.
pub fn encodeCompiled(value: CompiledManifest) [compiledEncodedLength()]u8 {
    var writer = Writer(compiledEncodedLength()){};
    writer.raw(&value.magic);
    writer.digest(value.definition_digest);
    writer.digest(value.strategy_digest);
    writer.digest(value.epistemics_digest);
    writer.digest(value.decision_contract_digest);
    writer.u64Value(value.maximum_frames);
    writer.u64Value(value.maximum_state_bytes);
    writer.u64Value(value.maximum_machine_fuel);
    writer.u8Value(@intFromBool(value.debug_metadata));
    writer.byteField(boundary_package_identity);
    writer.u32Value(value.boundary_machine_abi);
    writer.digest(value.boundary_machine_contract_digest);
    writer.digest(value.residual_effect_catalog_digest);
    writer.digest(value.semantic_digest);
    return writer.finish();
}

pub fn strategy(
    comptime Definition: type,
    comptime Strategy: type,
    comptime Program: type,
) StrategyManifest {
    @setEvalBranchQuota(10_000_000);
    const reflection_rounds: u32 = switch (Strategy.kind) {
        .react => 0,
        .reflective => Strategy.normalized_config.reflection_rounds,
        .custom => 0,
    };
    const config_schema_digest = boundary.schema.schemaDigest(Strategy.Config);
    var config_hasher = identity.Hasher.init(.{});
    identity.bytes(&config_hasher, "agent-strategy-config/v1");
    boundary.schema.updateCanonicalHash(
        Strategy.Config,
        Strategy.normalized_config,
        &config_hasher,
    ) catch unreachable;
    const config_value_digest = identity.finish(&config_hasher);
    const request_digest = boundary.schema.schemaDigest(Strategy.DecisionLocalType(Definition));
    var state_hasher = identity.Hasher.init(.{});
    identity.bytes(&state_hasher, "agent-strategy-state-schemas/v1");
    const state_types = Strategy.StateSchemaTypes(Definition);
    inline for (state_types) |State| {
        boundary.schema.assertPortable(State);
        hashDigest(&state_hasher, boundary.schema.schemaDigest(State));
    }
    const state_catalog_digest = identity.finish(&state_hasher);
    const control_digest = identity.controlDigest(Program.control_ir);
    var hasher = identity.Hasher.init(.{});
    identity.bytes(&hasher, "agent-strategy-manifest/v2");
    identity.bytes(&hasher, Strategy.semantic_identity);
    identity.unsigned(&hasher, reflection_rounds);
    hashDigest(&hasher, config_schema_digest);
    hashDigest(&hasher, config_value_digest);
    hashDigest(&hasher, request_digest);
    hashDigest(&hasher, state_catalog_digest);
    hashDigest(&hasher, control_digest);
    return .{
        .magic = "AGT_STR2".*,
        .semantic_identity_digest = identity.digestBytes(Strategy.semantic_identity),
        .reflection_rounds = reflection_rounds,
        .config_schema_digest = config_schema_digest,
        .config_value_digest = config_value_digest,
        .decision_local_schema_digest = request_digest,
        .state_schema_catalog_digest = state_catalog_digest,
        .control_ir_digest = control_digest,
        .semantic_digest = identity.finish(&hasher),
    };
}

fn loweringDigest(
    comptime domain: []const u8,
    control_digest: [32]u8,
    constants_digest: [32]u8,
) [32]u8 {
    var hasher = identity.Hasher.init(.{});
    identity.bytes(&hasher, "agent-epistemics-lowering/v1");
    identity.bytes(&hasher, domain);
    hashDigest(&hasher, control_digest);
    hashDigest(&hasher, constants_digest);
    return identity.finish(&hasher);
}

fn programConstantsDigest(comptime Program: type) [32]u8 {
    var hasher = identity.Hasher.init(.{});
    identity.bytes(&hasher, "agent-program-constants/v1");
    identity.unsigned(&hasher, Program.constants.len);
    inline for (Program.constants) |constant| {
        const T = @TypeOf(constant);
        boundary.schema.assertPortable(T);
        hashDigest(&hasher, boundary.schema.schemaDigest(T));
        boundary.schema.updateCanonicalHash(T, constant, &hasher) catch unreachable;
    }
    return identity.finish(&hasher);
}

pub fn epistemics(
    comptime Definition: type,
    comptime Epistemics: type,
    comptime Program: type,
) EpistemicsManifest {
    @setEvalBranchQuota(10_000_000);
    const config_schema_digest = boundary.schema.schemaDigest(Epistemics.Config);
    const config_value_digest = Epistemics.semantic_config_digest;
    const memory_digest = boundary.schema.schemaDigest(Epistemics.MemoryType(Definition));
    const view_digest = boundary.schema.schemaDigest(Epistemics.DecisionViewType(Definition));
    var state_hasher = identity.Hasher.init(.{});
    identity.bytes(&state_hasher, "agent-epistemics-state-schemas/v1");
    inline for (Epistemics.StateSchemaTypes(Definition)) |State| {
        boundary.schema.assertPortable(State);
        hashDigest(&state_hasher, boundary.schema.schemaDigest(State));
    }
    const state_digest = identity.finish(&state_hasher);
    const control_digest = identity.controlDigest(Program.control_ir);
    const constants_digest = programConstantsDigest(Program);
    const initial_digest = loweringDigest("initial", control_digest, constants_digest);
    const observe_digest = loweringDigest("observe", control_digest, constants_digest);
    const project_digest = loweringDigest("project", control_digest, constants_digest);
    const final_digest = loweringDigest("final", control_digest, constants_digest);
    var hasher = identity.Hasher.init(.{});
    identity.bytes(&hasher, "agent-epistemics-manifest/v1");
    identity.bytes(&hasher, Epistemics.semantic_identity);
    hashDigest(&hasher, config_schema_digest);
    hashDigest(&hasher, config_value_digest);
    hashDigest(&hasher, memory_digest);
    hashDigest(&hasher, view_digest);
    hashDigest(&hasher, state_digest);
    hashDigest(&hasher, initial_digest);
    hashDigest(&hasher, observe_digest);
    hashDigest(&hasher, project_digest);
    hashDigest(&hasher, final_digest);
    return .{
        .magic = "AGT_EPI1".*,
        .semantic_identity_digest = identity.digestBytes(Epistemics.semantic_identity),
        .config_schema_digest = config_schema_digest,
        .config_value_digest = config_value_digest,
        .memory_schema_digest = memory_digest,
        .decision_view_schema_digest = view_digest,
        .state_schema_catalog_digest = state_digest,
        .initial_lowering_digest = initial_digest,
        .observe_lowering_digest = observe_digest,
        .project_lowering_digest = project_digest,
        .final_guard_lowering_digest = final_digest,
        .semantic_digest = identity.finish(&hasher),
    };
}

fn residualCatalogDigest(comptime Machine: type) [32]u8 {
    var hasher = identity.Hasher.init(.{});
    identity.bytes(&hasher, "agent-residual-effect-catalog/v1");
    identity.unsigned(&hasher, Machine.Manifest.effect_site_count);
    inline for (0..Machine.Manifest.effect_site_count) |index| {
        const Site = Machine.EffectRow.site(index);
        identity.bytes(&hasher, Site.semantic_identity);
        hashDigest(&hasher, Site.semantic_contract_digest);
        hashDigest(&hasher, Site.contract_digest);
    }
    return identity.finish(&hasher);
}

pub fn compiled(
    definition_manifest: anytype,
    strategy_manifest: StrategyManifest,
    epistemics_manifest: EpistemicsManifest,
    decision_contract_digest: [32]u8,
    comptime Machine: type,
) CompiledManifest {
    @setEvalBranchQuota(10_000_000);
    const boundary_digest = identity.digestBytes(boundary_package_identity);
    const residual_digest = residualCatalogDigest(Machine);
    var hasher = identity.Hasher.init(.{});
    identity.bytes(&hasher, "agent-compiled-manifest/v2");
    hashDigest(&hasher, definition_manifest.semantic_digest);
    hashDigest(&hasher, strategy_manifest.semantic_digest);
    hashDigest(&hasher, epistemics_manifest.semantic_digest);
    hashDigest(&hasher, decision_contract_digest);
    identity.unsigned(&hasher, Machine.Manifest.maximum_frames);
    identity.unsigned(&hasher, Machine.Manifest.maximum_state_bytes);
    identity.unsigned(&hasher, Machine.Manifest.maximum_machine_fuel);
    identity.boolean(&hasher, Machine.Manifest.includes_debug_metadata);
    hashDigest(&hasher, boundary_digest);
    identity.unsigned(&hasher, Machine.abi_version);
    hashDigest(&hasher, Machine.Manifest.machine_contract_digest);
    hashDigest(&hasher, residual_digest);
    return .{
        .magic = "AGT_CMP2".*,
        .definition_digest = definition_manifest.semantic_digest,
        .strategy_digest = strategy_manifest.semantic_digest,
        .epistemics_digest = epistemics_manifest.semantic_digest,
        .decision_contract_digest = decision_contract_digest,
        .maximum_frames = Machine.Manifest.maximum_frames,
        .maximum_state_bytes = Machine.Manifest.maximum_state_bytes,
        .maximum_machine_fuel = Machine.Manifest.maximum_machine_fuel,
        .debug_metadata = Machine.Manifest.includes_debug_metadata,
        .boundary_package_digest = boundary_digest,
        .boundary_machine_abi = Machine.abi_version,
        .boundary_machine_contract_digest = Machine.Manifest.machine_contract_digest,
        .residual_effect_catalog_digest = residual_digest,
        .semantic_digest = identity.finish(&hasher),
    };
}
