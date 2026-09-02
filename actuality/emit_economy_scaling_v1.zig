const agent = @import("agent");
const boundary = @import("boundary");
const std = @import("std");

const Goal = boundary.Text(64);
const Result = struct { value: u8 };
const Observation = union(enum) { none: void };
const Failure = enum {
    arithmetic_overflow,
    capacity_exceeded,
    invalid_index,
    invalid_utf8,
    malformed,
    invalid_variant,
    incomplete,
    response_error,
    unsupported,
    multiple_calls,
    refusal,
    unknown_action,
    transport,
    http,
};
const failures = .{
    .arithmetic_overflow = Failure.arithmetic_overflow,
    .capacity_exceeded = Failure.capacity_exceeded,
    .invalid_index = Failure.invalid_index,
    .invalid_utf8 = Failure.invalid_utf8,
    .malformed = Failure.malformed,
    .invalid_variant = Failure.invalid_variant,
    .incomplete = Failure.incomplete,
    .response_error = Failure.response_error,
    .unsupported = Failure.unsupported,
    .multiple_calls = Failure.multiple_calls,
    .refusal = Failure.refusal,
    .unknown_action = Failure.unknown_action,
    .transport = Failure.transport,
    .http = Failure.http,
};
const model = agent.model(.{
    .name = "primary",
    .protocol = agent.protocol.openaiResponsesV2.Profile,
    .model = "economy-model",
    .parameters = .{},
});
const prompt_1k = [_]u8{'p'} ** 1024;
const prompt_8k = [_]u8{'p'} ** (8 * 1024);
const prompt_16k = [_]u8{'p'} ** (16 * 1024);
const skill_4k = [_]u8{'s'} ** (4 * 1024);
const flow_limits = agent.FlowLimits{
    .maximum_functions = 8,
    .maximum_values = 1024,
    .maximum_blocks = 192,
    .maximum_instructions = 2048,
    .maximum_operands = 4096,
    .maximum_parameters = 2048,
    .maximum_requests = 16,
    .maximum_edge_arguments = 4096,
};

fn representation(comptime Action: type) @TypeOf(.{
    .response_bytes = @as(u32, 1024),
    .image_bytes = @as(u32, 256 * 1024),
    .flow_limits = flow_limits,
    .schema_types = .{ Goal, Result, Action, Observation, Failure },
}) {
    return .{
        .response_bytes = 1024,
        .image_bytes = 256 * 1024,
        .flow_limits = flow_limits,
        .schema_types = .{ Goal, Result, Action, Observation, Failure },
    };
}

fn NoToolSystem(comptime DynamicGoal: type) type {
    const Action = union(enum) {};
    return agent.system(.{
        .name = "agent-economy-scaling-no-tools",
        .version = "1.0.0",
        .Goal = DynamicGoal,
        .Action = Action,
        .Observation = Observation,
        .Result = Result,
        .Failure = Failure,
        .models = .{model},
        .prompts = .{agent.prompt.literal(.{
            .role = .system,
            .content = "fixed model message",
        })},
        .skills = .{},
        .actions = .{},
        .strategy = agent.strategy.react(.{}),
        .epistemics = agent.epistemics.systemStateless(.{}),
        .failures = failures,
        .representation = representation(Action),
    });
}

fn OneToolSystem(
    comptime prompt_content: []const u8,
    comptime skill_instructions: ?[]const u8,
) type {
    const Action = union(enum) { done: Result };
    const actions = .{agent.action.final(.done, .{
        .name = "done",
        .description = "Return one bounded value.",
    })};
    const skills = if (skill_instructions) |instructions| .{agent.skill(.{
        .id = "economy-skill",
        .description = "One scaling skill.",
        .instructions = instructions,
        .role = .developer,
        .position = .before_user,
        .activation = .always,
        .actions = .{"done"},
    })} else .{};
    return agent.system(.{
        .name = "agent-economy-scaling-one-tool",
        .version = "1.0.0",
        .Goal = Goal,
        .Action = Action,
        .Observation = Observation,
        .Result = Result,
        .Failure = Failure,
        .models = .{model},
        .prompts = .{agent.prompt.literal(.{
            .role = .system,
            .content = prompt_content,
        })},
        .skills = skills,
        .actions = actions,
        .strategy = agent.strategy.react(.{}),
        .epistemics = agent.epistemics.systemStateless(.{}),
        .failures = failures,
        .representation = representation(Action),
    });
}

