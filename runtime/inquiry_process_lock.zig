//! dyld invokes this trusted dependency before the final image's initializers.
//! The deployment's exact filesystem/network profile is installed once here.
//! Denying exec prevents the candidate from discarding its fatal memory limit;
//! denying fork keeps the footprint/thread limits scoped to one process.
extern "c" fn sandbox_init([*:0]const u8, u64, ?*?[*:0]u8) c_int;
extern "c" fn _exit(c_int) noreturn;
extern "c" fn getenv([*:0]const u8) ?[*:0]const u8;
extern "c" fn write(c_int, [*]const u8, usize) isize;
extern "c" fn close(c_int) c_int;
fn initialize() callconv(.c) void {
    const profile = getenv("AGENT_CHECK_SANDBOX_PROFILE") orelse _exit(126);
    if (sandbox_init(profile, 0, null) != 0) _exit(126);
    const nonce = getenv("AGENT_CHECK_READY_NONCE") orelse _exit(126);
    var length: usize = 0;
    while (nonce[length] != 0) : (length += 1) if (length == 64) _exit(126);
    if (length != 64 or write(3, nonce, length) != 64 or close(3) != 0) _exit(126);
}
export var agent_process_lock: *const fn () callconv(.c) void linksection("__DATA,__mod_init_func") = initialize;
