//! Pure admission and interpretation of the finite session experiment surface.
const std = @import("std");
const agent = @import("agent");
const t = @import("types.zig");
const s = @import("source.zig");
const Pop = @import("plans.zig").Pop;
const Id = s.Id;
const E = s.E;
const Case = std.meta.Child(@FieldType(@FieldType(@import("boundary").computation.ast.Term, "match_sum"), "cases"));

pub fn define(e: E, d: agent.inquiry.broker.Definition) !agent.inquiry.broker.Functions {
    return .{ .admit = try admit(e, d), .select = try agent.inquiry.broker.defaultSelection(e.b(), .{
        .identity = "inquiry.repair",
        .subject = try e.schema(t.Subject),
        .demand = try e.schema(t.Demand),
        .key = try e.schema(t.Key),
        .observation = try e.schema(t.Observation),
        .finding = try e.schema(t.Finding),
        .policy = try e.schema(bool),
        .failure = try e.value(void, {}),
    }, d, try discriminator(e)), .finish = try finish(e, d), .observe = try observationAdmission(e) };
}

pub fn admit(e: E, d: agent.inquiry.broker.Definition) !Id {
    const b = e.b();
    const trace_valid = try traceValidator(e);
    const f = try b.declare(&.{ try e.schema(t.Subject), try e.schema(t.Demand) }, d.types.admission, &.{}, &.{});
    const subject = try e.p(f, 0);
    const probe = try b.variable(try e.schema(t.Probe));
    const candidate = try b.variable(try e.schema(t.Source));
    const retirement = try b.variable(try e.schema(t.Reason));
    const checked = try b.variable(try e.schema(bool));
    const denied = try b.pure(try b.primitive(d.types.admission, .variant, &.{try e.value(void, {})}, 0));
    const p = try e.ref(probe);
    const trace = try e.field(t.Trace, p, 0);
    const prediction = try e.field(t.Prediction, p, 1);
    const count = try b.primitive(try e.schema(u64), .sequence_length, &.{try e.field(@FieldType(t.Trace, "steps"), trace, 1)}, 0);
    const relevant = try e.less(try e.field(u8, prediction, 3), try e.value(u8, 8));
    const predicted = try e.less(try e.field(u64, prediction, 0), count);
    const probe_key = try e.product(t.Key, &.{ subject, try e.product(t.Experiment, &.{ try e.value(u8, 0), try e.value(t.Source, .{ .bytes = "" }), trace }) });
    var eligible = try admitted(e, d, probe_key, try e.field(bool, subject, 5), 1, 1);
    eligible = try e.cond(relevant, try e.cond(predicted, eligible, denied), denied);
    const selector = try b.primitive(try e.schema(u32), .enum_tag, &.{try e.field(t.Selector, prediction, 1)}, 0);
    const bounded_boolean = try e.cond(try e.less(try e.field(u64, prediction, 2), try e.value(u64, 2)), eligible, denied);
    eligible = try e.cond(try e.eq(selector, try e.value(u32, 1)), bounded_boolean, try e.cond(try e.eq(selector, try e.value(u32, 4)), bounded_boolean, try e.cond(try e.eq(selector, try e.value(u32, 6)), bounded_boolean, eligible)));
    const probing = try b.bind(checked, try e.call(trace_valid, &.{trace}), try e.cond(try e.ref(checked), eligible, denied));
    const validation_key = try e.product(t.Key, &.{ subject, try e.product(t.Experiment, &.{ try e.value(u8, 1), try e.ref(candidate), try e.value(t.Trace, .{ .mode = 0, .steps = .{ .items = &.{} } }) }) });
    const has_source = try e.less(try e.value(u64, 0), try b.primitive(try e.schema(u64), .blob_length, &.{try e.ref(candidate)}, 0));
    const validating = try e.cond(has_source, try admitted(e, d, validation_key, try e.value(bool, false), 0, 16), denied);
    const branch = try b.term(.{ .match_sum = .{
        .value = try e.p(f, 1),
        .cases = &.{ .{ .variable = probe, .body = probing }, .{ .variable = candidate, .body = validating }, .{ .variable = retirement, .body = try b.pure(try b.primitive(d.types.admission, .variant, &.{try e.value(void, {})}, 2)) } },
    } });
    try b.define(f, branch);
    return f;
}

