//! Consumer-directed parser construction using compiled task-valued hyperfunctions.
const std = @import("std");
const agent = @import("agent");
const boundary = @import("boundary");
const source = boundary.computation;
const hyper = boundary.library.hyper;
const parser = agent.parser_synthesis;
const P = parser.proposals.Profile;
const Id = source.Id;
pub const Input = struct { subject: parser.Subject, model: P.Request, trace: parser.Trace, occurrence: u64, rounds: u64 };
const State = struct { input: Input, successor: bool, version: u64, remaining: u64, prior: ?Report, reference: ?parser.ReferenceReply };
const Constraint = struct { state: State, observation: parser.ReferenceReply };
const Constructed = struct { candidate: parser.Candidate, reference: parser.ReferenceReply };
pub const Report = struct { candidate: parser.Candidate, observation: parser.ExecutionReply };
pub const Contribution = union(enum(u32)) {
    reference: Constraint = 0,
    candidate: Constructed = 1,
    assessed: Report = 2,
    unresolved: agent.contracts.Text(512) = 3,
};
const Types = struct {
    input: Id,
    state: Id,
    contribution: Id,
    task: Id,
    pair: hyper.Pair,
    model: Id,
    reference: Id,
    execution: Id,
    sample: Id,
    probe: Id,
    reference_factory: Id,
};
fn types(b: *source.Builder) !Types {
    const cache = try b.specialization(Types, "agent.parser.episode/v1", .{});
    if (cache.cached) |value| return value;
    const input = try agent.contracts.schema(Input, b);
    const state = try agent.contracts.schema(State, b);
    const contribution = try agent.contracts.schema(Contribution, b);
    const model = try P.declare(b);
    const reference = try b.effect(.{ .identity = parser.reference_identity, .payload = try agent.contracts.schema(parser.ReferenceRequest, b), .result = try agent.contracts.schema(parser.ReferenceReply, b) });
    const execution = try b.effect(.{ .identity = "agent.parser.probe.v1", .payload = try agent.contracts.schema(parser.ExecutionRequest, b), .result = try agent.contracts.schema(parser.ExecutionReply, b) });
    const task = try b.reserveSchema();
    const pair = try hyper.pairWith(b, task, task, &.{ state, contribution });
    try b.defineSchema(task, .{ .internal = .{ .computation = .{ .parameters = &.{}, .result = contribution, .effects = &.{ model, reference, execution }, .capture_bound = &.{ state, pair.peer_forward, pair.peer_backward } } } });
    const sample = try b.declare(&.{ state, try agent.contracts.schema(Constraint, b) }, contribution, &.{model}, &.{});
    const probe = try b.declare(&.{ state, try agent.contracts.schema(parser.Candidate, b) }, try agent.contracts.schema(parser.ExecutionReply, b), &.{execution}, &.{});
    const reference_factory = try b.declare(&.{state}, pair.backward, &.{}, &.{});
    return cache.finish(b, .{ .reference_factory = reference_factory, .input = input, .state = state, .contribution = contribution, .task = task, .pair = pair, .model = model, .reference = reference, .execution = execution, .sample = sample, .probe = probe });
}
fn field(b: *source.Builder, comptime T: type, value: Id, index: Id) !Id {
    return b.primitive(try agent.contracts.schema(T, b), .field, &.{value}, index);
}
fn unresolved(b: *source.Builder, t: Types, message: []const u8) !Id {
    const text = try literal(b, agent.contracts.Text(512), .{ .bytes = message });
    return b.pure(try b.primitive(t.contribution, .variant, &.{text}, 3));
}
fn step(b: *source.Builder, q: hyper.Query, consumer: bool) !Id {
    const t = try types(b);
    const need = try hyper.demand.family(b, "parser/need", t.state, t.contribution);
    const interpreted = try hyper.demand.interpret(b, q, need, t.contribution, .{
        .captures = &.{ t.state, t.contribution, t.pair.peer_forward, t.pair.peer_backward },
        .residual = .{ .effects = &.{ t.model, t.reference, t.execution } },
    });
    const body = try b.declare(&.{need.capability}, t.contribution, &.{ t.model, t.reference, t.execution, need.effect }, &.{});
    const next = try successor(b, q.state);
    const received = try b.variable(t.contribution);
    const requested = try hyper.demand.request(b, need, try b.reference(b.parameter(body, 0)), next);
    const continued = try afterContribution(b, t, q, try b.reference(received), consumer);
    var instructions = try b.bind(received, requested, continued);
    if (consumer) instructions = try b.term(.{ .conditional = .{
        .condition = try field(b, bool, q.state, 1),
        .when_true = try referenceParticipant(b, t, q),
        .when_false = instructions,
    } });
    const exhausted = try b.primitive(try b.scalar(bool), .equal, &.{ try field(b, u64, q.state, 3), try b.constant(u64, 0) }, 0);
    try b.define(body, try b.term(.{ .conditional = .{ .condition = exhausted, .when_true = try unresolved(b, t, "Construction allowance exhausted."), .when_false = instructions } }));
    const task = try b.declare(&.{}, t.contribution, &.{ t.model, t.reference, t.execution }, &.{});
    try b.define(task, try hyper.demand.handle(b, interpreted, q.peer, try b.lambda(body, interpreted.body)));
    const descriptor = try b.declare(&.{}, t.task, &.{}, &.{});
    try b.define(descriptor, try b.pure(try b.lambda(task, t.task)));
    return b.pure(try b.lambda(descriptor, q.types.answer_forward));
}
fn referenceStep(b: *source.Builder, t: Types, state: Id) !Id {
    const input = try field(b, Input, state, 0);
    const request = try b.primitive(try agent.contracts.schema(parser.ReferenceRequest, b), .product, &.{
        try field(b, parser.Subject, input, 0), try field(b, u64, input, 3), try field(b, parser.Trace, input, 2),
    }, 0);
    const reply = try b.variable(try agent.contracts.schema(parser.ReferenceReply, b));
    const constraint = try b.primitive(try agent.contracts.schema(Constraint, b), .product, &.{ state, try b.reference(reply) }, 0);
    const observed = try b.bind(reply, try b.term(.{ .perform = .{ .effect = t.reference, .payload = request } }), try b.pure(try b.primitive(t.contribution, .variant, &.{constraint}, 0)));
    const cached = try b.variable(try agent.contracts.schema(parser.ReferenceReply, b));
    const reused = try b.primitive(try agent.contracts.schema(Constraint, b), .product, &.{ state, try b.reference(cached) }, 0);
    return b.term(.{ .match_sum = .{ .value = try field(b, ?parser.ReferenceReply, state, 5), .cases = &.{
        .{ .variable = try b.variable(try b.scalar(void)), .body = observed },
        .{ .variable = cached, .body = try b.pure(try b.primitive(t.contribution, .variant, &.{reused}, 0)) },
    } } });
}
fn afterContribution(b: *source.Builder, t: Types, q: hyper.Query, value: Id, consumer: bool) !Id {
    var cases: [4]struct { variable: Id, body: Id } = undefined;
    const schemas = [_]Id{ try agent.contracts.schema(Constraint, b), try agent.contracts.schema(Constructed, b), try agent.contracts.schema(Report, b), try agent.contracts.schema(agent.contracts.Text(512), b) };
    for (schemas, 0..) |schema, index| {
        const variable = try b.variable(schema);
        var body = try unresolved(b, t, "Unexpected counterpart contribution.");
        if (index == 3) body = try b.pure(try b.primitive(t.contribution, .variant, &.{try b.reference(variable)}, 3));
        if (!consumer and index == 0) body = try b.term(.{ .call = .{ .function = t.sample, .arguments = &.{ q.state, try b.reference(variable) } } });
        if (consumer and index == 1) body = try assessAndContinue(b, t, q, try b.reference(variable));
        cases[index] = .{ .variable = variable, .body = body };
    }
    return b.term(.{ .match_sum = .{ .value = value, .cases = &.{
        .{ .variable = cases[0].variable, .body = cases[0].body }, .{ .variable = cases[1].variable, .body = cases[1].body },
        .{ .variable = cases[2].variable, .body = cases[2].body }, .{ .variable = cases[3].variable, .body = cases[3].body },
    } } });
}
const Producer = struct {
    pub fn emit(b: *source.Builder, q: hyper.Query) !Id {
        return step(b, q, false);
    }
};
const Consumer = struct {
    pub fn emit(b: *source.Builder, q: hyper.Query) !Id {
        return step(b, q, true);
    }
};

