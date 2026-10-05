//! Review is an operation on a still-owned investigation. Questions return to
//! its suspended call site; only a terminal disposition permits its cleanup.
const agent = @import("agent");
const boundary = @import("boundary");
const a = boundary.authoring;
const t = @import("types.zig");
const p = @import("publication.zig");
const text_budget = @import("budget.zig");
const Emit = @import("emit.zig").Emit;
const V = *const a.Value;
pub const Definition = struct { function: *const a.Function, effects: []const *const a.Operation };
fn done(e: Emit, b: *a.Body, proposal: V, publication: V) !V {
    return b.variant(try e.schema(t.ReviewAction), "done", try b.product(try e.schema(t.ReviewOutcome), &.{ .{ .name = "proposal", .value = proposal }, .{ .name = "publication", .value = publication } }));
}
fn reply(e: Emit, b: *a.Body, action: V, moves: V) !V {
    return b.product(try e.schema(t.ReviewReply), &.{ .{ .name = "action", .value = action }, .{ .name = "remaining_moves", .value = moves } });
}
pub fn define(e: Emit, resolve: *const a.Operation, relocate: *const a.Operation) !Definition {
    const c = e.c;
    const ctx = e.agent_context;
    const failure_value = try ctx.literal(t.Failure, .placement_failed);
    const failure = try a.interop.literalFailure(c, failure_value, try e.schema(t.Failure));
    const prepare = try e.external("agent.repository.proposal.v1", p.Preparation, p.Proposal, .write);
    const review = try e.external("agent.repository.review.v1", t.ReviewInput, t.ReviewAnswer, .interaction);
    const initial_effects = &.{ prepare, review, resolve, relocate };
    const f = try c.function("review repository candidate", &.{ .{ .name = "task", .schema = try e.schema(t.Task) }, .{ .name = "review", .schema = try e.schema(t.ReviewDemand) } }, try e.schema(t.ReviewReply), initial_effects);
    const b = try c.body(f);
    const task = try b.parameter("task");
    const demand = try b.parameter("review");
    const finding = try b.field(demand, "finding");
    const candidate = try b.field(finding, "candidate");
    const changed = try b.branch();
    const unchanged = try b.branch();
    const input = try changed.product(try e.schema(p.Preparation), &.{ .{ .name = "candidate", .value = candidate }, .{ .name = "validation", .value = try changed.field(finding, "validation") }, .{ .name = "task_id", .value = try changed.field(task, "task_id") }, .{ .name = "generation", .value = try changed.field(task, "generation") } });
    const prepared = try ctx.builder.term(.{ .perform = .{ .effect = try a.interop.operationId(c, prepare), .payload = try a.interop.valueId(changed, input) } });
    try ctx.registry.protectSite(try a.interop.functionId(c, f), prepared, try a.interop.operationId(c, prepare));
    const materialized = try b.conditional(try b.less(try b.constant(u64, 0), try b.blobLength(candidate)), try changed.ret(try a.interop.term(changed, prepared, try e.schema(p.Proposal))), try unchanged.ret(try e.literal(unchanged, p.Proposal, .{ .bytes = "" })));
    const publish_mode = try b.equal(try b.enumTag(try b.field(task, "mode")), try b.constant(u32, 2));
    const allowed = try b.select(publish_mode, try b.less(try b.constant(u64, 0), try b.blobLength(materialized)), try b.constant(bool, false));
    // Reserve the complete typed reply before asking or publishing. Capacity
    // failure must not occur after a successful write merely to fit its receipt.
    const reserve = try b.select(allowed, try b.constant(u64, p.Receipt.max_length.?), try b.constant(u64, t.Answer.max_length.?));
    const held = try text_budget.add(e, b, try b.field(demand, "retained_text_bytes"), try b.blobLength(materialized));
    const proposal = try text_budget.admit(e, b, p.Proposal, materialized, try text_budget.add(e, b, held, reserve));
    const home = try b.variantPayload(try e.place(b, try b.field(task, "human"), try b.field(finding, "remaining_moves")), "Ready", failure);
    const moves = try b.field(home, "remaining_moves");
    const publish = try b.branch();
    const present = try b.branch();
    const region = try c.region();
    const cell_schema = try c.cell(region, try c.scalar(u32));
    const cell_variable = try ctx.builder.variable(try a.interop.schemaId(c, cell_schema));
    const workspace = try b.field(task, "workspace");
    const budget = try b.field(workspace, "budget");
    const placement = try b.product(try e.schema(agent.mobility.EnsureInput), &.{
        .{ .name = "placement", .value = try b.field(workspace, "placement") },
        .{ .name = "placement_intent_id", .value = try b.field(workspace, "placement_intent_id") },
        .{ .name = "export_policy_ref", .value = try b.field(workspace, "export_policy_ref") },
        .{ .name = "budget", .value = try b.product(try e.schema(agent.mobility.Budget), &.{ .{ .name = "moves", .value = moves }, .{ .name = "attempts", .value = try b.field(budget, "attempts") } }) },
    });
    const gate = try p.defineRetained(ctx, try a.interop.valueId(b, try b.field(task, "principal")), try a.interop.valueId(b, placement), failure_value, .{ .cell = try ctx.builder.reference(cell_variable), .region = try a.interop.regionId(c, region) });
    const row = try (boundary.source.Row{ .effects = gate.effects }).unionWith(ctx.builder.allocator(), .{ .effects = &.{ try a.interop.operationId(c, prepare), try a.interop.operationId(c, review) } });
    ctx.builder.functions.items[@intCast(try a.interop.functionId(c, f))].effects = row.effects;
    const effects = try ctx.builder.allocator().alloc(*const a.Operation, row.effects.len);
    for (row.effects, effects) |id, *op| op.* = try a.interop.operation(c, id);
    const body_schema = try c.regionBodySchema(region, &.{}, try e.schema(t.ReviewReply), effects, .{ .use = .reusable, .captures = &.{ try e.schema(t.Task), try e.schema(p.Proposal), try c.scalar(u32), try e.schema(agent.mobility.EnsureInput), try c.scalar(u64) } });
    const inside_fn = try c.functionFor("retain approval movement", body_schema);
    const inside = try publish.closureBody(inside_fn);
    const cell = try inside.newCell(cell_schema, try inside.parameter("region"), moves);
    const approval = try agent.approval.approveAndCommit(ctx, gate, try a.interop.functionId(c, inside_fn), try a.interop.valueId(inside, proposal));
    const approved = try a.interop.term(inside, try ctx.builder.bind(cell_variable, try ctx.builder.pure(try a.interop.valueId(inside, cell)), approval), try e.schema(p.Result));
    const returned = try inside.variantPayload(try e.place(inside, try inside.field(task, "human"), try inside.readCell(cell)), "Ready", failure);
    var results: [4]*const a.FinishedCase = undefined;
    inline for (.{ "delivered", "declined", "invalid", "denied" }, 0..) |name, i| {
        const branch = try inside.caseOf(approved, name);
        const body = branch.body();
        var action: V = undefined;
        if (i == 1) {
            var reasons: [3]*const a.FinishedCase = undefined;
            inline for (.{ "decline", "question", "amend" }, 0..) |reason, n| {
                const reason_case = try body.caseOf(branch.payload(), reason);
                const selected = reason_case.body();
                reasons[n] = try reason_case.ret(if (n == 0) try done(e, selected, proposal, try selected.variant(try e.schema(t.Publication), "approval", approved)) else try selected.variant(try e.schema(t.ReviewAction), reason, reason_case.payload()));
            }
            action = try body.match(branch.payload(), &reasons);
        } else action = try done(e, body, proposal, try body.variant(try e.schema(t.Publication), "approval", approved));
        results[i] = try branch.ret(try reply(e, body, action, try body.field(returned, "remaining_moves")));
    }
    try c.define(inside_fn, try inside.ret(try inside.match(approved, &results)));
    const result = try publish.withRegion(region, try publish.lambda(inside_fn, body_schema), &.{});
    const answer = try present.perform(review, try present.product(try e.schema(t.ReviewInput), &.{ .{ .name = "task_id", .value = try present.field(task, "task_id") }, .{ .name = "generation", .value = try present.field(task, "generation") }, .{ .name = "mode", .value = try present.field(task, "mode") }, .{ .name = "summary", .value = try present.field(finding, "answer") }, .{ .name = "proposal", .value = proposal } }));
    var answers: [4]*const a.FinishedCase = undefined;
    inline for (.{ "finish", "decline", "question", "amend" }, 0..) |name, i| {
        const branch = try present.caseOf(answer, name);
        const body = branch.body();
        answers[i] = try branch.ret(try reply(e, body, if (i < 2) try done(e, body, proposal, try body.variant(try e.schema(t.Publication), "none", try body.constant(void, {}))) else try body.variant(try e.schema(t.ReviewAction), name, branch.payload()), moves));
    }
    const summary = try present.match(answer, &answers);
    try c.define(f, try b.ret(try b.conditional(allowed, try publish.ret(result), try present.ret(summary))));
    return .{ .function = f, .effects = effects };
}
