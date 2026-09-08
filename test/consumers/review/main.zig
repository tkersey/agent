//! Independent consuming application: all review order and policy live here.
const std = @import("std");
const agent = @import("agent");
const boundary = @import("boundary");
const source = boundary.computation;
const Builder = source.Builder;
const Id = source.Id;
const Mode = enum { mid_review, clarify_first, human, model, rule, react };
const Finding = struct { kind: u32, score: u32 };
const Memory = struct { last_evidence: u32, last_score: u32 };
const Report = struct {
    evidence: u32,
    clarification: u32,
    findings: [2]Finding,
    scope: u32,
    previous_evidence: u32,
};
const Turn = struct { memory: Memory, report: Report };
const P = agent.model_invocation.Question(u32, "answer", "Answer the numeric review question.", .{
    .model_id_bytes = 64,
    .temperature_bytes = 8,
    .maximum_messages = 4,
    .message_bytes = 256,
    .maximum_output_items = 4,
    .call_id_bytes = 32,
    .arguments_json_bytes = 128,
    .result_text_bytes = 256,
    .provider_response_bytes = 4096,
});
const FixtureModel = agent.model(.{
    .name = "review",
    .protocol = struct {
        pub const semantic_identity = agent.model_invocation.protocol_identity;
    },
    .model = "fixture-review-model",
    .parameters = .{ .temperature = "0" },
});
const selection = agent.model_invocation.Selection{
    .minimum_calls = 1,
    .maximum_calls = 1,
    .parallel_calls = false,
};

fn Application(comptime mode: Mode) type {
    return struct {
        pub fn emit(c: agent.Context) !source.Module {
            if (mode == .react) return reactRoot(c);
            if (mode == .human or mode == .model or mode == .rule)
                return headless(c, mode);
            return review(c, mode);
        }
    };
}

fn System(comptime mode: Mode) type {
    return agent.system(.{
        .InitialArgs = u32,
        .Result = if (mode == .mid_review or mode == .clarify_first) Memory else u32,
        .Failure = void,
        .application = Application(mode),
    });
}

fn arithmetic(b: *Builder, left: Id, right: Id) !Id {
    return b.value(.{ .schema = try b.scalar(u32), .expression = .{ .primitive = .{
        .opcode = .integer_add,
        .operands = &.{ left, right },
        .failures = &.{.{ .kind = .arithmetic_overflow, .value = try b.failureLiteral(try b.constant(void, {})) }},
    } } });
}

fn computation(b: *Builder, parameters: []const Id, result: Id, effects: []const Id) !Id {
    return b.schema(.{ .internal = .{ .computation = .{
        .parameters = parameters,
        .result = result,
        .effects = effects,
    } } });
}

fn exchange(c: agent.Context, name: []const u8, outgoing: Id, input: Id, close: bool) !agent.interaction.Definition {
    const text = try c.schema(agent.contracts.Utf8);
    const unit = try c.schema(void);
    const definition = try agent.interaction.define(c.builder, .{
        .name = name,
        .channel = text,
        .purpose = text,
        .presentation = unit,
        .outgoing = outgoing,
        .input = input,
        .close_conversation = if (close) unit else null,
    });
    try c.registry.classify(definition.effect, .interaction);
    return definition;
}

fn values(c: agent.Context, purpose: []const u8, outgoing: Id) !agent.interaction.Outgoing {
    return .{
        .channel = try c.literal(agent.contracts.Utf8, .{ .bytes = "review-reader" }),
        .purpose = try c.literal(agent.contracts.Utf8, .{ .bytes = purpose }),
        .presentation = try c.literal(void, {}),
        .outgoing = outgoing,
    };
}

fn askBody(b: *Builder, family: agent.decision.Family) !Id {
    const body = try b.declare(&.{ family.capability, family.question }, family.answer, &.{family.effect}, &.{});
    const answer = try b.variable(family.answer);
    const after = try arithmetic(b, try b.reference(answer), try b.constant(u32, 1));
    try b.define(body, try b.bind(answer, try agent.decision.ask(b, family, try b.reference(b.parameter(body, 0)), try b.reference(b.parameter(body, 1))), try b.pure(after)));
    return b.lambda(body, try computation(b, &.{ family.capability, family.question }, family.answer, &.{family.effect}));
}

