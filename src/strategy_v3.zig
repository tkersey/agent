/// Admit one custom staged Agent 3 runtime. The implementation returns an
/// ordinary Boundary Program Body at compile time; no runtime callback or
/// strategy registry survives in the image.
pub fn staged(comptime spec: anytype) type {
    if (!@hasField(@TypeOf(spec), "semantic_identity") or
        !@hasField(@TypeOf(spec), "implementation"))
    {
        @compileError("agent.strategy.staged requires semantic_identity and implementation");
    }
    if (spec.semantic_identity.len == 0) {
        @compileError("agent staged strategy semantic identity must not be empty");
    }
    const Implementation = spec.implementation;
    if (!@hasDecl(Implementation, "ProgramBody")) {
        @compileError("agent staged strategy implementation requires ProgramBody");
    }
    return struct {
        pub const system_semantic_identity = spec.semantic_identity;
        pub fn ProgramBody(comptime source: anytype) type {
            return Implementation.ProgramBody(source);
        }
    };
}

/// Default open ReAct lowering for complete Agent 3 system source.
pub fn react(comptime config: anytype) type {
    if (@typeInfo(@TypeOf(config)).@"struct".fields.len != 0) {
        @compileError("agent.strategy.react accepts only an empty config");
    }
    return struct {
        pub const system_semantic_identity = "agent.strategy.react.v3";
        pub fn ProgramBody(comptime source: anytype) type {
            return @import("system_compiler.zig").ReactBody(source);
        }
    };
}
