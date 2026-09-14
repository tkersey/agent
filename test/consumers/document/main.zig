//! Independent application. All control below becomes ordinary Boundary source.
const std = @import("std");
const agent = @import("agent");
const boundary = @import("boundary");
const source = boundary.computation;
const Id = source.Id;
const Text = agent.contracts.Text;
const Observation = struct { content: Text(128), digest: Text(64) };
const Proposal = struct {
    path: Text(32),
    base: Observation,
    replacement: Text(128),
    provenance: u64,
    required_principal: u64,
    reason: Text(64),
};
const Operation = union(enum) { success: Observation, conflict: Observation, failure: Text(64), uncertain: Text(64) };
const Read = union(enum) { success: Observation, failure: Text(64) };
const Memory = ?u64;
const Reply = union(enum) {
    revised: u64,
    recalled: u64,
    aborted: void,
    conflict: Observation,
    failed: Text(64),
    uncertain: Text(64),
    declined: Text(64),
    invalid: void,
    denied: void,
};
const Proposed = struct { replacement: Text(128), score: u64 };
const Assessment = struct { candidate: u64, score: u64, provenance: u64, replacement: Text(128) };
const Model = agent.model(.{
    .name = "document-assessor",
    .model = "fixture-model",
    .protocol = struct {
        pub const semantic_identity = "agent.model.protocol.openai-responses-v2";
    },
});
const P = agent.model_invocation.Profile(union(enum) { proposal: Proposed }, .{.{ .name = "proposal", .description = "Propose a document revision and assess its score." }}, .{
    .model_id_bytes = 32,
    .temperature_bytes = 8,
    .maximum_messages = 4,
    .message_bytes = 128,
    .maximum_output_items = 4,
    .call_id_bytes = 32,
    .arguments_json_bytes = 1024,
    .result_text_bytes = 64,
    .provider_response_bytes = 4096,
});
const Environment = struct { model: P.ModelId, instructions: P.MessageText, offered: [1]bool, skills: [64]bool };
const System = agent.system(.{ .InitialArgs = u64, .Result = Memory, .Failure = void, .application = Application });

pub fn main(init: std.process.Init) !void {
    var args = init.minimal.args.iterate();
    _ = args.next();
    const format = args.next() orelse "bpi2";
    if (args.next() != null) return error.UnknownArgument;
    if (std.mem.eql(u8, format, "args")) {
        const bytes = try agent.contracts.encodeOwned(u64, init.gpa, 7);
        defer init.gpa.free(bytes);
        var buffer: [4096]u8 = undefined;
        var output = std.Io.File.stdout().writer(init.io, &buffer);
        try output.interface.writeAll(bytes);
        try output.interface.flush();
        return;
    }
    if (!std.mem.eql(u8, format, "bpi2")) return error.UnknownArgument;
    var compiled = try agent.compile(init.gpa, System);
    defer compiled.deinit();
    const bytes = try init.gpa.alloc(u8, try boundary.image_v2.encodedLength(compiled.program));
    defer init.gpa.free(bytes);
    var buffer: [4096]u8 = undefined;
    var output = std.Io.File.stdout().writer(init.io, &buffer);
    try output.interface.writeAll(try compiled.encode(init.gpa, bytes));
    try output.interface.flush();
}

