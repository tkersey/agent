const agent = @import("agent");
const json = agent.json;
const boundary = @import("boundary");
const std = @import("std");

const Message = boundary.Text(32);
const SetPayload = struct { value: u8 };
const FinishPayload = struct { message: Message };
const Action = union(enum) {
    set: SetPayload,
    finish: FinishPayload,
};
const Observation = union(enum) { set: u8 };
const SetSite = boundary.effect.site(1, "slice.set.v1", SetPayload, u8);

const actions = .{
    agent.action.effect(.set, .set, SetSite, .{
        .name = "set_value",
        .description = "Set one bounded value.",
    }),
    agent.action.final(.finish, .{
        .name = "finish",
        .description = "Return one bounded message.",
    }),
};

const Parts = json.RequestParts(Action, actions, "slice-model-v1");

test "staged request parts derive strict tools from Action descriptors" {
    try std.testing.expectEqualStrings(
        "{\"model\":\"slice-model-v1\",\"input\":[{\"role\":\"user\",\"content\":\"",
        try Parts.prefix.slice(),
    );
    const suffix = try Parts.suffix.slice();
    inline for (.{
        "\"type\":\"function\",\"name\":\"set_value\"",
        "\"properties\":{\"value\":{\"type\":\"integer\",\"minimum\":0,\"maximum\":255}}",
        "\"name\":\"finish\"",
        "\"properties\":{\"message\":{\"type\":\"string\"}}",
        "\"additionalProperties\":false",
        "\"strict\":true",
        "\"tool_choice\":\"required\"",
        "\"parallel_tool_calls\":false",
        "\"store\":false",
        "\"stream\":false",
        "\"background\":false",
        "\"truncation\":\"disabled\"",
    }) |expected| {
        try std.testing.expect(std.mem.indexOf(u8, suffix, expected) != null);
    }
}

test "reachable tool metadata changes emitted request bytes" {
    const changed_actions = .{
        agent.action.effect(.set, .set, SetSite, .{
            .name = "set_value",
            .description = "Set one different bounded value.",
        }),
        actions[1],
    };
    const Changed = json.RequestParts(Action, changed_actions, "slice-model-v1");
    try std.testing.expect(!std.mem.eql(
        u8,
        try Parts.suffix.slice(),
        try Changed.suffix.slice(),
    ));
}

comptime {
    _ = Observation;
}
