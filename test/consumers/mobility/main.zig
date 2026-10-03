//! Independent consumer: placement and fallback are ordinary program control.
const std = @import("std");
const agent = @import("agent");
const boundary = @import("boundary");
const a = boundary.authoring;
const source = boundary.source;
const text = agent.tools.textInspection;
const mobility = agent.mobility;
var fixed_placement = false;

pub const Task = struct {
    task_id: u64,
    caller_marker: u64,
    subject: text.Subject,
    outbound: mobility.EnsureInput,
    inbound: mobility.EnsureInput,
};
pub const Report = struct { task_id: u64, caller_marker: u64, inspection: text.Result, child_result: u64 };
pub const TASK = "agent.mobility.fixture.task.v1";
pub const PRESENT = "agent.mobility.fixture.present.v1";
pub const SIDE = "agent.mobility.fixture.child-resumed.v1";
pub const CLEANUP = "agent.mobility.fixture.child-cleanup.v1";

const Tool = struct {
    var object: []const u8 = &.{};
    pub fn declare(c: agent.Context) !agent.tools.Descriptor {
        const read = try c.external(text.read_identity, try c.schema(text.Read), try c.schema(text.Reply), .read);
        const close = try c.external(text.close_identity, try c.schema(text.Subject), try c.schema(void), .read);
        return agent.tools.declareCompiled(c, .{
            .instance = "mobility-text",
            .object = object,
            .entry = "inspect",
            .identity = "agent.tool.mobility-inspect.v1",
            .payload = try c.schema(text.Subject),
            .result = try c.schema(text.Result),
            .effects = &.{ .{ .symbol = "read", .effect = read }, .{ .symbol = "close", .effect = close } },
            .name = "mobility-text",
        });
    }
};

const Emit = struct {
    agent_context: agent.Context,
    c: *a.Context,
    fn schema(e: Emit, comptime T: type) anyerror!*const a.Schema {
        switch (@typeInfo(T)) {
            .@"struct" => |info| {
                if (@hasDecl(T, "agent_value_kind")) return a.interop.schema(e.c, try e.agent_context.schema(T));
                var fields: [info.fields.len]a.Field = undefined;
                inline for (info.fields, 0..) |field, i| fields[i] = .{ .name = field.name, .schema = try e.schema(field.type) };
                return e.c.record(&fields);
            },
            .@"union" => |info| {
                var fields: [info.fields.len]a.Field = undefined;
                inline for (info.fields, 0..) |field, i| fields[i] = .{ .name = field.name, .schema = try e.schema(field.type) };
                return e.c.alternatives(&fields);
            },
            else => return a.interop.schema(e.c, try e.agent_context.schema(T)),
        }
    }
    fn external(e: Emit, name: []const u8, comptime Input: type, comptime Output: type, role: agent.admission.Role) !*const a.Operation {
        const op = try e.c.external(name, try e.schema(Input), try e.schema(Output));
        try e.agent_context.registry.classify(try a.interop.operationId(e.c, op), role);
        return op;
    }
    fn place(e: Emit, body: *a.Body, input: *const a.Value) !*const a.Value {
        const term = if (fixed_placement) try fixedPlace(e.agent_context, try a.interop.valueId(body, input)) else try mobility.ensure(e.agent_context, try a.interop.valueId(body, input), try e.agent_context.builder.constant(void, {}));
        return a.interop.term(body, term, try e.schema(mobility.PlacementResult));
    }
    fn refused(e: Emit, body: *a.Body) !*const a.Value {
        return body.variant(try e.schema(text.Result), "unavailable", try body.constant(void, {}));
    }
};

