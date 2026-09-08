const std = @import("std");
const boundary = @import("boundary");
const agent = @import("agent");
const catalogs = agent.catalogs;
const allocator = std.testing.allocator;

const Writer = agent.model(.{
    .name = "writer",
    .protocol = struct {
        pub const semantic_identity = "agent.model.protocol.openai-responses-v2";
    },
    .model = "fixture-writer",
    .parameters = .{ .max_output_tokens = @as(u32, 1024), .temperature = "0.25" },
});
const Instructions = agent.prompt.literal(.{ .role = .developer, .content = "Preserve meaning." });
const Revision = agent.skill(.{
    .id = "revision",
    .description = "Review a document",
    .instructions = "Read before proposing.",
    .role = .developer,
    .position = .before_user,
    .activation = .explicit,
    .actions = .{"document.read"},
});

const Read = struct {
    pub fn declare(c: agent.Context) !agent.tools.Descriptor {
        const text = try c.schema(agent.contracts.Utf8);
        return .{
            .identity = "document.read",
            .payload = text,
            .result = text,
            .role = .read,
            .implementation = .{ .external = try c.external("document.read", text, text, .read) },
            .model_offered = true,
            .name = "read",
            .description = "Read the current document",
        };
    }
};
const Message = struct {
    pub fn declare(c: agent.Context) !agent.interaction.Definition {
        const unit = try c.schema(void);
        return agent.interaction.define(c.builder, .{
            .name = "message",
            .channel = unit,
            .purpose = unit,
            .presentation = unit,
            .outgoing = try c.schema(agent.contracts.Utf8),
            .input = unit,
        });
    }
};

const Configured = struct {
    pub fn emit(c: agent.Context) !boundary.computation.Module {
        const model = try c.catalogs.model("writer");
        const prompt = try c.catalogs.prompt(0);
        const skill = try c.catalogs.skill("revision");
        const read = try c.catalogs.tool("document.read");
        const message = try c.catalogs.interaction("message");
        try std.testing.expectEqual(read.implementation.external, (try c.catalogs.tool("read")).implementation.external);
        try std.testing.expectEqual(@as(usize, 1), c.catalogs.skills.len);
        const Result = struct { model: catalogs.ModelValue, prompt: catalogs.PromptValue };
        const result = try c.schema(Result);
        const unit = try c.schema(void);
        const entry = try c.builder.declare(&.{unit}, result, &.{}, &.{});
        try c.builder.define(entry, try c.builder.pure(try c.builder.primitive(
            result,
            .product,
            &.{ model.value, prompt.value },
            0,
        )));
        // These IDs come from installed schemas/data, not native runtime state.
        try std.testing.expect(skill.tools < c.builder.values.items.len);
        try std.testing.expect(message.effect < c.builder.effects.items.len);
        return c.builder.module(entry, unit);
    }
};

test "supplied catalogs install before application and become ordinary program constants" {
    const Result = struct { model: catalogs.ModelValue, prompt: catalogs.PromptValue };
    const System = agent.system(.{
        .InitialArgs = void,
        .Result = Result,
        .Failure = void,
        .models = .{Writer},
        .prompts = .{Instructions},
        .skills = .{Revision},
        .tools = .{Read},
        .interactions = .{Message},
        .application = Configured,
    });
    var compiled = try agent.compile(allocator, System);
    defer compiled.deinit();
    const expected = try agent.contracts.encodeOwned(catalogs.ModelValue, allocator, .{
        .protocol = .{ .bytes = Writer.protocol.semantic_identity },
        .model = .{ .bytes = "fixture-writer" },
        .parameters = .{
            .max_output_tokens = 1024,
            .temperature = .{ .bytes = "0.25" },
            .reasoning = null,
        },
    });
    defer allocator.free(expected);
    var found = false;
    for (compiled.program.constants) |value| found = found or std.mem.eql(u8, value.bytes, expected);
    try std.testing.expect(found);
    try std.testing.expect(compiled.program.blocks.len != 0);
}

const Empty = struct {
    pub fn emit(c: agent.Context) !boundary.computation.Module {
        const unit = try c.schema(void);
        const entry = try c.builder.declare(&.{unit}, unit, &.{}, &.{});
        try c.builder.define(entry, try c.builder.pure(try c.literal(void, {})));
        return c.builder.module(entry, unit);
    }
};

test "omitted and explicitly empty catalogs preserve ordinary emitter compatibility" {
    const System = agent.system(.{
        .InitialArgs = void,
        .Result = void,
        .Failure = void,
        .models = .{},
        .prompts = .{},
        .skills = .{},
        .tools = .{},
        .interactions = .{},
        .application = Empty,
    });
    var compiled = try agent.compile(allocator, System);
    defer compiled.deinit();
}

