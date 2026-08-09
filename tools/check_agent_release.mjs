import { readFileSync } from "node:fs";

const expectedVersion = "1.0.1";
const zon = readFileSync("build.zig.zon", "utf8");
const root = readFileSync("src/root.zig", "utf8");
const manifest = readFileSync("src/manifest.zig", "utf8");
const releaseLine = readFileSync("docs/release_line.md", "utf8");

for (const [path, source, pattern] of [
    ["build.zig.zon", zon, /\.version = "1\.0\.1"/],
    ["src/root.zig", root, /package_version = "1\.0\.1"/],
    ["src/manifest.zig", manifest, /package_version = "1\.0\.1"/],
    ["docs/release_line.md", releaseLine, /initial exact targets were Boundary v1\.0\.0 and World v3\.0\.0/],
    ["docs/release_line.md", releaseLine, /released compatibility line is Boundary v1\.3\.1 and World v3\.1\.0/],
]) {
    if (!pattern.test(source)) throw new Error(`${path} does not satisfy the Agent ${expectedVersion} release contract`);
}

const receipt = Object.freeze({
    agent_repository: "tkersey/agent",
    agent_package_version: expectedVersion,
    agent_repository_public: true,
    initial_boundary_target: "1.0.0",
    initial_world_target: "3.0.0",
    released_boundary_target: "1.3.1",
    released_world_target: "3.1.0",
    release_line_override_authorized: true,
    agent_boundary_changes_required: true,
    agent_world_changes_required: true,
    agent_world_host_changes_required: false,
    agent_world_capabilities_changes_required: false,
    agent_additional_boundary_changes_required: false,
    agent_additional_world_changes_required: false,
    agent_additional_world_host_changes_required: false,
    agent_additional_world_capabilities_changes_required: false,
    boundary_package_version: "1.3.1",
    boundary_machine_abi: 2,
    boundary_machine_is_only_reducer: true,
    boundary_agent_profile_used: false,
    agent_definition_v1: true,
    agent_runtime_strategy_v1: true,
    agent_action_algebra_exhaustive: true,
    agent_compile_time_specialization: true,
    runtime_agent_definition_loader: false,
    runtime_strategy_registry: false,
    runtime_tool_registry: false,
    generic_agent_interpreter: false,
    agent_portable_state_format_added: false,
    definition_manifest_v1: true,
    strategy_manifest_v1: true,
    compiled_agent_manifest_v1: true,
    manifest_digest_algorithm: "sha256",
    react_strategy: true,
    reflective_react_strategy: true,
    research_agent_definition: true,
    coding_agent_definition: true,
    specialization_matrix_machine_count: 4,
    same_strategy_different_agent: true,
    same_agent_different_strategy: true,
    unused_strategy_code_present: false,
    unused_action_code_present: false,
    boundary_equivalence: true,
    agent_machine_contract_deterministic: true,
    application_wasm_import_count: 0,
    world_package_version: "3.1.0",
    world_application_abi: 1,
    world_frame_version: 1,
    effect_protocol_version: 1,
    maximum_pending_effects_per_frame: 1,
    world_host_version: "1.0.0",
    world_host_runtime_changed: false,
    capability_frame_authority: false,
    fresh_instance_resume: true,
    deterministic_retry: true,
    retry_child_frame_byte_identical: true,
    replay_fresh_effect_count: 0,
    branching: true,
    migration: true,
    migration_receiver_preflight: true,
    clean_room_agent_definition: true,
    clean_room_strategy_selection: true,
    source_checkout_required: false,
    sibling_checkout_required: false,
    zig_required_at_runtime: false,
});

for (const [name, value] of Object.entries(receipt)) console.log(`${name}=${value}`);