const Responder = struct { function: Id, schema: Id, effects: []const Id };

fn responder(c: agent.Context, mode: Mode) !Responder {
    const b = c.builder;
    const integer = try c.schema(u32);
    if (mode == .rule) {
        const function = try b.declare(&.{integer}, integer, &.{}, &.{});
        try b.define(function, try b.pure(try b.reference(b.parameter(function, 0))));
        return .{ .function = function, .schema = try computation(b, &.{integer}, integer, &.{}), .effects = &.{} };
    }
    if (mode == .human) return humanResponder(c);
    return modelResponder(c);
}

fn humanResponder(c: agent.Context) !Responder {
    const b = c.builder;
    const integer = try c.schema(u32);
    const contract = try exchange(c, "review.answer", integer, integer, false);
    const effects = try b.allocator().dupe(Id, &.{contract.effect});
    const function = try b.declare(&.{integer}, integer, effects, &.{});
    const response = try b.variable(contract.reply);
    const value = try b.variable(integer);
    const offered = try agent.interaction.exchange(b, contract, try values(c, "clarification", try b.reference(b.parameter(function, 0))));
    const accepted = try b.term(.{ .match_sum = .{
        .value = try b.reference(response),
        .cases = &.{.{ .variable = value, .body = try b.pure(try b.reference(value)) }},
    } });
    try b.define(function, try b.bind(response, offered, accepted));
    return .{ .function = function, .schema = try computation(b, &.{integer}, integer, effects), .effects = effects };
}

fn modelResponder(c: agent.Context) !Responder {
    const b = c.builder;
    const integer = try c.schema(u32);
    const effect = try P.declare(b);
    try c.registry.classify(effect, .model);
    const effects = try b.allocator().dupe(Id, &.{effect});
    const function = try b.declare(&.{integer}, integer, effects, &.{});
    const interpreted = try b.variable(try c.schema(P.Interpretation));
    const accepted = try b.variable(try c.schema(P.AnswerType));
    const rejected = try b.variable(try c.schema(P.InterpretationFailure));
    const answer = try b.variable(try c.schema(@FieldType(P.AnswerType, "answer")));
    const unwrapped = try b.term(.{ .match_sum = .{
        .value = try b.reference(accepted),
        .cases = &.{.{ .variable = answer, .body = try b.pure(try b.primitive(integer, .field, &.{try b.reference(answer)}, 0)) }},
    } });
    const checked = try b.term(.{ .match_sum = .{
        .value = try b.reference(interpreted),
        .cases = &.{
            .{ .variable = accepted, .body = unwrapped },
            .{ .variable = rejected, .body = try b.term(.{ .fail = try c.literal(void, {}) }) },
        },
    } });
    const request = try modelRequest(c, try b.reference(b.parameter(function, 0)));
    const invocation = try agent.responders.invokeModel(P, c, try c.literal(void, {}), false, request, try c.literal([1]bool, .{true}));
    try b.define(function, try b.bind(interpreted, invocation, checked));
    return .{ .function = function, .schema = try computation(b, &.{integer}, integer, effects), .effects = effects };
}

