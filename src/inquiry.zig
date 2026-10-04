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

pub const Options = struct {
    identity: []const u8,
    demand: *const typed.Schema,
    reply: *const typed.Schema,
    finding: *const typed.Schema,
    failure: *const typed.FailureLiteral,
    captures: typed.CaptureBounds,
    owned_regions: []const *const typed.Region = &.{},
    borrowed_regions: []const *const typed.Region = &.{},
    residual: []const *const typed.Operation = &.{},
    parameters: []const typed.Field = &.{},
    body_use: boundary.data.program.Use = .linear,
};
pub const TypedTypes = struct {
    view: *const typed.Schema,
    views: *const typed.Schema,
    waiting: *const typed.Schema,
    queue: *const typed.Schema,
    found: *const typed.Schema,
    findings: *const typed.Schema,
    state: *const typed.Schema,
    projected: *const typed.Schema,
    ids: *const typed.Schema,
};
pub const Inquiry = struct {
    dialogue: *const dialogue.Exchange,
    types: TypedTypes,
    park: *const typed.Function,
    project: *const typed.Function,
    distribute: *const typed.Function,
    retire: *const typed.Function,
    finish: *const typed.Function,
};

/// Create one nominal inquiry family and reuse its functions at each installation.
pub fn create(c: *typed.Context, options: Options) typed.Error!Inquiry {
    const integer = try c.scalar(u64);
    const d = try dialogue.create(c, options.identity, options.reply, options.demand, options.finding, .{
        .captures = options.captures,
        .owned_regions = options.owned_regions,
        .borrowed_regions = options.borrowed_regions,
        .residual = options.residual,
        .parameters = options.parameters,
        .body_use = options.body_use,
    });
    const view = try c.record(&.{ .{ .name = "occurrence", .schema = integer }, .{ .name = "generation", .schema = integer }, .{ .name = "demand", .schema = options.demand } });
    const waiting = try c.record(&.{ .{ .name = "view", .schema = view }, .{ .name = "future", .schema = d.package() } });
    const queue = try c.sequence(waiting);
    const found = try c.record(&.{ .{ .name = "occurrence", .schema = integer }, .{ .name = "finding", .schema = options.finding } });
    const findings = try c.sequence(found);
    const state = try c.record(&.{ .{ .name = "queue", .schema = queue }, .{ .name = "findings", .schema = findings }, .{ .name = "next", .schema = integer } });
    const views = try c.sequence(view);
    const t: TypedTypes = .{ .view = view, .views = views, .waiting = waiting, .queue = queue, .found = found, .findings = findings, .state = state, .projected = try c.record(&.{ .{ .name = "state", .schema = state }, .{ .name = "views", .schema = views } }), .ids = try c.sequence(integer) };
    const e: Emit = .{ .c = c, .d = d, .t = t, .spec = options, .integer = integer };
    const park = try e.typedParker();
    const contains = try e.typedMembership();
    return .{ .dialogue = d, .types = t, .park = park, .project = try e.typedProjector(), .distribute = try e.delivery(park, contains, false), .retire = try e.delivery(park, contains, true), .finish = try e.typedFinalizer() };
}

pub fn initial(body: *typed.Body, inquiry: Inquiry) typed.Error!*const typed.Value {
    return body.product(inquiry.types.state, &.{
        .{ .name = "queue", .value = try body.sequenceValue(inquiry.types.queue, &.{}) },
        .{ .name = "findings", .value = try body.sequenceValue(inquiry.types.findings, &.{}) },
        .{ .name = "next", .value = try body.constant(u64, 1) },
    });
}