fn component(allocator: std.mem.Allocator, consumer: bool, reference_only: bool, forged: bool) ![]u8 {
    var b = source.Builder.init(allocator);
    defer b.deinit();
    const t = try types(&b);
    const definition = if (forged) try hyper.ana(&b, hyper.swap(t.pair), t.state, ForgedConsumer) else if (reference_only) try hyper.ana(&b, hyper.swap(t.pair), t.state, Reference) else if (consumer) try hyper.ana(&b, hyper.swap(t.pair), t.state, Consumer) else try hyper.ana(&b, t.pair, t.state, Producer);
    var compiled = try source.component.compile(allocator, b.module(definition.function, try b.scalar(void)), .{
        .imports = &.{ .{ .name = "reference-factory", .reference = .{ .kind = .function, .id = t.reference_factory } }, .{ .name = "model", .reference = .{ .kind = .effect, .id = t.model } }, .{ .name = "probe", .reference = .{ .kind = .function, .id = t.probe } }, .{ .name = "reference", .reference = .{ .kind = .effect, .id = t.reference } }, .{ .name = "sample", .reference = .{ .kind = .function, .id = t.sample } }, .{ .name = "simulation", .reference = .{ .kind = .effect, .id = t.execution } } },
        .exports = &.{.{ .name = "create", .reference = .{ .kind = .function, .id = definition.function } }},
        .borrows = &.{ .{ .function = t.sample }, .{ .function = t.probe }, .{ .function = t.reference_factory } },
    });
    defer compiled.deinit();
    const bytes = try allocator.alloc(u8, try boundary.data.component.encodedLength(compiled.object));
    errdefer allocator.free(bytes);
    _ = try compiled.encode(allocator, bytes);
    return bytes;
}