test "unknown source fields and unsupported catalog list forms reject at the shared gate" {
    try std.testing.expectEqual(catalogs.SourceIssue.UnknownSystemField, comptime catalogs.sourceIssue(.{ .callbacks = .{} }).?);
    try std.testing.expectEqual(catalogs.SourceIssue.InvalidCatalogList, comptime catalogs.sourceIssue(.{ .models = 5 }).?);
    try std.testing.expectEqual(catalogs.SourceIssue.UnsupportedModelDescriptor, comptime catalogs.sourceIssue(.{ .models = .{struct {}} }).?);
    try std.testing.expectEqual(catalogs.SourceIssue.UnsupportedPromptDescriptor, comptime catalogs.sourceIssue(.{ .prompts = .{struct {}} }).?);
    try std.testing.expectEqual(catalogs.SourceIssue.UnsupportedSkillDescriptor, comptime catalogs.sourceIssue(.{ .skills = .{struct {}} }).?);
}

test "native callback fields and pointer declarations cannot become runtime tools" {
    const Callback = struct { callback: *const fn () void };
    const Pointer = struct {
        pub const declare: *const fn () void = undefined;
    };
    try std.testing.expectEqual(catalogs.SourceIssue.RuntimeCallbackDescriptor, comptime catalogs.sourceIssue(.{ .tools = .{Callback} }).?);
    try std.testing.expectEqual(catalogs.SourceIssue.RuntimeCallbackDescriptor, comptime catalogs.sourceIssue(.{ .interactions = .{Pointer} }).?);
    try std.testing.expectEqual(catalogs.SourceIssue.UnsupportedDeclarationType, comptime catalogs.sourceIssue(.{ .tools = .{.{ .runtime = 4 }} }).?);
}

test "duplicate model and skill identities reject at source admission" {
    try std.testing.expectEqual(catalogs.SourceIssue.DuplicateModelName, comptime catalogs.sourceIssue(.{ .models = .{ Writer, Writer } }).?);
    try std.testing.expectEqual(catalogs.SourceIssue.DuplicateSkillName, comptime catalogs.sourceIssue(.{ .skills = .{ Revision, Revision } }).?);
}

test "skill tool references are names rather than callback or numeric selectors" {
    const BadSkill = agent.skill(.{
        .id = "bad",
        .description = "Bad reference",
        .instructions = "Do something",
        .role = .developer,
        .position = .before_user,
        .activation = .explicit,
        .actions = .{@as(u32, 7)},
    });
    try std.testing.expectEqual(catalogs.SourceIssue.InvalidSkillToolReference, comptime catalogs.sourceIssue(.{ .skills = .{BadSkill} }).?);
}

test "unsupported model protocols and invalid declared text reject before emission" {
    const Unsupported = agent.model(.{
        .name = "other",
        .protocol = struct {
            pub const semantic_identity = "different";
        },
        .model = "not-the-declared-provider",
    });
    const InvalidText = agent.prompt.literal(.{ .role = .system, .content = "\xff" });
    try std.testing.expectEqual(catalogs.SourceIssue.UnsupportedModelProtocol, comptime catalogs.sourceIssue(.{ .models = .{Unsupported} }).?);
    try std.testing.expectEqual(catalogs.SourceIssue.InvalidDescriptorText, comptime catalogs.sourceIssue(.{ .prompts = .{InvalidText} }).?);
}

test "dangling skill references reject even when application never looks up that skill" {
    const System = agent.system(.{
        .InitialArgs = void,
        .Result = void,
        .Failure = void,
        .skills = .{Revision},
        .application = Empty,
    });
    try std.testing.expectError(error.UnknownSkillTool, agent.compile(allocator, System));
}

test "duplicate installed tool and interaction identities reject" {
    const Tools = agent.system(.{
        .InitialArgs = void,
        .Result = void,
        .Failure = void,
        .tools = .{ Read, Read },
        .application = Empty,
    });
    try std.testing.expectError(error.DuplicateToolDeclaration, agent.compile(allocator, Tools));
    const Interactions = agent.system(.{
        .InitialArgs = void,
        .Result = void,
        .Failure = void,
        .interactions = .{ Message, Message },
        .application = Empty,
    });
    try std.testing.expectError(error.DuplicateInteractionName, agent.compile(allocator, Interactions));
}

test "bad initial result and variable bindings reject without indexing invalid source" {
    const Bad = struct {
        pub fn emit(c: agent.Context) !boundary.computation.Module {
            const unit = try c.schema(void);
            const entry = try c.builder.declare(&.{unit}, unit, &.{}, &.{});
            c.builder.functions.items[@intCast(entry)].parameters = &.{std.math.maxInt(u64)};
            try c.builder.define(entry, try c.builder.pure(try c.literal(void, {})));
            return c.builder.module(entry, unit);
        }
    };
    const System = agent.system(.{
        .InitialArgs = void,
        .Result = void,
        .Failure = void,
        .application = Bad,
    });
    try std.testing.expectError(error.TypeMismatch, agent.compile(allocator, System));
}

test "declared result type cannot be silently ignored" {
    const System = agent.system(.{
        .InitialArgs = void,
        .Result = u32,
        .Failure = void,
        .application = Empty,
    });
    try std.testing.expectError(error.TypeMismatch, agent.compile(allocator, System));
}
