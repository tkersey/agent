//! Consumer-owned child control: retain a critic's future while asking a human.
const agent = @import("agent");
const boundary = @import("boundary");
const source = boundary.computation;
const Builder = source.Builder;
const Id = source.Id;
const Dialogue = agent.dialogue.Dialogue;
const Cases = @FieldType(@FieldType(source.ast.Term, "match_sum"), "cases");
const Case = @typeInfo(Cases).pointer.child;

/// Return a function (candidate: u64) -> u64 with only the supplied external
/// interaction effect. The critic offers candidate + 100, retains candidate,
/// and eventually returns candidate + the human answer. Its caller adds one.
/// Declared local-abort/close responses dispose the paused child before failing.
pub fn define(b: *Builder, interaction: agent.interaction.Definition) !Id {
    const integer = try b.scalar(u64);
    const text = try b.schema(.text);
    const unit = try b.scalar(void);
    const contract = interaction.contract;
    if (contract.outgoing != integer or contract.input != integer or
        contract.channel != text or contract.purpose != text or
        contract.presentation != unit) return error.InvalidInteractionContract;
    const instance = try b.specialization(Id, "document.critic/v1", .{interaction.effect});
    if (instance.cached) |cached| return cached;
    const scope_identity = "document.critic.scope.v1";
    const family = try agent.decision.define(b, scope_identity, unit, integer);
    const d = try agent.dialogue.define(
        b,
        "document.critic.question.v1",
        integer,
        integer,
        integer,
        .{ .captures = &.{ integer, family.capability } },
    );
    const reader = try agent.scopes.define(b, scope_identity, integer, integer, .{
        .captures = &.{ integer, d.capability },
        .residual = .{ .effects = &.{d.effect} },
    });
    const child = try childBody(b, d, reader);
    const child_type = try b.schema(.{ .internal = .{ .computation = .{
        .parameters = &.{ d.capability, integer },
        .result = integer,
        .effects = &.{d.effect},
    } } });
    const parent = try b.declare(&.{integer}, integer, &.{interaction.effect}, &.{});
    const started = try agent.dialogue.start(b, d, try b.lambda(child, child_type), &.{
        try b.reference(b.parameter(parent, 0)),
    });
    const step = try b.variable(d.answer);
    const done = try b.variable(d.result);
    const awaiting = try b.variable(d.awaiting);
    const offered = try b.term(.{ .match_sum = .{
        .value = try b.reference(step),
        .cases = &.{
            .{ .variable = done, .body = try fail(b) },
            .{ .variable = awaiting, .body = try askHuman(b, d, interaction, awaiting) },
        },
    } });
    try b.define(parent, try b.bind(step, started, offered));
    return instance.finish(b, parent);
}

fn childBody(b: *Builder, d: Dialogue, reader: agent.scopes.Reader) !Id {
    const integer = try b.scalar(u64);
    const child = try b.declare(&.{ d.capability, integer }, integer, &.{d.effect}, &.{});
    const parameters = &.{ reader.family.capability, d.capability, integer };
    const effects = &.{ reader.family.effect, d.effect };
    const inside = try b.declare(parameters, integer, effects, &.{});
    const scoped = try b.schema(.{ .internal = .{ .computation = .{
        .parameters = parameters,
        .result = integer,
        .effects = effects,
    } } });
    try b.define(inside, try scopedBody(b, d, reader, inside));
    try b.define(child, try agent.scopes.enter(
        b,
        reader,
        try b.lambda(inside, scoped),
        try b.constant(u64, 100),
        &.{ try b.reference(b.parameter(child, 0)), try b.reference(b.parameter(child, 1)) },
    ));
    return child;
}

fn scopedBody(b: *Builder, d: Dialogue, reader: agent.scopes.Reader, inside: Id) !Id {
    const integer = try b.scalar(u64);
    const scope = try b.reference(b.parameter(inside, 0));
    const capability = try b.reference(b.parameter(inside, 1));
    const candidate = try b.reference(b.parameter(inside, 2));
    const before = try b.variable(integer);
    const after = try b.variable(integer);
    const answer = try b.variable(integer);
    const question = try add(b, candidate, try b.reference(before));
    const result = try add(b, candidate, try b.reference(answer));
    const offered = try agent.dialogue.offer(b, d, capability, question);
    const same = try b.primitive(try b.scalar(bool), .equal, &.{
        try b.reference(before), try b.reference(after),
    }, 0);
    const restored = try b.term(.{ .conditional = .{
        .condition = same,
        .when_true = try b.pure(result),
        .when_false = try fail(b),
    } });
    const resumed = try b.bind(answer, offered, try b.bind(
        after,
        try agent.scopes.read(b, reader, scope),
        restored,
    ));
    const expected = try b.primitive(try b.scalar(bool), .equal, &.{
        try b.reference(before), try b.constant(u64, 100),
    }, 0);
    return b.bind(before, try agent.scopes.read(b, reader, scope), try b.term(.{
        .conditional = .{
            .condition = expected,
            .when_true = resumed,
            .when_false = try fail(b),
        },
    }));
}

