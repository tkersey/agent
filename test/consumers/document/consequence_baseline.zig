//! Test-only clarify-first comparator. Reuses the actual proposal and live path.
const agent = @import("agent");
const source = @import("boundary").computation;
const Id = source.Id;
const emit = @import("source.zig");
const t = @import("consequence_types.zig");
const Proposals = @import("consequence_proposals.zig").Definition;

pub fn define(c: agent.Context, proposals: Proposals, model: Id) !Id {
    const b = c.builder;
    const d = proposals.decision;
    const unit = try b.scalar(void);
    const exchange = try agent.interaction.define(b, .{
        .name = "document.terminology.scope-first",
        .channel = try b.schema(.text),
        .purpose = try b.schema(.text),
        .presentation = unit,
        .outgoing = try c.schema(t.Context),
        .input = d.types.input,
        .abort_turn = unit,
        .close_conversation = unit,
    });
    try c.registry.classify(exchange.effect, .interaction);
    const f = try b.declare(&.{try c.schema(t.Context)}, d.types.resolution, &.{ model, exchange.effect }, &.{});
    const context = try b.reference(b.parameter(f, 0));
    const reply = try b.variable(exchange.reply);
    const answer = try b.variable(d.types.input);
    const abort = try b.variable(unit);
    const close = try b.variable(unit);
    const selected = try replies(c, proposals, context, try b.reference(answer));
    const matched = try b.term(.{ .match_sum = .{
        .value = try b.reference(reply),
        .cases = &.{
            .{ .variable = answer, .body = selected },
            .{ .variable = abort, .body = try variant(b, d.types.resolution, try b.constant(void, {}), 3) },
            .{ .variable = close, .body = try variant(b, d.types.resolution, try b.constant(void, {}), 4) },
        },
    } });
    try b.define(f, try b.bind(reply, try agent.interaction.exchange(b, exchange, .{
        .channel = try emit.text(c, "document-user"),
        .purpose = try emit.text(c, "Choose active_section or whole_document before assessment."),
        .presentation = try b.constant(void, {}),
        .outgoing = context,
    }), matched));
    return f;
}

fn replies(c: agent.Context, p: Proposals, context: Id, answer: Id) !Id {
    const b = c.builder;
    const d = p.decision;
    const selected = try b.variable(try b.scalar(u64));
    const other = try b.variable(try b.scalar(void));
    const unsure = try b.variable(try b.scalar(void));
    const id = try b.reference(selected);
    const evaluated = try b.variable(d.types.evaluation);
    const checked = try assessment(c, p, try b.reference(evaluated), id);
    const run = try b.bind(evaluated, try emit.call(b, p.assess, &.{ context, id }), checked);
    const valid = try b.term(.{ .conditional = .{
        .condition = try emit.equal(b, id, try b.constant(u64, 1)),
        .when_true = run,
        .when_false = try b.term(.{ .conditional = .{
            .condition = try emit.equal(b, id, try b.constant(u64, 2)),
            .when_true = run,
            .when_false = try unresolved(c, p, 3),
        } }),
    } });
    return b.term(.{ .match_sum = .{ .value = answer, .cases = &.{
        .{ .variable = selected, .body = valid },
        .{ .variable = other, .body = try unresolved(c, p, 1) },
        .{ .variable = unsure, .body = try unresolved(c, p, 2) },
    } } });
}

fn assessment(c: agent.Context, p: Proposals, evaluation: Id, id: Id) !Id {
    const b = c.builder;
    const d = p.decision;
    const known = try b.variable(d.types.known);
    const unavailable = try b.variable(try b.scalar(void));
    const rejected = try b.variable(try b.scalar(void));
    const inconclusive = try b.variable(try b.scalar(void));
    const assessments = try b.primitive(d.types.evaluations, .sequence, &.{evaluation}, 0);
    const failed = try variant(b, d.types.resolution, try b.primitive(d.types.non_action, .variant, &.{assessments}, 0), 2);
    const group = try emit.product(b, d.types.group, &.{
        id, try b.reference(known), try b.primitive(d.types.ids, .sequence, &.{id}, 0),
    });
    return b.term(.{ .match_sum = .{
        .value = try emit.field(b, d.types.assessed, evaluation, 1),
        .cases = &.{
            .{ .variable = known, .body = try variant(b, d.types.resolution, group, 1) },
            .{ .variable = unavailable, .body = failed },
            .{ .variable = rejected, .body = failed },
            .{ .variable = inconclusive, .body = failed },
        },
    } });
}

fn unresolved(c: agent.Context, p: Proposals, tag: u64) !Id {
    const b = c.builder;
    const reason = try b.primitive(p.decision.types.non_action, .variant, &.{try b.constant(void, {})}, tag);
    return variant(b, p.decision.types.resolution, reason, 2);
}

fn variant(b: *source.Builder, schema: Id, value: Id, tag: u64) !Id {
    return b.pure(try b.primitive(schema, .variant, &.{value}, tag));
}