// Measurement counterpart: one explicit authored destination, with identical
// capability requirements and custody. It is not another public ensure API.
fn fixedPlace(ctx: agent.Context, input: source.Id) !source.Id {
    const b = ctx.builder;
    const cache = try b.specialization(source.Id, "mobility.fixture.fixed", .{});
    const function = cache.cached orelse create: {
        const d = try mobility.define(ctx);
        const result = try ctx.schema(mobility.PlacementResult);
        const f = try b.declare(&.{try ctx.schema(mobility.EnsureInput)}, result, &.{d.relocate}, &.{});
        const value = try b.reference(b.parameter(f, 0));
        const resolve = try b.primitive(try ctx.schema(mobility.ResolveInput), .field, &.{value}, 0);
        const constraints = try b.primitive(try ctx.schema(mobility.Constraints), .field, &.{resolve}, 1);
        const required = try b.primitive(try ctx.schema(?mobility.Identifier), .field, &.{constraints}, 1);
        const budget = try b.primitive(try ctx.schema(mobility.Budget), .field, &.{value}, 3);
        const moves = try b.primitive(try b.scalar(u32), .field, &.{budget}, 0);
        const absent = try b.variable(try b.scalar(void));
        const host = try b.variable(try ctx.schema(mobility.Identifier));
        const arrived = try b.variable(try ctx.schema(mobility.Arrival));
        const refused = try b.variable(try ctx.schema(mobility.Refusal));
        const reply = try b.variable(try ctx.schema(mobility.RelocationReply));
        const payload = try b.primitive(try ctx.schema(mobility.RelocateInput), .product, &.{
            try b.reference(host),
            try b.primitive(try ctx.schema(mobility.Requirements), .field, &.{resolve}, 0),
            try b.primitive(try ctx.schema(mobility.Identifier), .field, &.{value}, 1),
            try b.primitive(try ctx.schema(mobility.Identifier), .field, &.{value}, 2),
            moves,
        }, 0);
        const ready = try b.primitive(try ctx.schema(mobility.Placement), .product, &.{
            try b.primitive(try ctx.schema(mobility.Observation), .field, &.{try b.reference(arrived)}, 4),
            try b.value(.{ .schema = try b.scalar(u32), .expression = .{ .primitive = .{ .opcode = .integer_sub, .operands = &.{ moves, try b.constant(u32, 1) }, .failures = &.{.{ .kind = .arithmetic_overflow, .value = try b.failureLiteral(try b.constant(void, {})) }} } } }),
        }, 0);
        const denied = try b.pure(try b.primitive(result, .variant, &.{try b.primitive(try ctx.schema(mobility.Reason), .variant, &.{try b.constant(void, {})}, 9)}, 1));
        const relocate = try b.bind(reply, try mobility.relocate(ctx, f, payload), try b.term(.{ .match_sum = .{ .value = try b.reference(reply), .cases = &.{
            .{ .variable = arrived, .body = try b.pure(try b.primitive(result, .variant, &.{ready}, 0)) },
            .{ .variable = refused, .body = try b.pure(try b.primitive(result, .variant, &.{try b.primitive(try ctx.schema(mobility.Reason), .field, &.{try b.reference(refused)}, 0)}, 1)) },
        } } }));
        const selected = try b.term(.{ .match_sum = .{ .value = required, .cases = &.{
            .{ .variable = absent, .body = denied }, .{ .variable = host, .body = relocate },
        } } });
        try b.define(f, try b.term(.{ .conditional = .{ .condition = try b.primitive(try b.scalar(bool), .less, &.{ try b.constant(u32, 0), moves }, 0), .when_true = selected, .when_false = denied } }));
        break :create try cache.finish(b, f);
    };
    return b.term(.{ .call = .{ .function = function, .arguments = &.{input} } });
}

