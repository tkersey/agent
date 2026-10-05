//! Independent mobile repository consumer. World owns all application control;
//! environmental leaves supply evidence and answers, never the next phase.
const std = @import("std");
const agent = @import("agent");
const boundary = @import("boundary");
const a = boundary.authoring;
pub const t = @import("types.zig");
const publication = @import("publication.zig");
const mobility = agent.mobility;
const model = @import("model.zig");
const investigator = @import("investigator.zig");
const completion = @import("completion.zig");
pub const System = agent.system(.{ .InitialArgs = t.Task, .Result = t.Report, .Failure = t.Failure, .application = Application });
pub const SessionSystem = agent.system(.{ .InitialArgs = t.Session, .Result = t.Report, .Failure = t.Failure, .application = SessionApplication });
const SessionApplication = struct {
    pub fn emit(ctx: agent.Context) !boundary.source.Module {
        return Application.emitMode(ctx, true);
    }
};

const Emit = @import("emit.zig").Emit;

pub const Application = struct {
    pub fn emit(ctx: agent.Context) !boundary.source.Module {
        return emitMode(ctx, false);
    }
    fn emitMode(ctx: agent.Context, comptime session: bool) !boundary.source.Module {
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
        const leaves = try investigator.Leaves.init(e);
        const investigation_effects = [_]*const a.Operation{ resolve, relocate, snapshot_op, read_op, human_op, cleanup_op, leaves.list, leaves.read, leaves.search, leaves.prepare, leaves.check, leaves.model };
        const failure = try a.interop.literalFailure(c, try ctx.literal(t.Failure, .invalid_task), try e.schema(t.Failure));
        const inquiry = try agent.inquiry.create(c, .{
            .identity = "agent.repository.investigator.v1",
            .demand = try e.schema(t.Demand),
            .reply = try e.schema(t.Reply),
            .finding = try e.schema(t.Finding),
            .failure = failure,
            .captures = .{ .continuation = &.{ unit, integer, try e.schema(t.Task), try e.schema(t.Snapshot), try e.schema(t.Evidence), try e.schema(t.Cleanup), try e.schema(t.Demand), try e.schema(t.Finding), try e.schema(t.Reply), try e.schema(model.State), try e.schema(model.P.CallId), try e.schema(u32), try e.schema(u16), try e.schema(model.P.ReplayResult) }, .body = &.{ try e.schema(t.Task), try e.schema(t.Snapshot), try e.schema(t.Evidence), try e.schema(u32) } },
            .residual = &.{ cleanup_op, resolve, relocate, leaves.list, leaves.read, leaves.search, leaves.prepare, leaves.check, leaves.model },
            .parameters = &.{ .{ .name = "task", .schema = try e.schema(t.Task) }, .{ .name = "snapshot", .schema = try e.schema(t.Snapshot) }, .{ .name = "evidence", .schema = try e.schema(t.Evidence) }, .{ .name = "moves", .schema = try e.schema(u32) } },
            .body_use = .reusable,
        });
        const complete = try completion.define(e, resolve, relocate);
        const effects = try ctx.builder.allocator().alloc(*const a.Operation, investigation_effects.len + complete.effects.len);
        @memcpy(effects[0..investigation_effects.len], &investigation_effects);
        @memcpy(effects[investigation_effects.len..], complete.effects);
        const producer_type = try c.handledSchema(inquiry.dialogue.handler());
        const producer_fn = try c.functionFor("repository investigator", producer_type);
        const producer = try c.body(producer_fn);
        const input = try producer.parameter("task");
        const evidence = try producer.parameter("evidence");
        const capability = try producer.parameter("capability");
        const snapshot_input = try producer.parameter("snapshot");
        const moves_input = try producer.parameter("moves");
        const loop = try investigator.define(e, inquiry, leaves, &.{ resolve, relocate });
        const work_type = try c.callable(&.{}, try e.schema(t.Finding), &.{ inquiry.dialogue.effect(), resolve, relocate, leaves.list, leaves.read, leaves.search, leaves.prepare, leaves.check, leaves.model }, .{ .use = .reusable, .captures = &.{ inquiry.dialogue.capability(), try e.schema(t.Task), try e.schema(t.Snapshot), try e.schema(t.Evidence), try e.schema(u32) } });
        const work_fn = try c.functionFor("retained investigation", work_type);
        const work = try producer.closureBody(work_fn);
        const initial = try work.product(try e.schema(model.State), &.{
            .{ .name = "replay", .value = try e.literal(work, model.P.ReplayBytes, .{ .bytes = "" }) },
            .{ .name = "results", .value = try e.literal(work, model.Results, .{ .items = &.{} }) },
            .{ .name = "remaining_steps", .value = try work.field(input, "maximum_steps") },
            .{ .name = "remaining_checks", .value = try work.field(input, "maximum_checks") },
            .{ .name = "remaining_revisions", .value = try work.constant(u16, 8) },
            .{ .name = "remaining_moves", .value = moves_input },
            .{ .name = "edits", .value = try e.literal(work, @FieldType(model.State, "edits"), .{ .items = &.{} }) },
            .{ .name = "candidate", .value = try e.literal(work, @FieldType(model.State, "candidate"), .{ .bytes = "" }) },
            .{ .name = "validation", .value = try e.literal(work, @FieldType(model.State, "validation"), .{ .bytes = "" }) },
            .{ .name = "passed", .value = try work.constant(bool, false) },
            .{ .name = "view_only", .value = try work.constant(bool, false) },
            .{ .name = "guidance", .value = try e.literal(work, t.Answer, .{ .bytes = "" }) },
        });
        try c.define(work_fn, try work.ret(try work.call(loop, &.{ .{ .name = "task", .value = input }, .{ .name = "snapshot", .value = snapshot_input }, .{ .name = "evidence", .value = evidence }, .{ .name = "state", .value = initial }, .{ .name = "capability", .value = capability } })));
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
        const started = try at_workspace.handleWithArguments(inquiry.dialogue.handler(), try at_workspace.lambda(producer_fn, producer_type), &.{ .{ .name = "task", .value = task }, .{ .name = "snapshot", .value = snapshot }, .{ .name = "evidence", .value = observed }, .{ .name = "moves", .value = try at_workspace.field(arrived.payload(), "remaining_moves") } }, &.{});
        const parked = try at_workspace.call(inquiry.park, &.{ .{ .name = "state", .value = try agent.inquiry.initial(at_workspace, inquiry) }, .{ .name = "id", .value = try at_workspace.constant(u64, 1) }, .{ .name = "answer", .value = started } });
        const driver = try c.function("service retained investigation", &.{ .{ .name = "task", .schema = try e.schema(t.Task) }, .{ .name = "state", .schema = inquiry.types.state } }, try e.schema(t.Report), effects);
        const dispatch = try c.body(driver);
        const dispatch_task = try dispatch.parameter("task");
        const projected = try dispatch.call(inquiry.project, &.{.{ .name = "state", .value = try dispatch.parameter("state") }});
        const parts = try dispatch.destructure(projected);
        const retained = try parts.get("state");
        const views = try parts.get("views");
        const selected = try dispatch.sequenceGet(views, try dispatch.constant(u64, 0));
        const done = try dispatch.caseOf(selected, "none");
        const pending = try dispatch.caseOf(selected, "some");
        const wait = pending.body();
        const view = pending.payload();
        const demand = try wait.field(view, "demand");
        const clarification = try wait.caseOf(demand, "clarification");
        const question = clarification.body();
        const question_value = clarification.payload();
        const inbound = try e.place(question, try question.field(dispatch_task, "human"), try question.field(question_value, "remaining_moves"));
        const home = try question.caseOf(inbound, "Ready");
        const away = try question.caseOf(inbound, "Failed");
        const origin = home.body();
        const human = try origin.perform(human_op, question_value);
        const response = try origin.variant(try e.schema(t.Reply), "clarification", try origin.product(try e.schema(t.ClarificationReply), &.{ .{ .name = "answer", .value = human }, .{ .name = "remaining_moves", .value = try origin.field(home.payload(), "remaining_moves") } }));
        _ = try away.body().call(inquiry.finish, &.{.{ .name = "state", .value = retained }});
        const answered = try question.match(inbound, &.{ try home.ret(response), try away.fail(try e.schema(t.Reply), try e.literal(away.body(), t.Failure, .placement_failed)) });
        const review = try wait.caseOf(demand, "review");
        const reviewer = review.body();
        const reviewed = try reviewer.call(complete.function, &.{ .{ .name = "task", .value = dispatch_task }, .{ .name = "finding", .value = review.payload() } });
        const reply = try wait.match(demand, &.{ try clarification.ret(answered), try review.ret(try reviewer.variant(try e.schema(t.Reply), "review", reviewed)) });
        const resumed = try wait.call(inquiry.distribute, &.{ .{ .name = "state", .value = retained }, .{ .name = "ids", .value = try wait.sequenceValue(inquiry.types.ids, &.{try wait.field(view, "generation")}) }, .{ .name = "reply", .value = reply } });
        const pending_result = try wait.call(driver, &.{ .{ .name = "task", .value = dispatch_task }, .{ .name = "state", .value = resumed } });
        const finished = done.body();
        const findings = try finished.call(inquiry.finish, &.{.{ .name = "state", .value = retained }});
        const found = try finished.variantPayload(try finished.sequenceGet(findings, try finished.constant(u64, 0)), "some", failure);
        const finding = try finished.field(found, "finding");
        const report = try finished.product(try e.schema(t.Report), &.{ .{ .name = "task_id", .value = try finished.field(dispatch_task, "task_id") }, .{ .name = "generation", .value = try finished.field(dispatch_task, "generation") }, .{ .name = "mode", .value = try finished.field(dispatch_task, "mode") }, .{ .name = "remaining_moves", .value = try finished.field(finding, "remaining_moves") }, .{ .name = "findings", .value = findings }, .{ .name = "proposal", .value = try finished.field(finding, "proposal") }, .{ .name = "publication", .value = try finished.field(finding, "publication") } });
        try c.define(driver, try dispatch.ret(try dispatch.match(selected, &.{ try pending.ret(pending_result), try done.ret(report) })));
        const completed = try at_workspace.call(driver, &.{ .{ .name = "task", .value = task }, .{ .name = "state", .value = parked } });
        try c.define(entry, try body.ret(try body.match(outbound, &.{ try arrived.ret(completed), try refused.fail(try e.schema(t.Report), try e.literal(refused.body(), t.Failure, .placement_failed)) })));
        const admitted = try c.function("admit repository task", &.{.{ .name = "task", .schema = try e.schema(t.Task) }}, try e.schema(t.Report), effects);
        const admission = try c.body(admitted);
        const supplied = try admission.parameter("task");
        var valid = try admission.less(try admission.constant(u64, 0), try admission.field(supplied, "task_id"));
        valid = try admission.select(valid, try admission.less(try admission.constant(u64, 0), try admission.field(supplied, "generation")), try admission.constant(bool, false));
        inline for (.{ "goal", "repository", "base", "initial_path" }) |name| {
            const present = try admission.less(try admission.constant(u64, 0), try admission.blobLength(try admission.field(supplied, name)));
            valid = try admission.select(valid, present, try admission.constant(bool, false));
        }
        inline for (.{ "maximum_steps", "maximum_checks" }) |name| {
            const amount = try admission.field(supplied, name);
            valid = try admission.select(valid, try admission.less(try admission.constant(u16, 0), amount), try admission.constant(bool, false));
            valid = try admission.select(valid, try admission.less(amount, try admission.constant(u16, 65)), try admission.constant(bool, false));
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
        return c.module(if (session) try sessionEntry(e, admitted, effects) else admitted, try e.schema(t.Failure));
    }
};

fn sessionEntry(e: Emit, task_entry: *const a.Function, task_effects: []const *const a.Operation) !*const a.Function {
    const c = e.c;
    const failure = try a.interop.literalFailure(c, try e.agent_context.literal(t.Failure, .invalid_task), try e.schema(t.Failure));
    const next = try e.external(t.NEXT_TASK, t.NextTask, t.NextTaskAnswer, .interaction);
    const effects = try e.agent_context.builder.allocator().alloc(*const a.Operation, task_effects.len + 1);
    @memcpy(effects[0..task_effects.len], task_effects);
    effects[task_effects.len] = next;
    const loop = try c.function("repository session", &.{ .{ .name = "task", .schema = try e.schema(t.Task) }, .{ .name = "remaining", .schema = try e.schema(u16) } }, try e.schema(t.Report), effects);
    const body = try c.body(loop);
    const task = try body.parameter("task");
    const remaining = try body.parameter("remaining");
    const report = try body.call(task_entry, &.{.{ .name = "task", .value = task }});
    const more = try body.branch();
    const done = try body.branch();
    const generation = try more.checkedAdd(try more.field(task, "generation"), try more.constant(u64, 1), failure);
    const answer = try more.perform(next, try more.product(try e.schema(t.NextTask), &.{
        .{ .name = "report", .value = report },                                                                                      .{ .name = "next_generation", .value = generation },
        .{ .name = "maximum_steps", .value = try more.field(task, "maximum_steps") },                                                .{ .name = "maximum_checks", .value = try more.field(task, "maximum_checks") },
        .{ .name = "maximum_moves", .value = try more.field(try more.field(try more.field(task, "workspace"), "budget"), "moves") },
    }));
    const stop = try more.caseOf(answer, "stop");
    const start = try more.caseOf(answer, "start");
    const again = start.body();
    var fields: [@typeInfo(t.Task).@"struct".field_names.len]a.Argument = undefined;
    inline for (@typeInfo(t.Task).@"struct".field_names, 0..) |name, i| fields[i] = .{ .name = name, .value = if (comptime std.mem.eql(u8, name, "generation")) generation else if (comptime std.mem.eql(u8, name, "goal") or std.mem.eql(u8, name, "mode")) try again.field(start.payload(), name) else try again.field(task, name) };
    const fresh = try again.product(try e.schema(t.Task), &fields);
    const repeated = try again.call(loop, &.{ .{ .name = "task", .value = fresh }, .{ .name = "remaining", .value = try again.checked(.subtract, remaining, try again.constant(u16, 1), .{ .overflow = failure }) } });
    const selected = try more.match(answer, &.{ try stop.ret(report), try start.ret(repeated) });
    try c.define(loop, try body.ret(try body.conditional(try body.less(try body.constant(u16, 1), remaining), try more.ret(selected), try done.ret(report))));
    const entry = try c.function("start repository session", &.{.{ .name = "session", .schema = try e.schema(t.Session) }}, try e.schema(t.Report), effects);
    const initial = try c.body(entry);
    const supplied = try initial.parameter("session");
    const maximum = try initial.field(supplied, "maximum_tasks");
    const template = try initial.field(supplied, "task");
    inline for (@typeInfo(t.Task).@"struct".field_names, 0..) |name, i| fields[i] = .{ .name = name, .value = if (comptime std.mem.eql(u8, name, "generation")) try initial.constant(u64, 1) else try initial.field(template, name) };
    const first = try initial.product(try e.schema(t.Task), &fields);
    const accepted = try initial.branch();
    const rejected = try initial.branch();
    const valid = try initial.select(try initial.less(try initial.constant(u16, 0), maximum), try initial.less(maximum, try initial.constant(u16, 17)), try initial.constant(bool, false));
    const result = try accepted.call(loop, &.{ .{ .name = "task", .value = first }, .{ .name = "remaining", .value = maximum } });
    try c.define(entry, try initial.ret(try initial.conditional(valid, try accepted.ret(result), try rejected.fail(try e.schema(t.Report), try e.literal(rejected, t.Failure, .invalid_task)))));
    return entry;
}

pub fn main(init: std.process.Init) !void {
    var args = init.minimal.args.iterate();
    _ = args.next();
    const mode = args.next() orelse "image";
    inline for (.{ .{ "session", t.Session }, .{ "next-task", t.NextTask }, .{ "next-task-answer", t.NextTaskAnswer }, .{ "task", t.Task }, .{ "report", t.Report }, .{ "snapshot-request", t.SnapshotRequest }, .{ "snapshot", t.Snapshot }, .{ "read", t.ReadRequest }, .{ "evidence", t.Evidence }, .{ "question", t.Question }, .{ "answer", t.Answer }, .{ "cleanup", t.Cleanup }, .{ "unit", void } }) |item| {
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
    inline for (.{ .{ "model-request", model.P.ReplayRequest }, .{ "model-result", model.P.ReplayResult }, .{ "candidate-preparation", t.Preparation }, .{ "publication-preparation", publication.Preparation }, .{ "review", t.ReviewInput }, .{ "review-answer", t.ReviewAnswer } }) |item| {
        if (std.mem.eql(u8, mode, item[0])) {
            var b = boundary.source.Builder.init(init.gpa);
            defer b.deinit();
            const schema = try agent.contracts.schema(item[1], &b);
            const bytes = try boundary.data.schema.encodeOwned(init.gpa, b.schemas.items, schema);
            defer init.gpa.free(bytes);
            return write(init, bytes);
        }
    }
    if (!std.mem.eql(u8, mode, "image") and !std.mem.eql(u8, mode, "session-image")) return error.InvalidMode;
    var compiled = if (std.mem.eql(u8, mode, "session-image")) try agent.compile(init.gpa, SessionSystem) else try agent.compile(init.gpa, System);
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