fn literal(b: *source.Builder, comptime T: type, value: T) !Id {
    return b.literal(.{ .schema = try agent.contracts.schema(T, b), .bytes = try agent.contracts.encodeOwned(T, b.allocator(), value) });
}
fn appendSummary(c: agent.Context, request: Id, rows: Id) !Id {
    const b = c.builder;
    const count = try b.primitive(try b.scalar(u64), .sequence_length, &.{rows}, 0);
    const number = try b.primitive(try b.schema(.text), .text_integer, &.{count}, 0);
    const prefix = try c.literal(P.MessageText, .{ .bytes = "The actual frozen reference returned this many feed observations: " });
    const content = try b.value(.{ .schema = try c.schema(P.MessageText), .expression = .{ .primitive = .{
        .opcode = .blob_concat,
        .operands = &.{ prefix, number },
        .failures = &.{.{ .kind = .capacity_exceeded, .value = try b.failureLiteral(try b.constant(void, {})) }},
    } } });
    return appendMessage(c, request, content);
}
fn appendMessage(c: agent.Context, request: Id, content: Id) !Id {
    const b = c.builder;
    const message = try b.primitive(try c.schema(P.Message), .product, &.{ try c.literal(agent.model_invocation.MessageRole, .user), content }, 0);
    var fields: [std.meta.fields(P.Request).len]Id = undefined;
    inline for (std.meta.fields(P.Request), 0..) |item, index| {
        const value = try field(b, item.type, request, index);
        fields[index] = if (comptime std.mem.eql(u8, item.name, "messages")) try b.value(.{
            .schema = try c.schema(P.Messages),
            .expression = .{ .primitive = .{
                .opcode = .sequence_append,
                .operands = &.{ value, message },
                .failures = &.{.{ .kind = .capacity_exceeded, .value = try b.failureLiteral(try b.constant(void, {})) }},
            } },
        }) else value;
    }
    return b.primitive(try c.schema(P.Request), .product, &fields, 0);
}
fn defineSample(c: agent.Context, t: Types) !void {
    const b = c.builder;
    const state = try b.reference(b.parameter(t.sample, 0));
    const constraint = try b.reference(b.parameter(t.sample, 1));
    const reference_reply = try field(b, parser.ReferenceReply, constraint, 1);
    const current = try field(b, State, constraint, 0);
    const input = try field(b, Input, current, 0);
    _ = state;
    const outcome = try field(b, @FieldType(parser.ReferenceReply, "outcome"), reference_reply, 1);
    const rows = try b.variable(try c.schema(parser.Observations));
    const unavailable = try b.variable(try c.schema(parser.Unavailable));
    const result = try b.variable(try c.schema(P.Interpretation));
    const answer = try b.variable(try c.schema(parser.proposals.Proposal));
    const rejected = try b.variable(try c.schema(P.InterpretationFailure));
    const interpreted = try b.term(.{ .match_sum = .{ .value = try b.reference(result), .cases = &.{
        .{ .variable = answer, .body = try candidateProposal(c, t, try b.reference(answer), try field(b, u64, current, 2), reference_reply) },
        .{ .variable = rejected, .body = try unresolved(b, t, "The model response was rejected.") },
    } } });
    const summarized = try appendSummary(c, try field(b, P.Request, input, 1), try b.reference(rows));
    const request_slot = try b.variable(try c.schema(P.Request));
    const request = try b.reference(request_slot);
    const sampled_call = try b.bind(result, try agent.responders.invokeModel(P, c, try b.constant(void, {}), false, request, try offered(c, try field(b, u64, current, 2))), interpreted);
    const sampled = try b.bind(request_slot, try revisionPrompt(c, summarized, current), sampled_call);
    const dispatch = try b.term(.{ .match_sum = .{ .value = outcome, .cases = &.{
        .{ .variable = rows, .body = sampled },
        .{ .variable = unavailable, .body = try unresolved(b, t, "Reference evidence is unavailable.") },
    } } });
    const matching = try b.primitive(try b.scalar(bool), .equal, &.{
        try field(b, u64, reference_reply, 0), try field(b, u64, input, 3),
    }, 0);
    try b.define(t.sample, try b.term(.{ .conditional = .{ .condition = matching, .when_true = dispatch, .when_false = try unresolved(b, t, "Reference occurrence is stale.") } }));
}
fn candidateProposal(c: agent.Context, t: Types, answer: Id, version: Id, reference_reply: Id) !Id {
    const b = c.builder;
    var cases: [5]struct { variable: Id, body: Id } = undefined;
    inline for (std.meta.fields(parser.proposals.Proposal), 0..) |item, index| {
        const variable = try b.variable(try c.schema(item.type));
        var body = try unresolved(b, t, "The proposal does not answer the current fragment demand.");
        if (index == 0 or index == 1) {
            const code = try field(b, parser.Code, try b.reference(variable), 0);
            const candidate = try b.primitive(try c.schema(parser.Candidate), .product, &.{
                code, version, try c.literal(parser.Completeness, if (index == 0) .partial else .complete),
            }, 0);
            const constructed = try b.primitive(try c.schema(Constructed), .product, &.{ candidate, reference_reply }, 0);
            body = try b.pure(try b.primitive(t.contribution, .variant, &.{constructed}, 1));
        }
        if (index == 4) body = try b.pure(try b.primitive(t.contribution, .variant, &.{try field(b, parser.proposals.Explanation, try b.reference(variable), 0)}, 3));
        cases[index] = .{ .variable = variable, .body = body };
    }
    return b.term(.{ .match_sum = .{ .value = answer, .cases = &.{
        .{ .variable = cases[0].variable, .body = cases[0].body }, .{ .variable = cases[1].variable, .body = cases[1].body },
        .{ .variable = cases[2].variable, .body = cases[2].body }, .{ .variable = cases[3].variable, .body = cases[3].body },
        .{ .variable = cases[4].variable, .body = cases[4].body },
    } } });
}
fn defineProbe(c: agent.Context, t: Types) !void {
    const b = c.builder;
    const input = try field(b, Input, try b.reference(b.parameter(t.probe, 0)), 0);
    const occurrence = try b.value(.{ .schema = try b.scalar(u64), .expression = .{ .primitive = .{
        .opcode = .integer_add,
        .operands = &.{ try field(b, u64, input, 3), try field(b, u64, try b.reference(b.parameter(t.probe, 0)), 2) },
        .failures = &.{.{ .kind = .arithmetic_overflow, .value = try b.failureLiteral(try b.constant(void, {})) }},
    } } });
    const check_type = try c.schema(@FieldType(parser.ExecutionRequest, "check"));
    const check = try b.primitive(check_type, .variant, &.{try field(b, parser.Trace, input, 2)}, 0);
    const request = try b.primitive(try c.schema(parser.ExecutionRequest), .product, &.{
        try field(b, parser.Subject, input, 0), occurrence, try b.reference(b.parameter(t.probe, 1)), check,
    }, 0);
    try b.define(t.probe, try parser.execute(c, .{ .reference = t.reference, .execution = t.execution }, request, try b.constant(void, {})));
}

