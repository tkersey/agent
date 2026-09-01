pub const Role = enum { system, developer, user };

pub fn literal(comptime spec: anytype) type {
    if (!@hasField(@TypeOf(spec), "role") or
        !@hasField(@TypeOf(spec), "content"))
    {
        @compileError("agent.prompt.literal requires role and content");
    }
    const role: Role = spec.role;
    if (spec.content.len == 0) @compileError("agent prompt content must not be empty");
    return struct {
        pub const prompt_role = role;
        pub const content = spec.content;
    };
}
