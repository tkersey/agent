//! Single-trajectory comparator. Ordinary working state and reusable observations,
//! using the same model proposals, admission, evaluator and live delivery boundary.
const std = @import("std");
const agent = @import("agent");
const boundary = @import("boundary");
const t = @import("types.zig");
const s = @import("source.zig");
const E = s.E;
const Id = s.Id;
const Pop = @import("plans.zig").Pop;
const Text = agent.contracts.Text(4096);
const State = struct {
    task: t.Task,
    working: t.Working,
    version: u64,
    records: []const t.Record,
    passes: u64,
    acquisitions: u64,
    reuse: u64,
    demands: u64,
    status: u8,
    candidate: ?t.Candidate,
};
const Action = struct { state: State, plan: t.Plan };
pub const System = agent.system(.{ .InitialArgs = t.Task, .Result = t.Result, .Failure = void, .application = Application });

const Application = struct {
    pub fn emit(c: agent.Context) !boundary.computation.Module {
        const e = E{ .c = c };
        const b = c.builder;
        const model = try t.P.declare(b);
        try c.registry.classify(model, .model);
        const d = try agent.inquiry.broker.define(b, .{
            .identity = "inquiry.repair",
            .subject = try e.schema(t.Subject),
            .demand = try e.schema(t.Demand),
            .key = try e.schema(t.Key),
            .observation = try e.schema(t.Observation),
            .finding = try e.schema(t.Finding),
            .policy = try e.schema(bool),
            .failure = try e.value(void, {}),
        });
        try c.registry.classify(d.experiment, .write);
        const rows = &.{ model, d.experiment };
        const step = try agent.react.step(b, try e.schema(Action), try e.schema(t.InquiryOutcome));
        const decide = try b.declare(&.{try e.schema(State)}, step.schema, &.{model}, &.{});
        const execute = try b.declare(&.{try e.schema(Action)}, try e.schema(State), &.{d.experiment}, &.{});
        const fold = try b.declare(&.{ try e.schema(State), try e.schema(State) }, try e.schema(State), &.{}, &.{});
        const g: G = .{ .e = e, .d = d, .step = step, .decide = decide, .execute = execute, .model = try @import("models.zig").directModel(e), .parse = try @import("plans.zig").define(e), .admit = try @import("policy.zig").admit(e, d), .observe = try @import("policy.zig").observationAdmission(e), .summary = try @import("evidence.zig").summary(e), .cache = try cache(e, d) };
        try b.define(decide, try g.decision());
        try b.define(execute, try g.execution());
        try b.define(fold, try b.pure(try e.p(fold, 1)));
        const decision = try e.lambda(decide, &.{try e.schema(State)}, step.schema, &.{model}, &.{});
        const execution = try e.lambda(execute, &.{try e.schema(Action)}, try e.schema(State), &.{d.experiment}, &.{});
        const folding = try e.lambda(fold, &.{ try e.schema(State), try e.schema(State) }, try e.schema(State), &.{}, &.{});
        const loop = try agent.react.define(b, .{ .state = try e.schema(State), .step = step, .observation = try e.schema(State), .decide = b.values.items[decision].schema, .execute = b.values.items[execution].schema, .fold = b.values.items[folding].schema, .residual = .{ .effects = rows } });
        const live = try @import("live.zig").define(e);
        const run = try b.declare(&.{try e.schema(t.Task)}, try e.schema(t.Result), try e.row(rows, live.effects), &.{});
        const task = try e.p(run, 0);
        // Match the inquiry's total allowed investigator calls, with one initial
        // call's allowance. These are application counters, not World fuel.
        const count = try b.primitive(try e.schema(u64), .integer_convert, &.{try e.field(u8, task, 2)}, 0);
        const calls = try e.arithmetic(.integer_add, try e.arithmetic(.integer_mul, count, try e.field(u64, task, 4)), try e.value(u64, 1));
        const working = try e.product(t.Working, &.{
            try e.value(t.Reason, .{ .bytes = "Single-trajectory ReAct: consider competing explanations and revise the current account as evidence changes." }),
            try e.value(u64, 0),
            try e.value(Text, .{ .bytes = "No evidence yet. Propose a discriminating trace, repair, revision or honest stop." }),
            calls,
            try e.value(t.Source, .{ .bytes = "" }),
        });
        const initial = try e.product(State, &.{ task, working, try e.value(u64, 1), try e.value([]const t.Record, &.{}), try e.field(u64, task, 3), try e.value(u64, 0), try e.value(u64, 0), try e.value(u64, 0), try e.value(u8, 0), try e.value(?t.Candidate, null) });
        const outcome = try b.variable(try e.schema(t.InquiryOutcome));
        const done = try b.bind(outcome, try agent.react.run(b, loop, initial, decision, execution, folding), try e.call(live.function, &.{ task, try e.ref(outcome) }));
        const invalid = try b.pure(try e.variant(t.Result, try e.value(t.Reason, .{ .bytes = "Unsupported task scope, requirements or allowance." }), 1));
        try b.define(run, try @import("main.zig").admitTask(e, task, done, invalid));
        const normalized = try @import("main.zig").intentEntry(e, run);
        const entry = try b.declare(&.{try e.schema(t.Task)}, try e.schema(t.Result), b.functions.items[normalized].effects, &.{});
        try b.define(entry, try e.call(normalized, &.{ try e.p(entry, 0), try e.value(u64, 1) }));
        return b.module(entry, try e.schema(void));
    }
};

