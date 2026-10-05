//! Independent mobile repository consumer. World owns all application control;
//! environmental leaves supply evidence and answers, never the next phase.
const std = @import("std");
const agent = @import("agent");
const boundary = @import("boundary");
const a = boundary.authoring;
pub const t = @import("types.zig");
const mobility = agent.mobility;
pub const System = agent.system(.{ .InitialArgs = t.Task, .Result = t.Report, .Failure = t.Failure, .application = Application });

const Emit = struct {
    agent_context: agent.Context,
    c: *a.Context,

    fn schema(e: Emit, comptime T: type) anyerror!*const a.Schema {
        switch (@typeInfo(T)) {
            .@"struct" => |info| {
                if (@hasDecl(T, "agent_value_kind")) return a.interop.schema(e.c, try e.agent_context.schema(T));
                var fields: [info.field_names.len]a.Field = undefined;
                inline for (info.field_names, info.field_types, 0..) |name, F, i| fields[i] = .{ .name = name, .schema = try e.schema(F) };
                return e.c.record(&fields);
            },
            .@"union" => |info| {
                var fields: [info.field_names.len]a.Field = undefined;
                inline for (info.field_names, info.field_types, 0..) |name, F, i| fields[i] = .{ .name = name, .schema = try e.schema(F) };
                return e.c.alternatives(&fields);
            },
            .pointer => |info| if (info.size == .slice and info.child != u8) {
                return e.c.sequence(try e.schema(info.child));
            } else return a.interop.schema(e.c, try e.agent_context.schema(T)),
            else => return a.interop.schema(e.c, try e.agent_context.schema(T)),
        }
    }
    fn external(e: Emit, name: []const u8, comptime Input: type, comptime Output: type, role: agent.admission.Role) !*const a.Operation {
        const op = try e.c.external(name, try e.schema(Input), try e.schema(Output));
        try e.agent_context.registry.classify(try a.interop.operationId(e.c, op), role);
        return op;
    }
    fn literal(e: Emit, body: *a.Body, comptime T: type, value: T) !*const a.Value {
        return a.interop.adoptValue(body, try e.agent_context.literal(T, value), try e.schema(T));
    }
    // A later destination cannot reset the allowance supplied by an earlier
    // ensure. The template contributes requirements/policy and attempt bounds.
    fn place(e: Emit, body: *a.Body, template: *const a.Value, moves: *const a.Value) !*const a.Value {
        const budget = try body.field(template, "budget");
        const input = try body.product(try e.schema(mobility.EnsureInput), &.{
            .{ .name = "placement", .value = try body.field(template, "placement") },
            .{ .name = "placement_intent_id", .value = try body.field(template, "placement_intent_id") },
            .{ .name = "export_policy_ref", .value = try body.field(template, "export_policy_ref") },
            .{ .name = "budget", .value = try body.product(try e.schema(mobility.Budget), &.{
                .{ .name = "moves", .value = moves },
                .{ .name = "attempts", .value = try body.field(budget, "attempts") },
            }) },
        });
        return a.interop.term(body, try mobility.ensure(e.agent_context, try a.interop.valueId(body, input), try e.agent_context.literal(t.Failure, .placement_failed)), try e.schema(mobility.PlacementResult));
    }
};

