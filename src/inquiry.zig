//! Resumable inquiry custody, authored as ordinary Boundary computations.
//! Application callbacks never receive the owning queue. All source allocations
//! belong to the caller's Builder; runtime custody belongs to the emitted terms.
const boundary = @import("boundary");
const source = boundary.computation;
const dialogue = @import("dialogue.zig");
const Id = source.Id;
const Builder = source.Builder;
pub const broker = @import("inquiry_broker.zig");

pub const Spec = struct {
    identity: []const u8,
    demand: Id,
    reply: Id,
    finding: Id,
    failure: Id,
    scope: dialogue.Scope = .{},
};

pub const Types = struct {
    /// Ordinary (investigation occurrence, demand generation, demand).
    view: Id,
    views: Id,
    /// Internal (view, one owned package).
    waiting: Id,
    queue: Id,
    /// Ordinary (investigation occurrence, finding).
    found: Id,
    findings: Id,
    /// Internal (queue, findings, next demand generation).
    state: Id,
    /// Internal (state, ordinary views).
    projected: Id,
    ids: Id,
};

pub const Definition = struct {
    dialogue: dialogue.Dialogue,
    types: Types,
    /// (state, program-owned investigation occurrence, dialogue answer) -> state.
    park: Id,
    /// Consuming state -> (state, ordinary views).
    project: Id,
    /// (state, fixed recipient generation IDs, ordinary reply) -> state.
    distribute: Id,
    /// (state, fixed recipient generation IDs) -> state; cleanup may suspend.
    retire: Id,
    /// Consume all remaining packages through disposal, then return findings.
    finish: Id,
};

/// A single generation counter belongs to the state and advances only at park.
/// Overflow follows the enclosing typed failure path; it never wraps. The
/// caller assigns investigation occurrences in authored code, independently of
/// model IDs. Demand generations remain authoritative for consuming operations.
pub fn define(b: *Builder, spec: Spec) source.Error!Definition {
    const cached = try b.specialization(Definition, "agent.inquiry.custody/v1", .{spec});
    if (cached.cached) |value| return value;
    const integer = try b.scalar(u64);
    const d = try dialogue.define(b, spec.identity, spec.demand, spec.reply, spec.finding, spec.scope);
    const view = try b.schema(.{ .product = &.{ integer, integer, spec.demand } });
    const waiting = try b.schema(.{ .product = &.{ view, d.package } });
    const queue = try b.schema(.{ .seq = waiting });
    const found = try b.schema(.{ .product = &.{ integer, spec.finding } });
    const findings = try b.schema(.{ .seq = found });
    const state = try b.schema(.{ .product = &.{ queue, findings, integer } });
    const views = try b.schema(.{ .seq = view });
    const t: Types = .{ .view = view, .views = views, .waiting = waiting, .queue = queue, .found = found, .findings = findings, .state = state, .projected = try b.schema(.{ .product = &.{ state, views } }), .ids = try b.schema(.{ .seq = integer }) };
    const e: Emit = .{ .b = b, .d = d, .t = t, .spec = spec, .integer = integer, .unit = try b.scalar(void) };
    const park = try e.parker();
    const contains = try e.membership();
    return cached.finish(b, .{
        .dialogue = d,
        .types = t,
        .park = park,
        .project = try e.projector(),
        .distribute = try e.delivery(park, contains, false),
        .retire = try e.delivery(park, contains, true),
        .finish = try e.finalizer(),
    });
}

pub fn empty(b: *Builder, definition: Definition) source.Error!Id {
    return b.primitive(definition.types.state, .product, &.{
        try b.primitive(definition.types.queue, .sequence, &.{}, 0),
        try b.primitive(definition.types.findings, .sequence, &.{}, 0),
        try b.constant(u64, 1),
    }, 0);
}

pub fn need(b: *Builder, definition: Definition, capability: Id, demand: Id) source.Error!Id {
    return dialogue.offer(b, definition.dialogue, capability, demand);
}

