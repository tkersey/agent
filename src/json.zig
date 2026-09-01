const std = @import("std");
const boundary = @import("boundary");

const CountingWriter = struct {
    length: usize = 0,

    fn byte(self: *@This(), _: u8) void {
        self.length += 1;
    }

    fn raw(self: *@This(), value: []const u8) void {
        self.length += value.len;
    }
};

fn FixedWriter(comptime capacity: usize) type {
    return struct {
        bytes: [capacity]u8 = undefined,
        cursor: usize = 0,

        fn byte(self: *@This(), value: u8) void {
            if (self.cursor >= capacity) @compileError("agent JSON writer overflow");
            self.bytes[self.cursor] = value;
            self.cursor += 1;
        }

        fn raw(self: *@This(), value: []const u8) void {
            if (value.len > capacity - self.cursor) {
                @compileError("agent JSON writer overflow");
            }
            @memcpy(self.bytes[self.cursor..][0..value.len], value);
            self.cursor += value.len;
        }

        fn finish(self: @This()) [capacity]u8 {
            if (self.cursor != capacity) @compileError("agent JSON writer underflow");
            return self.bytes;
        }
    };
}

fn writeString(writer: anytype, comptime value: []const u8) void {
    if (!std.unicode.utf8ValidateSlice(value)) {
        @compileError("agent JSON source string must be valid UTF-8");
    }
    const hex = "0123456789abcdef";
    writer.byte('"');
    inline for (value) |byte| switch (byte) {
        '"' => writer.raw("\\\""),
        '\\' => writer.raw("\\\\"),
        0x08 => writer.raw("\\b"),
        0x0c => writer.raw("\\f"),
        '\n' => writer.raw("\\n"),
        '\r' => writer.raw("\\r"),
        '\t' => writer.raw("\\t"),
        0x00...0x07, 0x0b, 0x0e...0x1f => {
            writer.raw("\\u00");
            writer.byte(hex[byte >> 4]);
            writer.byte(hex[byte & 0x0f]);
        },
        else => writer.byte(byte),
    };
    writer.byte('"');
}

fn writeUnsigned(writer: anytype, comptime value: anytype) void {
    writer.raw(std.fmt.comptimePrint("{d}", .{value}));
}

fn writeSchema(comptime T: type, writer: anytype) void {
    if (comptime boundary.schema.isTextType(T)) {
        writer.raw("{\"type\":\"string\"}");
        return;
    }
    switch (@typeInfo(T)) {
        .void => writer.raw("{\"type\":\"object\",\"properties\":{},\"additionalProperties\":false}"),
        .bool => writer.raw("{\"type\":\"boolean\"}"),
        .int => {
            writer.raw("{\"type\":\"integer\",\"minimum\":");
            writer.raw(std.fmt.comptimePrint("{d}", .{std.math.minInt(T)}));
            writer.raw(",\"maximum\":");
            writer.raw(std.fmt.comptimePrint("{d}", .{std.math.maxInt(T)}));
            writer.byte('}');
        },
        .@"enum" => |info| {
            writer.raw("{\"type\":\"string\",\"enum\":[");
            inline for (info.fields, 0..) |field, index| {
                if (index != 0) writer.byte(',');
                writeString(writer, field.name);
            }
            writer.raw("]}");
        },
        .@"struct" => |info| {
            if (info.is_tuple) {
                @compileError("agent JSON tuple schemas are not implemented yet");
            }
            writer.raw("{\"type\":\"object\",\"properties\":{");
            inline for (info.fields, 0..) |field, index| {
                if (index != 0) writer.byte(',');
                writeString(writer, field.name);
                writer.byte(':');
                writeSchema(field.type, writer);
            }
            writer.raw("},\"required\":[");
            inline for (info.fields, 0..) |field, index| {
                if (index != 0) writer.byte(',');
                writeString(writer, field.name);
            }
            writer.raw("],\"additionalProperties\":false}");
        },
        else => @compileError("agent JSON schema does not support " ++ @typeName(T)),
    }
}

fn actionPayload(
    comptime Action: type,
    comptime action_name: []const u8,
) type {
    const info = switch (@typeInfo(Action)) {
        .@"union" => |value| value,
        else => @compileError("agent JSON Action must be a tagged union"),
    };
    inline for (info.fields) |field| {
        if (std.mem.eql(u8, field.name, action_name)) return field.type;
    }
    @compileError("agent JSON descriptor names an unknown Action variant");
}

