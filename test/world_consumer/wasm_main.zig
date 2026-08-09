const world = @import("world");
const application = @import("agent_world_application");

const Abi = world.ApplicationAbiV1(application.App, .{
    .input_capacity = 16 * 1024 * 1024,
    .output_capacity = 8 * 1024 * 1024,
    .scratch_capacity = 32 * 1024 * 1024,
    .manifest_capacity = 64 * 1024,
    .error_capacity = 1024,
});

pub export fn world_abi_version() u32 {
    return Abi.worldAbiVersion();
}

pub export fn world_manifest_ptr() u32 {
    return Abi.worldManifestPtr();
}

pub export fn world_manifest_len() u32 {
    return Abi.worldManifestLen();
}

pub export fn world_input_ptr() u32 {
    return Abi.worldInputPtr();
}

pub export fn world_input_capacity() u32 {
    return Abi.worldInputCapacity();
}

pub export fn world_step(input_len: u32) u32 {
    return Abi.worldStep(input_len);
}

pub export fn world_output_ptr() u32 {
    return Abi.worldOutputPtr();
}

pub export fn world_output_len() u32 {
    return Abi.worldOutputLen();
}

pub export fn world_error_ptr() u32 {
    return Abi.worldErrorPtr();
}

pub export fn world_error_len() u32 {
    return Abi.worldErrorLen();
}

pub export fn world_reset() u32 {
    return Abi.worldReset();
}