const Application = struct {
    pub fn emit(c: agent.Context) !source.Module {
        const b = c.builder;
        const unit = try b.scalar(void);
        const integer = try b.scalar(u64);
        const memory = try c.schema(Memory);
        const reply = try c.schema(Reply);
        const pair = try b.schema(.{ .product = &.{ memory, reply } });
        const observation = try c.schema(Observation);
        const proposal = try c.schema(Proposal);
        const read = try c.external("document.read.v1", try c.schema(Text(32)), try c.schema(Read), .read);
        const observed = try agent.observation.define(c, "document.base", read);
        const commit = try c.external("document.replace.v1", proposal, try c.schema(Operation), .commit);
        const model = try P.declare(b);
        try c.registry.classify(model, .model);
        const clarification = try exchange(c, "document.clarification", false, true);
        const critic = try exchange(c, "document.critic", false, false);
        const message = try exchange(c, "document.message", true, false);
        const cleanup = try c.external("document.turn.cleanup.v1", integer, unit, .read);
        const auth = try authority(c, proposal);
        const revalidate = try livePolicy(c, proposal);
        const project = try b.declare(&.{proposal}, observed.data, &.{}, &.{});
        try b.define(project, try b.pure(try b.primitive(observed.data, .variant, &.{try field(b, observation, try b.reference(b.parameter(project, 0)), 1)}, 0)));
        const approval = try agent.approval.define(c, .{
            .name = "document.change",
            .proposal = proposal,
            .occurrence = integer,
            .principal = integer,
            .reason = try c.schema(Text(64)),
            .commit_effect = commit,
            .authority = auth,
            .revalidate = revalidate,
            .failure = try b.constant(void, {}),
            .channel = "document-owner",
            .evidence = .{ .proof = observed.proof, .consume = observed.consume, .project = project },
        });
        const rows = try row(b, &.{ read, model, clarification.effect, critic.effect, message.effect, cleanup }, approval.effects);
        const clarify = try @import("clarification.zig").define(c, clarification, try c.schema(Environment));
        const assess = try assessAlternatives(c, model, observed);
        const child = try @import("critic.zig").define(b, critic);
        const turn = try b.declare(&.{ memory, integer }, pair, rows, &.{});
        const region = b.region();
        const region_schema = try b.schema(.{ .internal = .{ .region = region } });
        const cell_schema = try b.schema(.{ .internal = .{ .cell = .{ .element = integer, .region = region } } });
        const inside = try b.declare(&.{region_schema}, pair, rows, &.{region});
        const cell = try b.variable(cell_schema);
        const body = try b.declare(&.{}, pair, rows, &.{region});
        const known = try b.variable(integer);
        const unknown = try b.variable(unit);
        const old = try b.reference(b.parameter(turn, 0));
        const input = try b.reference(b.parameter(turn, 1));
        const repeated = try b.pure(try product(b, pair, &.{ old, try b.primitive(reply, .variant, &.{try add(b, try b.reference(known), input)}, 1) }));
        const first = try firstTurn(c, body, pair, memory, observation, proposal, observed, clarify, assess, child, approval, input);
        const selected = try b.term(.{ .match_sum = .{ .value = old, .cases = &.{
            .{ .variable = unknown, .body = first }, .{ .variable = known, .body = repeated },
        } } });
        // Each turn has real authored cleanup, including an external suspension.
        try b.define(body, selected);
        const exit = try boundary.library.cleanup.exitInfo(b, unit);
        const close_turn = try b.declare(&.{exit}, unit, &.{cleanup}, &.{region});
        try b.define(close_turn, try perform(b, cleanup, try b.primitive(integer, .cell_get, &.{try b.reference(cell)}, 0)));
        const body_type = try scopedComputation(b, &.{}, pair, rows, &.{ memory, integer }, &.{region});
        const cleanup_type = try scopedComputation(b, &.{exit}, unit, &.{cleanup}, &.{cell_schema}, &.{region});
        const protected = try b.term(.{ .protect = .{ .body = try b.lambda(body, body_type), .cleanup = try b.lambda(close_turn, cleanup_type) } });
        const allocated = try b.primitive(cell_schema, .cell_new, &.{ try b.reference(b.parameter(inside, 0)), input }, 0);
        try b.define(inside, try b.bind(cell, try b.pure(allocated), protected));
        const inside_type = try scopedComputation(b, &.{region_schema}, pair, rows, &.{ memory, integer }, &.{region});
        try b.define(turn, try b.term(.{ .with_region = .{ .region = region, .body = try b.lambda(inside, inside_type) } }));
        const finish = try b.declare(&.{ memory, unit }, memory, &.{}, &.{});
        try b.define(finish, try b.pure(try b.reference(b.parameter(finish, 0))));
        const loop = try agent.conversation.define(b, .{
            .memory = memory,
            .input = integer,
            .reply = reply,
            .result = memory,
            .exchange = message,
            .turn = turn,
            .finish = finish,
            .channel = try text(c, "document-user"),
            .purpose = try text(c, "message"),
            .presentation = try b.constant(void, {}),
            .residual = .{ .effects = rows },
        });
        const entry = try b.declare(&.{integer}, memory, rows, &.{});
        try b.define(entry, try agent.conversation.run(b, loop, try c.literal(Memory, null), try b.reference(b.parameter(entry, 0))));
        return b.module(entry, unit);
    }
};

