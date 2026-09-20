const std = @import("std");
const agent = @import("agent");
const boundary = @import("boundary");
const source = boundary.computation;
const data = boundary.data;
const a = std.testing.allocator;
const Answer = union(enum(u32)) { contribute: struct { value: u64 } = 1 };
const P = agent.model_invocation.Profile(Answer, .{
    .{ .name = "contribute", .description = "Supply the requested contribution." },
}, .{
    .model_id_bytes = 32,
    .temperature_bytes = 8,
    .maximum_messages = 4,
    .message_bytes = 256,
    .maximum_output_items = 4,
    .call_id_bytes = 32,
    .arguments_json_bytes = 128,
    .result_text_bytes = 128,
    .provider_response_bytes = 4096,
});
const Input = struct { request: P.Request, offered: [1]bool };

fn producer(allocator: std.mem.Allocator, direct: bool) ![]u8 {
    var b = source.Builder.init(allocator);
    defer b.deinit();
    const unit = try b.scalar(void);
    const request = try agent.contracts.schema(P.Request, &b);
    const offered = try agent.contracts.schema([1]bool, &b);
    const result = try agent.contracts.schema(P.Interpretation, &b);
    const effect = try P.declare(&b);
    const helper = try b.declare(&.{ request, offered }, result, &.{effect}, &.{});
    const entry = try b.declare(&.{ request, offered }, result, &.{effect}, &.{});
    const call = try b.term(.{ .call = .{ .function = helper, .arguments = &.{
        try b.reference(b.parameter(entry, 0)), try b.reference(b.parameter(entry, 1)),
    } } });
    const answer = try b.variable(result);
    var body = try b.bind(answer, call, try b.pure(try b.reference(answer)));
    if (direct) {
        const response = try b.variable(try agent.contracts.schema(P.Result, &b));
        body = try b.bind(response, try b.term(.{ .perform = .{
            .effect = effect,
            .payload = try b.reference(b.parameter(entry, 0)),
        } }), body);
    }
    try b.define(entry, body);
    var object = try source.component.compile(allocator, b.module(entry, unit), .{
        .borrows = &.{.{ .function = helper }},
        .imports = &.{
            .{ .name = "model", .reference = .{ .kind = .effect, .id = effect } },
            .{ .name = "respond", .reference = .{ .kind = .function, .id = helper } },
        },
        .exports = &.{.{ .name = "contribute", .reference = .{ .kind = .function, .id = entry } }},
    });
    defer object.deinit();
    const bytes = try allocator.alloc(u8, try data.component.encodedLength(object.object));
    errdefer allocator.free(bytes);
    _ = try object.encode(allocator, bytes);
    return bytes;
}

const Application = struct {
    var bytes: []const u8 = &.{};
    var assessment = false;
    var allow_model = true;
    var completion = false;
    var wrong_result = false;
    var mutate_object = false;
    pub fn emit(c: agent.Context) !source.Module {
        const b = c.builder;
        const unit = try b.scalar(void);
        const request = try c.schema(P.Request);
        const offered = try c.schema([1]bool);
        const result = try c.schema(P.Interpretation);
        const helper = try agent.responders.defineModel(P, c, try c.literal(void, {}), false);
        const model = try P.declare(b);
        const bound = if (completion) try completionHelper(c, request, offered, result) else if (wrong_result)
            try wrongHelper(c, request, offered)
        else
            helper;
        const participant = try agent.participant.declare(c, .{
            .instance = "producer",
            .object = bytes,
            .entry = "contribute",
            .parameters = &.{ request, offered },
            .result = result,
            .residual = &.{model},
            .effects = &.{.{ .symbol = "model", .effect = model }},
            .functions = &.{.{ .symbol = "respond", .function = bound }},
        });
        if (mutate_object) @memset(@constCast(bytes), 0xff);
        if (assessment) try c.registry.speculate(participant, if (allow_model) &.{model} else &.{});
        const entry = try b.declare(&.{try c.schema(Input)}, result, &.{model}, &.{});
        const input = try b.reference(b.parameter(entry, 0));
        try b.define(entry, try b.term(.{ .call = .{ .function = participant, .arguments = &.{
            try b.primitive(request, .field, &.{input}, 0),
            try b.primitive(offered, .field, &.{input}, 1),
        } } }));
        return b.module(entry, unit);
    }
};

fn wrongHelper(c: agent.Context, request: source.Id, offered: source.Id) !source.Id {
    const b = c.builder;
    const helper = try b.declare(&.{ request, offered }, try b.scalar(bool), &.{}, &.{});
    try b.define(helper, try b.pure(try b.constant(bool, true)));
    return helper;
}

fn completionHelper(c: agent.Context, request: source.Id, offered: source.Id, result: source.Id) !source.Id {
    const b = c.builder;
    const write = try c.external("fixture/target-write", try b.scalar(void), result, .write);
    const helper = try b.declare(&.{ request, offered }, result, &.{write}, &.{});
    const operation = try b.term(.{ .perform = .{
        .effect = write,
        .payload = try c.literal(void, {}),
    } });
    // A trusted real completion site that would write if invoked. Assessment
    // must reject this binding even when ordinary source admission permits it.
    try c.registry.protectSite(helper, operation, write);
    try b.define(helper, operation);
    return helper;
}
const System = agent.system(.{
    .InitialArgs = Input,
    .Result = P.Interpretation,
    .Failure = void,
    .application = Application,
});

