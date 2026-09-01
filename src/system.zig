const std = @import("std");
const boundary = @import("boundary");
const model = @import("model.zig");
const skill = @import("skill.zig");

const admitted_fields = .{
    "name",
    "version",
    "Goal",
    "Action",
    "Observation",
    "Result",
    "Failure",
    "models",
    "prompts",
    "skills",
    "actions",
    "strategy",
    "epistemics",
    "failures",
    "representation",
};

fn fieldAdmitted(comptime name: []const u8) bool {
    inline for (admitted_fields) |admitted| {
        if (std.mem.eql(u8, name, admitted)) return true;
    }
    return false;
}

fn taggedUnion(comptime T: type, comptime label: []const u8) std.builtin.Type.Union {
    return switch (@typeInfo(T)) {
        .@"union" => |info| blk: {
            if (info.tag_type == null or !@typeInfo(info.tag_type.?).@"enum".is_exhaustive) {
                @compileError("agent system " ++ label ++ " must be an exhaustive tagged union");
            }
            break :blk info;
        },
        else => @compileError("agent system " ++ label ++ " must be an exhaustive tagged union"),
    };
}

fn unionFieldType(comptime T: type, comptime name: []const u8, comptime label: []const u8) type {
    inline for (taggedUnion(T, label).fields) |field| {
        if (std.mem.eql(u8, field.name, name)) return field.type;
    }
    @compileError("agent system " ++ label ++ " has no variant named '" ++ name ++ "'");
}

fn actionNameExists(comptime actions: anytype, comptime name: []const u8) bool {
    inline for (actions) |Descriptor| {
        if (std.mem.eql(u8, Descriptor.name, name)) return true;
    }
    return false;
}

fn validate(comptime spec: anytype) void {
    inline for (std.meta.fields(@TypeOf(spec))) |field| {
        if (!fieldAdmitted(field.name)) {
            @compileError("agent.system unknown source field '" ++ field.name ++ "'");
        }
    }
    inline for (admitted_fields) |field| {
        if (!@hasField(@TypeOf(spec), field)) {
            @compileError("agent.system missing source field '" ++ field ++ "'");
        }
    }
    if (spec.name.len == 0 or spec.version.len == 0) {
        @compileError("agent system name and version must not be empty");
    }
    boundary.schema.assertPortable(spec.Goal);
    boundary.schema.assertPortable(spec.Action);
    boundary.schema.assertPortable(spec.Observation);
    boundary.schema.assertPortable(spec.Result);
    boundary.schema.assertPortable(spec.Failure);
    const action_info = taggedUnion(spec.Action, "Action");
    _ = taggedUnion(spec.Observation, "Observation");
    if (spec.actions.len != action_info.fields.len) {
        @compileError("agent system requires exactly one descriptor per Action variant");
    }
    if (spec.actions.len > 32 or spec.skills.len > 32) {
        @compileError("agent system supports at most 32 actions and 32 skills per closed system");
    }
    inline for (spec.actions, 0..) |Descriptor, index| {
        if (!std.mem.eql(u8, Descriptor.action_name, action_info.fields[index].name)) {
            @compileError("agent system descriptors must follow Action declaration order");
        }
        if (Descriptor.name.len == 0 or Descriptor.description.len == 0) {
            @compileError("agent system action names and descriptions must not be empty");
        }
        inline for (spec.actions, 0..) |Earlier, earlier_index| {
            if (earlier_index < index and std.mem.eql(u8, Earlier.name, Descriptor.name)) {
                @compileError("agent system model-visible action name is duplicated");
            }
        }
        const Payload = action_info.fields[index].type;
        switch (Descriptor.kind) {
            .effect => {
                if (Descriptor.Site.site_id == 0) {
                    @compileError("agent system external action site 0 is reserved for the model protocol");
                }
                if (Payload != Descriptor.Site.Payload) {
                    @compileError("agent system Action payload differs from its effect payload");
                }
                if (unionFieldType(
                    spec.Observation,
                    Descriptor.observation_name,
                    "Observation",
                ) != Descriptor.Site.Resume) {
                    @compileError("agent system Observation payload differs from effect Resume");
                }
            },
            .local => {
                if (!@hasDecl(Descriptor.Local, "Payload") or
                    !@hasDecl(Descriptor.Local, "Observation") or
                    !@hasDecl(Descriptor.Local, "emit"))
                {
                    @compileError("agent system local action implementation is incomplete");
                }
                if (Payload != Descriptor.Local.Payload) {
                    @compileError("agent system local Action payload differs from its implementation Payload");
                }
                const ObservationPayload = unionFieldType(
                    spec.Observation,
                    Descriptor.observation_name,
                    "Observation",
                );
                if (ObservationPayload != Descriptor.Local.Observation) {
                    @compileError("agent system local Observation payload differs from its implementation Observation");
                }
                boundary.schema.assertPortable(Descriptor.Local.Payload);
                boundary.schema.assertPortable(Descriptor.Local.Observation);
            },
            .final => if (Payload != spec.Result) {
                @compileError("agent system final Action payload differs from Result");
            },
            .fail => if (Payload != spec.Failure) {
                @compileError("agent system failure Action payload differs from Failure");
            },
        }
    }
    inline for (spec.skills) |Skill| {
        inline for (Skill.actions) |name| {
            if (!actionNameExists(spec.actions, name)) {
                @compileError("agent skill references an unknown model-visible action");
            }
        }
    }
    model.validateUnique(spec.models);
    skill.validateUnique(spec.skills);
    const Strategy = spec.strategy;
    if (!@hasDecl(Strategy, "system_semantic_identity") or
        !@hasDecl(Strategy, "ProgramBody"))
    {
        @compileError("agent system strategy must be one staged Agent 3 strategy");
    }
}

pub fn system(comptime spec: anytype) type {
    @setEvalBranchQuota(500_000_000);
    comptime validate(spec);
    const Strategy = spec.strategy;
    const Body = Strategy.ProgramBody(spec);
    if (Body.InitialArgs != spec.Goal or Body.Result != spec.Result or
        Body.Failure != spec.Failure)
    {
        @compileError("agent system strategy Body disagrees with Goal, Result, or Failure");
    }
    const ProgramType = boundary.program(
        std.fmt.comptimePrint("{s}:{s}", .{ spec.name, Strategy.system_semantic_identity }),
        Body,
    );
    return struct {
        pub const Source = spec;
        pub const Goal = spec.Goal;
        pub const Action = spec.Action;
        pub const Observation = spec.Observation;
        pub const Result = spec.Result;
        pub const Failure = spec.Failure;
        pub const InitialArgs = Goal;
        pub const Program = ProgramType;
    };
}