fn replace(e: E, comptime T: type, value: Id, comptime field_index: usize, item: Id) !Id {
    var fields: [std.meta.fields(T).len]Id = undefined;
    inline for (std.meta.fields(T), 0..) |field, i| fields[i] = if (i == field_index) item else try e.field(field.type, value, i);
    return e.product(T, &fields);
}

fn cache(e: E, d: agent.inquiry.broker.Definition) !Id {
    const b = e.b();
    const f = try b.declare(&.{ try e.schema([]const t.Record), try e.schema(t.Key) }, try e.schema(?t.Record), &.{}, &.{});
    const pop = try Pop.init(e, []const t.Record, t.Record);
    const same = try b.variable(try e.schema(bool));
    const record = try e.ref(pop.head);
    const next = try e.call(f, &.{ try e.ref(pop.rest), try e.p(f, 1) });
    const present = try b.pure(try e.variant(?t.Record, record, 1));
    const matched = try b.bind(same, try e.call(d.key_equal, &.{ try e.field(t.Key, record, 1), try e.p(f, 1) }), try e.cond(try e.ref(same), present, next));
    try b.define(f, try pop.match(e, try e.p(f, 0), try b.pure(try e.value(?t.Record, null)), try e.cond(try e.field(bool, record, 3), matched, next)));
    return f;
}