fn admitted(e: E, d: agent.inquiry.broker.Definition, key: Id, reusable: Id, priority: u64, cost: u64) !Id {
    const value = try e.b().primitive(d.types.admitted, .product, &.{ key, reusable, try e.value(u64, priority), try e.value(u64, cost) }, 0);
    return e.b().pure(try e.b().primitive(d.types.admission, .variant, &.{value}, 1));
}

pub fn traceValidator(e: E) !Id {
    const b = e.b();
    const sequence = @FieldType(t.Trace, "steps");
    const scan = try b.declare(&.{ try e.schema(sequence), try e.schema([]const u64) }, try e.schema(bool), &.{}, &.{});
    const pop = try Pop.init(e, sequence, t.Step);
    const no = try b.pure(try e.value(bool, false));
    var cases: [std.meta.fields(t.Step).len]Case = undefined;
    inline for (std.meta.fields(t.Step), 0..) |field, i| {
        const v = try b.variable(try e.schema(field.type));
        const seen = try e.p(scan, 1);
        const added = try b.primitive(try e.schema([]const u64), .sequence_append, &.{ seen, try e.value(u64, i) }, 0);
        var next = try e.call(scan, &.{ try e.ref(pop.rest), added });
        if (i == 0) {
            const count = try b.primitive(try e.schema(u64), .sequence_length, &.{try e.field(@FieldType(t.Issue, "choices"), try e.ref(v), 1)}, 0);
            next = try e.cond(try e.less(try e.value(u64, 0), count), next, no);
        } else if (i == 1 or i == 2) {
            const ref = if (i == 1) try e.field(u64, try e.ref(v), 0) else try e.ref(v);
            const found = try b.variable(try e.schema(u64));
            const absent = try b.variable(try e.schema(void));
            next = try b.term(.{ .match_sum = .{
                .value = try e.index(u64, seen, ref),
                .cases = &.{ .{ .variable = absent, .body = no }, .{ .variable = found, .body = try e.cond(try e.eq(try e.ref(found), try e.value(u64, i - 1)), next, no) } },
            } });
        }
        cases[i] = .{ .variable = v, .body = next };
    }
    const body = try b.term(.{ .match_sum = .{ .value = try e.ref(pop.head), .cases = &cases } });
    try b.define(scan, try pop.match(e, try e.p(scan, 0), try b.pure(try e.value(bool, true)), body));
    const f = try b.declare(&.{try e.schema(t.Trace)}, try e.schema(bool), &.{}, &.{});
    const trace = try e.p(f, 0);
    const values = try e.field(sequence, trace, 1);
    const count = try b.primitive(try e.schema(u64), .sequence_length, &.{values}, 0);
    const checked = try e.call(scan, &.{ values, try e.value([]const u64, &.{}) });
    try b.define(f, try e.cond(try e.less(try e.field(u8, trace, 0), try e.value(u8, 2)), try e.cond(try e.less(try e.value(u64, 0), count), checked, no), no));
    return f;
}

