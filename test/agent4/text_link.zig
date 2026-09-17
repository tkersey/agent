//! Read BMO1 bytes and compile only the selected caller. No component emission.
const std = @import("std");
const agent = @import("agent");
const boundary = @import("boundary");
const source = boundary.source;
const data = boundary.data;
const text = agent.tools.textInspection;
pub const Task = struct { subject: text.Subject, task: u64 };
pub const Report = struct { task: u64, result: text.Result };
const declaration = .{ .name = text.name, .description = text.description };
const Empty = struct {};
const Action = union(enum) { inspect_text: Empty };
const Profile = agent.model_invocation.Profile(Action, .{declaration}, .{
    .model_id_bytes = 32,
    .temperature_bytes = 8,
    .maximum_messages = 1,
    .message_bytes = 128,
    .maximum_output_items = 1,
    .call_id_bytes = 32,
    .arguments_json_bytes = 64,
    .result_text_bytes = 128,
    .provider_response_bytes = 4096,
});
const Model = agent.model(.{ .name = "text-reader", .model = "fixture-text-reader", .protocol = struct {
    pub const semantic_identity = agent.model_invocation.protocol_identity;
} });
const side_identity = "agent.text.side-resumed.v1";
const Challenge = struct { task: u64, occurrence: u64 };

fn confirmation(c: agent.Context) !source.Id {
    const b = c.builder;
    const unit = try b.scalar(void);
    const integer = try b.scalar(u64);
    const boolean = try b.scalar(bool);
    const challenge = try c.schema(Challenge);
    const d = try agent.interaction.define(b, .{ .name = "text-continue", .channel = unit, .purpose = unit, .presentation = unit, .outgoing = challenge, .input = challenge });
    try c.registry.classify(d.effect, .interaction);
    const function = try b.declare(&.{challenge}, unit, &.{d.effect}, &.{});
    const expected = try b.reference(b.parameter(function, 0));
    const response = try b.variable(d.reply);
    const answer = try b.variable(challenge);
    const supplied = try b.reference(answer);
    const retry = try b.term(.{ .call = .{ .function = function, .arguments = &.{expected} } });
    var accepted = try b.pure(try b.constant(void, {}));
    for (0..2) |field| accepted = try b.term(.{ .conditional = .{
        .condition = try b.primitive(boolean, .equal, &.{
            try b.primitive(integer, .field, &.{expected}, field), try b.primitive(integer, .field, &.{supplied}, field),
        }, 0),
        .when_true = accepted,
        .when_false = retry,
    } });
    const matched = try b.term(.{ .match_sum = .{ .value = try b.reference(response), .cases = &.{.{ .variable = answer, .body = accepted }} } });
    const value = try b.constant(void, {});
    try b.define(function, try b.bind(response, try agent.interaction.exchange(b, d, .{ .channel = value, .purpose = value, .presentation = value, .outgoing = expected }), matched));
    return function;
}

fn discardYield(b: *source.Builder, g: boundary.library.generator.Generator, value: source.Id, failure: source.Id) !source.Id {
    const payload = try b.variable(g.element);
    const package = try b.variable(g.package);
    const close = try b.bind(try b.variable(try b.scalar(void)), try boundary.library.generator.close(b, g, try b.reference(package)), try b.term(.{ .fail = failure }));
    return b.term(.{ .unpack_product = .{ .value = value, .variables = &.{ payload, package }, .body = close } });
}