test "compiled participant uses the actual checked model responder through normal compilation" {
    const bytes = try producer(a, false);
    defer a.free(bytes);
    Application.bytes = bytes;
    var compiled = try agent.compile(a, System);
    defer compiled.deinit();
    try std.testing.expectEqual(1, compiled.program.effects.len);
    try std.testing.expectEqualStrings("agent.model.invoke.v3", compiled.program.effects[0].identity);
    const image = try a.alloc(u8, try data.program_image.encodedLength(compiled.program));
    defer a.free(image);
    _ = try compiled.encode(a, image);
    var decoded = try data.program_image.decode(a, image);
    defer decoded.deinit();
}

test "compiled assessment permits its model policy but rejects missing allowance" {
    const bytes = try producer(a, false);
    defer a.free(bytes);
    Application.bytes = bytes;
    Application.assessment = true;
    defer Application.assessment = false;
    var compiled = try agent.compile(a, System);
    defer compiled.deinit();
    Application.allow_model = false;
    defer Application.allow_model = true;
    try std.testing.expectError(error.SpeculativeEffect, agent.compile(a, System));
}

test "compiled participant cannot directly emit a protected model operation" {
    const bytes = try producer(a, true);
    defer a.free(bytes);
    Application.bytes = bytes;
    try std.testing.expectError(error.ProtectedEffectBypass, agent.compile(a, System));
}

test "compiled assessment cannot acquire target writing through a helper substitution" {
    const bytes = try producer(a, false);
    defer a.free(bytes);
    Application.bytes = bytes;
    Application.assessment = true;
    defer Application.assessment = false;
    Application.completion = true;
    defer Application.completion = false;
    try std.testing.expectError(error.SpeculativeEffect, agent.compile(a, System));
}

test "participant binding checks the actual helper result at the source-free linker" {
    const bytes = try producer(a, false);
    defer a.free(bytes);
    Application.bytes = bytes;
    Application.wrong_result = true;
    defer Application.wrong_result = false;
    try std.testing.expectError(error.IncompatibleInterface, agent.compile(a, System));
}

test "participant admission owns the exact component bytes before caller mutation" {
    const bytes = try producer(a, false);
    defer a.free(bytes);
    Application.bytes = bytes;
    Application.mutate_object = true;
    defer Application.mutate_object = false;
    var compiled = try agent.compile(a, System);
    defer compiled.deinit();
    try std.testing.expectEqual(@as(u8, 0xff), bytes[0]);
    try std.testing.expectEqualStrings("agent.model.invoke.v3", compiled.program.effects[0].identity);
}

fn output(init: std.process.Init, bytes: []const u8) !void {
    var buffer: [4096]u8 = undefined;
    var writer = std.Io.File.stdout().writer(init.io, &buffer);
    try writer.interface.writeAll(bytes);
    try writer.interface.flush();
}

const Model = agent.model(.{
    .name = "participant-fixture",
    .model = "synthetic-only",
    .protocol = struct {
        pub const semantic_identity = agent.model_invocation.protocol_identity;
    },
});

fn inputBytes(allocator: std.mem.Allocator) ![]u8 {
    const request = try P.templateValue(Model, .{ .items = &.{.{
        .role = .user,
        .content = .{ .bytes = "Supply the requested number." },
    }} }, .{ .minimum_calls = 1, .maximum_calls = 1, .parallel_calls = false });
    return agent.contracts.encodeOwned(Input, allocator, .{ .request = request, .offered = .{true} });
}
fn replyBytes(allocator: std.mem.Allocator) ![]u8 {
    return agent.contracts.encodeOwned(P.Result, allocator, .{ .output = .{
        .items = .{ .items = &.{.{ .function_call = .{
            .call_id = .{ .bytes = "participant-fixture" },
            .name = .{ .bytes = "contribute" },
            .arguments_json = .{ .bytes = "{\"value\":42}" },
            .tool_ordinal_claim = 0,
            .decoded_action = .{ .decoded = .{ .contribute = .{ .value = 42 } } },
        } }} },
        .normalized_output_digest = [_]u8{0} ** 32,
    } });
}

/// Object emission and linking run as separate processes. The linker receives
/// only object bytes; it never calls producer or rebuilds participant source.
pub fn main(init: std.process.Init) !void {
    var args = init.minimal.args.iterate();
    _ = args.next();
    const mode = args.next() orelse return error.ExpectedMode;
    if (std.mem.eql(u8, mode, "link")) {
        const path = args.next() orelse return error.ExpectedObject;
        if (args.next() != null) return error.UnexpectedArgument;
        const bytes = try std.Io.Dir.cwd().readFileAlloc(init.io, path, init.gpa, .limited(64 << 20));
        defer init.gpa.free(bytes);
        Application.bytes = bytes;
        var compiled = try agent.compile(init.gpa, System);
        defer compiled.deinit();
        const image = try init.gpa.alloc(u8, try data.program_image.encodedLength(compiled.program));
        defer init.gpa.free(image);
        _ = try compiled.encode(init.gpa, image);
        return output(init, image);
    }
    if (args.next() != null) return error.UnexpectedArgument;
    const bytes = if (std.mem.eql(u8, mode, "object"))
        try producer(init.gpa, false)
    else if (std.mem.eql(u8, mode, "input"))
        try inputBytes(init.gpa)
    else if (std.mem.eql(u8, mode, "reply"))
        try replyBytes(init.gpa)
    else if (std.mem.eql(u8, mode, "expected"))
        try agent.contracts.encodeOwned(P.Interpretation, init.gpa, .{ .accepted = .{ .contribute = .{ .value = 42 } } })
    else
        return error.UnknownMode;
    defer init.gpa.free(bytes);
    return output(init, bytes);
}
