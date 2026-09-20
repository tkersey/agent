//! Consumer-directed parser construction using compiled task-valued hyperfunctions.
const std = @import("std");
const agent = @import("agent");
const boundary = @import("boundary");
const source = boundary.computation;
const hyper = boundary.library.hyper;
const parser = agent.parser_synthesis;
const P = parser.proposals.Profile;
const Id = source.Id;
pub const Input = struct { subject: parser.Subject, model: P.Request, trace: parser.Trace, occurrence: u64 };
const State = struct { input: Input, successor: bool };
pub const Report = struct { candidate: parser.Candidate, observation: parser.ExecutionReply };
pub const Contribution = union(enum(u32)) {
    reference: parser.ReferenceReply = 0,
    candidate: parser.Candidate = 1,
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
    const execution = try b.effect(.{ .identity = parser.execution_identity, .payload = try agent.contracts.schema(parser.ExecutionRequest, b), .result = try agent.contracts.schema(parser.ExecutionReply, b) });
    const task = try b.reserveSchema();
    const pair = try hyper.pairWith(b, task, task, &.{ state, contribution });
    try b.defineSchema(task, .{ .internal = .{ .computation = .{ .parameters = &.{}, .result = contribution, .effects = &.{ model, reference, execution }, .capture_bound = &.{ state, pair.peer_forward, pair.peer_backward } } } });
    const sample = try b.declare(&.{ state, try agent.contracts.schema(parser.ReferenceReply, b) }, contribution, &.{model}, &.{});
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
    const input = try field(b, Input, q.state, 0);
    const next = try b.primitive(t.state, .product, &.{ input, try b.constant(bool, true) }, 0);
    const received = try b.variable(t.contribution);
    const requested = try hyper.demand.request(b, need, try b.reference(b.parameter(body, 0)), next);
    const continued = try afterContribution(b, t, q.state, try b.reference(received), consumer);
    var instructions = try b.bind(received, requested, continued);
    if (consumer) instructions = try b.term(.{ .conditional = .{
        .condition = try field(b, bool, q.state, 1),
        .when_true = try referenceParticipant(b, t, q),
        .when_false = instructions,
    } });
    try b.define(body, instructions);
    const task = try b.declare(&.{}, t.contribution, &.{ t.model, t.reference, t.execution }, &.{});
    try b.define(task, try hyper.demand.handle(b, interpreted, q.peer, try b.lambda(body, interpreted.body)));
    const descriptor = try b.declare(&.{}, t.task, &.{}, &.{});
    try b.define(descriptor, try b.pure(try b.lambda(task, t.task)));
    return b.pure(try b.lambda(descriptor, q.types.answer_forward));
}
fn referenceStep(b: *source.Builder, t: Types, input: Id) !Id {
    const request = try b.primitive(try agent.contracts.schema(parser.ReferenceRequest, b), .product, &.{
        try field(b, parser.Subject, input, 0), try field(b, u64, input, 3), try field(b, parser.Trace, input, 2),
    }, 0);
    const reply = try b.variable(try agent.contracts.schema(parser.ReferenceReply, b));
    return b.bind(reply, try b.term(.{ .perform = .{ .effect = t.reference, .payload = request } }), try b.pure(try b.primitive(t.contribution, .variant, &.{try b.reference(reply)}, 0)));
}
fn afterContribution(b: *source.Builder, t: Types, state: Id, value: Id, consumer: bool) !Id {
    var cases: [4]struct { variable: Id, body: Id } = undefined;
    const schemas = [_]Id{ try agent.contracts.schema(parser.ReferenceReply, b), try agent.contracts.schema(parser.Candidate, b), try agent.contracts.schema(Report, b), try agent.contracts.schema(agent.contracts.Text(512), b) };
    for (schemas, 0..) |schema, index| {
        const variable = try b.variable(schema);
        var body = try unresolved(b, t, "Unexpected counterpart contribution.");
        if (index == 3) body = try b.pure(try b.primitive(t.contribution, .variant, &.{try b.reference(variable)}, 3));
        if (!consumer and index == 0) body = try b.term(.{ .call = .{ .function = t.sample, .arguments = &.{ state, try b.reference(variable) } } });
        if (consumer and index == 1) {
            const observation = try b.variable(try agent.contracts.schema(parser.ExecutionReply, b));
            const report = try b.primitive(try agent.contracts.schema(Report, b), .product, &.{ try b.reference(variable), try b.reference(observation) }, 0);
            body = try b.bind(observation, try b.term(.{ .call = .{ .function = t.probe, .arguments = &.{ state, try b.reference(variable) } } }), try b.pure(try b.primitive(t.contribution, .variant, &.{report}, 2)));
        }
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

fn component(allocator: std.mem.Allocator, consumer: bool, reference_only: bool) ![]u8 {
    var b = source.Builder.init(allocator);
    defer b.deinit();
    const t = try types(&b);
    const definition = if (reference_only) try hyper.ana(&b, hyper.swap(t.pair), t.state, Reference) else if (consumer) try hyper.ana(&b, hyper.swap(t.pair), t.state, Consumer) else try hyper.ana(&b, t.pair, t.state, Producer);
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
    const reference_reply = try b.reference(b.parameter(t.sample, 1));
    const input = try field(b, Input, state, 0);
    const outcome = try field(b, @FieldType(parser.ReferenceReply, "outcome"), reference_reply, 1);
    const rows = try b.variable(try c.schema(parser.Observations));
    const unavailable = try b.variable(try c.schema(parser.Unavailable));
    const result = try b.variable(try c.schema(P.Interpretation));
    const answer = try b.variable(try c.schema(parser.proposals.Proposal));
    const rejected = try b.variable(try c.schema(P.InterpretationFailure));
    const interpreted = try b.term(.{ .match_sum = .{ .value = try b.reference(result), .cases = &.{
        .{ .variable = answer, .body = try candidateProposal(c, t, try b.reference(answer)) },
        .{ .variable = rejected, .body = try unresolved(b, t, "The model response was rejected.") },
    } } });
    const request = try appendSummary(c, try field(b, P.Request, input, 1), try b.reference(rows));
    const sampled = try b.bind(result, try agent.responders.invokeModel(P, c, try b.constant(void, {}), false, request, try c.literal([5]bool, .{ true, false, false, false, true })), interpreted);
    const dispatch = try b.term(.{ .match_sum = .{ .value = outcome, .cases = &.{
        .{ .variable = rows, .body = sampled },
        .{ .variable = unavailable, .body = try unresolved(b, t, "Reference evidence is unavailable.") },
    } } });
    const matching = try b.primitive(try b.scalar(bool), .equal, &.{
        try field(b, u64, reference_reply, 0), try field(b, u64, input, 3),
    }, 0);
    try b.define(t.sample, try b.term(.{ .conditional = .{ .condition = matching, .when_true = dispatch, .when_false = try unresolved(b, t, "Reference occurrence is stale.") } }));
}
fn candidateProposal(c: agent.Context, t: Types, answer: Id) !Id {
    const b = c.builder;
    var cases: [5]struct { variable: Id, body: Id } = undefined;
    inline for (std.meta.fields(parser.proposals.Proposal), 0..) |item, index| {
        const variable = try b.variable(try c.schema(item.type));
        var body = try unresolved(b, t, "The proposal does not answer the current fragment demand.");
        if (index == 0) {
            const code = try field(b, parser.Code, try b.reference(variable), 0);
            const candidate = try b.primitive(try c.schema(parser.Candidate), .product, &.{
                code, try b.constant(u64, 1), try c.literal(parser.Completeness, .partial),
            }, 0);
            body = try b.pure(try b.primitive(t.contribution, .variant, &.{candidate}, 1));
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
        .operands = &.{ try field(b, u64, input, 3), try b.constant(u64, 1) },
        .failures = &.{.{ .kind = .arithmetic_overflow, .value = try b.failureLiteral(try b.constant(void, {})) }},
    } } });
    const check = try b.primitive(try c.schema(@FieldType(parser.ExecutionRequest, "check")), .variant, &.{try field(b, parser.Trace, input, 2)}, 0);
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
        const entry = try b.declare(&.{t.input}, t.contribution, &.{ t.model, t.reference, t.execution }, &.{});
        const initial = try b.primitive(t.state, .product, &.{ try b.reference(b.parameter(entry, 0)), try b.constant(bool, false) }, 0);
        const produced = try b.variable(t.pair.forward);
        const consumed = try b.variable(t.pair.backward);
        const peer = try b.declare(&.{}, t.pair.forward, &.{}, &.{});
        try b.define(peer, try b.pure(try b.reference(produced)));
        const delayed = try b.variable(t.pair.answer_backward);
        const task = try b.variable(t.task);
        const run = try b.bind(delayed, try hyper.invoke(b, try b.reference(consumed), try b.lambda(peer, t.pair.peer_forward)), try b.bind(task, try hyper.force(b, try b.reference(delayed)), try hyper.force(b, try b.reference(task))));
        const next = try b.bind(consumed, try b.term(.{ .call = .{ .function = z, .arguments = &.{initial} } }), run);
        try b.define(entry, try b.bind(produced, try b.term(.{ .call = .{ .function = p, .arguments = &.{initial} } }), next));
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
    if (std.mem.eql(u8, mode, "producer") or std.mem.eql(u8, mode, "consumer") or std.mem.eql(u8, mode, "reference")) {
        const bytes = try component(init.gpa, std.mem.eql(u8, mode, "consumer"), std.mem.eql(u8, mode, "reference"));
        defer init.gpa.free(bytes);
        return output(init, bytes);
    }
    if (std.mem.eql(u8, mode, "model-template")) {
        const request = try P.templateValue(Model, .{ .items = &.{
            .{ .role = .system, .content = .{ .bytes = parser.proposals.instructions } },
            .{ .role = .user, .content = .{ .bytes = "The consumer requests an escape-boundary transition before a complete parser. Supply partial source only, or explain inability." } },
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
        try b.define(task, try referenceStep(b, t, try field(b, Input, q.state, 0)));
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
    const reference_reply = try b.variable(try agent.contracts.schema(parser.ReferenceReply, b));
    const wrong = try unresolved(b, t, "The reference participant returned an incompatible contribution.");
    const matches = try b.primitive(try b.scalar(bool), .equal, &.{
        try field(b, u64, try b.reference(reference_reply), 0), try field(b, u64, input, 3),
    }, 0);
    const verified = try b.term(.{ .conditional = .{ .condition = matches, .when_true = try b.pure(value), .when_false = try unresolved(b, t, "The reference participant returned a stale occurrence.") } });
    return b.term(.{ .match_sum = .{ .value = value, .cases = &.{
        .{ .variable = reference_reply, .body = verified },
        .{ .variable = try b.variable(try agent.contracts.schema(parser.Candidate, b)), .body = wrong },
        .{ .variable = try b.variable(try agent.contracts.schema(Report, b)), .body = wrong },
        .{ .variable = try b.variable(try agent.contracts.schema(agent.contracts.Text(512), b)), .body = wrong },
    } } });
}