fn modelRequest(c: agent.Context, question: Id) !Id {
    const b = c.builder;
    const request = try P.templateValue(FixtureModel, .{ .items = &.{} }, selection);
    const base = try c.literal(P.Request, request);
    const text = try b.primitive(try b.schema(.text), .text_integer, &.{question}, 0);
    const content = try b.value(.{
        .schema = try c.schema(P.MessageText),
        .expression = .{ .primitive = .{
            .opcode = .blob_concat,
            .operands = &.{ try c.literal(P.MessageText, .{ .bytes = "Review question: " }), text },
            .failures = &.{.{ .kind = .capacity_exceeded, .value = try b.failureLiteral(try c.literal(void, {})) }},
        } },
    });
    const message = try b.primitive(try c.schema(P.Message), .product, &.{
        try c.literal(agent.model_invocation.MessageRole, .user), content,
    }, 0);
    const messages = try b.primitive(try c.schema(P.Messages), .sequence, &.{message}, 0);
    var fields: [std.meta.fields(P.Request).len]Id = undefined;
    inline for (std.meta.fields(P.Request), 0..) |field, index| {
        fields[index] = if (comptime std.mem.eql(u8, field.name, "messages")) messages else try b.primitive(try c.schema(field.type), .field, &.{base}, index);
    }
    return b.primitive(try c.schema(P.Request), .product, &fields, 0);
}

fn headless(c: agent.Context, mode: Mode) !source.Module {
    const b = c.builder;
    const integer = try c.schema(u32);
    const family = try agent.decision.define(b, "review.question.v1", integer, integer);
    const selected = try responder(c, mode);
    const interpretation = try agent.decision.interpret(b, family, integer, selected.schema, .{ .captures = &.{integer}, .residual = .{ .effects = selected.effects } });
    const entry = try b.declare(&.{integer}, integer, selected.effects, &.{});
    try b.define(entry, try agent.decision.handle(b, interpretation, try askBody(b, family), try b.lambda(selected.function, selected.schema), &.{try b.reference(b.parameter(entry, 0))}));
    return b.module(entry, try c.schema(void));
}

const ReviewParts = struct {
    integer: Id,
    memory: Id,
    report: Id,
    turn: Id,
    read: Id,
    clarification: agent.interaction.Definition,
    question: agent.decision.Family,
    response: Responder,
    interpretation: agent.decision.Interpretation,
    effects: []const Id,
};

fn review(c: agent.Context, mode: Mode) !source.Module {
    const b = c.builder;
    const r = try reviewParts(c);
    const next = try exchange(c, "review.next", r.report, r.integer, true);
    const all = try b.allocator().alloc(Id, r.effects.len + 1);
    @memcpy(all[0..r.effects.len], r.effects);
    all[r.effects.len] = next.effect;
    const turn = try reviewTurn(c, r, mode);
    const finish = try b.declare(&.{ r.memory, try c.schema(void) }, r.memory, &.{}, &.{});
    try b.define(finish, try b.pure(try b.reference(b.parameter(finish, 0))));
    const display = try values(c, "message", try c.literal(u32, 0));
    const loop = try agent.conversation.define(b, .{
        .memory = r.memory,
        .input = r.integer,
        .reply = r.report,
        .result = r.memory,
        .exchange = next,
        .turn = turn,
        .finish = finish,
        .channel = display.channel,
        .purpose = display.purpose,
        .presentation = display.presentation,
        .residual = .{ .effects = all },
    });
    const entry = try b.declare(&.{r.integer}, r.memory, all, &.{});
    try b.define(entry, try agent.conversation.run(b, loop, try c.literal(Memory, .{ .last_evidence = 0, .last_score = 0 }), try b.reference(b.parameter(entry, 0))));
    return b.module(entry, try c.schema(void));
}

fn reviewParts(c: agent.Context) !ReviewParts {
    const b = c.builder;
    const integer = try c.schema(u32);
    const read = try c.external("review.evidence.read.v1", integer, integer, .read);
    const clarification = try exchange(c, "review.clarification", integer, integer, false);
    const question = try agent.decision.define(b, "review.question.v1", integer, integer);
    const response = try responder(c, .model);
    const interpreted = try agent.decision.interpret(b, question, integer, response.schema, .{ .captures = &.{integer}, .residual = .{ .effects = response.effects } });
    const effects = try b.allocator().dupe(Id, &.{ read, clarification.effect, response.effects[0] });
    return .{ .integer = integer, .memory = try c.schema(Memory), .report = try c.schema(Report), .turn = try c.schema(Turn), .read = read, .clarification = clarification, .question = question, .response = response, .interpretation = interpreted, .effects = effects };
}