const Application = struct {
    var producer: []const u8 = &.{};
    var consumer: []const u8 = &.{};
    var reference_bytes: []const u8 = &.{};
    pub fn emit(c: agent.Context) !source.Module {
        const b = c.builder;
        const t = try types(b);
        try c.registry.classify(t.model, .model);
        try c.registry.classify(t.reference, .read);
        try c.registry.classify(t.execution, .simulation);
        try defineSample(c, t);
        try defineProbe(c, t);
        const r = try install(c, t, "reference", reference_bytes, t.pair.backward);
        try b.define(t.reference_factory, try b.term(.{ .call = .{ .function = r, .arguments = &.{try b.reference(b.parameter(t.reference_factory, 0))} } }));
        const p = try install(c, t, "producer", producer, t.pair.forward);
        const z = try install(c, t, "consumer", consumer, t.pair.backward);
        const acceptance = try c.external(parser.execution_identity, try c.schema(parser.ExecutionRequest), try c.schema(parser.ExecutionReply), .simulation);
        const effects = &.{ t.model, t.reference, t.execution, acceptance };
        const round = try b.declare(&.{t.state}, t.contribution, effects, &.{});
        try c.registry.privateFunction(round);
        const state = try b.reference(b.parameter(round, 0));
        const produced = try b.variable(t.pair.forward);
        const consumed = try b.variable(t.pair.backward);
        const peer = try b.declare(&.{}, t.pair.forward, &.{}, &.{});
        try b.define(peer, try b.pure(try b.reference(produced)));
        const delayed = try b.variable(t.pair.answer_backward);
        const task = try b.variable(t.task);
        const contribution = try b.variable(t.contribution);
        const complete = try completion(c, t, round, acceptance, state, try b.reference(contribution));
        const run = try b.bind(delayed, try hyper.invoke(b, try b.reference(consumed), try b.lambda(peer, t.pair.peer_forward)), try b.bind(task, try hyper.force(b, try b.reference(delayed)), try b.bind(contribution, try hyper.force(b, try b.reference(task)), complete)));
        const next = try b.bind(consumed, try b.term(.{ .call = .{ .function = z, .arguments = &.{state} } }), run);
        try b.define(round, try b.bind(produced, try b.term(.{ .call = .{ .function = p, .arguments = &.{state} } }), next));
        const entry = try b.declare(&.{t.input}, t.contribution, effects, &.{});
        const input = try b.reference(b.parameter(entry, 0));
        const initial = try b.primitive(t.state, .product, &.{ input, try b.constant(bool, false), try b.constant(u64, 1), try field(b, u64, input, 4), try literal(b, ?Report, null), try literal(b, ?parser.ReferenceReply, null) }, 0);
        const call = try b.term(.{ .call = .{ .function = round, .arguments = &.{initial} } });
        try c.registry.allowPrivateCall(entry, call, round);
        try b.define(entry, call);
        return b.module(entry, try b.scalar(void));
    }
};
fn install(c: agent.Context, t: Types, name: []const u8, bytes: []const u8, result: Id) !Id {
    return agent.participant.declare(c, .{
        .instance = name,
        .object = bytes,
        .entry = "create",
        .parameters = &.{t.state},
        .result = result,
        .effects = &.{ .{ .symbol = "model", .effect = t.model }, .{ .symbol = "reference", .effect = t.reference }, .{ .symbol = "simulation", .effect = t.execution } },
        .functions = &.{ .{ .symbol = "reference-factory", .function = t.reference_factory }, .{ .symbol = "sample", .function = t.sample }, .{ .symbol = "probe", .function = t.probe } },
    });
}
const System = agent.system(.{ .InitialArgs = Input, .Result = Contribution, .Failure = void, .application = Application });
const Model = agent.model(.{ .name = "parser-producer", .model = "synthetic-only", .protocol = struct {
    pub const semantic_identity = agent.model_invocation.protocol_identity;
} });
fn output(init: std.process.Init, bytes: []const u8) !void {
    var buffer: [4096]u8 = undefined;
    var writer = std.Io.File.stdout().writer(init.io, &buffer);
    try writer.interface.writeAll(bytes);
    try writer.interface.flush();
}
pub fn main(init: std.process.Init) !void {
    var args = init.minimal.args.iterate();
    _ = args.next();
    const mode = args.next() orelse return error.ExpectedMode;
    if (std.mem.eql(u8, mode, "link")) {
        const p = args.next() orelse return error.ExpectedProducer;
        const c = args.next() orelse return error.ExpectedConsumer;
        const r = args.next() orelse return error.ExpectedReference;
        if (args.next() != null) return error.UnexpectedArgument;
        const pb = try std.Io.Dir.cwd().readFileAlloc(init.io, p, init.gpa, .limited(64 << 20));
        defer init.gpa.free(pb);
        const cb = try std.Io.Dir.cwd().readFileAlloc(init.io, c, init.gpa, .limited(64 << 20));
        defer init.gpa.free(cb);
        const rb = try std.Io.Dir.cwd().readFileAlloc(init.io, r, init.gpa, .limited(64 << 20));
        defer init.gpa.free(rb);
        Application.reference_bytes = rb;
        Application.producer = pb;
        Application.consumer = cb;
        var compiled = try agent.compile(init.gpa, System);
        defer compiled.deinit();
        const bytes = try init.gpa.alloc(u8, try boundary.data.program_image.encodedLength(compiled.program));
        defer init.gpa.free(bytes);
        _ = try compiled.encode(init.gpa, bytes);
        return output(init, bytes);
    }
    if (args.next() != null) return error.UnexpectedArgument;
    if (std.mem.eql(u8, mode, "producer") or std.mem.eql(u8, mode, "consumer") or std.mem.eql(u8, mode, "reference") or std.mem.eql(u8, mode, "consumer-forged")) {
        const bytes = try component(init.gpa, std.mem.eql(u8, mode, "consumer"), std.mem.eql(u8, mode, "reference"), std.mem.eql(u8, mode, "consumer-forged"));
        defer init.gpa.free(bytes);
        return output(init, bytes);
    }
    if (std.mem.eql(u8, mode, "model-template")) {
        const request = try P.templateValue(Model, .{ .items = &.{
            .{ .role = .system, .content = .{ .bytes = parser.proposals.instructions } },
            .{ .role = .user, .content = .{ .bytes = "The consumer initially requests an escape-boundary transition before a complete parser. Later feedback may request revised or complete source. Explain inability honestly." } },
        } }, .{ .minimum_calls = 1, .maximum_calls = 1, .parallel_calls = false });
        const bytes = try agent.contracts.encodeOwned(P.Request, init.gpa, request);
        defer init.gpa.free(bytes);
        return output(init, bytes);
    }
    var b = source.Builder.init(init.gpa);
    defer b.deinit();
    const schema = if (std.mem.eql(u8, mode, "input-schema")) try agent.contracts.schema(Input, &b) else if (std.mem.eql(u8, mode, "result-schema")) try agent.contracts.schema(Contribution, &b) else if (std.mem.eql(u8, mode, "model-schema")) try agent.contracts.schema(P.Request, &b) else if (std.mem.eql(u8, mode, "model-reply-schema")) try agent.contracts.schema(P.Result, &b) else return error.InvalidMode;
    const bytes = try boundary.data.schema.encodeOwned(init.gpa, b.schemas.items, schema);
    defer init.gpa.free(bytes);
    return output(init, bytes);
}