fn askHuman(
    b: *Builder,
    d: Dialogue,
    interaction: agent.interaction.Definition,
    awaiting: Id,
) !Id {
    const outgoing = try b.variable(d.outgoing);
    const future = try b.variable(d.package);
    const response = try b.variable(interaction.reply);
    const request = try agent.interaction.exchange(b, interaction, .{
        .channel = try b.literal(.{
            .schema = interaction.contract.channel,
            .bytes = "\x05human",
        }),
        .purpose = try b.literal(.{
            .schema = interaction.contract.purpose,
            .bytes = "\x0dclarification",
        }),
        .presentation = try b.constant(void, {}),
        .outgoing = try b.reference(outgoing),
    });
    const resumed = try replyCases(b, d, interaction, future, response);
    return b.term(.{ .unpack_product = .{
        .value = try b.reference(awaiting),
        .variables = &.{ outgoing, future },
        .body = try b.bind(response, request, resumed),
    } });
}

fn replyCases(
    b: *Builder,
    d: Dialogue,
    interaction: agent.interaction.Definition,
    future: Id,
    response: Id,
) !Id {
    var cases: [3]Case = undefined;
    const input = try b.variable(d.input);
    const resumed = try agent.dialogue.resumeWith(
        b,
        d,
        try b.reference(future),
        try b.reference(input),
    );
    cases[0] = .{ .variable = input, .body = try terminal(b, d, resumed) };
    var count: usize = 1;
    for ([_]?Id{ interaction.contract.abort_turn, interaction.contract.close_conversation }) |schema| {
        if (schema) |reason| {
            cases[count] = .{
                .variable = try b.variable(reason),
                .body = try disposeAndFail(b, d, try b.reference(future)),
            };
            count += 1;
        }
    }
    return b.term(.{ .match_sum = .{
        .value = try b.reference(response),
        .cases = cases[0..count],
    } });
}

fn terminal(b: *Builder, d: Dialogue, resumed: Id) !Id {
    const step = try b.variable(d.answer);
    const done = try b.variable(d.result);
    const awaiting = try b.variable(d.awaiting);
    const outgoing = try b.variable(d.outgoing);
    const future = try b.variable(d.package);
    const unexpected = try b.term(.{ .unpack_product = .{
        .value = try b.reference(awaiting),
        .variables = &.{ outgoing, future },
        .body = try disposeAndFail(b, d, try b.reference(future)),
    } });
    const transformed = try add(b, try b.reference(done), try b.constant(u64, 1));
    const matched = try b.term(.{ .match_sum = .{
        .value = try b.reference(step),
        .cases = &.{
            .{ .variable = done, .body = try b.pure(transformed) },
            .{ .variable = awaiting, .body = unexpected },
        },
    } });
    return b.bind(step, resumed, matched);
}

fn disposeAndFail(b: *Builder, d: Dialogue, future: Id) !Id {
    const ignored = try b.variable(try b.scalar(void));
    return b.bind(ignored, try agent.dialogue.dispose(b, d, future), try fail(b));
}

fn fail(b: *Builder) !Id {
    return b.term(.{ .fail = try b.constant(void, {}) });
}

fn add(b: *Builder, left: Id, right: Id) !Id {
    return b.value(.{
        .schema = try b.scalar(u64),
        .expression = .{ .primitive = .{
            .opcode = .integer_add,
            .operands = &.{ left, right },
            .failures = &.{.{
                .kind = .arithmetic_overflow,
                .value = try b.failureLiteral(try b.constant(void, {})),
            }},
        } },
    });
}

test "delayed child lowers with answer-only and declared abandonment replies" {
    const testing = @import("std").testing;
    for ([_]bool{ false, true }) |controls| {
        var b = Builder.init(testing.allocator);
        defer b.deinit();
        const unit = try b.scalar(void);
        const integer = try b.scalar(u64);
        const text = try b.schema(.text);
        const interaction = try agent.interaction.define(&b, .{
            .name = "document.critic.input",
            .channel = text,
            .purpose = text,
            .presentation = unit,
            .outgoing = integer,
            .input = integer,
            .abort_turn = if (controls) unit else null,
            .close_conversation = if (controls) unit else null,
        });
        const entry = try define(&b, interaction);
        var compiled = try boundary.program.compile(testing.allocator, b.module(entry, unit));
        defer compiled.deinit();
        try testing.expect(compiled.program.blocks.len > 0);
    }
}