fn writeTools(
    comptime Action: type,
    comptime actions: anytype,
    writer: anytype,
) void {
    inline for (actions, 0..) |Descriptor, index| {
        if (index != 0) writer.byte(',');
        writer.raw("{\"type\":\"function\",\"name\":");
        writeString(writer, Descriptor.name);
        writer.raw(",\"description\":");
        writeString(writer, Descriptor.description);
        writer.raw(",\"parameters\":");
        writeSchema(actionPayload(Action, Descriptor.action_name), writer);
        writer.raw(",\"strict\":true}");
    }
}

fn writePrefix(comptime model: []const u8, writer: anytype) void {
    writer.raw("{\"model\":");
    writeString(writer, model);
    writer.raw(",\"input\":[{\"role\":\"user\",\"content\":\"");
}

fn roleName(comptime role: anytype) []const u8 {
    return switch (role) {
        .system => "system",
        .developer => "developer",
        .user => "user",
    };
}

fn writeStaticMessage(
    comptime role: anytype,
    comptime content: []const u8,
    writer: anytype,
) void {
    writeMessage(role, content, writer);
    writer.byte(',');
}

fn writeMessage(
    comptime role: anytype,
    comptime content: []const u8,
    writer: anytype,
) void {
    writer.raw("{\"role\":");
    writeString(writer, roleName(role));
    writer.raw(",\"content\":");
    writeString(writer, content);
    writer.byte('}');
}

fn writeSystemPrefix(
    comptime model: []const u8,
    comptime prompts: anytype,
    comptime skills: anytype,
    writer: anytype,
) void {
    writer.raw("{\"model\":");
    writeString(writer, model);
    writer.raw(",\"input\":[");
    inline for (prompts) |Prompt| {
        writeStaticMessage(Prompt.prompt_role, Prompt.content, writer);
    }
    inline for (skills) |Skill| {
        if (Skill.activation == .always and Skill.position == .before_user) {
            writeStaticMessage(Skill.role, Skill.instructions, writer);
        }
    }
    writer.raw("{\"role\":\"user\",\"content\":\"");
}

fn writeSuffix(
    comptime Action: type,
    comptime actions: anytype,
    writer: anytype,
) void {
    writer.raw("\"}],\"tools\":[");
    writeTools(Action, actions, writer);
    writer.raw(
        "],\"tool_choice\":\"required\",\"parallel_tool_calls\":false," ++
            "\"store\":false,\"stream\":false,\"background\":false," ++
            "\"truncation\":\"disabled\"}",
    );
}

pub fn RequestParts(
    comptime Action: type,
    comptime actions: anytype,
    comptime model: []const u8,
) type {
    const prefix_length = comptime blk: {
        var writer = CountingWriter{};
        writePrefix(model, &writer);
        break :blk writer.length;
    };
    const suffix_length = comptime blk: {
        var writer = CountingWriter{};
        writeSuffix(Action, actions, &writer);
        break :blk writer.length;
    };
    const prefix_bytes = comptime blk: {
        var writer = FixedWriter(prefix_length){};
        writePrefix(model, &writer);
        break :blk writer.finish();
    };
    const suffix_bytes = comptime blk: {
        var writer = FixedWriter(suffix_length){};
        writeSuffix(Action, actions, &writer);
        break :blk writer.finish();
    };

    return struct {
        pub const Prefix = boundary.Bytes(prefix_length);
        pub const Suffix = boundary.Bytes(suffix_length);
        pub const prefix = Prefix.fromSlice(&prefix_bytes) catch unreachable;
        pub const suffix = Suffix.fromSlice(&suffix_bytes) catch unreachable;
    };
}

pub fn SystemRequestParts(
    comptime Action: type,
    comptime actions: anytype,
    comptime model: []const u8,
    comptime prompts: anytype,
    comptime skills: anytype,
) type {
    const prefix_length = comptime blk: {
        var writer = CountingWriter{};
        writeSystemPrefix(model, prompts, skills, &writer);
        break :blk writer.length;
    };
    const suffix_length = comptime blk: {
        var writer = CountingWriter{};
        writeSuffix(Action, actions, &writer);
        break :blk writer.length;
    };
    const prefix_bytes = comptime blk: {
        var writer = FixedWriter(prefix_length){};
        writeSystemPrefix(model, prompts, skills, &writer);
        break :blk writer.finish();
    };
    const suffix_bytes = comptime blk: {
        var writer = FixedWriter(suffix_length){};
        writeSuffix(Action, actions, &writer);
        break :blk writer.finish();
    };
    return struct {
        pub const Prefix = boundary.Bytes(prefix_length);
        pub const Suffix = boundary.Bytes(suffix_length);
        pub const prefix = Prefix.fromSlice(&prefix_bytes) catch unreachable;
        pub const suffix = Suffix.fromSlice(&suffix_bytes) catch unreachable;
    };
}