const Reference = struct {
    pub fn emit(b: *source.Builder, q: hyper.Query) !Id {
        const t = try types(b);
        const task = try b.declare(&.{}, t.contribution, &.{ t.model, t.reference, t.execution }, &.{});
        try b.define(task, try referenceStep(b, t, q.state));
        const descriptor = try b.declare(&.{}, t.task, &.{}, &.{});
        try b.define(descriptor, try b.pure(try b.lambda(task, t.task)));
        return b.pure(try b.lambda(descriptor, q.types.answer_forward));
    }
};
fn referenceParticipant(b: *source.Builder, t: Types, q: hyper.Query) !Id {
    const participant = try b.variable(t.pair.backward);
    const delayed = try b.variable(t.pair.answer_backward);
    const task = try b.variable(t.task);
    const contribution = try b.variable(t.contribution);
    const observed = try checkedReference(b, t, try field(b, Input, q.state, 0), try b.reference(contribution));
    const run = try b.bind(delayed, try hyper.invoke(b, try b.reference(participant), q.peer), try b.bind(task, try hyper.force(b, try b.reference(delayed)), try b.bind(contribution, try hyper.force(b, try b.reference(task)), observed)));
    return b.bind(participant, try b.term(.{ .call = .{ .function = t.reference_factory, .arguments = &.{q.state} } }), run);
}
fn checkedReference(b: *source.Builder, t: Types, input: Id, value: Id) !Id {
    const reference_reply = try b.variable(try agent.contracts.schema(Constraint, b));
    const wrong = try unresolved(b, t, "The reference participant returned an incompatible contribution.");
    const matches = try b.primitive(try b.scalar(bool), .equal, &.{
        try field(b, u64, try field(b, parser.ReferenceReply, try b.reference(reference_reply), 1), 0), try field(b, u64, input, 3),
    }, 0);
    const verified = try b.term(.{ .conditional = .{ .condition = matches, .when_true = try b.pure(value), .when_false = try unresolved(b, t, "The reference participant returned a stale occurrence.") } });
    return b.term(.{ .match_sum = .{ .value = value, .cases = &.{
        .{ .variable = reference_reply, .body = verified },
        .{ .variable = try b.variable(try agent.contracts.schema(Constructed, b)), .body = wrong },
        .{ .variable = try b.variable(try agent.contracts.schema(Report, b)), .body = wrong },
        .{ .variable = try b.variable(try agent.contracts.schema(agent.contracts.Text(512), b)), .body = wrong },
    } } });
}

