//! Resumable inquiry custody, authored as ordinary Boundary computations.
//! Application callbacks never receive the owning queue. All source allocations
//! belong to the caller's Builder; runtime custody belongs to the emitted terms.
const boundary = @import("boundary");
const source = boundary.source;
const typed = boundary.authoring;
const dialogue = boundary.library.generator;
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
    dialogue: dialogue.Generator,
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
    return defineTyped(b, spec) catch |err| return typed.sourceError(err);
}

fn defineTyped(b: *Builder, spec: Spec) typed.Error!Definition {
    const cached = try b.specialization(Definition, "agent.inquiry.custody/v1", .{spec});
    if (cached.cached) |value| return value;
    const integer = try b.scalar(u64);
    const d = try dialogue.defineExchange(b, spec.identity, spec.reply, spec.demand, spec.finding, spec.scope.captures, spec.scope.owned_regions, spec.scope.borrowed_regions, spec.scope.residual);
    const view = try b.schema(.{ .product = &.{ integer, integer, spec.demand } });
    const waiting = try b.schema(.{ .product = &.{ view, d.package } });
    const queue = try b.schema(.{ .seq = waiting });
    const found = try b.schema(.{ .product = &.{ integer, spec.finding } });
    const findings = try b.schema(.{ .seq = found });
    const state = try b.schema(.{ .product = &.{ queue, findings, integer } });
    const views = try b.schema(.{ .seq = view });
    const t: Types = .{ .view = view, .views = views, .waiting = waiting, .queue = queue, .found = found, .findings = findings, .state = state, .projected = try b.schema(.{ .product = &.{ state, views } }), .ids = try b.schema(.{ .seq = integer }) };
    const e: Emit = .{ .c = try typed.Context.init(b), .b = b, .d = d, .t = t, .spec = spec, .integer = integer };
    const park = try e.typedParker();
    const contains = try e.typedMembership();
    return cached.finish(b, .{
        .dialogue = d,
        .types = t,
        .park = try typed.interop.functionId(e.c, park),
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
    c: *typed.Context,
    b: *Builder,
    d: dialogue.Generator,
    t: Types,
    spec: Spec,
    integer: Id,

    fn typedParker(e: Emit) typed.Error!*const typed.Function {
        const c = e.c;
        const state_type = try typed.interop.schema(c, e.t.state);
        const integer = try typed.interop.schema(c, e.integer);
        const answer_type = try typed.interop.schema(c, e.d.answer);
        const regions = try e.b.allocator().alloc(*const typed.Region, e.spec.scope.borrowed_regions.len);
        for (regions, e.spec.scope.borrowed_regions) |*item, id| item.* = try typed.interop.region(c, id);
        const signature = try c.callable(&.{
            .{ .name = "state", .schema = state_type },
            .{ .name = "id", .schema = integer },
            .{ .name = "answer", .schema = answer_type },
        }, state_type, &.{}, .{ .use = .reusable, .captures = &.{}, .regions = regions });
        const function = try c.functionFor("park inquiry answer", signature);
        const body = try c.body(function);
        const state = try body.destructure(try body.parameter("state"));
        const queue = try state.get("0");
        const findings = try state.get("1");
        const generation = try state.get("2");
        const id = try body.parameter("id");
        const answer = try body.parameter("answer");
        const done = try body.caseOf(answer, "0");
        const completed = done.body();
        const found = try completed.product(try typed.interop.schema(c, e.t.found), &.{
            .{ .name = "0", .value = id }, .{ .name = "1", .value = done.payload() },
        });
        const complete_state = try completed.product(state_type, &.{
            .{ .name = "0", .value = queue },
            .{ .name = "1", .value = try completed.append(findings, found) },
            .{ .name = "2", .value = generation },
        });
        const awaiting = try body.caseOf(answer, "1");
        const suspended = awaiting.body();
        const pending = try suspended.destructure(awaiting.payload());
        const view = try suspended.product(try typed.interop.schema(c, e.t.view), &.{
            .{ .name = "0", .value = id },                   .{ .name = "1", .value = generation },
            .{ .name = "2", .value = try pending.get("0") },
        });
        const waiting = try suspended.product(try typed.interop.schema(c, e.t.waiting), &.{
            .{ .name = "0", .value = view }, .{ .name = "1", .value = try pending.get("1") },
        });
        const queued = try suspended.append(queue, waiting);
        if (e.spec.failure >= e.b.values.items.len) return error.InvalidReference;
        const failure = try typed.interop.literalFailure(c, e.spec.failure, try typed.interop.schema(c, e.b.values.items[e.spec.failure].schema));
        const next_generation = try suspended.checkedAdd(generation, try suspended.constant(u64, 1), failure);
        const parked = try suspended.product(state_type, &.{
            .{ .name = "0", .value = queued },          .{ .name = "1", .value = findings },
            .{ .name = "2", .value = next_generation },
        });
        const result = try body.match(answer, &.{ try done.ret(complete_state), try awaiting.ret(parked) });
        try c.define(function, try body.ret(result));
        return function;
    }

    fn typedMembership(e: Emit) typed.Error!*const typed.Function {
        const c = e.c;
        const ids = try typed.interop.schema(c, e.t.ids);
        const integer = try typed.interop.schema(c, e.integer);
        const function = try c.function("inquiry membership", &.{
            .{ .name = "ids", .schema = ids }, .{ .name = "id", .schema = integer },
        }, try c.scalar(bool), &.{});
        const body = try c.body(function);
        const id = try body.parameter("id");
        const popped = try body.pop(try body.parameter("ids"));
        const empty_case = try body.caseOf(popped, "empty");
        const item = try body.caseOf(popped, "item");
        const parts = try item.body().destructure(item.payload());
        const yes = try item.body().branch();
        const no = try item.body().branch();
        const next = try no.call(function, &.{
            .{ .name = "ids", .value = try parts.get("tail") },
            .{ .name = "id", .value = id },
        });
        const found = try item.body().conditional(
            try item.body().equal(try parts.get("head"), id),
            try yes.ret(try yes.constant(bool, true)),
            try no.ret(next),
        );
        const result = try body.match(popped, &.{
            try empty_case.ret(try empty_case.body().constant(bool, false)), try item.ret(found),
        });
        try c.define(function, try body.ret(result));
        return function;
    }

    fn declareTyped(e: Emit, c: *typed.Context, name: []const u8, parameters: []const typed.Field, result: *const typed.Schema, effects: []const Id) typed.Error!*const typed.Function {
        const regions = try e.b.allocator().alloc(*const typed.Region, e.spec.scope.borrowed_regions.len);
        for (regions, e.spec.scope.borrowed_regions) |*item, id| item.* = try typed.interop.region(c, id);
        const residual = try e.b.allocator().alloc(*const typed.Operation, effects.len);
        for (residual, effects) |*item, id| item.* = try typed.interop.operation(c, id);
        return c.functionFor(name, try c.callable(parameters, result, residual, .{
            .use = .reusable,
            .captures = &.{},
            .regions = regions,
        }));
    }

    fn projector(e: Emit) source.Error!Id {
        return e.typedProjector() catch |err| return typed.sourceError(err);
    }

    fn typedProjector(e: Emit) typed.Error!Id {
        const c = e.c;
        const queue_type = try typed.interop.schema(c, e.t.queue);
        const views_type = try typed.interop.schema(c, e.t.views);
        const projected_type = try c.record(&.{
            .{ .name = "queue", .schema = queue_type }, .{ .name = "views", .schema = views_type },
        });
        const scan = try e.declareTyped(c, "project queue", &.{
            .{ .name = "pending", .schema = queue_type },
            .{ .name = "rebuilt", .schema = queue_type },
            .{ .name = "views", .schema = views_type },
        }, projected_type, &.{});
        const body = try c.body(scan);
        const rebuilt = try body.parameter("rebuilt");
        const views = try body.parameter("views");
        const popped = try body.pop(try body.parameter("pending"));
        const empty_case = try body.caseOf(popped, "empty");
        const completed = try empty_case.body().product(projected_type, &.{
            .{ .name = "queue", .value = rebuilt }, .{ .name = "views", .value = views },
        });
        const item = try body.caseOf(popped, "item");
        const working = item.body();
        const parts = try working.destructure(item.payload());
        const waiting = try working.destructure(try parts.get("head"));
        const view = try waiting.get("0");
        const entry = try working.product(try typed.interop.schema(c, e.t.waiting), &.{
            .{ .name = "0", .value = view }, .{ .name = "1", .value = try waiting.get("1") },
        });
        const next = try working.call(scan, &.{
            .{ .name = "pending", .value = try parts.get("tail") },
            .{ .name = "rebuilt", .value = try working.append(rebuilt, entry) },
            .{ .name = "views", .value = try working.append(views, view) },
        });
        try c.define(scan, try body.ret(try body.match(popped, &.{
            try empty_case.ret(completed), try item.ret(next),
        })));
        return e.typedProjectEntry(c, scan, queue_type, views_type);
    }

    fn typedProjectEntry(e: Emit, c: *typed.Context, scan: *const typed.Function, queue_type: *const typed.Schema, views_type: *const typed.Schema) typed.Error!Id {
        const state_type = try typed.interop.schema(c, e.t.state);
        const result_type = try typed.interop.schema(c, e.t.projected);
        const entry = try e.declareTyped(c, "project inquiry state", &.{.{
            .name = "state",
            .schema = state_type,
        }}, result_type, &.{});
        const body = try c.body(entry);
        const state = try body.destructure(try body.parameter("state"));
        const scanned = try body.call(scan, &.{
            .{ .name = "pending", .value = try state.get("0") },
            .{ .name = "rebuilt", .value = try body.sequenceValue(queue_type, &.{}) },
            .{ .name = "views", .value = try body.sequenceValue(views_type, &.{}) },
        });
        const parts = try body.destructure(scanned);
        const rebuilt = try body.product(state_type, &.{
            .{ .name = "0", .value = try parts.get("queue") },
            .{ .name = "1", .value = try state.get("1") },
            .{ .name = "2", .value = try state.get("2") },
        });
        try c.define(entry, try body.ret(try body.product(result_type, &.{
            .{ .name = "0", .value = rebuilt }, .{ .name = "1", .value = try parts.get("views") },
        })));
        return typed.interop.functionId(c, entry);
    }

    fn delivery(e: Emit, park: *const typed.Function, contains: *const typed.Function, retire: bool) typed.Error!Id {
        const c = e.c;
        const state_type = try typed.interop.schema(c, e.t.state);
        const queue_type = try typed.interop.schema(c, e.t.queue);
        const ids_type = try typed.interop.schema(c, e.t.ids);
        const reply_type = try typed.interop.schema(c, e.spec.reply);
        const parameters = [_]typed.Field{
            .{ .name = "pending", .schema = queue_type }, .{ .name = "state", .schema = state_type },
            .{ .name = "ids", .schema = ids_type },       .{ .name = "reply", .schema = reply_type },
        };
        const scan = try e.declareTyped(c, "deliver inquiry replies", parameters[0..@as(usize, if (retire) 3 else 4)], state_type, e.spec.scope.residual.effects);
        const body = try c.body(scan);
        const state = try body.parameter("state");
        const ids = try body.parameter("ids");
        const reply = if (retire) null else try body.parameter("reply");
        const popped = try body.pop(try body.parameter("pending"));
        const empty_case = try body.caseOf(popped, "empty");
        const item = try body.caseOf(popped, "item");
        const working = item.body();
        const parts = try working.destructure(item.payload());
        const waiting = try working.destructure(try parts.get("head"));
        const rest = try parts.get("tail");
        const view = try waiting.get("0");
        const future = try waiting.get("1");
        const matches = try working.call(contains, &.{
            .{ .name = "ids", .value = ids }, .{ .name = "id", .value = try working.field(view, "1") },
        });
        const selected = try working.branch();
        const token = try selected.unpack(future);
        const next_state = if (retire) blk: {
            _ = try selected.dispose(token);
            break :blk state;
        } else blk: {
            const answer = try selected.resumeValue(token, reply.?);
            break :blk try selected.call(park, &.{
                .{ .name = "state", .value = state },
                .{ .name = "id", .value = try selected.field(view, "0") },
                .{ .name = "answer", .value = answer },
            });
        };
        const delivered = try e.repeatDelivery(selected, scan, rest, next_state, ids, reply);
        const kept = try working.branch();
        const retained = try e.retainWaiting(kept, state_type, state, view, future);
        const unchanged = try e.repeatDelivery(kept, scan, rest, retained, ids, reply);
        const result = try working.conditional(matches, try selected.ret(delivered), try kept.ret(unchanged));
        try c.define(scan, try body.ret(try body.match(popped, &.{
            try empty_case.ret(state), try item.ret(result),
        })));
        return e.typedDeliveryEntry(scan, parameters[1..@as(usize, if (retire) 3 else 4)], retire);
    }

    fn repeatDelivery(_: Emit, body: *typed.Body, scan: *const typed.Function, rest: *const typed.Value, state: *const typed.Value, ids: *const typed.Value, reply: ?*const typed.Value) typed.Error!*const typed.Value {
        if (reply) |value| return body.call(scan, &.{
            .{ .name = "pending", .value = rest }, .{ .name = "state", .value = state },
            .{ .name = "ids", .value = ids },      .{ .name = "reply", .value = value },
        });
        return body.call(scan, &.{
            .{ .name = "pending", .value = rest }, .{ .name = "state", .value = state },
            .{ .name = "ids", .value = ids },
        });
    }

    fn retainWaiting(e: Emit, body: *typed.Body, state_type: *const typed.Schema, state: *const typed.Value, view: *const typed.Value, future: *const typed.Value) typed.Error!*const typed.Value {
        const parts = try body.destructure(state);
        const waiting = try body.product(try typed.interop.schema(e.c, e.t.waiting), &.{
            .{ .name = "0", .value = view }, .{ .name = "1", .value = future },
        });
        return body.product(state_type, &.{
            .{ .name = "0", .value = try body.append(try parts.get("0"), waiting) },
            .{ .name = "1", .value = try parts.get("1") },
            .{ .name = "2", .value = try parts.get("2") },
        });
    }

    fn typedDeliveryEntry(e: Emit, scan: *const typed.Function, parameters: []const typed.Field, retire: bool) typed.Error!Id {
        const c = e.c;
        const state_type = try typed.interop.schema(c, e.t.state);
        const entry = try e.declareTyped(c, "deliver inquiry state", parameters, state_type, e.spec.scope.residual.effects);
        const body = try c.body(entry);
        const state = try body.destructure(try body.parameter("state"));
        const initial = try body.product(state_type, &.{
            .{ .name = "0", .value = try body.sequenceValue(try typed.interop.schema(c, e.t.queue), &.{}) },
            .{ .name = "1", .value = try state.get("1") },
            .{ .name = "2", .value = try state.get("2") },
        });
        const result = try e.repeatDelivery(body, scan, try state.get("0"), initial, try body.parameter("ids"), if (retire) null else try body.parameter("reply"));
        try c.define(entry, try body.ret(result));
        return typed.interop.functionId(c, entry);
    }

    fn finalizer(e: Emit) source.Error!Id {
        return e.typedFinalizer() catch |err| return typed.sourceError(err);
    }

    fn typedFinalizer(e: Emit) typed.Error!Id {
        const c = e.c;
        const queue_type = try typed.interop.schema(c, e.t.queue);
        const findings_type = try typed.interop.schema(c, e.t.findings);
        const scan = try e.declareTyped(c, "finalize inquiry queue", &.{
            .{ .name = "pending", .schema = queue_type },
            .{ .name = "findings", .schema = findings_type },
        }, findings_type, e.spec.scope.residual.effects);
        const body = try c.body(scan);
        const findings = try body.parameter("findings");
        const popped = try body.pop(try body.parameter("pending"));
        const empty_case = try body.caseOf(popped, "empty");
        const item = try body.caseOf(popped, "item");
        const working = item.body();
        const parts = try working.destructure(item.payload());
        const waiting = try working.destructure(try parts.get("head"));
        _ = try working.dispose(try working.unpack(try waiting.get("1")));
        const next = try working.call(scan, &.{
            .{ .name = "pending", .value = try parts.get("tail") },
            .{ .name = "findings", .value = findings },
        });
        try c.define(scan, try body.ret(try body.match(popped, &.{
            try empty_case.ret(findings), try item.ret(next),
        })));
        const entry = try e.declareTyped(c, "finalize inquiry state", &.{.{
            .name = "state",
            .schema = try typed.interop.schema(c, e.t.state),
        }}, findings_type, e.spec.scope.residual.effects);
        const root = try c.body(entry);
        const state = try root.destructure(try root.parameter("state"));
        try c.define(entry, try root.ret(try root.call(scan, &.{
            .{ .name = "pending", .value = try state.get("0") },
            .{ .name = "findings", .value = try state.get("1") },
        })));
        return typed.interop.functionId(c, entry);
    }
};