fn exchange(c: agent.Context, name: []const u8, close: bool, abort: bool) !agent.interaction.Definition {
    const b = c.builder;
    const d = try agent.interaction.define(b, .{ .name = name, .channel = try b.schema(.text), .purpose = try b.schema(.text), .presentation = try b.scalar(void), .outgoing = if (close) try c.schema(Reply) else try b.scalar(u64), .input = try b.scalar(u64), .close_conversation = if (close) try b.scalar(void) else null, .abort_turn = if (abort) try b.scalar(void) else null });
    try c.registry.classify(d.effect, .interaction);
    return d;
}
fn authority(c: agent.Context, proposal: Id) !Id {
    const b = c.builder;
    const integer = try b.scalar(u64);
    const boolean = try b.scalar(bool);
    const f = try b.declare(&.{ proposal, integer }, boolean, &.{}, &.{});
    const principal = try b.reference(b.parameter(f, 1));
    const expected = try b.constant(u64, 7);
    try b.define(f, try b.term(.{ .conditional = .{ .condition = try equal(b, principal, expected), .when_true = try b.pure(try equal(b, try field(b, integer, try b.reference(b.parameter(f, 0)), 4), expected)), .when_false = try b.pure(try b.constant(bool, false)) } }));
    return f;
}
fn livePolicy(c: agent.Context, proposal: Id) !Id {
    const b = c.builder;
    const f = try b.declare(&.{proposal}, try b.scalar(bool), &.{}, &.{});
    // The label must agree with policy; the separate private evidence resource
    // binds the retained actual read and prevents labels from granting authority.
    const proposal_value = try b.reference(b.parameter(f, 0));
    const path_comparison = try b.primitive(try b.scalar(i8), .blob_compare, &.{ try field(b, try c.schema(Text(32)), proposal_value, 0), try c.literal(Text(32), .{ .bytes = "document.txt" }) }, 0);
    const predicates = [_]Id{
        try equal(b, try field(b, try b.scalar(u64), proposal_value, 3), try b.constant(u64, 1)),
        try equal(b, try field(b, try b.scalar(u64), proposal_value, 4), try b.constant(u64, 7)),
        try equal(b, path_comparison, try b.constant(i8, 0)),
    };
    var checked = try b.pure(try b.constant(bool, true));
    for (predicates) |predicate| checked = try b.term(.{ .conditional = .{ .condition = predicate, .when_true = checked, .when_false = try b.pure(try b.constant(bool, false)) } });
    try b.define(f, checked);
    return f;
}
fn firstTurn(c: agent.Context, owner: Id, pair: Id, memory: Id, observation: Id, proposal: Id, live: agent.observation.Definition, clarify: @import("clarification.zig").Definition, assess: Id, child: Id, approval: agent.approval.Definition, input: Id) !Id {
    const b = c.builder;
    const integer = try b.scalar(u64);
    const requirement = try b.variable(clarify.result);
    const ready = try b.variable(clarify.ready);
    const aborted = try b.variable(try b.scalar(void));
    const evidence = try b.variable(live.evidence);
    const proof = try b.variable(live.proof);
    const observed = try b.variable(try c.schema(Read));
    const base = try b.variable(observation);
    const failed = try b.variable(try c.schema(Text(64)));
    const assessment = try b.variable(try c.schema(Assessment));
    const critique = try b.variable(integer);
    const outcome = try b.variable(approval.result);
    const candidate = try field(b, integer, try b.reference(assessment), 0);
    const score = try field(b, integer, try b.reference(assessment), 1);
    const replacement = try field(b, try c.schema(Text(128)), try b.reference(assessment), 3);
    const proposed = try product(b, proposal, &.{ try c.literal(Text(32), .{ .bytes = "document.txt" }), try b.reference(base), replacement, try b.constant(u64, 1), try b.constant(u64, 7), try c.literal(Text(64), .{ .bytes = "Clarified requirement and simulated alternatives reviewed." }) });
    const operation = try b.variable(try c.schema(Operation));
    const rejected = try b.variable(try c.schema(Text(64)));
    const invalid = try b.variable(try b.scalar(void));
    const denied = try b.variable(try b.scalar(void));
    const success = try b.variable(observation);
    const conflict = try b.variable(observation);
    const failure = try b.variable(try c.schema(Text(64)));
    const uncertain = try b.variable(try c.schema(Text(64)));
    const accepted = try add(b, score, try b.reference(critique));
    const keep = try product(b, pair, &.{ try b.primitive(memory, .variant, &.{accepted}, 1), try b.primitive(try c.schema(Reply), .variant, &.{accepted}, 0) });
    const empty = try turnOutcome(c, pair, 2, try b.constant(void, {}));
    const result = try b.term(.{ .match_sum = .{ .value = try b.reference(operation), .cases = &.{
        .{ .variable = success, .body = try b.pure(keep) }, .{ .variable = conflict, .body = try b.pure(try turnOutcome(c, pair, 3, try b.reference(conflict))) }, .{ .variable = failure, .body = try b.pure(try turnOutcome(c, pair, 4, try b.reference(failure))) }, .{ .variable = uncertain, .body = try b.pure(try turnOutcome(c, pair, 5, try b.reference(uncertain))) },
    } } });
    const final = try b.term(.{ .match_sum = .{ .value = try b.reference(outcome), .cases = &.{
        .{ .variable = operation, .body = result }, .{ .variable = rejected, .body = try b.pure(try turnOutcome(c, pair, 6, try b.reference(rejected))) }, .{ .variable = invalid, .body = try b.pure(try turnOutcome(c, pair, 7, try b.reference(invalid))) }, .{ .variable = denied, .body = try b.pure(try turnOutcome(c, pair, 8, try b.reference(denied))) },
    } } });
    const committed = try b.bind(outcome, try agent.approval.approveWithEvidence(c, approval, owner, proposed, try b.reference(proof)), final);
    const evaluated = try b.bind(assessment, try call(b, assess, &.{ try field(b, integer, try b.reference(ready), 0), try field(b, try c.schema(Environment), try b.reference(ready), 1), try b.reference(base) }), try b.bind(critique, try call(b, child, &.{candidate}), committed));
    const discarded = try b.variable(live.data);
    const read_failure = try b.bind(discarded, try agent.observation.consumeEvidence(c, live, owner, try b.reference(proof)), try b.pure(try turnOutcome(c, pair, 4, try b.reference(failed))));
    const read_result = try b.term(.{ .match_sum = .{ .value = try b.reference(observed), .cases = &.{ .{ .variable = base, .body = evaluated }, .{ .variable = failed, .body = read_failure } } } });
    const unpack = try b.term(.{ .unpack_product = .{ .value = try b.reference(evidence), .variables = &.{ observed, proof }, .body = read_result } });
    const after_clarification = try b.term(.{ .match_sum = .{ .value = try b.reference(requirement), .cases = &.{ .{ .variable = ready, .body = try b.bind(evidence, try agent.observation.readEvidence(c, live, owner, try c.literal(Text(32), .{ .bytes = "document.txt" })), unpack) }, .{ .variable = aborted, .body = try b.pure(empty) } } } });
    var enabled = [_]bool{false} ** 64;
    enabled[31] = true;
    enabled[32] = true;
    enabled[63] = true;
    const environment = try c.literal(Environment, .{ .model = .{ .bytes = "fixture-model" }, .instructions = .{ .bytes = "Assess the revision under the clarified document policy." }, .offered = .{true}, .skills = enabled });
    return b.bind(requirement, try call(b, clarify.function, &.{ input, environment }), after_clarification);
}