fn successor(b: *source.Builder, state: Id) !Id {
    var values: [std.meta.fields(State).len]Id = undefined;
    inline for (std.meta.fields(State), 0..) |item, index|
        values[index] = if (index == 1) try b.constant(bool, true) else try field(b, item.type, state, index);
    return b.primitive(try agent.contracts.schema(State, b), .product, &values, 0);
}
fn arithmetic(b: *source.Builder, opcode: boundary.data.program.Opcode, left: Id, right: Id) !Id {
    return b.value(.{ .schema = try b.scalar(u64), .expression = .{ .primitive = .{
        .opcode = opcode,
        .operands = &.{ left, right },
        .failures = &.{.{ .kind = .arithmetic_overflow, .value = try b.failureLiteral(try b.constant(void, {})) }},
    } } });
}
fn offered(c: agent.Context, version: Id) !Id {
    const first = try c.builder.primitive(try c.builder.scalar(bool), .equal, &.{ version, try c.builder.constant(u64, 1) }, 0);
    const permit_complete = try c.builder.primitive(try c.builder.scalar(bool), .equal, &.{ first, try c.builder.constant(bool, false) }, 0);
    return c.builder.primitive(try c.schema([5]bool), .sequence, &.{
        try c.builder.constant(bool, true),  permit_complete,                    try c.builder.constant(bool, false),
        try c.builder.constant(bool, false), try c.builder.constant(bool, true),
    }, 0);
}
fn revisionPrompt(c: agent.Context, request: Id, state: Id) !Id {
    const b = c.builder;
    const prior = try b.variable(try c.schema(Report));
    const candidate = try field(b, parser.Candidate, try b.reference(prior), 0);
    const code = try field(b, parser.Code, candidate, 0);
    const prefix = try b.variable(try c.schema(P.MessageText));
    const content = try b.value(.{ .schema = try c.schema(P.MessageText), .expression = .{ .primitive = .{
        .opcode = .blob_concat,
        .operands = &.{ try b.reference(prefix), code },
        .failures = &.{.{ .kind = .capacity_exceeded, .value = try b.failureLiteral(try b.constant(void, {})) }},
    } } });
    const observation = try field(b, parser.ExecutionReply, try b.reference(prior), 1);
    const outcome = try field(b, @FieldType(parser.ExecutionReply, "outcome"), observation, 2);
    const revised = try b.bind(prefix, try feedbackText(c, outcome), try b.pure(try appendMessage(c, request, content)));
    return b.term(.{ .match_sum = .{ .value = try field(b, ?Report, state, 4), .cases = &.{
        .{ .variable = try b.variable(try b.scalar(void)), .body = try b.pure(request) },
        .{ .variable = prior, .body = revised },
    } } });
}
fn assessAndContinue(b: *source.Builder, t: Types, q: hyper.Query, constructed: Id) !Id {
    const candidate = try field(b, parser.Candidate, constructed, 0);
    const reference_reply = try field(b, parser.ReferenceReply, constructed, 1);
    const observation = try b.variable(try agent.contracts.schema(parser.ExecutionReply, b));
    const report = try b.primitive(try agent.contracts.schema(Report, b), .product, &.{ candidate, try b.reference(observation) }, 0);
    const finish = try b.pure(try b.primitive(t.contribution, .variant, &.{report}, 2));
    const again = try reenter(b, t, q, report, reference_reply, finish);
    const assessment = try b.variable(try agent.contracts.schema(parser.Assessment, b));
    const passes = try b.term(.{ .conditional = .{ .condition = try field(b, bool, try b.reference(assessment), 0), .when_true = try completeAssessment(b, t, try b.reference(assessment), finish), .when_false = again } });
    const outcome = try field(b, @FieldType(parser.ExecutionReply, "outcome"), try b.reference(observation), 2);
    const next = try b.term(.{ .match_sum = .{ .value = outcome, .cases = &.{
        .{ .variable = try b.variable(try agent.contracts.schema(parser.Probe, b)), .body = again },
        .{ .variable = assessment, .body = passes },
        .{ .variable = try b.variable(try agent.contracts.schema(parser.Unavailable, b)), .body = finish },
    } } });
    const probed = try b.bind(observation, try b.term(.{ .call = .{ .function = t.probe, .arguments = &.{ q.state, candidate } } }), next);
    const completeness = try field(b, parser.Completeness, candidate, 2);
    const complete = try b.primitive(try b.scalar(bool), .equal, &.{
        try b.primitive(try b.scalar(u32), .enum_tag, &.{completeness}, 0), try b.constant(u32, 1),
    }, 0);
    const checked = try b.term(.{ .conditional = .{ .condition = complete, .when_true = try b.pure(try b.primitive(t.contribution, .variant, &.{constructed}, 1)), .when_false = probed } });
    const current = try b.primitive(try b.scalar(bool), .equal, &.{ try field(b, u64, candidate, 1), try field(b, u64, q.state, 2) }, 0);
    return b.term(.{ .conditional = .{ .condition = current, .when_true = checked, .when_false = try unresolved(b, t, "Candidate version is stale.") } });
}
fn reenter(b: *source.Builder, t: Types, q: hyper.Query, report: Id, reference_reply: Id, exhausted: Id) !Id {
    const remaining = try field(b, u64, q.state, 3);
    const last = try b.primitive(try b.scalar(bool), .equal, &.{ remaining, try b.constant(u64, 1) }, 0);
    const state = try b.primitive(t.state, .product, &.{
        try field(b, Input, q.state, 0),                                                        try b.constant(bool, false),
        try arithmetic(b, .integer_add, try field(b, u64, q.state, 2), try b.constant(u64, 1)), try arithmetic(b, .integer_sub, remaining, try b.constant(u64, 1)),
        try b.primitive(try agent.contracts.schema(?Report, b), .variant, &.{report}, 1),       try b.primitive(try agent.contracts.schema(?parser.ReferenceReply, b), .variant, &.{reference_reply}, 1),
    }, 0);
    const participant = try b.variable(q.types.forward);
    const delayed = try b.variable(q.types.answer_forward);
    const task = try b.variable(t.task);
    const invoked = try hyper.invoke(b, try b.reference(participant), q.peer);
    const continued = try b.bind(participant, try b.term(.{ .call = .{ .function = q.maker, .arguments = &.{state} } }), try b.bind(delayed, invoked, try b.bind(task, try hyper.force(b, try b.reference(delayed)), try hyper.force(b, try b.reference(task)))));
    return b.term(.{ .conditional = .{ .condition = last, .when_true = exhausted, .when_false = continued } });
}