fn withRetainedWork(c: agent.Context, side_effect: source.Id, tool: agent.tools.Descriptor, result: source.Id, report: source.Id, after_tool: source.Id, failure: source.Id) !source.Id {
    const b = c.builder;
    const unit = try b.scalar(void);
    const integer = try b.scalar(u64);
    const g = try boundary.library.generator.define(b, "agent.text.side-task.v1", integer, &.{ unit, integer }, &.{}, .{ .effects = &.{side_effect} });
    const body = try b.declare(&.{g.capability}, unit, &.{ side_effect, g.effect }, &.{});
    const offered = try b.term(.{ .perform = .{ .effect = g.effect, .capability = try b.reference(b.parameter(body, 0)), .payload = try b.constant(u64, 7) } });
    const resumed = try b.term(.{ .perform = .{ .effect = side_effect, .payload = try b.constant(u64, 77) } });
    try b.define(body, try b.bind(try b.variable(unit), offered, try b.bind(try b.variable(unit), resumed, try b.pure(try b.constant(void, {})))));
    const body_type = try b.schema(.{ .internal = .{ .computation = .{ .parameters = &.{g.capability}, .result = unit, .effects = &.{ side_effect, g.effect } } } });
    const answer = try b.variable(g.answer);
    const yielded = try b.variable(g.yielded);
    const payload = try b.variable(integer);
    const package = try b.variable(g.package);
    const next_answer = try b.variable(g.answer);
    const unexpected = try b.variable(g.yielded);
    const finish = try b.term(.{ .match_sum = .{ .value = try b.reference(next_answer), .cases = &.{
        .{ .variable = try b.variable(unit), .body = try b.pure(report) },
        .{ .variable = unexpected, .body = try discardYield(b, g, try b.reference(unexpected), failure) },
    } } });
    const resume_side = try b.bind(next_answer, try boundary.library.generator.next(b, g, try b.reference(package)), finish);
    const execute = try b.bind(result, try agent.tools.perform(c, tool, try c.literal(Empty, .{})), try b.bind(try b.variable(unit), after_tool, resume_side));
    const unpack = try b.term(.{ .unpack_product = .{ .value = try b.reference(yielded), .variables = &.{ payload, package }, .body = execute } });
    const started = try b.term(.{ .match_sum = .{ .value = try b.reference(answer), .cases = &.{
        .{ .variable = try b.variable(unit), .body = try b.term(.{ .fail = failure }) },
        .{ .variable = yielded, .body = unpack },
    } } });
    return b.bind(answer, try b.term(.{ .handle = .{ .handler = g.handler, .body = try b.lambda(body, body_type) } }), started);
}