const Application = struct {
    pub fn emit(ctx: agent.Context) !source.Module {
        const b = ctx.builder;
        const c = try a.Context.init(b);
        const e = Emit{ .agent_context = ctx, .c = c };
        const unit = try c.scalar(void);
        const integer = try c.scalar(u64);
        const definition = try mobility.define(ctx);
        const move_op = try a.interop.operation(c, definition.relocate);
        const resolve_op = try a.interop.operation(c, definition.resolve);
        const tool = try ctx.catalogs.tool("mobility-text");
        const read_op = try a.interop.operation(c, b.functions.items[@intCast(tool.implementation.local)].effects[0]);
        const close_op = try a.interop.operation(c, b.functions.items[@intCast(tool.implementation.local)].effects[1]);
        const task_op = try e.external(TASK, u64, Task, .interaction);
        const present_op = try e.external(PRESENT, text.Result, void, .interaction);
        const side_op = try e.external(SIDE, u64, void, .read);
        const cleanup_op = try e.external(CLEANUP, u64, void, .read);
        const effects = &.{ resolve_op, move_op, read_op, close_op, present_op };
        const inspect = try c.function("move, inspect, return and present", &.{.{ .name = "task", .schema = try e.schema(Task) }}, try e.schema(text.Result), effects);
        const body = try c.body(inspect);
        const task = try body.parameter("task");
        const outbound = try e.place(body, try body.field(task, "outbound"));
        const arrived = try body.caseOf(outbound, "Ready");
        const refused = try body.caseOf(outbound, "Failed");
        const work = arrived.body();
        const subject = try work.field(task, "subject");
        const result = try a.interop.term(work, try agent.tools.perform(ctx, tool, try a.interop.valueId(work, subject)), try e.schema(text.Result));
        const inbound = try e.place(work, try work.field(task, "inbound"));
        const home = try work.caseOf(inbound, "Ready");
        const away = try work.caseOf(inbound, "Failed");
        _ = try home.body().perform(present_op, result);
        const returned = try work.match(inbound, &.{ try home.ret(result), try away.ret(try e.refused(away.body())) });
        try c.define(inspect, try body.ret(try body.match(outbound, &.{ try arrived.ret(returned), try refused.ret(try e.refused(refused.body())) })));

        // The child has a live protected cleanup scope when it yields. Its
        // actual suspension package remains owned by the caller across moves.
        const child = try boundary.library.generator.create(c, "agent.mobility.fixture.child.v1", unit, integer, integer, .{
            .captures = .{ .continuation = &.{ unit, integer }, .body = &.{integer} },
            .residual = &.{ side_op, cleanup_op },
            .body_use = .reusable,
        });
        const start_type = try c.handledSchema(child.handler());
        const entry = try c.function("retained caller", &.{.{ .name = "task_id", .schema = integer }}, try e.schema(Report), &.{ task_op, resolve_op, move_op, read_op, close_op, present_op, side_op, cleanup_op });
        const root = try c.body(entry);
        const input = try root.perform(task_op, try root.parameter("task_id"));
        const marker = try root.field(input, "caller_marker");
        const task_id = try root.field(input, "task_id");
        const start_fn = try c.functionFor("owned child", start_type);
        const start = try root.closureBody(start_fn);
        const capability = try start.parameter("capability");
        const work_type = try c.callable(&.{}, integer, &.{ child.effect(), side_op }, .{ .use = .reusable, .captures = &.{child.capability()} });
        const child_fn = try c.functionFor("suspended child", work_type);
        const child_body = try start.closureBody(child_fn);
        _ = try child_body.performLocal(child.effect(), capability, try child_body.constant(u64, 7));
        _ = try child_body.perform(side_op, try child_body.constant(u64, 77));
        try c.define(child_fn, try child_body.ret(try child_body.constant(u64, 91)));
        const cleanup_type = try c.callable(&.{.{ .name = "exit", .schema = try c.cleanupInfo(unit) }}, unit, &.{cleanup_op}, .{ .use = .reusable, .captures = &.{integer} });
        const cleanup_fn = try c.functionFor("child cleanup", cleanup_type);
        const cleanup = try start.closureBody(cleanup_fn);
        try c.define(cleanup_fn, try cleanup.ret(try cleanup.perform(cleanup_op, marker)));
        try c.define(start_fn, try start.ret(try start.protect(try start.lambda(child_fn, work_type), try start.lambda(cleanup_fn, cleanup_type), &.{})));
        const suspended = try root.handleWith(child.handler(), try root.lambda(start_fn, start_type), &.{});
        const early = try root.caseOf(suspended, "done");
        const pending = try root.caseOf(suspended, "yielded");
        const parts = try pending.body().destructure(pending.payload());
        const future = try parts.get("future");
        const inspection = try pending.body().call(inspect, &.{.{ .name = "task", .value = input }});
        const resumed = try pending.body().resumePackage(future, try pending.body().constant(void, {}));
        const done = try pending.body().caseOf(resumed, "done");
        const again = try pending.body().caseOf(resumed, "yielded");
        const unexpected = try again.body().destructure(again.payload());
        _ = try again.body().disposePackage(try unexpected.get("future"));
        const report = try done.body().product(try e.schema(Report), &.{
            .{ .name = "task_id", .value = task_id },       .{ .name = "caller_marker", .value = marker },
            .{ .name = "inspection", .value = inspection }, .{ .name = "child_result", .value = done.payload() },
        });
        const completed = try pending.body().match(resumed, &.{ try done.ret(report), try again.fail(try e.schema(Report), try again.body().constant(void, {})) });
        try c.define(entry, try root.ret(try root.match(suspended, &.{ try early.fail(try e.schema(Report), try early.body().constant(void, {})), try pending.ret(completed) })));
        // Agent resolves the declared BMO1 import in its final component link.
        // Context.module is the closed-source publisher and forbids imports.
        return b.module(try a.interop.functionId(c, entry), try a.interop.schemaId(c, unit));
    }
};
pub const System = agent.system(.{ .InitialArgs = u64, .Result = Report, .Failure = void, .tools = .{Tool}, .application = Application });