fn feedbackText(c: agent.Context, outcome: Id) !Id {
    const b = c.builder;
    const probe = try b.variable(try c.schema(parser.Probe));
    const assessment = try b.variable(try c.schema(parser.Assessment));
    const text = struct {
        fn emit(context: agent.Context, value: []const u8) !Id {
            return context.builder.pure(try context.literal(P.MessageText, .{ .bytes = value }));
        }
    }.emit;
    const probe_feedback = try b.term(.{ .conditional = .{
        .condition = try field(b, bool, try b.reference(probe), 1),
        .when_true = try text(c, "The consumer probe passed, but this partial source is not a complete validated artifact. Supply a complete candidate for required acceptance. Previous source:\n"),
        .when_false = try text(c, "The real consumer probe failed on the supplied concrete trace. Revise the source using the batch reference and required immediate-emission behavior. A complete candidate will undergo full acceptance. Previous source:\n"),
    } });
    return b.term(.{ .match_sum = .{ .value = outcome, .cases = &.{
        .{ .variable = probe, .body = probe_feedback },
        .{ .variable = assessment, .body = try text(c, "Required acceptance rejected this complete candidate. Repair it; no validation is established. Previous source:\n") },
        .{ .variable = try b.variable(try c.schema(parser.Unavailable)), .body = try text(c, "The prior check was unavailable. No acceptance is established. Previous source:\n") },
    } } });
}

fn completeAssessment(b: *source.Builder, t: Types, assessment: Id, finished: Id) !Id {
    const invalid = try unresolved(b, t, "Acceptance report is incomplete or inconsistent.");
    const required = try field(b, u32, assessment, 2);
    const empty = try b.primitive(try b.scalar(bool), .equal, &.{ required, try b.constant(u32, 0) }, 0);
    const retained = try b.term(.{ .conditional = .{ .condition = try field(b, bool, assessment, 3), .when_true = finished, .when_false = invalid } });
    const all = try b.primitive(try b.scalar(bool), .equal, &.{ required, try field(b, u32, assessment, 1) }, 0);
    const complete = try b.term(.{ .conditional = .{ .condition = all, .when_true = retained, .when_false = invalid } });
    return b.term(.{ .conditional = .{ .condition = empty, .when_true = invalid, .when_false = complete } });
}