fn turnOutcome(c: agent.Context, pair: Id, tag: u64, payload: Id) !Id {
    return product(c.builder, pair, &.{ try c.literal(Memory, null), try c.builder.primitive(try c.schema(Reply), .variant, &.{payload}, tag) });
}

fn assessAlternatives(c: agent.Context, model: Id, live: agent.observation.Definition) !Id {
    const b = c.builder;
    const integer = try b.scalar(u64);
    const assessment = try c.schema(Assessment);
    const alternatives = try b.schema(.{ .seq = integer });
    const environment = try c.schema(Environment);
    const base = try c.schema(Observation);
    const unit = try b.scalar(void);
    const region = b.region();
    const region_schema = try b.schema(.{ .internal = .{ .region = region } });
    const cell_schema = try b.schema(.{ .internal = .{ .cell = .{ .element = integer, .region = region } } });
    const d = try agent.deliberation.define(b, "document.alternatives", integer, assessment, .{ .captures = &.{ unit, integer, alternatives, environment, base, cell_schema }, .owned_regions = &.{region}, .residual = .{ .effects = &.{model} } });
    const f = try b.declare(&.{ integer, environment, base }, assessment, &.{model}, &.{});
    const body = try b.declare(&.{d.capability}, assessment, &.{ model, d.effect }, &.{});
    const inside = try b.declare(&.{region_schema}, assessment, &.{ model, d.effect }, &.{region});
    const cell = try b.variable(cell_schema);
    const previous = try b.variable(integer);
    const stored = try b.variable(unit);
    const candidate = try b.variable(integer);
    const interpreted = try b.variable(try c.schema(P.Interpretation));
    const answer = try b.variable(try c.schema(P.AnswerType));
    const rejected = try b.variable(try c.schema(P.InterpretationFailure));
    const value = try b.variable(try c.schema(Proposed));
    const branch_value = try b.primitive(integer, .cell_get, &.{try b.reference(cell)}, 0);
    const scored = try b.term(.{ .match_sum = .{ .value = try b.reference(answer), .cases = &.{.{ .variable = value, .body = try simulatedAssessment(c, live, assessment, branch_value, try b.reference(value), try b.reference(b.parameter(f, 2))) }} } });
    const checked = try b.term(.{ .match_sum = .{ .value = try b.reference(interpreted), .cases = &.{ .{ .variable = answer, .body = scored }, .{ .variable = rejected, .body = try fail(b) } } } });
    const offered = try field(b, try c.schema([1]bool), try b.reference(b.parameter(f, 1)), 2);
    const request = try modelRequest(c, try b.reference(candidate), try b.reference(b.parameter(f, 0)), try b.reference(b.parameter(f, 1)), try b.reference(b.parameter(f, 2)));
    const choice = try agent.deliberation.choose(b, d, try b.reference(b.parameter(body, 0)), try b.primitive(alternatives, .sequence, &.{ try b.constant(u64, 1), try b.constant(u64, 2) }, 0));
    const interpreted_model = try agent.responders.invokeModel(P, c, try b.constant(void, {}), false, request, offered);
    const evaluated = try b.bind(stored, try b.pure(try b.primitive(unit, .cell_set, &.{ try b.reference(cell), try b.reference(candidate) }, 0)), try b.bind(interpreted, interpreted_model, checked));
    const isolated = try b.term(.{ .conditional = .{ .condition = try equal(b, try b.reference(previous), try b.constant(u64, 0)), .when_true = evaluated, .when_false = try fail(b) } });
    const branch = try b.bind(candidate, choice, try b.bind(previous, try b.pure(try b.primitive(integer, .cell_get, &.{try b.reference(cell)}, 0)), isolated));
    const created = try b.primitive(cell_schema, .cell_new, &.{ try b.reference(b.parameter(inside, 0)), try b.constant(u64, 0) }, 0);
    try b.define(inside, try b.bind(cell, try b.pure(created), branch));
    const inside_type = try scopedComputation(b, &.{region_schema}, assessment, &.{ model, d.effect }, &.{ integer, environment, base, d.capability }, &.{region});
    try b.define(body, try b.term(.{ .with_region = .{ .region = region, .body = try b.lambda(inside, inside_type) } }));
    const body_type = try computation(b, &.{d.capability}, assessment, &.{ model, d.effect }, &.{ integer, environment, base });
    try agent.deliberation.register(c, d, body, &.{model});
    const answers = try b.variable(d.answer);
    const first = try index(b, assessment, try b.reference(answers), 0);
    const second = try index(b, assessment, try b.reference(answers), 1);
    const greater = try b.primitive(try b.scalar(bool), .less, &.{ try field(b, integer, first, 1), try field(b, integer, second, 1) }, 0);
    const selected = try b.term(.{ .conditional = .{ .condition = greater, .when_true = try b.pure(second), .when_false = try b.pure(first) } });
    try b.define(f, try b.bind(answers, try agent.deliberation.evaluate(b, d, try b.lambda(body, body_type), &.{}), selected));
    return f;
}