const Tool = struct {
    var object: []const u8 = &.{};
    pub fn declare(c: agent.Context) !agent.tools.Descriptor {
        const read = try c.external(text.read_identity, try c.schema(text.Read), try c.schema(text.Reply), .read);
        const close = try c.external(text.close_identity, try c.schema(text.Subject), try c.schema(void), .read);
        return agent.tools.declareCompiled(c, .{ .instance = "text", .object = object, .entry = "inspect", .identity = "agent.tool.inspect-text-core.v1", .payload = try c.schema(text.Subject), .result = try c.schema(text.Result), .effects = &.{ .{ .symbol = "read", .effect = read }, .{ .symbol = "close", .effect = close } }, .name = "text-core" });
    }
};
const Application = struct {
    pub fn emit(c: agent.Context) !source.Module {
        const b = c.builder;
        const core = try c.catalogs.tool("text-core");
        const unit = try b.scalar(void);
        const failure = try b.constant(void, {});
        const responder = try agent.responders.defineModel(Profile, c, failure, false);
        const confirm = try confirmation(c);
        const side_effect = try c.external(side_identity, try b.scalar(u64), unit, .read);
        const model_effects = try (source.Row{ .effects = b.functions.items[@intCast(responder)].effects }).unionWith(b.allocator(), .{ .effects = &.{side_effect} });
        const base_effects = try (source.Row{ .effects = b.functions.items[@intCast(core.implementation.local)].effects }).unionWith(b.allocator(), model_effects);
        const effects = try base_effects.unionWith(b.allocator(), .{ .effects = b.functions.items[@intCast(confirm)].effects });
        const entry = try b.declare(&.{try c.schema(Task)}, try c.schema(Report), effects.effects, &.{});
        const input = try b.reference(b.parameter(entry, 0));
        const subject = try b.primitive(core.payload, .field, &.{input}, 0);
        const task = try b.primitive(try b.scalar(u64), .field, &.{input}, 1);
        // The model-facing tool has no ambient file/path argument: the source
        // closure supplies the immutable subject from the captured task.
        const empty = try c.schema(Empty);
        const local = try b.declare(&.{empty}, core.result, b.functions.items[@intCast(core.implementation.local)].effects, &.{});
        try b.define(local, try agent.tools.perform(c, core, subject));
        const tool: agent.tools.Descriptor = .{ .identity = "agent.tool.inspect-text.v1", .payload = empty, .result = core.result, .implementation = .{ .local = local }, .role = .read, .model_offered = true, .name = declaration.name, .description = declaration.description };
        try agent.tools.validate(c, &.{tool});
        const result = try b.variable(tool.result);
        const report = try b.primitive(try c.schema(Report), .product, &.{ task, try b.reference(result) }, 0);
        const first_question = try b.term(.{ .call = .{ .function = confirm, .arguments = &.{try b.primitive(try c.schema(Challenge), .product, &.{ task, try b.constant(u64, 1) }, 0)} } });
        const last_question = try b.term(.{ .call = .{ .function = confirm, .arguments = &.{try b.primitive(try c.schema(Challenge), .product, &.{ task, try b.constant(u64, 2) }, 0)} } });
        const execute = try b.bind(try b.variable(unit), first_question, try withRetainedWork(c, side_effect, tool, result, report, last_question, failure));
        const template = try c.literal(Profile.Request, try Profile.templateValue(Model, .{ .items = &.{} }, .{ .minimum_calls = 1, .maximum_calls = 1, .parallel_calls = false }));
        const subject_name = try b.primitive(try c.schema(agent.contracts.Text(64)), .field, &.{subject}, 0);
        const prompt = try b.value(.{ .schema = try c.schema(Profile.MessageText), .expression = .{ .primitive = .{
            .opcode = .blob_concat,
            .operands = &.{ try c.literal(Profile.MessageText, .{ .bytes = "Inspect current subject: " }), subject_name },
            .failures = &.{.{ .kind = .capacity_exceeded, .value = try b.failureLiteral(failure) }},
        } } });
        const message = try b.primitive(try c.schema(Profile.Message), .product, &.{ try c.literal(agent.model_invocation.MessageRole, .user), prompt }, 0);
        const messages = try b.primitive(try c.schema(Profile.Messages), .sequence, &.{message}, 0);
        var fields: [std.meta.fields(Profile.Request).len]source.Id = undefined;
        inline for (std.meta.fields(Profile.Request), 0..) |field, i| fields[i] = if (comptime std.mem.eql(u8, field.name, "messages")) messages else try b.primitive(try c.schema(field.type), .field, &.{template}, i);
        const request = try b.primitive(try c.schema(Profile.Request), .product, &fields, 0);
        const selected = try b.variable(try c.schema(Profile.Interpretation));
        const accept = try b.variable(try c.schema(Action));
        const reject = try b.variable(try c.schema(Profile.InterpretationFailure));
        const action = try b.term(.{ .match_sum = .{ .value = try b.reference(accept), .cases = &.{.{ .variable = try b.variable(empty), .body = execute }} } });
        const choice = try b.term(.{ .match_sum = .{ .value = try b.reference(selected), .cases = &.{
            .{ .variable = accept, .body = action }, .{ .variable = reject, .body = try b.term(.{ .fail = failure }) },
        } } });
        try b.define(entry, try b.bind(selected, try agent.responders.invokeModel(Profile, c, failure, false, request, try c.literal([1]bool, .{true})), choice));
        return b.module(entry, unit);
    }
};
const System = agent.system(.{ .InitialArgs = Task, .Result = Report, .Failure = void, .tools = .{Tool}, .application = Application });

