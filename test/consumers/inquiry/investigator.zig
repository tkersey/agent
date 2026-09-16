//! One shared version body. Revision returns before its successor is started.
const agent = @import("agent");
const boundary = @import("boundary");
const t = @import("types.zig");
const s = @import("source.zig");
const Id = s.Id;
const E = s.E;

pub fn define(e: E, d: agent.inquiry.broker.Definition, model: Id, cleanup: Id) !Id {
    const b = e.b();
    const rows = &.{ model, cleanup, d.custody.dialogue.effect };
    const params = &.{ d.custody.dialogue.capability, try e.schema(t.Task), try e.schema(u64), try e.schema(u64), try e.schema(t.Working) };
    const version = try b.declare(params, try e.schema(t.VersionResult), rows, &.{});
    const driver = try b.declare(params, try e.schema(t.Finding), rows, &.{});
    const g: G = .{ .e = e, .d = d, .version = version, .model = try @import("models.zig").define(e), .parse = try @import("plans.zig").define(e), .summary = try @import("evidence.zig").summary(e) };
    try b.define(version, try g.body());
    const result = try b.variable(try e.schema(t.VersionResult));
    const done = try b.variable(try e.schema(t.Finding));
    const revised = try b.variable(try e.schema(t.Working));
    const revision = try e.call(driver, &.{ try e.p(driver, 0), try e.p(driver, 1), try e.p(driver, 2), try e.arithmetic(.integer_add, try e.p(driver, 3), try e.value(u64, 1)), try e.ref(revised) });
    const dispatch = try b.term(.{ .match_sum = .{ .value = try e.ref(result), .cases = &.{
        .{ .variable = done, .body = try b.pure(try e.ref(done)) },
        .{ .variable = revised, .body = revision },
    } } });
    try b.define(driver, try b.bind(result, try e.call(version, &.{ try e.p(driver, 0), try e.p(driver, 1), try e.p(driver, 2), try e.p(driver, 3), try e.p(driver, 4) }), dispatch));
    return start(e, d, driver, cleanup, rows);
}

fn start(e: E, d: agent.inquiry.broker.Definition, driver: Id, cleanup: Id, rows: []const Id) !Id {
    const b = e.b();
    const params = &.{ d.custody.dialogue.capability, try e.schema(t.Task), try e.schema(u64), try e.schema(t.Hypothesis) };
    const f = try b.declare(params, try e.schema(t.Finding), rows, &.{});
    const body = try b.declare(&.{}, try e.schema(t.Finding), rows, &.{});
    const task = try e.p(f, 1);
    const working = try e.product(t.Working, &.{
        try e.field(t.Reason, try e.p(f, 3), 0),                                                                      try e.value(u64, 0),
        try e.value(agent.contracts.Text(4096), .{ .bytes = "No observation yet. Propose a discriminating trace." }), try e.field(u64, task, 4),
        try e.value(t.Source, .{ .bytes = "" }),
    });
    try b.define(body, try e.call(driver, &.{ try e.p(f, 0), task, try e.p(f, 2), try e.value(u64, 1), working }));
    const exit = try boundary.library.cleanup.exitInfo(b, try e.schema(void));
    const release = try b.declare(&.{exit}, try e.schema(void), &.{cleanup}, &.{});
    try b.define(release, try b.term(.{ .perform = .{ .effect = cleanup, .payload = try e.p(f, 2) } }));
    try b.define(f, try b.term(.{ .protect = .{
        .body = try e.lambda(body, &.{}, try e.schema(t.Finding), rows, params),
        .cleanup = try e.lambda(release, &.{exit}, try e.schema(void), &.{cleanup}, &.{try e.schema(u64)}),
    } }));
    return e.lambda(f, params, try e.schema(t.Finding), rows, &.{});
}