fn modelRequest(c: agent.Context, candidate: Id, requirement: Id, environment: Id, base: Id) !Id {
    const b = c.builder;
    const template = try P.templateValue(Model, .{ .items = &.{} }, .{ .minimum_calls = 1, .maximum_calls = 1, .parallel_calls = false });
    const first = try product(b, try c.schema(P.Message), &.{ try c.literal(agent.model_invocation.MessageRole, .system), try field(b, try c.schema(P.MessageText), environment, 1) });
    const selected = try decimal(c, candidate);
    // Runtime candidate and static policy are semantic messages, never host prompts.
    const message = try product(b, try c.schema(P.Message), &.{ try c.literal(agent.model_invocation.MessageRole, .user), selected });
    const clarified = try product(b, try c.schema(P.Message), &.{ try c.literal(agent.model_invocation.MessageRole, .user), try decimal(c, requirement) });
    const document = try product(b, try c.schema(P.Message), &.{ try c.literal(agent.model_invocation.MessageRole, .user), try field(b, try c.schema(P.MessageText), base, 0) });
    const messages = try b.primitive(try c.schema(P.Messages), .sequence, &.{ first, message, clarified, document }, 0);
    var fields: [std.meta.fields(P.Request).len]Id = undefined;
    inline for (std.meta.fields(P.Request), 0..) |descriptor, i| fields[i] = if (i == 3) messages else if (i == 1) try field(b, try c.schema(descriptor.type), environment, 0) else try c.literal(descriptor.type, @field(template, descriptor.name));
    return product(b, try c.schema(P.Request), &fields);
}