fn discriminator(e: E) !Id {
    const b = e.b();
    const f = try b.declare(&.{ try e.schema(t.Demand), try e.schema(t.Demand) }, try e.schema(bool), &.{}, &.{});
    const a = try b.variable(try e.schema(t.Probe));
    const z = try b.variable(try e.schema(t.Probe));
    const ignore_a = try b.variable(try e.schema(t.Source));
    const ignore_z = try b.variable(try e.schema(t.Source));
    const retire_a = try b.variable(try e.schema(t.Reason));
    const retire_z = try b.variable(try e.schema(t.Reason));
    const no = try b.pure(try e.value(bool, false));
    const pa = try e.field(t.Prediction, try e.ref(a), 1);
    const pz = try e.field(t.Prediction, try e.ref(z), 1);
    const fa = try b.primitive(try e.schema(u32), .enum_tag, &.{try e.field(t.Selector, pa, 1)}, 0);
    const fz = try b.primitive(try e.schema(u32), .enum_tag, &.{try e.field(t.Selector, pz, 1)}, 0);
    const different = try b.primitive(try e.schema(bool), .boolean_not, &.{try e.eq(try e.field(u64, pa, 2), try e.field(u64, pz, 2))}, 0);
    // Distinct requirement labels alone do not make predictions discriminate.
    const compare = try e.cond(try e.eq(try e.field(u64, pa, 0), try e.field(u64, pz, 0)), try e.cond(try e.eq(fa, fz), try b.pure(different), no), no);
    const right = try b.term(.{ .match_sum = .{ .value = try e.p(f, 1), .cases = &.{
        .{ .variable = z, .body = compare },   .{ .variable = ignore_z, .body = no },
        .{ .variable = retire_z, .body = no },
    } } });
    try b.define(f, try b.term(.{ .match_sum = .{ .value = try e.p(f, 0), .cases = &.{
        .{ .variable = a, .body = right },     .{ .variable = ignore_a, .body = no },
        .{ .variable = retire_a, .body = no },
    } } }));
    return f;
}

fn finish(e: E, d: agent.inquiry.broker.Definition) !Id {
    const b = e.b();
    const scan = try b.declare(&.{try e.schema([]const t.Found)}, try e.schema(bool), &.{}, &.{});
    const pop = try Pop.init(e, []const t.Found, t.Found);
    const ready = try b.variable(try e.schema(t.Candidate));
    const unresolved = try b.variable(try e.schema(t.Reason));
    const body = try b.term(.{ .match_sum = .{
        .value = try e.field(t.Finding, try e.ref(pop.head), 1),
        .cases = &.{
            .{ .variable = ready, .body = try b.pure(try e.value(bool, true)) },
            .{ .variable = unresolved, .body = try e.call(scan, &.{try e.ref(pop.rest)}) },
        },
    } });
    try b.define(scan, try pop.match(e, try e.p(scan, 0), try b.pure(try e.value(bool, false)), body));
    const f = try b.declare(&.{ try e.schema(t.Subject), d.custody.types.findings }, try e.schema(bool), &.{}, &.{});
    try b.define(f, try e.call(scan, &.{try e.p(f, 1)}));
    return f;
}

pub fn observationAdmission(e: E) !Id {
    const b = e.b();
    const f = try b.declare(&.{ try e.schema(t.Subject), try e.schema(t.Key), try e.schema(t.Observation) }, try e.schema(bool), &.{}, &.{});
    const experiment = try e.field(t.Experiment, try e.p(f, 1), 1);
    const kind = try e.field(u8, experiment, 0);
    const rows = try b.variable(try e.schema(t.Rows));
    const checks = try b.variable(try e.schema(t.Checked));
    const no = try b.pure(try e.value(bool, false));
    const expected = try e.field(@FieldType(t.Trace, "steps"), try e.field(t.Trace, experiment, 2), 1);
    const count_equal = try e.eq(try b.primitive(try e.schema(u64), .sequence_length, &.{expected}, 0), try b.primitive(try e.schema(u64), .sequence_length, &.{try e.ref(rows)}, 0));
    const traced = try e.cond(try e.eq(kind, try e.value(u8, 0)), try b.pure(count_equal), no);
    const checked = try e.ref(checks);
    const failed = try e.field(u64, checked, 2);
    const consistent = try e.eq(try e.field(bool, checked, 0), try e.eq(failed, try e.value(u64, 0)));
    const accepted = try e.cond(try e.eq(try e.field(u64, checked, 1), try e.value(u64, 16)), try e.cond(try e.less(failed, try e.value(u64, 17)), try b.pure(consistent), no), no);
    const validated = try e.cond(try e.eq(kind, try e.value(u8, 1)), accepted, no);
    try b.define(f, try b.term(.{ .match_sum = .{ .value = try e.p(f, 2), .cases = &.{
        .{ .variable = rows, .body = traced }, .{ .variable = checks, .body = validated },
    } } }));
    return f;
}
