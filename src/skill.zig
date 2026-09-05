const std = @import("std");
const prompt = @import("prompt.zig");

pub const Activation = enum { always, conditional, explicit };
pub const RenderPosition = enum { before_user, after_user };
const CanonicalSkillSeal = struct {};

pub fn isAdmitted(comptime Skill: type) bool {
    return @hasDecl(Skill, "agent_skill_seal") and
        Skill.agent_skill_seal == CanonicalSkillSeal;
}

pub fn skill(comptime spec: anytype) type {
    if (!@hasField(@TypeOf(spec), "id") or
        !@hasField(@TypeOf(spec), "description") or
        !@hasField(@TypeOf(spec), "instructions") or
        !@hasField(@TypeOf(spec), "role") or
        !@hasField(@TypeOf(spec), "position") or
        !@hasField(@TypeOf(spec), "activation") or
        !@hasField(@TypeOf(spec), "actions"))
    {
        @compileError("agent.skill requires id, description, instructions, role, position, activation, and actions");
    }
    inline for (std.meta.fields(@TypeOf(spec))) |field| {
        if (!std.mem.eql(u8, field.name, "id") and
            !std.mem.eql(u8, field.name, "description") and
            !std.mem.eql(u8, field.name, "instructions") and
            !std.mem.eql(u8, field.name, "role") and
            !std.mem.eql(u8, field.name, "position") and
            !std.mem.eql(u8, field.name, "activation") and
            !std.mem.eql(u8, field.name, "actions"))
        {
            @compileError("agent.skill unknown source field '" ++ field.name ++ "'");
        }
    }
    const activation_value: Activation = spec.activation;
    const role_value: prompt.Role = spec.role;
    const position_value: RenderPosition = spec.position;
    if (spec.id.len == 0 or spec.description.len == 0 or spec.instructions.len == 0) {
        @compileError("agent skill identity and content must not be empty");
    }
    return struct {
        const agent_skill_seal = CanonicalSkillSeal;
        pub const id = spec.id;
        pub const description = spec.description;
        pub const instructions = spec.instructions;
        pub const role = role_value;
        pub const position = position_value;
        pub const activation = activation_value;
        pub const actions = spec.actions;
    };
}

pub fn validateUnique(comptime skills: anytype) void {
    inline for (skills, 0..) |Skill, index| {
        inline for (skills, 0..) |Earlier, earlier_index| {
            if (earlier_index < index and std.mem.eql(u8, Earlier.id, Skill.id)) {
                @compileError("agent skill semantic id is duplicated");
            }
        }
    }
}