const G = struct {
    e: E,
    d: agent.inquiry.broker.Definition,
    step: agent.react.Step,
    decide: Id,
    execute: Id,
    model: Id,
    parse: Id,
    admit: Id,
    observe: Id,
    summary: Id,
    cache: Id,

    fn finish(g: G, state: Id, status: Id) !Id {
        const e = g.e;
        const b = e.b();
        const some = try b.variable(try e.schema(t.Candidate));
        const none = try b.variable(try e.schema(void));
        const found = try e.product(t.Found, &.{ try e.value(u64, 1), try e.variant(t.Finding, try e.ref(some), 0) });
        const findings = try b.variable(try e.schema([]const t.Found));
        const outcome = try e.product(t.InquiryOutcome, &.{ status, try e.ref(findings), try e.field([]const t.Record, state, 3), try e.field(u64, state, 5), try e.field(u64, state, 6), try e.field(u64, state, 7) });
        const value = try b.term(.{ .match_sum = .{ .value = try e.field(?t.Candidate, state, 9), .cases = &.{
            .{ .variable = none, .body = try b.pure(try e.value([]const t.Found, &.{})) },
            .{ .variable = some, .body = try b.pure(try b.primitive(try e.schema([]const t.Found), .sequence, &.{found}, 0)) },
        } } });
        return b.bind(findings, value, try b.pure(try agent.react.finishWith(b, g.step, outcome)));
    }

    fn decision(g: G) !Id {
        const e = g.e;
        const b = e.b();
        const state = try e.p(g.decide, 0);
        const working = try e.field(t.Working, state, 1);
        const response = try b.variable(try e.schema(t.P.BatchInterpretation));
        const proposals = try b.variable(try e.schema([]const t.Answer));
        const failed = try b.variable(try e.schema(t.P.InterpretationFailure));
        const plan = try b.variable(try e.schema(t.Plan));
        const action = try e.product(Action, &.{ state, try e.ref(plan) });
        const proceed = try b.bind(plan, try e.call(g.parse, &.{try e.ref(proposals)}), try b.pure(try agent.react.continueWith(b, g.step, action)));
        const match = try b.term(.{ .match_sum = .{ .value = try e.ref(response), .cases = &.{
            .{ .variable = proposals, .body = proceed }, .{ .variable = failed, .body = try g.finish(state, try e.value(u8, 1)) },
        } } });
        const request = try b.bind(response, try e.call(g.model, &.{ try e.field(t.Task, state, 0), try e.value(u64, 1), try e.field(u64, state, 2), working, try e.value(bool, false) }), match);
        const remaining = try e.field(u64, working, 3);
        const status = try e.field(u8, state, 8);
        const terminal = try g.finish(state, status);
        const candidate = try b.variable(try e.schema(t.Candidate));
        const absent = try b.variable(try e.schema(void));
        const active = try e.cond(try e.eq(remaining, try e.value(u64, 0)), try g.finish(state, try e.value(u8, 2)), request);
        const ready = try b.term(.{ .match_sum = .{ .value = try e.field(?t.Candidate, state, 9), .cases = &.{
            .{ .variable = absent, .body = active }, .{ .variable = candidate, .body = terminal },
        } } });
        return e.cond(try e.eq(status, try e.value(u8, 0)), ready, terminal);
    }

    fn stopped(g: G, state: Id, status: u8) !Id {
        return g.e.b().pure(try replace(g.e, State, state, 8, try g.e.value(u8, status)));
    }

    fn execution(g: G) !Id {
        const e = g.e;
        const b = e.b();
        const action = try e.p(g.execute, 0);
        const old = try e.field(State, action, 0);
        const old_work = try e.field(t.Working, old, 1);
        const work = try replace(e, t.Working, old_work, 3, try e.arithmetic(.integer_sub, try e.field(u64, old_work, 3), try e.value(u64, 1)));
        const state = try replace(e, State, old, 1, work);
        const probe = try b.variable(try e.schema(t.Probe));
        const repair = try b.variable(try e.schema(t.Repair));
        const revision = try b.variable(try e.schema(t.Revision));
        const stop = try b.variable(try e.schema(t.Stop));
        const invalid = try b.variable(try e.schema(void));
        const revised = try replace(e, State, try replace(e, State, state, 1, try replace(e, t.Working, work, 0, try e.field(t.Reason, try e.ref(revision), 0))), 2, try e.arithmetic(.integer_add, try e.field(u64, state, 2), try e.value(u64, 1)));
        const id = try e.field(u64, work, 1);
        return b.term(.{ .match_sum = .{ .value = try e.field(t.Plan, action, 1), .cases = &.{
            .{ .variable = probe, .body = try g.acquire(state, try e.variant(t.Demand, try e.ref(probe), 0), null, try e.field(t.Prediction, try e.ref(probe), 1)) },
            .{ .variable = repair, .body = try e.cond(try e.eq(try e.field(u64, try e.ref(repair), 1), id), try g.acquire(state, try e.variant(t.Demand, try e.field(t.Source, try e.ref(repair), 0), 1), try e.field(t.Source, try e.ref(repair), 0), null), try g.stopped(state, 1)) },
            .{ .variable = revision, .body = try e.cond(try e.eq(try e.field(u64, try e.ref(revision), 1), id), try b.pure(revised), try g.stopped(state, 1)) },
            .{ .variable = stop, .body = try g.stopped(state, 1) },
            .{ .variable = invalid, .body = try g.stopped(state, 1) },
        } } });
    }

    fn acquire(g: G, input: Id, demand: Id, candidate: ?Id, prediction: ?Id) !Id {
        const e = g.e;
        const b = e.b();
        const state = try replace(e, State, try replace(e, State, input, 4, try e.arithmetic(.integer_sub, try e.field(u64, input, 4), try e.value(u64, 1))), 7, try e.arithmetic(.integer_add, try e.field(u64, input, 7), try e.value(u64, 1)));
        const subject = try e.field(t.Subject, try e.field(t.Task, state, 0), 0);
        const admission = try b.variable(g.d.types.admission);
        const admitted = try b.variable(g.d.types.admitted);
        const denied = try b.variable(try e.schema(void));
        const retire = try b.variable(try e.schema(void));
        const key = try b.primitive(try e.schema(t.Key), .field, &.{try e.ref(admitted)}, 0);
        const reusable = try b.primitive(try e.schema(bool), .field, &.{try e.ref(admitted)}, 1);
        const found = try b.variable(try e.schema(?t.Record));
        const record = try b.variable(try e.schema(t.Record));
        const absent = try b.variable(try e.schema(void));
        const actual = try g.perform(state, subject, key, demand, reusable, candidate, prediction);
        const cached_state = try replace(e, State, state, 6, try e.arithmetic(.integer_add, try e.field(u64, state, 6), try e.value(u64, 1)));
        const cache_match = try b.term(.{ .match_sum = .{ .value = try e.ref(found), .cases = &.{
            .{ .variable = absent, .body = actual }, .{ .variable = record, .body = try g.observed(cached_state, try e.ref(record), candidate, prediction) },
        } } });
        const lookup = try b.bind(found, try e.call(g.cache, &.{ try e.field([]const t.Record, state, 3), key }), cache_match);
        const select = try b.term(.{ .match_sum = .{ .value = try e.ref(admission), .cases = &.{
            .{ .variable = denied, .body = try g.stopped(state, 1) },
            .{ .variable = admitted, .body = try e.cond(reusable, lookup, actual) },
            .{ .variable = retire, .body = try g.stopped(state, 1) },
        } } });
        const allowed = try b.bind(admission, try e.call(g.admit, &.{ subject, demand }), select);
        return e.cond(try e.eq(try e.field(u64, input, 4), try e.value(u64, 0)), try g.stopped(input, 2), allowed);
    }

    fn perform(g: G, old: Id, subject: Id, key: Id, demand: Id, reusable: Id, candidate: ?Id, prediction: ?Id) !Id {
        const e = g.e;
        const b = e.b();
        const occurrence = try e.arithmetic(.integer_add, try e.field(u64, old, 5), try e.value(u64, 1));
        const state = try replace(e, State, old, 5, occurrence);
        const envelope = try b.variable(g.d.types.envelope);
        const result = try e.ref(envelope);
        const observed_subject = try b.primitive(try e.schema(t.Subject), .field, &.{result}, 0);
        const observed_key = try b.primitive(try e.schema(t.Key), .field, &.{result}, 1);
        const observed_id = try b.primitive(try e.schema(u64), .field, &.{result}, 2);
        const completion = try b.primitive(g.d.types.completion, .field, &.{result}, 3);
        const observation = try b.variable(try e.schema(t.Observation));
        const inconclusive = try b.variable(try e.schema(void));
        const unavailable = try b.variable(try e.schema(void));
        const accepted = try b.variable(try e.schema(bool));
        const record = try e.product(t.Record, &.{ occurrence, key, try e.ref(observation), reusable });
        const recorded = try replace(e, State, state, 3, try b.primitive(try e.schema([]const t.Record), .sequence_append, &.{ try e.field([]const t.Record, state, 3), record }, 0));
        const admitted = try b.bind(accepted, try e.call(g.observe, &.{ subject, key, try e.ref(observation) }), try e.cond(try e.ref(accepted), try g.observed(recorded, record, candidate, prediction), try g.stopped(state, 4)));
        const work = try e.field(t.Working, state, 1);
        const attempted = if (candidate) |value| try replace(e, t.Working, work, 4, value) else work;
        const unknown_work = try replace(e, t.Working, attempted, 2, try e.value(Text, .{ .bytes = "Experiment inconclusive; no new observation was admitted." }));
        const unknown = try b.pure(try replace(e, State, state, 1, unknown_work));
        var next = try b.term(.{ .match_sum = .{ .value = completion, .cases = &.{
            .{ .variable = observation, .body = admitted },                .{ .variable = inconclusive, .body = unknown },
            .{ .variable = unavailable, .body = try g.stopped(state, 5) },
        } } });
        const invalid = try g.stopped(state, 4);
        next = try e.cond(try e.eq(observed_id, occurrence), next, invalid);
        for ([_][3]Id{ .{ g.d.key_equal, observed_key, key }, .{ g.d.subject_equal, observed_subject, subject } }) |pair| {
            const same = try b.variable(try e.schema(bool));
            next = try b.bind(same, try e.call(pair[0], &.{ pair[1], pair[2] }), try e.cond(try e.ref(same), next, invalid));
        }
        const request = try b.primitive(g.d.types.request, .product, &.{ subject, key, demand, occurrence }, 0);
        const performed = try b.term(.{ .perform = .{ .effect = g.d.experiment, .payload = request } });
        try e.c.registry.protectSite(g.execute, performed, g.d.experiment);
        return b.bind(envelope, performed, next);
    }

    fn observed(g: G, state: Id, record: Id, candidate: ?Id, prediction: ?Id) !Id {
        const e = g.e;
        const b = e.b();
        const observation = try e.field(t.Observation, record, 2);
        const id = try e.field(u64, record, 0);
        const report = try b.variable(try e.schema(Text));
        const previous = try e.field(t.Working, state, 1);
        const work = try e.product(t.Working, &.{ try e.field(t.Reason, previous, 0), id, try e.ref(report), try e.field(u64, previous, 3), candidate orelse try e.field(t.Source, previous, 4) });
        const updated = try replace(e, State, state, 1, work);
        var next = try b.pure(updated);
        if (candidate) |source| {
            const wrong = try b.variable(try e.schema(t.Rows));
            const checks = try b.variable(try e.schema(t.Checked));
            const subject = try e.field(t.Subject, try e.field(t.Task, state, 0), 0);
            const ready = try e.product(t.Candidate, &.{ source, id, try e.value(u64, 1), try e.field(u64, state, 2), try e.ref(checks), try e.field(t.Hash, subject, 4), try e.field(t.Hash, subject, 2), try e.field(t.Reason, previous, 0) });
            const saved = try replace(e, State, updated, 9, try e.variant(?t.Candidate, ready, 1));
            next = try b.term(.{ .match_sum = .{ .value = observation, .cases = &.{
                .{ .variable = wrong, .body = try g.stopped(state, 4) },
                .{ .variable = checks, .body = try e.cond(try e.field(bool, try e.ref(checks), 0), try b.pure(saved), next) },
            } } });
        }
        const predicted = prediction orelse try e.value(t.Prediction, .{ .step = 0, .field = .accepted, .expected = 1, .requirement = 0 });
        return b.bind(report, try e.call(g.summary, &.{ observation, predicted }), next);
    }
};
