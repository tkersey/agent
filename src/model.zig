const std = @import("std");

pub const ReasoningEffort = enum {
    none,
    minimal,
    low,
    medium,
    high,
    xhigh,
    max,
};

pub const ReasoningSummary = enum {
    auto,
    concise,
    detailed,
};

fn parameterFieldAdmitted(comptime name: []const u8) bool {
    return std.mem.eql(u8, name, "max_output_tokens") or
        std.mem.eql(u8, name, "temperature") or
        std.mem.eql(u8, name, "reasoning");
}

fn modelFieldAdmitted(comptime name: []const u8) bool {
    return std.mem.eql(u8, name, "name") or
        std.mem.eql(u8, name, "protocol") or
        std.mem.eql(u8, name, "model") or
        std.mem.eql(u8, name, "parameters");
}

fn canonicalTemperature(comptime value: []const u8) bool {
    if (value.len == 0 or value[0] < '0' or value[0] > '2') return false;
    if (value.len == 1) return true;
    if (value[1] != '.' or value.len == 2 or value[value.len - 1] == '0') {
        return false;
    }
    if (value[0] == '2') return false;
    for (value[2..]) |byte| if (byte < '0' or byte > '9') return false;
    return true;
}

fn validateReasoning(comptime reasoning: anytype) void {
    if (@typeInfo(@TypeOf(reasoning)) != .@"struct") {
        @compileError("agent model reasoning configuration must be a struct");
    }
    inline for (std.meta.fields(@TypeOf(reasoning))) |field| {
        if (!std.mem.eql(u8, field.name, "effort") and
            !std.mem.eql(u8, field.name, "summary"))
        {
            @compileError(
                "agent model reasoning contains unsupported field '" ++
                    field.name ++ "'",
            );
        }
    }
    if (!@hasField(@TypeOf(reasoning), "effort") and
        !@hasField(@TypeOf(reasoning), "summary"))
    {
        @compileError("agent model reasoning configuration must not be empty");
    }
    if (@hasField(@TypeOf(reasoning), "effort")) {
        const effort: ReasoningEffort = reasoning.effort;
        _ = effort;
    }
    if (@hasField(@TypeOf(reasoning), "summary")) {
        const summary: ReasoningSummary = reasoning.summary;
        _ = summary;
    }
}

fn validateParameters(comptime parameters: anytype) void {
    if (@TypeOf(parameters) == void) return;
    inline for (std.meta.fields(@TypeOf(parameters))) |field| {
        if (!parameterFieldAdmitted(field.name)) {
            @compileError("agent model parameters contain unsupported field '" ++ field.name ++ "'");
        }
    }
    if (@hasField(@TypeOf(parameters), "max_output_tokens")) {
        if (@TypeOf(parameters.max_output_tokens) != u32) {
            @compileError("agent model max_output_tokens must be u32");
        }
        if (parameters.max_output_tokens == 0) {
            @compileError("agent model max_output_tokens must be positive");
        }
    }
    if (@hasField(@TypeOf(parameters), "temperature")) {
        const value: []const u8 = parameters.temperature;
        if (!canonicalTemperature(value)) {
            @compileError("agent model temperature must be a canonical decimal from 0 through 2");
        }
    }
    if (@hasField(@TypeOf(parameters), "reasoning")) {
        validateReasoning(parameters.reasoning);
    }
}

pub fn model(comptime spec: anytype) type {
    inline for (std.meta.fields(@TypeOf(spec))) |field| {
        if (!modelFieldAdmitted(field.name)) {
            @compileError("agent.model unknown source field '" ++ field.name ++ "'");
        }
    }
    if (!@hasField(@TypeOf(spec), "name") or
        !@hasField(@TypeOf(spec), "protocol") or
        !@hasField(@TypeOf(spec), "model"))
    {
        @compileError("agent.model requires name, protocol, and model");
    }
    if (spec.name.len == 0) @compileError("agent model name must not be empty");
    if (spec.model.len == 0) @compileError("agent model identifier must not be empty");
    const Protocol = spec.protocol;
    if (!@hasDecl(Protocol, "semantic_identity") or Protocol.semantic_identity.len == 0) {
        @compileError("agent model protocol requires a semantic_identity");
    }
    const Parameters = if (@hasField(@TypeOf(spec), "parameters"))
        @TypeOf(spec.parameters)
    else
        void;
    const parameters_value: Parameters = if (@hasField(@TypeOf(spec), "parameters"))
        spec.parameters
    else {};
    comptime validateParameters(parameters_value);
    return struct {
        pub const name = spec.name;
        pub const protocol = Protocol;
        pub const model_id = spec.model;
        pub const ParametersType = Parameters;
        pub const parameters = parameters_value;
    };
}

pub fn validateUnique(comptime models: anytype) void {
    if (models.len == 0) @compileError("agent system requires at least one model");
    inline for (models, 0..) |Model, index| {
        _ = Model.protocol.semantic_identity;
        inline for (models, 0..) |Earlier, earlier_index| {
            if (earlier_index < index and std.mem.eql(u8, Earlier.name, Model.name)) {
                @compileError("agent model semantic name is duplicated");
            }
        }
    }
}