fn reviewTurn(c: agent.Context, r: ReviewParts, mode: Mode) !Id {
    const b = c.builder;
    const scope = try agent.scopes.define(b, "review.instructions.v1", r.integer, r.turn, .{ .captures = &.{ r.integer, r.memory, r.report }, .residual = .{ .effects = r.effects } });
    const inner_effects = try b.allocator().alloc(Id, r.effects.len + 1);
    @memcpy(inner_effects[0..r.effects.len], r.effects);
    inner_effects[r.effects.len] = scope.family.effect;
    const body = try b.declare(&.{ scope.family.capability, r.memory, r.integer }, r.turn, inner_effects, &.{});
    const environment = try b.variable(r.integer);
    const evidence = try b.variable(r.integer);
    const ending = try reviewOrder(c, r, mode, body, environment, evidence);
    const read = try b.term(.{ .perform = .{
        .effect = r.read,
        .payload = try b.reference(b.parameter(body, 2)),
    } });
    try b.define(body, try b.bind(environment, try agent.scopes.read(b, scope, try b.reference(b.parameter(body, 0))), try b.bind(evidence, read, ending)));
    const turn = try b.declare(&.{ r.memory, r.integer }, r.turn, r.effects, &.{});
    const body_type = try computation(b, &.{ scope.family.capability, r.memory, r.integer }, r.turn, inner_effects);
    try b.define(turn, try agent.scopes.enter(b, scope, try b.lambda(body, body_type), try c.literal(u32, 9), &.{
        try b.reference(b.parameter(turn, 0)), try b.reference(b.parameter(turn, 1)),
    }));
    return turn;
}

fn reviewOrder(c: agent.Context, r: ReviewParts, mode: Mode, body: Id, environment: Id, evidence: Id) !Id {
    const b = c.builder;
    const clarified = try b.variable(r.integer);
    const score = try b.variable(r.integer);
    const old = try b.reference(b.parameter(body, 1));
    const question = try arithmetic(b, try b.reference(evidence), try b.reference(environment));
    const final = try reportResult(c, r, old, evidence, clarified, score, environment);
    const model_question = if (mode == .clarify_first)
        try arithmetic(b, question, try b.reference(clarified))
    else
        question;
    const model = try agent.decision.handle(b, r.interpretation, try askBody(b, r.question), try b.lambda(r.response.function, r.response.schema), &.{model_question});
    const outgoing = if (mode == .mid_review)
        try arithmetic(b, question, try b.reference(score))
    else
        question;
    const clarification = try clarificationCall(c, r.clarification, outgoing);
    if (mode == .mid_review)
        return b.bind(score, model, try b.bind(clarified, clarification, final));
    return b.bind(clarified, clarification, try b.bind(score, model, final));
}

fn clarificationCall(c: agent.Context, contract: agent.interaction.Definition, outgoing: Id) !Id {
    const b = c.builder;
    const response = try b.variable(contract.reply);
    const input = try b.variable(contract.contract.input);
    const next = try b.term(.{ .match_sum = .{
        .value = try b.reference(response),
        .cases = &.{.{ .variable = input, .body = try b.pure(try b.reference(input)) }},
    } });
    return b.bind(response, try agent.interaction.exchange(b, contract, try values(c, "clarification", outgoing)), next);
}

fn reportResult(c: agent.Context, r: ReviewParts, old: Id, evidence: Id, clarification: Id, score: Id, environment: Id) !Id {
    const b = c.builder;
    const finding = try c.schema(Finding);
    const findings = try b.primitive(try c.schema([2]Finding), .sequence, &.{
        try b.primitive(finding, .product, &.{ try c.literal(u32, 0), try b.reference(score) }, 0),
        try b.primitive(finding, .product, &.{ try c.literal(u32, 1), try b.reference(clarification) }, 0),
    }, 0);
    const memory = try b.primitive(r.memory, .product, &.{ try b.reference(evidence), try b.reference(score) }, 0);
    const report = try b.primitive(r.report, .product, &.{
        try b.reference(evidence),    try b.reference(clarification),                 findings,
        try b.reference(environment), try b.primitive(r.integer, .field, &.{old}, 0),
    }, 0);
    return b.pure(try b.primitive(r.turn, .product, &.{ memory, report }, 0));
}