pub fn main(init: std.process.Init) !void {
    var args = init.minimal.args.iterate();
    _ = args.next();
    const mode = args.next() orelse return error.ExpectedMode;
    if (std.mem.eql(u8, mode, "model-reply")) {
        if (args.next() != null) return error.UnexpectedArgument;
        const bytes = try agent.contracts.encodeOwned(Profile.Result, init.gpa, .{ .output = .{
            .items = .{ .items = &.{.{ .function_call = .{
                .call_id = .{ .bytes = "text-fixture" },
                .name = .{ .bytes = declaration.name },
                .arguments_json = .{ .bytes = "{}" },
                .tool_ordinal_claim = 0,
                .decoded_action = .{ .decoded = .{ .inspect_text = .{} } },
            } }} },
            .normalized_output_digest = [_]u8{0} ** 32,
        } });
        defer init.gpa.free(bytes);
        return write(init, bytes);
    }
    inline for (.{ .{ "subject-schema", text.Subject }, .{ "task-schema", Task }, .{ "result-schema", text.Result }, .{ "report-schema", Report } }) |item| {
        if (std.mem.eql(u8, mode, item[0])) {
            if (args.next() != null) return error.UnexpectedArgument;
            var b = source.Builder.init(init.gpa);
            defer b.deinit();
            const root = try agent.contracts.schema(item[1], &b);
            const bytes = try data.schema.encodeOwned(init.gpa, b.schemas.items, root);
            defer init.gpa.free(bytes);
            return write(init, bytes);
        }
    }
    const path = args.next() orelse return error.ExpectedObject;
    if (args.next() != null) return error.UnexpectedArgument;
    const bytes = try std.Io.Dir.cwd().readFileAlloc(init.io, path, init.gpa, .limited(64 << 20));
    defer init.gpa.free(bytes);
    if (std.mem.eql(u8, mode, "agent")) {
        Tool.object = bytes;
        defer Tool.object = &.{};
        var compiled = try agent.compile(init.gpa, System);
        defer compiled.deinit();
        return writeImage(init, &compiled);
    }
    if (!std.mem.eql(u8, mode, "standalone")) return error.InvalidMode;
    var b = source.Builder.init(init.gpa);
    defer b.deinit();
    const subject = try agent.contracts.schema(text.Subject, &b);
    const result = try agent.contracts.schema(text.Result, &b);
    const unit = try b.scalar(void);
    const read = try b.effect(.{ .identity = text.read_identity, .payload = try agent.contracts.schema(text.Read, &b), .result = try agent.contracts.schema(text.Reply, &b) });
    const close = try b.effect(.{ .identity = text.close_identity, .payload = subject, .result = unit });
    const inspect = try b.declare(&.{subject}, result, &.{ read, close }, &.{});
    const entry = try b.declare(&.{subject}, result, &.{ read, close }, &.{});
    try b.define(entry, try b.term(.{ .call = .{ .function = inspect, .arguments = &.{try b.reference(b.parameter(entry, 0))} } }));
    var caller = try source.component.compile(init.gpa, b.module(entry, unit), .{
        .imports = &.{.{ .name = "inspect", .reference = .{ .kind = .function, .id = inspect } }},
        .borrows = &.{.{ .function = inspect }},
        .exports = &.{ .{ .name = "main", .reference = .{ .kind = .function, .id = entry } }, .{ .name = "read", .reference = .{ .kind = .effect, .id = read } }, .{ .name = "close", .reference = .{ .kind = .effect, .id = close } } },
    });
    defer caller.deinit();
    const object = try init.gpa.alloc(u8, try data.component.encodedLength(caller.object));
    defer init.gpa.free(object);
    _ = try caller.encode(init.gpa, object);
    var linked = try data.linker.link(init.gpa, &.{ .{ .key = "caller", .object = object }, .{ .key = "text", .object = bytes } }, &.{
        .{ .required = .{ .instance = "caller", .symbol = "inspect" }, .supplied = .{ .instance = "text", .symbol = "inspect" } },
        .{ .required = .{ .instance = "text", .symbol = "read" }, .supplied = .{ .instance = "caller", .symbol = "read" } },
        .{ .required = .{ .instance = "text", .symbol = "close" }, .supplied = .{ .instance = "caller", .symbol = "close" } },
    }, .{ .instance = "caller", .symbol = "main" });
    defer linked.deinit();
    try writeImage(init, &linked);
}
fn writeImage(init: std.process.Init, compiled: anytype) !void {
    const bytes = try init.gpa.alloc(u8, try data.program_image.encodedLength(compiled.program));
    defer init.gpa.free(bytes);
    _ = try compiled.encode(init.gpa, bytes);
    try write(init, bytes);
}
fn write(init: std.process.Init, bytes: []const u8) !void {
    var buffer: [4096]u8 = undefined;
    var output = std.Io.File.stdout().writer(init.io, &buffer);
    try output.interface.writeAll(bytes);
    try output.interface.flush();
}
