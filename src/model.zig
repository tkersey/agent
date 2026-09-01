const std = @import("std");

pub fn model(comptime spec: anytype) type {
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