const G = struct {
    e: E,
    d: agent.inquiry.broker.Definition,
    version: Id,
    model: Id,
    parse: Id,
    summary: Id,

    fn p(g: G, i: usize) !Id {
        return g.e.p(g.version, i);
    }
    fn remaining(g: G) !Id {
        return g.e.arithmetic(.integer_sub, try g.e.field(u64, try g.p(4), 3), try g.e.value(u64, 1));
    }
    fn unresolved(g: G, text: []const u8) !Id {
        const e = g.e;
        const finding = try e.variant(t.Finding, try e.value(t.Reason, .{ .bytes = text }), 1);
        return e.b().pure(try e.variant(t.VersionResult, finding, 0));
    }
    fn again(g: G, working: Id) !Id {
        return g.e.call(g.version, &.{ try g.p(0), try g.p(1), try g.p(2), try g.p(3), working });
    }
    fn makeWorking(g: G, explanation: Id, observation: Id, summary: Id, candidate: Id) !Id {
        return g.e.product(t.Working, &.{ explanation, observation, summary, try g.remaining(), candidate });
    }

    fn body(g: G) !Id {
        const e = g.e;
        const b = e.b();
        const response = try b.variable(try e.schema(t.P.BatchInterpretation));
        const proposals = try b.variable(try e.schema([]const t.Answer));
        const failure = try b.variable(try e.schema(t.P.InterpretationFailure));
        const plan = try b.variable(try e.schema(t.Plan));
        const interpreted = try b.bind(plan, try e.call(g.parse, &.{try e.ref(proposals)}), try g.dispatchPlan(try e.ref(plan)));
        const match = try b.term(.{ .match_sum = .{ .value = try e.ref(response), .cases = &.{
            .{ .variable = proposals, .body = interpreted },
            .{ .variable = failure, .body = try g.unresolved("Model proposal refused, malformed, unsupported or unavailable.") },
        } } });
        const modeled = try b.bind(response, try e.call(g.model, &.{ try g.p(1), try g.p(2), try g.p(3), try g.p(4), try e.value(bool, false) }), match);
        return e.cond(try e.eq(try e.field(u64, try g.p(4), 3), try e.value(u64, 0)), try g.unresolved("Investigation model allowance exhausted."), modeled);
    }

    fn dispatchPlan(g: G, plan: Id) !Id {
        const e = g.e;
        const b = e.b();
        const probe = try b.variable(try e.schema(t.Probe));
        const repair = try b.variable(try e.schema(t.Repair));
        const revise = try b.variable(try e.schema(t.Revision));
        const stop = try b.variable(try e.schema(t.Stop));
        const invalid = try b.variable(try e.schema(void));
        const w = try g.p(4);
        const current_id = try e.field(u64, w, 1);
        const wrong = try g.unresolved("Proposal cites a foreign observation.");
        const revised = try g.makeWorking(try e.field(t.Reason, try e.ref(revise), 0), current_id, try e.field(agent.contracts.Text(4096), w, 2), try e.field(t.Source, w, 4));
        const revision = try e.cond(try e.eq(try e.field(u64, try e.ref(revise), 1), current_id), try b.pure(try e.variant(t.VersionResult, revised, 1)), wrong);
        const retirement_reason = try b.variable(try e.schema(t.Reason));
        const reason = try e.ref(retirement_reason);
        const parked = try b.bind(retirement_reason, try b.pure(try e.field(t.Reason, try e.ref(stop), 0)), try b.bind(try b.variable(g.d.types.reply), try agent.inquiry.need(b, g.d.custody, try g.p(0), try e.variant(t.Demand, reason, 2)), try b.pure(try e.variant(t.VersionResult, try e.variant(t.Finding, reason, 1), 0))));
        const stopped = try e.cond(try e.eq(try e.field(u64, try e.ref(stop), 1), current_id), parked, wrong);
        const repairing = try e.cond(try e.eq(try e.field(u64, try e.ref(repair), 1), current_id), try g.offer(try e.variant(t.Demand, try e.field(t.Source, try e.ref(repair), 0), 1), try e.field(t.Source, try e.ref(repair), 0), null), wrong);
        return b.term(.{ .match_sum = .{ .value = plan, .cases = &.{
            .{ .variable = probe, .body = try g.offer(try e.variant(t.Demand, try e.ref(probe), 0), null, try e.field(t.Prediction, try e.ref(probe), 1)) },
            .{ .variable = repair, .body = repairing },
            .{ .variable = revise, .body = revision },
            .{ .variable = stop, .body = stopped },
            .{ .variable = invalid, .body = try g.unresolved("Invalid or mixed model plan.") },
        } } });
    }

    fn offer(g: G, demand: Id, candidate: ?Id, prediction: ?Id) !Id {
        const e = g.e;
        const b = e.b();
        const reply = try b.variable(g.d.types.reply);
        const record = try b.variable(g.d.types.record);
        const cached = try b.variable(g.d.types.record);
        const denied = try b.variable(try e.schema(void));
        const unknown = try b.variable(try e.schema(void));
        const w = try g.p(4);
        const inconclusive = try g.makeWorking(try e.field(t.Reason, w, 0), try e.field(u64, w, 1), try e.value(agent.contracts.Text(4096), .{ .bytes = "Experiment inconclusive. No observation was admitted." }), candidate orelse try e.field(t.Source, w, 4));
        const handled = try b.term(.{ .match_sum = .{ .value = try e.ref(reply), .cases = &.{
            .{ .variable = record, .body = try g.observed(try e.ref(record), candidate, prediction) },
            .{ .variable = denied, .body = try g.unresolved("Experiment denied by the application contract.") },
            .{ .variable = unknown, .body = try g.again(inconclusive) },
            .{ .variable = cached, .body = try g.observed(try e.ref(cached), candidate, prediction) },
        } } });
        return b.bind(reply, try agent.inquiry.need(b, g.d.custody, try g.p(0), demand), handled);
    }

    fn observed(g: G, record: Id, candidate: ?Id, prediction: ?Id) !Id {
        const e = g.e;
        const b = e.b();
        const observation = try e.field(t.Observation, record, 2);
        const id = try e.field(u64, record, 0);
        const report = try b.variable(try e.schema(agent.contracts.Text(4096)));
        const predicted = prediction orelse try e.value(t.Prediction, .{ .step = 0, .field = .accepted, .expected = 1, .requirement = 0 });
        const w = try g.p(4);
        const continued = try g.again(try g.makeWorking(try e.field(t.Reason, w, 0), id, try e.ref(report), candidate orelse try e.field(t.Source, w, 4)));
        var next = continued;
        if (candidate) |source| {
            const wrong = try b.variable(try e.schema(t.Rows));
            const check = try b.variable(try e.schema(t.Checked));
            const subject = try e.field(t.Subject, try e.field(t.Key, record, 1), 0);
            const ready = try e.product(t.Candidate, &.{ source, id, try g.p(2), try g.p(3), try e.ref(check), try e.field(t.Hash, subject, 4), try e.field(t.Hash, subject, 2), try e.field(t.Reason, w, 0) });
            const done = try b.pure(try e.variant(t.VersionResult, try e.variant(t.Finding, ready, 0), 0));
            next = try b.term(.{ .match_sum = .{ .value = observation, .cases = &.{
                .{ .variable = wrong, .body = try g.unresolved("Wrong observation kind for candidate validation.") },
                .{ .variable = check, .body = try e.cond(try e.field(bool, try e.ref(check), 0), done, continued) },
            } } });
        }
        return b.bind(report, try e.call(g.summary, &.{ observation, predicted }), next);
    }
};
