const boundary = @import("boundary");
const action = @import("action.zig");
const identity = @import("identity.zig");

pub const package_version = "0.0.0";
pub const boundary_package_identity = "tkersey/boundary@v1.3.1";

pub const DefinitionAction = struct {
    kind: action.Kind,
    class: action.Class,
    name_digest: [32]u8,
    description_digest: [32]u8,
    payload_schema_digest: [32]u8,
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
        maximum_observations: u32,
        history_overflow: u8,
        semantic_digest: [32]u8,
    };
}

pub const StrategyManifest = struct {
    magic: [8]u8,
    semantic_identity_digest: [32]u8,
    reflection_rounds: u32,
    config_schema_digest: [32]u8,
    config_value_digest: [32]u8,
    decision_request_schema_digest: [32]u8,
    state_schema_catalog_digest: [32]u8,
    control_ir_digest: [32]u8,
    semantic_digest: [32]u8,
};

pub const CompiledManifest = struct {
    magic: [8]u8,
    definition_digest: [32]u8,
    strategy_digest: [32]u8,
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
    identity.bytes(&hasher, "agent-definition-manifest/v1");
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
        actions[index] = .{
            .kind = Descriptor.kind,
            .class = Descriptor.class,
            .name_digest = identity.digestBytes(Descriptor.name),
            .description_digest = identity.digestBytes(Descriptor.description),
            .payload_schema_digest = payload_digest,
            .resume_schema_digest = resume_digest,
            .effect_identity_digest = effect_identity_digest,
        };
        identity.unsigned(&hasher, @intFromEnum(Descriptor.kind));
        identity.unsigned(&hasher, @intFromEnum(Descriptor.class));
        identity.bytes(&hasher, Descriptor.name);
        identity.bytes(&hasher, Descriptor.description);
        hashDigest(&hasher, payload_digest);
        hashDigest(&hasher, resume_digest);
        hashDigest(&hasher, effect_identity_digest);
    }
    identity.unsigned(&hasher, Definition.budget.maximum_turns);
    identity.unsigned(&hasher, Definition.budget.maximum_decisions);
    identity.unsigned(&hasher, Definition.budget.maximum_effect_actions);
    identity.unsigned(&hasher, Definition.budget.maximum_child_actions);
    identity.unsigned(&hasher, Definition.history.maximum_observations);
    identity.unsigned(&hasher, @intFromEnum(Definition.history.overflow));
    return .{
        .magic = "AGT_DEF1".*,
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
        .maximum_observations = Definition.history.maximum_observations,
        .history_overflow = @intFromEnum(Definition.history.overflow),
        .semantic_digest = identity.finish(&hasher),
    };
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
    const request_digest = boundary.schema.schemaDigest(
        Strategy.DecisionRequestType(Definition),
    );
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
    identity.bytes(&hasher, "agent-strategy-manifest/v1");
    identity.bytes(&hasher, Strategy.semantic_identity);
    identity.unsigned(&hasher, reflection_rounds);
    hashDigest(&hasher, config_schema_digest);
    hashDigest(&hasher, config_value_digest);
    hashDigest(&hasher, request_digest);
    hashDigest(&hasher, state_catalog_digest);
    hashDigest(&hasher, control_digest);
    return .{
        .magic = "AGT_STR1".*,
        .semantic_identity_digest = identity.digestBytes(Strategy.semantic_identity),
        .reflection_rounds = reflection_rounds,
        .config_schema_digest = config_schema_digest,
        .config_value_digest = config_value_digest,
        .decision_request_schema_digest = request_digest,
        .state_schema_catalog_digest = state_catalog_digest,
        .control_ir_digest = control_digest,
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
    comptime Machine: type,
) CompiledManifest {
    @setEvalBranchQuota(10_000_000);
    const boundary_digest = identity.digestBytes(boundary_package_identity);
    const residual_digest = residualCatalogDigest(Machine);
    var hasher = identity.Hasher.init(.{});
    identity.bytes(&hasher, "agent-compiled-manifest/v1");
    hashDigest(&hasher, definition_manifest.semantic_digest);
    hashDigest(&hasher, strategy_manifest.semantic_digest);
    identity.unsigned(&hasher, Machine.Manifest.maximum_frames);
    identity.unsigned(&hasher, Machine.Manifest.maximum_state_bytes);
    identity.unsigned(&hasher, Machine.Manifest.maximum_machine_fuel);
    identity.boolean(&hasher, Machine.Manifest.includes_debug_metadata);
    hashDigest(&hasher, boundary_digest);
    identity.unsigned(&hasher, Machine.abi_version);
    hashDigest(&hasher, Machine.Manifest.machine_contract_digest);
    hashDigest(&hasher, residual_digest);
    return .{
        .magic = "AGT_CMP1".*,
        .definition_digest = definition_manifest.semantic_digest,
        .strategy_digest = strategy_manifest.semantic_digest,
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