const Emit = struct {
    b: *Builder,
    d: dialogue.Dialogue,
    t: Types,
    spec: Spec,
    integer: Id,
    unit: Id,

    fn ref(e: Emit, variable: Id) source.Error!Id {
        return e.b.reference(variable);
    }
    fn param(e: Emit, function: Id, index: usize) source.Error!Id {
        return e.ref(e.b.parameter(function, index));
    }
    fn call(e: Emit, function: Id, arguments: []const Id) source.Error!Id {
        return e.b.term(.{ .call = .{ .function = function, .arguments = arguments } });
    }
    fn product(e: Emit, schema: Id, values: []const Id) source.Error!Id {
        return e.b.primitive(schema, .product, values, 0);
    }
    fn append(e: Emit, schema: Id, sequence: Id, item: Id) source.Error!Id {
        return e.b.primitive(schema, .sequence_append, &.{ sequence, item }, 0);
    }
    fn conditional(e: Emit, condition: Id, yes: Id, no: Id) source.Error!Id {
        return e.b.term(.{ .conditional = .{
            .condition = condition,
            .when_true = yes,
            .when_false = no,
        } });
    }
    fn equal(e: Emit, a: Id, b: Id) source.Error!Id {
        return e.b.primitive(try e.b.scalar(bool), .equal, &.{ a, b }, 0);
    }
    fn unpack(e: Emit, value: Id, variables: []const Id, body: Id) source.Error!Id {
        return e.b.term(.{ .unpack_product = .{
            .value = value,
            .variables = variables,
            .body = body,
        } });
    }
    fn field(e: Emit, schema: Id, value: Id, index: u64) source.Error!Id {
        return e.b.primitive(schema, .field, &.{value}, index);
    }
    fn increment(e: Emit, value: Id) source.Error!Id {
        return e.b.value(.{ .schema = e.integer, .expression = .{ .primitive = .{
            .opcode = .integer_add,
            .operands = &.{ value, try e.b.constant(u64, 1) },
            .failures = &.{.{ .kind = .arithmetic_overflow, .value = try e.b.failureLiteral(e.spec.failure) }},
        } } });
    }

    fn parker(e: Emit) source.Error!Id {
        const b = e.b;
        const f = try b.declare(&.{ e.t.state, e.integer, e.d.answer }, e.t.state, &.{}, e.spec.scope.borrowed_regions);
        const q = try b.variable(e.t.queue);
        const findings = try b.variable(e.t.findings);
        const generation = try b.variable(e.integer);
        const done = try b.variable(e.spec.finding);
        const awaiting = try b.variable(e.d.awaiting);
        const demand = try b.variable(e.spec.demand);
        const package = try b.variable(e.d.package);
        const id = try e.param(f, 1);
        const found = try e.product(e.t.found, &.{ id, try e.ref(done) });
        const completed = try b.pure(try e.product(e.t.state, &.{ try e.ref(q), try e.append(e.t.findings, try e.ref(findings), found), try e.ref(generation) }));
        const view = try e.product(e.t.view, &.{ id, try e.ref(generation), try e.ref(demand) });
        const waiting = try e.product(e.t.waiting, &.{ view, try e.ref(package) });
        const parked = try b.pure(try e.product(e.t.state, &.{
            try e.append(e.t.queue, try e.ref(q), waiting), try e.ref(findings),
            try e.increment(try e.ref(generation)),
        }));
        const answer = try b.term(.{ .match_sum = .{
            .value = try e.param(f, 2),
            .cases = &.{
                .{ .variable = done, .body = completed },
                .{ .variable = awaiting, .body = try e.unpack(try e.ref(awaiting), &.{ demand, package }, parked) },
            },
        } });
        try b.define(f, try e.unpack(try e.param(f, 0), &.{ q, findings, generation }, answer));
        return f;
    }

    fn membership(e: Emit) source.Error!Id {
        const b = e.b;
        const boolean = try b.scalar(bool);
        const f = try b.declare(&.{ e.t.ids, e.integer }, boolean, &.{}, &.{});
        const pop = try Pop.init(e, e.t.ids, e.integer);
        const next = try e.call(f, &.{ try e.ref(pop.rest), try e.param(f, 1) });
        const checked = try e.conditional(try e.equal(try e.ref(pop.head), try e.param(f, 1)), try b.pure(try b.constant(bool, true)), next);
        try b.define(f, try pop.match(e, try e.param(f, 0), try b.pure(try b.constant(bool, false)), checked));
        return f;
    }

    fn projector(e: Emit) source.Error!Id {
        const b = e.b;
        const projected_queue = try b.schema(.{ .product = &.{ e.t.queue, e.t.views } });
        const scan = try b.declare(&.{ e.t.queue, e.t.queue, e.t.views }, projected_queue, &.{}, e.spec.scope.borrowed_regions);
        const pop = try Pop.init(e, e.t.queue, e.t.waiting);
        const view = try b.variable(e.t.view);
        const package = try b.variable(e.d.package);
        const entry = try e.product(e.t.waiting, &.{ try e.ref(view), try e.ref(package) });
        const next = try e.call(scan, &.{ try e.ref(pop.rest), try e.append(e.t.queue, try e.param(scan, 1), entry), try e.append(e.t.views, try e.param(scan, 2), try e.ref(view)) });
        const nonempty = try e.unpack(try e.ref(pop.head), &.{ view, package }, next);
        try b.define(scan, try pop.match(e, try e.param(scan, 0), try b.pure(try e.product(projected_queue, &.{ try e.param(scan, 1), try e.param(scan, 2) })), nonempty));
        return e.projectEntry(scan, projected_queue);
    }

    fn projectEntry(e: Emit, scan: Id, projected_queue: Id) source.Error!Id {
        const b = e.b;
        const f = try b.declare(&.{e.t.state}, e.t.projected, &.{}, e.spec.scope.borrowed_regions);
        const q = try b.variable(e.t.queue);
        const findings = try b.variable(e.t.findings);
        const generation = try b.variable(e.integer);
        const scanned = try b.variable(projected_queue);
        const rebuilt = try b.variable(e.t.queue);
        const views = try b.variable(e.t.views);
        const result = try b.pure(try e.product(e.t.projected, &.{ try e.product(e.t.state, &.{ try e.ref(rebuilt), try e.ref(findings), try e.ref(generation) }), try e.ref(views) }));
        const body = try b.bind(scanned, try e.call(scan, &.{ try e.ref(q), try b.primitive(e.t.queue, .sequence, &.{}, 0), try b.primitive(e.t.views, .sequence, &.{}, 0) }), try e.unpack(try e.ref(scanned), &.{ rebuilt, views }, result));
        try b.define(f, try e.unpack(try e.param(f, 0), &.{ q, findings, generation }, body));
        return f;
    }

    fn delivery(e: Emit, park: Id, contains: Id, retire: bool) source.Error!Id {
        const b = e.b;
        const args = if (retire) &.{ e.t.queue, e.t.state, e.t.ids } else &.{ e.t.queue, e.t.state, e.t.ids, e.spec.reply };
        const scan = try b.declare(args, e.t.state, e.spec.scope.residual.effects, e.spec.scope.borrowed_regions);
        const pop = try Pop.init(e, e.t.queue, e.t.waiting);
        const view = try b.variable(e.t.view);
        const package = try b.variable(e.d.package);
        const matches = try b.variable(try b.scalar(bool));
        const selected = try e.deliverSelected(scan, park, pop.rest, view, package, retire);
        const kept = try e.keepWaiting(scan, pop.rest, view, package, retire);
        const test_id = try e.field(e.integer, try e.ref(view), 1);
        const test_term = try b.bind(matches, try e.call(contains, &.{ try e.param(scan, 2), test_id }), try e.conditional(try e.ref(matches), selected, kept));
        const nonempty = try e.unpack(try e.ref(pop.head), &.{ view, package }, test_term);
        try b.define(scan, try pop.match(e, try e.param(scan, 0), try b.pure(try e.param(scan, 1)), nonempty));
        return e.deliveryEntry(scan, retire);
    }

    fn recurse(e: Emit, scan: Id, rest: Id, state: Id, retire: bool) source.Error!Id {
        return e.call(scan, if (retire) &.{ try e.ref(rest), state, try e.param(scan, 2) } else &.{ try e.ref(rest), state, try e.param(scan, 2), try e.param(scan, 3) });
    }

    fn deliverSelected(e: Emit, scan: Id, park: Id, rest: Id, view: Id, package: Id, retire: bool) source.Error!Id {
        const b = e.b;
        if (retire) return b.bind(try b.variable(e.unit), try dialogue.dispose(b, e.d, try e.ref(package)), try e.recurse(scan, rest, try e.param(scan, 1), retire));
        const answer = try b.variable(e.d.answer);
        const state = try b.variable(e.t.state);
        const next = try e.recurse(scan, rest, try e.ref(state), retire);
        const saved = try b.bind(state, try e.call(park, &.{ try e.param(scan, 1), try e.field(e.integer, try e.ref(view), 0), try e.ref(answer) }), next);
        return b.bind(answer, try dialogue.resumeWith(b, e.d, try e.ref(package), try e.param(scan, 3)), saved);
    }

    fn keepWaiting(e: Emit, scan: Id, rest: Id, view: Id, package: Id, retire: bool) source.Error!Id {
        const b = e.b;
        const q = try b.variable(e.t.queue);
        const findings = try b.variable(e.t.findings);
        const generation = try b.variable(e.integer);
        const waiting = try e.product(e.t.waiting, &.{ try e.ref(view), try e.ref(package) });
        const state = try e.product(e.t.state, &.{ try e.append(e.t.queue, try e.ref(q), waiting), try e.ref(findings), try e.ref(generation) });
        return e.unpack(try e.param(scan, 1), &.{ q, findings, generation }, try e.recurse(scan, rest, state, retire));
    }

    fn deliveryEntry(e: Emit, scan: Id, retire: bool) source.Error!Id {
        const b = e.b;
        const args = if (retire) &.{ e.t.state, e.t.ids } else &.{ e.t.state, e.t.ids, e.spec.reply };
        const f = try b.declare(args, e.t.state, e.spec.scope.residual.effects, e.spec.scope.borrowed_regions);
        const q = try b.variable(e.t.queue);
        const findings = try b.variable(e.t.findings);
        const generation = try b.variable(e.integer);
        const empty_state = try e.product(e.t.state, &.{ try b.primitive(e.t.queue, .sequence, &.{}, 0), try e.ref(findings), try e.ref(generation) });
        const body = try e.call(scan, if (retire)
            &.{ try e.ref(q), empty_state, try e.param(f, 1) }
        else
            &.{ try e.ref(q), empty_state, try e.param(f, 1), try e.param(f, 2) });
        try b.define(f, try e.unpack(try e.param(f, 0), &.{ q, findings, generation }, body));
        return f;
    }
    fn finalizer(e: Emit) source.Error!Id {
        const b = e.b;
        const scan = try b.declare(&.{ e.t.queue, e.t.findings }, e.t.findings, e.spec.scope.residual.effects, e.spec.scope.borrowed_regions);
        const pop = try Pop.init(e, e.t.queue, e.t.waiting);
        const view = try b.variable(e.t.view);
        const package = try b.variable(e.d.package);
        const next = try b.bind(try b.variable(e.unit), try dialogue.dispose(b, e.d, try e.ref(package)), try e.call(scan, &.{ try e.ref(pop.rest), try e.param(scan, 1) }));
        try b.define(scan, try pop.match(e, try e.param(scan, 0), try b.pure(try e.param(scan, 1)), try e.unpack(try e.ref(pop.head), &.{ view, package }, next)));
        const f = try b.declare(&.{e.t.state}, e.t.findings, e.spec.scope.residual.effects, e.spec.scope.borrowed_regions);
        const q = try b.variable(e.t.queue);
        const findings = try b.variable(e.t.findings);
        const generation = try b.variable(e.integer);
        try b.define(f, try e.unpack(try e.param(f, 0), &.{ q, findings, generation }, try e.call(scan, &.{ try e.ref(q), try e.ref(findings) })));
        return f;
    }
};

const Pop = struct {
    optional: Id,
    empty: Id,
    present: Id,
    head: Id,
    rest: Id,

    fn init(e: Emit, sequence: Id, element: Id) source.Error!Pop {
        const pair = try e.b.schema(.{ .product = &.{ element, sequence } });
        return .{ .optional = try e.b.schema(.{ .sum = &.{ e.unit, pair } }), .empty = try e.b.variable(e.unit), .present = try e.b.variable(pair), .head = try e.b.variable(element), .rest = try e.b.variable(sequence) };
    }
    fn match(p: Pop, e: Emit, sequence: Id, empty_body: Id, present: Id) source.Error!Id {
        return e.b.term(.{ .match_sum = .{
            .value = try e.b.primitive(p.optional, .sequence_pop, &.{sequence}, 0),
            .cases = &.{ .{ .variable = p.empty, .body = empty_body }, .{ .variable = p.present, .body = try e.unpack(try e.ref(p.present), &.{ p.head, p.rest }, present) } },
        } });
    }
};