// Transitional source adapter while the remaining broker/application callers migrate.
fn defineTyped(b: *Builder, spec: Spec) typed.Error!Definition {
    const cached = try b.specialization(Definition, "agent.inquiry.custody/v1", .{spec});
    if (cached.cached) |value| return value;
    const c = try typed.Context.init(b);
    const captures = try b.allocator().alloc(*const typed.Schema, spec.scope.captures.len);
    for (captures, spec.scope.captures) |*out, id| out.* = try typed.interop.schema(c, id);
    const owned = try b.allocator().alloc(*const typed.Region, spec.scope.owned_regions.len);
    for (owned, spec.scope.owned_regions) |*out, id| out.* = try typed.interop.region(c, id);
    const borrowed = try b.allocator().alloc(*const typed.Region, spec.scope.borrowed_regions.len);
    for (borrowed, spec.scope.borrowed_regions) |*out, id| out.* = try typed.interop.region(c, id);
    const effects = try b.allocator().alloc(*const typed.Operation, spec.scope.residual.effects.len);
    for (effects, spec.scope.residual.effects) |*out, id| out.* = try typed.interop.operation(c, id);
    if (spec.failure >= b.values.items.len) return error.InvalidReference;
    const value = try create(c, .{
        .identity = spec.identity,
        .demand = try typed.interop.schema(c, spec.demand),
        .reply = try typed.interop.schema(c, spec.reply),
        .finding = try typed.interop.schema(c, spec.finding),
        .failure = try typed.interop.literalFailure(c, spec.failure, try typed.interop.schema(c, b.values.items[@intCast(spec.failure)].schema)),
        .captures = .{ .continuation = captures },
        .owned_regions = owned,
        .borrowed_regions = borrowed,
        .residual = effects,
    });
    const d = value.dialogue;
    var types: Types = undefined;
    inline for (@typeInfo(Types).@"struct".field_names) |field_name| @field(types, field_name) = try typed.interop.schemaId(c, @field(value.types, field_name));
    return cached.finish(b, .{
        .dialogue = .{
            .input = try typed.interop.schemaId(c, d.input()),
            .element = try typed.interop.schemaId(c, d.element()),
            .result = try typed.interop.schemaId(c, d.result()),
            .effect = try typed.interop.operationId(c, d.effect()),
            .capability = try typed.interop.schemaId(c, d.capability()),
            .answer = try typed.interop.schemaId(c, d.answer()),
            .yielded = try typed.interop.schemaId(c, d.yielded()),
            .package = try typed.interop.schemaId(c, d.package()),
            .resumption = try typed.interop.schemaId(c, d.resumption()),
            .handler = try typed.interop.handlerId(c, d.handler()),
        },
        .types = types,
        .park = try typed.interop.functionId(c, value.park),
        .project = try typed.interop.functionId(c, value.project),
        .distribute = try typed.interop.functionId(c, value.distribute),
        .retire = try typed.interop.functionId(c, value.retire),
        .finish = try typed.interop.functionId(c, value.finish),
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
    d: *const dialogue.Exchange,
    t: TypedTypes,
    spec: Options,
    integer: *const typed.Schema,

    fn typedParker(e: Emit) typed.Error!*const typed.Function {
        const c = e.c;
        const state_type = e.t.state;
        const integer = e.integer;
        const answer_type = e.d.answer();
        const regions = e.spec.borrowed_regions;
        const signature = try c.callable(&.{
            .{ .name = "state", .schema = state_type },
            .{ .name = "id", .schema = integer },
            .{ .name = "answer", .schema = answer_type },
        }, state_type, &.{}, .{ .use = .reusable, .captures = &.{}, .regions = regions });
        const function = try c.functionFor("park inquiry answer", signature);
        const body = try c.body(function);
        const state = try body.destructure(try body.parameter("state"));
        const queue = try state.get("queue");
        const findings = try state.get("findings");
        const generation = try state.get("next");
        const id = try body.parameter("id");
        const answer = try body.parameter("answer");
        const done = try body.caseOf(answer, "done");
        const completed = done.body();
        const found = try completed.product(e.t.found, &.{
            .{ .name = "occurrence", .value = id }, .{ .name = "finding", .value = done.payload() },
        });
        const complete_state = try completed.product(state_type, &.{
            .{ .name = "queue", .value = queue },
            .{ .name = "findings", .value = try completed.append(findings, found) },
            .{ .name = "next", .value = generation },
        });
        const awaiting = try body.caseOf(answer, "yielded");
        const suspended = awaiting.body();
        const pending = try suspended.destructure(awaiting.payload());
        const view = try suspended.product(e.t.view, &.{
            .{ .name = "occurrence", .value = id },                   .{ .name = "generation", .value = generation },
            .{ .name = "demand", .value = try pending.get("value") },
        });
        const waiting = try suspended.product(e.t.waiting, &.{
            .{ .name = "view", .value = view }, .{ .name = "future", .value = try pending.get("future") },
        });
        const queued = try suspended.append(queue, waiting);
        const failure = e.spec.failure;
        const next_generation = try suspended.checkedAdd(generation, try suspended.constant(u64, 1), failure);
        const parked = try suspended.product(state_type, &.{
            .{ .name = "queue", .value = queued },         .{ .name = "findings", .value = findings },
            .{ .name = "next", .value = next_generation },
        });
        const result = try body.match(answer, &.{ try done.ret(complete_state), try awaiting.ret(parked) });
        try c.define(function, try body.ret(result));
        return function;
    }

    fn typedMembership(e: Emit) typed.Error!*const typed.Function {
        const c = e.c;
        const ids = e.t.ids;
        const integer = e.integer;
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

    fn declareTyped(e: Emit, c: *typed.Context, name: []const u8, parameters: []const typed.Field, result: *const typed.Schema, effects: []const *const typed.Operation) typed.Error!*const typed.Function {
        const regions = e.spec.borrowed_regions;
        return c.functionFor(name, try c.callable(parameters, result, effects, .{
            .use = .reusable,
            .captures = &.{},
            .regions = regions,
        }));
    }

    fn typedProjector(e: Emit) typed.Error!*const typed.Function {
        const c = e.c;
        const queue_type = e.t.queue;
        const views_type = e.t.views;
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
        const view = try waiting.get("view");
        const entry = try working.product(e.t.waiting, &.{
            .{ .name = "view", .value = view }, .{ .name = "future", .value = try waiting.get("future") },
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

    fn typedProjectEntry(e: Emit, c: *typed.Context, scan: *const typed.Function, queue_type: *const typed.Schema, views_type: *const typed.Schema) typed.Error!*const typed.Function {
        const state_type = e.t.state;
        const result_type = e.t.projected;
        const entry = try e.declareTyped(c, "project inquiry state", &.{.{
            .name = "state",
            .schema = state_type,
        }}, result_type, &.{});
        const body = try c.body(entry);
        const state = try body.destructure(try body.parameter("state"));
        const scanned = try body.call(scan, &.{
            .{ .name = "pending", .value = try state.get("queue") },
            .{ .name = "rebuilt", .value = try body.sequenceValue(queue_type, &.{}) },
            .{ .name = "views", .value = try body.sequenceValue(views_type, &.{}) },
        });
        const parts = try body.destructure(scanned);
        const rebuilt = try body.product(state_type, &.{
            .{ .name = "queue", .value = try parts.get("queue") },
            .{ .name = "findings", .value = try state.get("findings") },
            .{ .name = "next", .value = try state.get("next") },
        });
        try c.define(entry, try body.ret(try body.product(result_type, &.{
            .{ .name = "state", .value = rebuilt }, .{ .name = "views", .value = try parts.get("views") },
        })));
        return entry;
    }

    fn delivery(e: Emit, park: *const typed.Function, contains: *const typed.Function, retire: bool) typed.Error!*const typed.Function {
        const c = e.c;
        const state_type = e.t.state;
        const queue_type = e.t.queue;
        const ids_type = e.t.ids;
        const reply_type = e.spec.reply;
        const parameters = [_]typed.Field{
            .{ .name = "pending", .schema = queue_type }, .{ .name = "state", .schema = state_type },
            .{ .name = "ids", .schema = ids_type },       .{ .name = "reply", .schema = reply_type },
        };
        const scan = try e.declareTyped(c, "deliver inquiry replies", parameters[0..@as(usize, if (retire) 3 else 4)], state_type, e.spec.residual);
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
        const view = try waiting.get("view");
        const future = try waiting.get("future");
        const matches = try working.call(contains, &.{
            .{ .name = "ids", .value = ids }, .{ .name = "id", .value = try working.field(view, "generation") },
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
                .{ .name = "id", .value = try selected.field(view, "occurrence") },
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
        const waiting = try body.product(e.t.waiting, &.{
            .{ .name = "view", .value = view }, .{ .name = "future", .value = future },
        });
        return body.product(state_type, &.{
            .{ .name = "queue", .value = try body.append(try parts.get("queue"), waiting) },
            .{ .name = "findings", .value = try parts.get("findings") },
            .{ .name = "next", .value = try parts.get("next") },
        });
    }

    fn typedDeliveryEntry(e: Emit, scan: *const typed.Function, parameters: []const typed.Field, retire: bool) typed.Error!*const typed.Function {
        const c = e.c;
        const state_type = e.t.state;
        const entry = try e.declareTyped(c, "deliver inquiry state", parameters, state_type, e.spec.residual);
        const body = try c.body(entry);
        const state = try body.destructure(try body.parameter("state"));
        const initial_state = try body.product(state_type, &.{
            .{ .name = "queue", .value = try body.sequenceValue(e.t.queue, &.{}) },
            .{ .name = "findings", .value = try state.get("findings") },
            .{ .name = "next", .value = try state.get("next") },
        });
        const result = try e.repeatDelivery(body, scan, try state.get("queue"), initial_state, try body.parameter("ids"), if (retire) null else try body.parameter("reply"));
        try c.define(entry, try body.ret(result));
        return entry;
    }

    fn typedFinalizer(e: Emit) typed.Error!*const typed.Function {
        const c = e.c;
        const queue_type = e.t.queue;
        const findings_type = e.t.findings;
        const scan = try e.declareTyped(c, "finalize inquiry queue", &.{
            .{ .name = "pending", .schema = queue_type },
            .{ .name = "findings", .schema = findings_type },
        }, findings_type, e.spec.residual);
        const body = try c.body(scan);
        const findings = try body.parameter("findings");
        const popped = try body.pop(try body.parameter("pending"));
        const empty_case = try body.caseOf(popped, "empty");
        const item = try body.caseOf(popped, "item");
        const working = item.body();
        const parts = try working.destructure(item.payload());
        const waiting = try working.destructure(try parts.get("head"));
        _ = try working.dispose(try working.unpack(try waiting.get("future")));
        const next = try working.call(scan, &.{
            .{ .name = "pending", .value = try parts.get("tail") },
            .{ .name = "findings", .value = findings },
        });
        try c.define(scan, try body.ret(try body.match(popped, &.{
            try empty_case.ret(findings), try item.ret(next),
        })));
        const entry = try e.declareTyped(c, "finalize inquiry state", &.{.{
            .name = "state",
            .schema = e.t.state,
        }}, findings_type, e.spec.residual);
        const root = try c.body(entry);
        const state = try root.destructure(try root.parameter("state"));
        try c.define(entry, try root.ret(try root.call(scan, &.{
            .{ .name = "pending", .value = try state.get("queue") },
            .{ .name = "findings", .value = try state.get("findings") },
        })));
        return entry;
    }
};