fn TwoToolSystem() type {
    const Action = union(enum) { first: Result, done: Result };
    const actions = .{
        agent.action.final(.first, .{
            .name = "first",
            .description = "Return through the first bounded action.",
        }),
        agent.action.final(.done, .{
            .name = "done",
            .description = "Return through the second bounded action.",
        }),
    };
    return agent.system(.{
        .name = "agent-economy-scaling-two-tools",
        .version = "1.0.0",
        .Goal = Goal,
        .Action = Action,
        .Observation = Observation,
        .Result = Result,
        .Failure = Failure,
        .models = .{model},
        .prompts = .{agent.prompt.literal(.{
            .role = .system,
            .content = "p",
        })},
        .skills = .{},
        .actions = actions,
        .strategy = agent.strategy.react(.{}),
        .epistemics = agent.epistemics.systemStateless(.{}),
        .failures = failures,
        .representation = representation(Action),
    });
}

const SixAction = union(enum) {
    one: Result,
    two: Result,
    three: Result,
    four: Result,
    five: Result,
    six: Result,
};
const six_actions = .{
    agent.action.final(.one, .{ .name = "one", .description = "Return through action one." }),
    agent.action.final(.two, .{ .name = "two", .description = "Return through action two." }),
    agent.action.final(.three, .{ .name = "three", .description = "Return through action three." }),
    agent.action.final(.four, .{ .name = "four", .description = "Return through action four." }),
    agent.action.final(.five, .{ .name = "five", .description = "Return through action five." }),
    agent.action.final(.six, .{ .name = "six", .description = "Return through action six." }),
};
const six_source = .{
    .name = "agent-economy-scaling-six-tools",
    .version = "1.0.0",
    .Goal = Goal,
    .Action = SixAction,
    .Observation = Observation,
    .Result = Result,
    .Failure = Failure,
    .models = .{model},
    .prompts = .{agent.prompt.literal(.{ .role = .system, .content = "p" })},
    .skills = .{agent.skill(.{
        .id = "economy-skill",
        .description = "One scaling skill.",
        .instructions = "s",
        .role = .developer,
        .position = .before_user,
        .activation = .always,
        .actions = .{ "one", "two", "three", "four", "five", "six" },
    })},
    .actions = six_actions,
    .strategy = agent.strategy.react(.{}),
    .epistemics = agent.epistemics.systemStateless(.{}),
    .failures = failures,
    .representation = representation(SixAction),
};

fn SixToolSystem() type {
    return agent.system(six_source);
}

const SixToolAblatedBody = agent.economy_tooling.ReactBodyActionDecodeAblation(
    six_source,
);
const SixToolAblatedProgram = boundary.program(
    "agent-economy-scaling-six-tools:action-decode-ablation",
    SixToolAblatedBody,
);

fn writeImage(comptime System: type, output: *std.Io.Writer) !void {
    try output.writeAll(&System.Program.image().bytes);
}

fn writeProgramImage(comptime Program: type, output: *std.Io.Writer) !void {
    try output.writeAll(&Program.image().bytes);
}

pub fn main(init: std.process.Init) !void {
    const args = try init.minimal.args.toSlice(init.arena.allocator());
    if (args.len != 2) return error.InvalidArguments;
    var buffer: [4096]u8 = undefined;
    var stdout = std.Io.File.stdout().writer(init.io, &buffer);
    if (std.mem.eql(u8, args[1], "prompt-1k")) {
        try writeImage(OneToolSystem(&prompt_1k, null), &stdout.interface);
    } else if (std.mem.eql(u8, args[1], "prompt-8k")) {
        try writeImage(OneToolSystem(&prompt_8k, null), &stdout.interface);
    } else if (std.mem.eql(u8, args[1], "prompt-16k")) {
        try writeImage(OneToolSystem(&prompt_16k, null), &stdout.interface);
    } else if (std.mem.eql(u8, args[1], "skill-base")) {
        try writeImage(OneToolSystem("p", null), &stdout.interface);
    } else if (std.mem.eql(u8, args[1], "skill-4k")) {
        try writeImage(OneToolSystem("p", &skill_4k), &stdout.interface);
    } else if (std.mem.eql(u8, args[1], "tool-base")) {
        try writeImage(OneToolSystem("p", null), &stdout.interface);
    } else if (std.mem.eql(u8, args[1], "tool-extra")) {
        try writeImage(TwoToolSystem(), &stdout.interface);
    } else if (std.mem.eql(u8, args[1], "model-fixed-no-tools")) {
        try writeImage(NoToolSystem(boundary.Text(1)), &stdout.interface);
    } else if (std.mem.eql(u8, args[1], "model-dynamic-goal")) {
        try writeImage(NoToolSystem(Goal), &stdout.interface);
    } else if (std.mem.eql(u8, args[1], "six-tools-no-decode")) {
        try writeProgramImage(SixToolAblatedProgram, &stdout.interface);
    } else if (std.mem.eql(u8, args[1], "six-tools-decode")) {
        try writeImage(SixToolSystem(), &stdout.interface);
    } else return error.InvalidArguments;
    try stdout.interface.flush();
}