fn simulatedAssessment(c: agent.Context, d: agent.observation.Definition, assessment: Id, candidate: Id, proposed: Id, base: Id) !Id {
    const b = c.builder;
    const observation = try c.schema(Observation);
    const client = try b.declare(&.{ d.family.capability, d.question }, d.observation, &.{d.family.effect}, &.{});
    try b.define(client, try agent.observation.ask(b, d, try b.reference(b.parameter(client, 0)), try b.reference(b.parameter(client, 1))));
    const client_type = try computation(b, &.{ d.family.capability, d.question }, d.observation, &.{d.family.effect}, &.{});
    // A hypothetical read assumes the retained base. It never invokes the live
    // environment and cannot manufacture the separate protected evidence resource.
    const simulator = try b.declare(&.{d.question}, d.data, &.{}, &.{});
    try b.define(simulator, try b.pure(try b.primitive(d.data, .variant, &.{base}, 0)));
    const simulator_type = try computation(b, &.{d.question}, d.data, &.{}, &.{observation});
    const offered = try agent.observation.withSimulation(c, d, d.observation, try b.lambda(client, client_type), try b.lambda(simulator, simulator_type), .{}, &.{try c.literal(Text(32), .{ .bytes = "document.txt" })});
    const interpreted = try b.variable(d.observation);
    const external = try b.variable(d.data);
    const simulated = try b.variable(d.data);
    const content = try b.variable(observation);
    const failure = try b.variable(try c.schema(Text(64)));
    const replacement = try field(b, try c.schema(Text(128)), proposed, 0);
    const compared = try b.primitive(try b.scalar(i8), .blob_compare, &.{ replacement, try field(b, try c.schema(Text(128)), try b.reference(content), 0) }, 0);
    const result = try product(b, assessment, &.{ candidate, try field(b, try b.scalar(u64), proposed, 1), try b.constant(u64, 2), replacement });
    const assessed = try b.term(.{ .conditional = .{ .condition = try equal(b, compared, try b.constant(i8, 0)), .when_true = try fail(b), .when_false = try b.pure(result) } });
    const selected = try b.term(.{ .match_sum = .{ .value = try b.reference(simulated), .cases = &.{ .{ .variable = content, .body = assessed }, .{ .variable = failure, .body = try fail(b) } } } });
    return b.bind(interpreted, offered, try b.term(.{ .match_sum = .{ .value = try b.reference(interpreted), .cases = &.{ .{ .variable = external, .body = try fail(b) }, .{ .variable = simulated, .body = selected } } } }));
}