pub fn main(init: std.process.Init) !void {
    var args = init.minimal.args.iterate();
    _ = args.next();
    const mode = args.next() orelse return error.ExpectedMode;
    inline for (.{ .{ "task-schema", Task }, .{ "report-schema", Report }, .{ "resolve-schema", mobility.ResolveInput }, .{ "resolution-schema", mobility.Resolution }, .{ "relocate-schema", mobility.RelocateInput }, .{ "relocation-reply-schema", mobility.RelocationReply }, .{ "read-schema", text.Read }, .{ "text-reply-schema", text.Reply }, .{ "subject-schema", text.Subject }, .{ "inspection-schema", text.Result }, .{ "integer-schema", u64 }, .{ "unit-schema", void } }) |item| {
        if (std.mem.eql(u8, mode, item[0])) {
            var b = source.Builder.init(init.gpa);
            defer b.deinit();
            const schema = try agent.contracts.schema(item[1], &b);
            const bytes = try boundary.data.schema.encodeOwned(init.gpa, b.schemas.items, schema);
            defer init.gpa.free(bytes);
            return write(init, bytes);
        }
    }
    fixed_placement = std.mem.eql(u8, mode, "fixed-image") or std.mem.eql(u8, mode, "fixed-identity");
    if (!fixed_placement and !std.mem.eql(u8, mode, "image") and !std.mem.eql(u8, mode, "identity")) return error.InvalidMode;
    const path = args.next() orelse return error.ExpectedObject;
    const bytes = try std.Io.Dir.cwd().readFileAlloc(init.io, path, init.gpa, .limited(8 << 20));
    defer init.gpa.free(bytes);
    Tool.object = bytes;
    defer Tool.object = &.{};
    var compiled = try agent.compile(init.gpa, System);
    defer compiled.deinit();
    if (std.mem.eql(u8, mode, "identity") or std.mem.eql(u8, mode, "fixed-identity")) return write(init, &(try boundary.data.program_image.identity(init.gpa, compiled.program)));
    const image = try init.gpa.alloc(u8, try boundary.data.program_image.encodedLength(compiled.program));
    defer init.gpa.free(image);
    _ = try compiled.encode(init.gpa, image);
    try write(init, image);
}
fn write(init: std.process.Init, bytes: []const u8) !void {
    var buffer: [4096]u8 = undefined;
    var out = std.Io.File.stdout().writer(init.io, &buffer);
    try out.interface.writeAll(bytes);
    try out.interface.flush();
}