pub const Application = struct {
    pub fn emit(ctx: agent.Context) !boundary.source.Module {
        const c = try a.Context.init(ctx.builder);
        errdefer {
            const diagnostic = c.lastDiagnostic().renderAlloc(ctx.builder.allocator()) catch "diagnostic unavailable";
            std.debug.print("mobile repository authoring: {s}\n", .{diagnostic});
        }
        const e = Emit{ .agent_context = ctx, .c = c };
        const unit = try c.scalar(void);
        const integer = try c.scalar(u64);
        const movement = try mobility.define(ctx);
        const resolve = try a.interop.operation(c, movement.resolve);
        const relocate = try a.interop.operation(c, movement.relocate);
        const snapshot_op = try e.external(t.SNAPSHOT, t.SnapshotRequest, t.Snapshot, .read);
        const read_op = try e.external(t.READ, t.ReadRequest, t.Evidence, .read);
        const human_op = try e.external(t.HUMAN, t.Question, t.Answer, .interaction);
        const cleanup_op = try e.external(t.RELEASE, t.Cleanup, void, .read);
        const effects = &.{ resolve, relocate, snapshot_op, read_op, human_op, cleanup_op };
        const failure = try a.interop.literalFailure(c, try ctx.literal(t.Failure, .invalid_task), try e.schema(t.Failure));
        const inquiry = try agent.inquiry.create(c, .{
            .identity = "agent.repository.investigator.v1",
            .demand = try e.schema(t.Question),
            .reply = try e.schema(t.Answer),
            .finding = try e.schema(t.Finding),
            .failure = failure,
            .captures = .{ .continuation = &.{ unit, integer, try e.schema(t.Task), try e.schema(t.Evidence), try e.schema(t.Cleanup), try e.schema(t.Question), try e.schema(t.Answer) }, .body = &.{ try e.schema(t.Task), try e.schema(t.Evidence) } },
            .residual = &.{cleanup_op},
            .parameters = &.{ .{ .name = "task", .schema = try e.schema(t.Task) }, .{ .name = "evidence", .schema = try e.schema(t.Evidence) } },
            .body_use = .reusable,
        });
        const producer_type = try c.handledSchema(inquiry.dialogue.handler());
        const producer_fn = try c.functionFor("repository investigator", producer_type);
        const producer = try c.body(producer_fn);
        const input = try producer.parameter("task");
        const evidence = try producer.parameter("evidence");
        const capability = try producer.parameter("capability");
        const work_type = try c.callable(&.{}, try e.schema(t.Finding), &.{inquiry.dialogue.effect()}, .{ .use = .reusable, .captures = &.{ inquiry.dialogue.capability(), try e.schema(t.Task), try e.schema(t.Evidence) } });
        const work_fn = try c.functionFor("retained investigation", work_type);
        const work = try producer.closureBody(work_fn);
        const question = try work.product(try e.schema(t.Question), &.{
            .{ .name = "task_id", .value = try work.field(input, "task_id") },
            .{ .name = "generation", .value = try work.field(input, "generation") },
            .{ .name = "goal", .value = try work.field(input, "goal") },
            .{ .name = "evidence", .value = evidence },
        });
        const answer = try work.performLocal(inquiry.dialogue.effect(), capability, question);
        try c.define(work_fn, try work.ret(try work.product(try e.schema(t.Finding), &.{
            .{ .name = "goal", .value = try work.field(input, "goal") },
            .{ .name = "evidence", .value = evidence },
            .{ .name = "answer", .value = answer },
        })));
        const cleanup_type = try c.callable(&.{.{ .name = "exit", .schema = try c.cleanupInfo(try e.schema(t.Failure)) }}, unit, &.{cleanup_op}, .{ .use = .reusable, .captures = &.{try e.schema(t.Task)} });
        const cleanup_fn = try c.functionFor("release investigation", cleanup_type);
        const cleanup = try producer.closureBody(cleanup_fn);
        _ = try cleanup.perform(cleanup_op, try cleanup.product(try e.schema(t.Cleanup), &.{
            .{ .name = "task_id", .value = try cleanup.field(input, "task_id") },
            .{ .name = "generation", .value = try cleanup.field(input, "generation") },
        }));
        try c.define(cleanup_fn, try cleanup.ret(try cleanup.constant(void, {})));
        try c.define(producer_fn, try producer.ret(try producer.protect(try producer.lambda(work_fn, work_type), try producer.lambda(cleanup_fn, cleanup_type), &.{})));

        const entry = try c.function("repository task", &.{.{ .name = "task", .schema = try e.schema(t.Task) }}, try e.schema(t.Report), effects);
        const body = try c.body(entry);
        const task = try body.parameter("task");
        const workspace = try body.field(task, "workspace");
        const outbound = try e.place(body, workspace, try body.field(try body.field(workspace, "budget"), "moves"));
        const arrived = try body.caseOf(outbound, "Ready");
        const refused = try body.caseOf(outbound, "Failed");
        const at_workspace = arrived.body();
        const snapshot = try at_workspace.perform(snapshot_op, try at_workspace.product(try e.schema(t.SnapshotRequest), &.{
            .{ .name = "repository", .value = try at_workspace.field(task, "repository") },
            .{ .name = "base", .value = try at_workspace.field(task, "base") },
        }));
        const observed = try at_workspace.perform(read_op, try at_workspace.product(try e.schema(t.ReadRequest), &.{
            .{ .name = "snapshot", .value = snapshot },
            .{ .name = "path", .value = try at_workspace.field(task, "initial_path") },
        }));
        const started = try at_workspace.handleWithArguments(inquiry.dialogue.handler(), try at_workspace.lambda(producer_fn, producer_type), &.{ .{ .name = "task", .value = task }, .{ .name = "evidence", .value = observed } }, &.{});
        const parked = try at_workspace.call(inquiry.park, &.{ .{ .name = "state", .value = try agent.inquiry.initial(at_workspace, inquiry) }, .{ .name = "id", .value = try at_workspace.constant(u64, 1) }, .{ .name = "answer", .value = started } });
        // The actual owned investigation remains unfinished during relocation.
        const inbound = try e.place(at_workspace, try at_workspace.field(task, "human"), try at_workspace.field(arrived.payload(), "remaining_moves"));
        const home = try at_workspace.caseOf(inbound, "Ready");
        const away = try at_workspace.caseOf(inbound, "Failed");
        const origin = home.body();
        const projected = try origin.call(inquiry.project, &.{.{ .name = "state", .value = parked }});
        const parts = try origin.destructure(projected);
        const state = try parts.get("state");
        const views = try parts.get("views");
        const selected = try origin.sequenceGet(views, try origin.constant(u64, 0));
        const missing = try origin.caseOf(selected, "none");
        const found = try origin.caseOf(selected, "some");
        const at_home = found.body();
        const view = found.payload();
        const human = try at_home.perform(human_op, try at_home.field(view, "demand"));
        const resumed = try at_home.call(inquiry.distribute, &.{
            .{ .name = "state", .value = state },
            .{ .name = "ids", .value = try at_home.sequenceValue(inquiry.types.ids, &.{try at_home.field(view, "generation")}) },
            .{ .name = "reply", .value = human },
        });
        const findings = try at_home.call(inquiry.finish, &.{.{ .name = "state", .value = resumed }});
        const result = try at_home.product(try e.schema(t.Report), &.{
            .{ .name = "task_id", .value = try at_home.field(task, "task_id") },
            .{ .name = "generation", .value = try at_home.field(task, "generation") },
            .{ .name = "mode", .value = try at_home.field(task, "mode") },
            .{ .name = "remaining_moves", .value = try at_home.field(home.payload(), "remaining_moves") },
            .{ .name = "findings", .value = findings },
        });
        _ = try missing.body().call(inquiry.finish, &.{.{ .name = "state", .value = state }});
        const returned_home = try origin.match(selected, &.{ try found.ret(result), try missing.fail(try e.schema(t.Report), try e.literal(missing.body(), t.Failure, .invalid_task)) });
        _ = try away.body().call(inquiry.finish, &.{.{ .name = "state", .value = parked }});
        const returned = try at_workspace.match(inbound, &.{ try home.ret(returned_home), try away.fail(try e.schema(t.Report), try e.literal(away.body(), t.Failure, .placement_failed)) });
        try c.define(entry, try body.ret(try body.match(outbound, &.{ try arrived.ret(returned), try refused.fail(try e.schema(t.Report), try e.literal(refused.body(), t.Failure, .placement_failed)) })));
        const admitted = try c.function("admit repository task", &.{.{ .name = "task", .schema = try e.schema(t.Task) }}, try e.schema(t.Report), effects);
        const admission = try c.body(admitted);
        const supplied = try admission.parameter("task");
        var valid = try admission.less(try admission.constant(u64, 0), try admission.field(supplied, "task_id"));
        valid = try admission.select(valid, try admission.less(try admission.constant(u64, 0), try admission.field(supplied, "generation")), try admission.constant(bool, false));
        inline for (.{ "goal", "repository", "base", "initial_path" }) |name| {
            const present = try admission.less(try admission.constant(u64, 0), try admission.blobLength(try admission.field(supplied, name)));
            valid = try admission.select(valid, present, try admission.constant(bool, false));
        }
        inline for (.{ "workspace", "human" }) |name| {
            const budget = try admission.field(try admission.field(supplied, name), "budget");
            const moves = try admission.field(budget, "moves");
            const attempts = try admission.field(budget, "attempts");
            for ([_]*const a.Value{
                try admission.less(moves, try admission.constant(u32, 17)),
                try admission.less(try admission.constant(u32, 0), attempts),
                try admission.less(attempts, try admission.constant(u32, 4)),
            }) |within| valid = try admission.select(valid, within, try admission.constant(bool, false));
        }
        const accepted = try admission.branch();
        const rejected = try admission.branch();
        const called = try accepted.call(entry, &.{.{ .name = "task", .value = supplied }});
        try c.define(admitted, try admission.ret(try admission.conditional(valid, try accepted.ret(called), try rejected.fail(try e.schema(t.Report), try e.literal(rejected, t.Failure, .invalid_task)))));
        return c.module(admitted, try e.schema(t.Failure));
    }
};

