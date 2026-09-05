const CanonicalStrategySeal = struct {};

pub fn isAdmitted(comptime Strategy: type) bool {
    return @hasDecl(Strategy, "agent_strategy_seal") and
        Strategy.agent_strategy_seal == CanonicalStrategySeal;
}

/// Select one alternate staged identity while retaining the compiler-owned
/// closed-system runtime, decoder, admission, and dispatch path.
pub fn staged(comptime spec: anytype) type {
    inline for (@import("std").meta.fields(@TypeOf(spec))) |field| {
        if (!@import("std").mem.eql(u8, field.name, "semantic_identity")) {
            @compileError("agent.strategy.staged unknown field '" ++ field.name ++ "'");
        }
    }
    if (!@hasField(@TypeOf(spec), "semantic_identity"))
        @compileError("agent.strategy.staged requires semantic_identity");
    if (spec.semantic_identity.len == 0) {
        @compileError("agent staged strategy semantic identity must not be empty");
    }
    return struct {
        const agent_strategy_seal = CanonicalStrategySeal;
        pub const system_semantic_identity = spec.semantic_identity;
        pub const requires_typed_action_product_payloads = true;
        pub const repeat_after_observation = true;
        pub const allow_completion = true;
        pub fn ProgramBody(comptime source: anytype) type {
            return @import("system_compiler.zig").ReactBody(source);
        }
    };
}

/// Default open ReAct lowering for complete Agent 3 system source.
pub fn react(comptime config: anytype) type {
    if (@typeInfo(@TypeOf(config)).@"struct".fields.len != 0) {
        @compileError("agent.strategy.react accepts only an empty config");
    }
    return struct {
        const agent_strategy_seal = CanonicalStrategySeal;
        pub const system_semantic_identity = "agent.strategy.react.v3";
        pub const requires_typed_action_product_payloads = true;
        pub const repeat_after_observation = true;
        pub const allow_completion = true;
        pub fn ProgramBody(comptime source: anytype) type {
            return @import("system_compiler.zig").ReactBody(source);
        }
    };
}