fn reactRoot(c: agent.Context) !source.Module {
    const b = c.builder;
    const integer = try c.schema(u32);
    const step = try agent.react.step(b, integer, integer);
    const decide = try b.declare(&.{integer}, step.schema, &.{}, &.{});
    const state = try b.reference(b.parameter(decide, 0));
    try b.define(decide, try b.term(.{ .conditional = .{
        .condition = try b.primitive(try c.schema(bool), .equal, &.{ state, try c.literal(u32, 0) }, 0),
        .when_true = try b.pure(try agent.react.continueWith(b, step, try c.literal(u32, 1))),
        .when_false = try b.pure(try agent.react.finishWith(b, step, state)),
    } }));
    const execute = try b.declare(&.{integer}, integer, &.{}, &.{});
    try b.define(execute, try b.pure(try arithmetic(b, try b.reference(b.parameter(execute, 0)), try c.literal(u32, 1))));
    const fold = try b.declare(&.{ integer, integer }, integer, &.{}, &.{});
    try b.define(fold, try b.pure(try b.reference(b.parameter(fold, 1))));
    const ds = try computation(b, &.{integer}, step.schema, &.{});
    const es = try computation(b, &.{integer}, integer, &.{});
    const fs = try computation(b, &.{ integer, integer }, integer, &.{});
    const loop = try agent.react.define(b, .{
        .state = integer,
        .step = step,
        .observation = integer,
        .decide = ds,
        .execute = es,
        .fold = fs,
    });
    const entry = try b.declare(&.{integer}, integer, &.{}, &.{});
    try b.define(entry, try agent.react.run(b, loop, try b.reference(b.parameter(entry, 0)), try b.lambda(decide, ds), try b.lambda(execute, es), try b.lambda(fold, fs)));
    return b.module(entry, try c.schema(void));
}

test "external consumers compile all authored orders and responder interpretations" {
    inline for (comptime std.meta.tags(Mode)) |mode| {
        var compiled = try agent.compile(std.testing.allocator, System(mode));
        defer compiled.deinit();
        for (compiled.program.effects) |effect| {
            try std.testing.expect(std.mem.indexOf(u8, effect.identity, "commit") == null);
            try std.testing.expect(std.mem.indexOf(u8, effect.identity, "approval") == null);
            try std.testing.expect(std.mem.indexOf(u8, effect.identity, "write") == null);
        }
    }
}

pub fn main(init: std.process.Init) !void {
    var args = init.minimal.args.iterate();
    _ = args.next();
    const mode = std.meta.stringToEnum(Mode, args.next() orelse return error.MissingMode) orelse
        return error.InvalidMode;
    const format = args.next() orelse "bpi2";
    if (args.next() != null) return error.UnknownArgument;
    var buffer: [4096]u8 = undefined;
    var out = std.Io.File.stdout().writer(init.io, &buffer);
    if (std.mem.eql(u8, format, "args")) {
        const value: u32 = if (mode == .react) 0 else 7;
        const bytes = try agent.contracts.encodeOwned(u32, init.gpa, value);
        defer init.gpa.free(bytes);
        try out.interface.writeAll(bytes);
    } else if (std.mem.eql(u8, format, "bpi2")) {
        inline for (comptime std.meta.tags(Mode)) |candidate| if (mode == candidate) {
            var compiled = try agent.compile(init.gpa, System(candidate));
            defer compiled.deinit();
            const bytes = try init.gpa.alloc(u8, try boundary.image_v2.encodedLength(compiled.program));
            defer init.gpa.free(bytes);
            try out.interface.writeAll(try compiled.encode(init.gpa, bytes));
        };
    } else return error.InvalidFormat;
    try out.interface.flush();
}