fn field(b: *source.Builder, schema: Id, value: Id, n: u64) !Id {
    return b.primitive(schema, .field, &.{value}, n);
}
fn product(b: *source.Builder, schema: Id, values: []const Id) !Id {
    return b.primitive(schema, .product, values, 0);
}
fn perform(b: *source.Builder, effect: Id, value: Id) !Id {
    return b.term(.{ .perform = .{ .effect = effect, .payload = value } });
}
fn call(b: *source.Builder, function: Id, args: []const Id) !Id {
    return b.term(.{ .call = .{ .function = function, .arguments = args } });
}
fn fail(b: *source.Builder) !Id {
    return b.term(.{ .fail = try b.constant(void, {}) });
}
fn text(c: agent.Context, value: []const u8) !Id {
    return c.literal(agent.contracts.Utf8, .{ .bytes = value });
}
fn equal(b: *source.Builder, a: Id, z: Id) !Id {
    return b.primitive(try b.scalar(bool), .equal, &.{ a, z }, 0);
}
fn add(b: *source.Builder, a: Id, z: Id) !Id {
    return b.value(.{ .schema = try b.scalar(u64), .expression = .{ .primitive = .{ .opcode = .integer_add, .operands = &.{ a, z }, .failures = &.{.{ .kind = .arithmetic_overflow, .value = try b.failureLiteral(try b.constant(void, {})) }} } } });
}
fn index(b: *source.Builder, schema: Id, value: Id, n: u64) !Id {
    const optional = try b.schema(.{ .sum = &.{ try b.scalar(void), schema } });
    const found = try b.primitive(optional, .sequence_get, &.{ value, try b.constant(u64, n) }, 0);
    return b.value(.{ .schema = schema, .expression = .{ .primitive = .{ .opcode = .variant_payload, .operands = &.{found}, .immediate = 1, .failures = &.{.{ .kind = .invalid_variant, .value = try b.failureLiteral(try b.constant(void, {})) }} } } });
}
fn decimal(c: agent.Context, value: Id) !Id {
    const b = c.builder;
    const unbounded = try b.primitive(try b.schema(.text), .text_integer, &.{value}, 0);
    return b.value(.{ .schema = try c.schema(P.MessageText), .expression = .{ .primitive = .{ .opcode = .blob_concat, .operands = &.{ try c.literal(P.MessageText, .{ .bytes = "" }), unbounded }, .failures = &.{.{ .kind = .capacity_exceeded, .value = try b.failureLiteral(try b.constant(void, {})) }} } } });
}
fn computation(b: *source.Builder, params: []const Id, result: Id, effects: []const Id, captures: []const Id) !Id {
    return b.schema(.{ .internal = .{ .computation = .{ .parameters = params, .result = result, .effects = effects, .capture_bound = captures } } });
}
fn scopedComputation(b: *source.Builder, params: []const Id, result: Id, effects: []const Id, captures: []const Id, regions: []const Id) !Id {
    return b.schema(.{ .internal = .{ .computation = .{ .parameters = params, .result = result, .effects = effects, .capture_bound = captures, .regions = regions } } });
}
fn row(b: *source.Builder, a: []const Id, z: []const Id) ![]const Id {
    const result = try b.allocator().alloc(Id, a.len + z.len);
    @memcpy(result[0..a.len], a);
    @memcpy(result[a.len..], z);
    std.mem.sort(Id, result, {}, std.sort.asc(Id));
    return result;
}