fn writeSystemOpen(
    comptime model: []const u8,
    comptime parameters: anytype,
    comptime prompts: anytype,
    writer: anytype,
) void {
    writer.raw("{\"model\":");
    writeString(writer, model);
    if (@TypeOf(parameters) != void) {
        if (@hasField(@TypeOf(parameters), "max_output_tokens")) {
            writer.raw(",\"max_output_tokens\":");
            writeUnsigned(writer, parameters.max_output_tokens);
        }
        if (@hasField(@TypeOf(parameters), "temperature")) {
            const temperature: []const u8 = parameters.temperature;
            writer.raw(",\"temperature\":");
            writer.raw(temperature);
        }
    }
    writer.raw(",\"input\":[");
    inline for (prompts) |Prompt| {
        writeStaticMessage(Prompt.prompt_role, Prompt.content, writer);
    }
}

fn writeSkillBefore(comptime Skill: type, writer: anytype) void {
    if (Skill.position == .before_user) {
        writeStaticMessage(Skill.role, Skill.instructions, writer);
    }
}

fn writeSkillAfter(comptime Skill: type, writer: anytype) void {
    if (Skill.position == .after_user) {
        writer.byte(',');
        writeMessage(Skill.role, Skill.instructions, writer);
    }
}

fn writeTool(
    comptime Action: type,
    comptime Descriptor: type,
    writer: anytype,
) void {
    writer.raw("{\"type\":\"function\",\"name\":");
    writeString(writer, Descriptor.name);
    writer.raw(",\"description\":");
    writeString(writer, Descriptor.description);
    writer.raw(",\"parameters\":");
    writeSchema(actionPayload(Action, Descriptor.action_name), writer);
    writer.raw(",\"strict\":true}");
}

fn Fragment(comptime length: usize, comptime bytes: [length]u8) type {
    return struct {
        pub const value = bytes;
    };
}

pub fn SystemOpen(
    comptime model: []const u8,
    comptime parameters: anytype,
    comptime prompts: anytype,
) type {
    const length = comptime blk: {
        var writer = CountingWriter{};
        writeSystemOpen(model, parameters, prompts, &writer);
        break :blk writer.length;
    };
    const bytes = comptime blk: {
        var writer = FixedWriter(length){};
        writeSystemOpen(model, parameters, prompts, &writer);
        break :blk writer.finish();
    };
    return Fragment(length, bytes);
}

pub fn SkillBefore(comptime Skill: type) type {
    const length = comptime blk: {
        var writer = CountingWriter{};
        writeSkillBefore(Skill, &writer);
        break :blk writer.length;
    };
    const bytes = comptime blk: {
        var writer = FixedWriter(length){};
        writeSkillBefore(Skill, &writer);
        break :blk writer.finish();
    };
    return Fragment(length, bytes);
}

pub fn SkillAfter(comptime Skill: type) type {
    const length = comptime blk: {
        var writer = CountingWriter{};
        writeSkillAfter(Skill, &writer);
        break :blk writer.length;
    };
    const bytes = comptime blk: {
        var writer = FixedWriter(length){};
        writeSkillAfter(Skill, &writer);
        break :blk writer.finish();
    };
    return Fragment(length, bytes);
}

pub fn ToolFragment(comptime Action: type, comptime Descriptor: type) type {
    const length = comptime blk: {
        var writer = CountingWriter{};
        writeTool(Action, Descriptor, &writer);
        break :blk writer.length;
    };
    const bytes = comptime blk: {
        var writer = FixedWriter(length){};
        writeTool(Action, Descriptor, &writer);
        break :blk writer.finish();
    };
    return Fragment(length, bytes);
}

pub fn ToolCommaFragment(comptime Action: type, comptime Descriptor: type) type {
    const Tool = ToolFragment(Action, Descriptor);
    const bytes = comptime blk: {
        var writer = FixedWriter(Tool.value.len + 1){};
        writer.byte(',');
        writer.raw(&Tool.value);
        break :blk writer.finish();
    };
    return Fragment(Tool.value.len + 1, bytes);
}

pub const user_open = "{\"role\":\"user\",\"content\":\"";
pub const user_close = "\"}";
pub const tools_open = "],\"tools\":[";
pub const request_end =
    "],\"tool_choice\":\"required\",\"parallel_tool_calls\":false," ++
    "\"store\":false,\"stream\":false,\"background\":false," ++
    "\"truncation\":\"disabled\"}";