pub fn main(init: std.process.Init) !void {
    var args = init.minimal.args.iterate();
    _ = args.next();
    const mode = args.next() orelse "image";
    inline for (.{ .{ "task", t.Task }, .{ "report", t.Report }, .{ "snapshot-request", t.SnapshotRequest }, .{ "snapshot", t.Snapshot }, .{ "read", t.ReadRequest }, .{ "evidence", t.Evidence }, .{ "question", t.Question }, .{ "answer", t.Answer }, .{ "cleanup", t.Cleanup }, .{ "unit", void } }) |item| {
        if (std.mem.eql(u8, mode, item[0])) {
            var b = boundary.source.Builder.init(init.gpa);
            defer b.deinit();
            const schema = try agent.contracts.schema(item[1], &b);
            const bytes = try boundary.data.schema.encodeOwned(init.gpa, b.schemas.items, schema);
            defer init.gpa.free(bytes);
            return write(init, bytes);
        }
    }
    inline for (.{ .{ "list", t.ListRequest }, .{ "listing", t.Listing }, .{ "search", t.SearchRequest }, .{ "search-result", t.SearchResult }, .{ "read-window", t.ReadWindowRequest }, .{ "read-window-result", t.ReadWindow } }) |item| {
        if (std.mem.eql(u8, mode, item[0])) {
            var b = boundary.source.Builder.init(init.gpa);
            defer b.deinit();
            const schema = try agent.contracts.schema(item[1], &b);
            const bytes = try boundary.data.schema.encodeOwned(init.gpa, b.schemas.items, schema);
            defer init.gpa.free(bytes);
            return write(init, bytes);
        }
    }
    if (!std.mem.eql(u8, mode, "image")) return error.InvalidMode;
    var compiled = try agent.compile(init.gpa, System);
    defer compiled.deinit();
    const bytes = try init.gpa.alloc(u8, try boundary.data.program_image.encodedLength(compiled.program));
    defer init.gpa.free(bytes);
    return write(init, try compiled.encode(init.gpa, bytes));
}
fn write(init: std.process.Init, bytes: []const u8) !void {
    var buffer: [4096]u8 = undefined;
    var out = std.Io.File.stdout().writer(init.io, &buffer);
    try out.interface.writeAll(bytes);
    try out.interface.flush();
}