fn completion(c: agent.Context, t: Types, owner: Id, acceptance: Id, state: Id, value: Id) !Id {
    const b = c.builder;
    const candidate = try b.variable(try c.schema(Constructed));
    const report = try b.variable(try c.schema(Report));
    const partial = try field(b, parser.Candidate, try b.reference(report), 0);
    const status = try field(b, parser.Completeness, partial, 2);
    const is_partial = try b.primitive(try b.scalar(bool), .equal, &.{ try b.primitive(try b.scalar(u32), .enum_tag, &.{status}, 0), try b.constant(u32, 0) }, 0);
    const rejected = try unresolved(b, t, "Participant reports do not grant completion authority.");
    const partial_report = try b.term(.{ .conditional = .{ .condition = is_partial, .when_true = try b.pure(value), .when_false = rejected } });
    return b.term(.{ .match_sum = .{ .value = value, .cases = &.{
        .{ .variable = try b.variable(try c.schema(Constraint)), .body = rejected },
        .{ .variable = candidate, .body = try acceptCandidate(c, t, owner, acceptance, state, try b.reference(candidate)) },
        .{ .variable = report, .body = partial_report },
        .{ .variable = try b.variable(try c.schema(agent.contracts.Text(512))), .body = try b.pure(value) },
    } } });
}
fn acceptCandidate(c: agent.Context, t: Types, owner: Id, acceptance: Id, state: Id, constructed: Id) !Id {
    const b = c.builder;
    const input = try field(b, Input, state, 0);
    const candidate = try field(b, parser.Candidate, constructed, 0);
    const version = try field(b, u64, candidate, 1);
    const count = try field(b, u64, input, 4);
    const status = try field(b, parser.Completeness, candidate, 2);
    const complete = try b.primitive(try b.scalar(bool), .equal, &.{ try b.primitive(try b.scalar(u32), .enum_tag, &.{status}, 0), try b.constant(u32, 1) }, 0);
    const reply = try b.variable(try c.schema(parser.ExecutionReply));
    const report = try b.primitive(try c.schema(Report), .product, &.{ candidate, try b.reference(reply) }, 0);
    const finished = try b.pure(try b.primitive(t.contribution, .variant, &.{report}, 2));
    const again = try retryCompletion(c, t, owner, input, constructed, report, finished);
    const assessment = try b.variable(try c.schema(parser.Assessment));
    const assessed = try b.term(.{ .conditional = .{ .condition = try field(b, bool, try b.reference(assessment), 0), .when_true = try completeAssessment(b, t, try b.reference(assessment), finished), .when_false = again } });
    const outcome = try field(b, @FieldType(parser.ExecutionReply, "outcome"), try b.reference(reply), 2);
    const inspected = try b.term(.{ .match_sum = .{ .value = outcome, .cases = &.{
        .{ .variable = try b.variable(try c.schema(parser.Probe)), .body = try unresolved(b, t, "Acceptance returned a probe.") },
        .{ .variable = assessment, .body = assessed },
        .{ .variable = try b.variable(try c.schema(parser.Unavailable)), .body = finished },
    } } });
    const request = try b.primitive(try c.schema(parser.ExecutionRequest), .product, &.{
        try field(b, parser.Subject, input, 0),                                                                                 try arithmetic(b, .integer_add, try field(b, u64, input, 3), version), candidate,
        try b.primitive(try c.schema(@FieldType(parser.ExecutionRequest, "check")), .variant, &.{try b.constant(void, {})}, 1),
    }, 0);
    var execute = try b.bind(reply, try parser.execute(c, .{ .reference = t.reference, .execution = acceptance }, request, try b.constant(void, {})), inspected);
    const invalid = try unresolved(b, t, "Candidate completion or allowance is invalid.");
    const excessive = try b.primitive(try b.scalar(bool), .less, &.{ count, version }, 0);
    execute = try b.term(.{ .conditional = .{ .condition = excessive, .when_true = invalid, .when_false = execute } });
    const zero = try b.primitive(try b.scalar(bool), .equal, &.{ version, try b.constant(u64, 0) }, 0);
    execute = try b.term(.{ .conditional = .{ .condition = zero, .when_true = invalid, .when_false = execute } });
    return b.term(.{ .conditional = .{ .condition = complete, .when_true = execute, .when_false = invalid } });
}
fn retryCompletion(c: agent.Context, t: Types, owner: Id, input: Id, constructed: Id, report: Id, finished: Id) !Id {
    const b = c.builder;
    const candidate = try field(b, parser.Candidate, constructed, 0);
    const version = try field(b, u64, candidate, 1);
    const count = try field(b, u64, input, 4);
    const more = try b.primitive(try b.scalar(bool), .less, &.{ version, count }, 0);
    const state = try b.primitive(t.state, .product, &.{
        input,                                                            try b.constant(bool, false),
        try arithmetic(b, .integer_add, version, try b.constant(u64, 1)), try arithmetic(b, .integer_sub, count, version),
        try b.primitive(try c.schema(?Report), .variant, &.{report}, 1),  try b.primitive(try c.schema(?parser.ReferenceReply), .variant, &.{try field(b, parser.ReferenceReply, constructed, 1)}, 1),
    }, 0);
    const retry = try b.term(.{ .call = .{ .function = owner, .arguments = &.{state} } });
    try c.registry.allowPrivateCall(owner, retry, owner);
    return b.term(.{ .conditional = .{ .condition = more, .when_true = retry, .when_false = finished } });
}

// Adversarial test object: ordinary fields cannot impersonate completion authority.
const ForgedConsumer = struct {
    pub fn emit(b: *source.Builder, q: hyper.Query) !Id {
        const t = try types(b);
        const forged = try literal(b, Contribution, .{ .assessed = .{
            .candidate = .{ .source = .{ .bytes = "unvalidated source" }, .version = 1, .completeness = .complete },
            .observation = .{ .occurrence = 18, .candidate_version = 1, .outcome = .{ .assessment = .{
                .passed = true,
                .executed = 536,
                .required = 536,
                .retention_passed = true,
                .first_failure = .{ .bytes = "" },
            } } },
        } });
        const task = try b.declare(&.{}, t.contribution, &.{ t.model, t.reference, t.execution }, &.{});
        try b.define(task, try b.pure(forged));
        const description = try b.declare(&.{}, t.task, &.{}, &.{});
        try b.define(description, try b.pure(try b.lambda(task, t.task)));
        return b.pure(try b.lambda(description, q.types.answer_forward));
    }
};
