//! Complete opt-in conversation. Hypothetical results are ordinary data only.
const std = @import("std");
const agent = @import("agent");
const boundary = @import("boundary");
const source = boundary.computation;
const Id = source.Id;
const code = @import("source.zig");
pub const types = @import("consequence_types.zig");
const t = types;
const proposals = @import("consequence_proposals.zig");
const questions = @import("consequence_question.zig");
const live = @import("consequence_live.zig");
pub const System = agent.system(.{
    .InitialArgs = t.Request,
    .Result = t.Memory,
    .Failure = void,
    .application = Application(false),
});

pub const ClarifyFirstSystem = agent.system(.{
    .InitialArgs = t.Request,
    .Result = t.Memory,
    .Failure = void,
    .application = Application(true),
});

fn Application(comptime clarify_first: bool) type {
    return struct {
        pub fn emit(c: agent.Context) !source.Module {
            const b = c.builder;
            const unit = try b.scalar(void);
            const memory = try c.schema(t.Memory);
            const request = try c.schema(t.Request);
            const read = try c.external("document.terminology.read.v1", try c.schema(t.Path), try c.schema(t.Read), .read);
            const observed = try agent.observation.define(c, "document.terminology.base", read);
            const model = try t.P.declare(b);
            try c.registry.classify(model, .model);
            const proposal = try proposals.define(c, model);
            const resolve = if (clarify_first)
                try @import("consequence_baseline.zig").define(c, proposal, model)
            else
                try questions.define(c, proposal.decision);
            const execute = try live.define(c, observed);
            const message = try messageContract(c);
            const turn_cleanup = try c.external("document.terminology.turn.cleanup.v1", try b.scalar(u64), unit, .read);
            const conversation_cleanup = try c.external("document.terminology.conversation.cleanup.v1", unit, unit, .read);
            const closed = try boundary.library.raise.family(b, "document.terminology.close.v1", memory);
            try c.registry.classify(closed.effect, .internal);
            const external_rows = try code.row(b, &.{
                model,          b.functions.items[resolve].effects[b.functions.items[resolve].effects.len - 1],
                message.effect, turn_cleanup,
            }, execute.effects);
            const rows = try code.row(b, external_rows, &.{closed.effect});
            const session = try b.declare(&.{ closed.capability, request }, memory, rows, &.{});
            const turn = try turnFunction(clarify_first, c, session, rows, closed, turn_cleanup, observed, proposal, resolve, execute.function);
            const finish = try b.declare(&.{ memory, unit }, memory, &.{}, &.{});
            try b.define(finish, try b.pure(try b.reference(b.parameter(finish, 0))));
            const loop = try agent.conversation.define(b, .{
                .memory = memory,
                .input = request,
                .reply = try c.schema(t.Reply),
                .result = memory,
                .exchange = message,
                .turn = turn,
                .finish = finish,
                .channel = try code.text(c, "document-user"),
                .purpose = try code.text(c, "message"),
                .presentation = try b.constant(void, {}),
                .residual = .{ .effects = rows },
            });
            const initial = try c.literal(t.Memory, .{ .next_turn = 1, .receipt = null });
            try b.define(session, try agent.conversation.run(b, loop, initial, try b.reference(b.parameter(session, 1))));
            return finishSession(c, session, closed, external_rows, rows, conversation_cleanup);
        }
    };
}

fn messageContract(c: agent.Context) !agent.interaction.Definition {
    const b = c.builder;
    const d = try agent.interaction.define(b, .{
        .name = "document.terminology.message",
        .channel = try b.schema(.text),
        .purpose = try b.schema(.text),
        .presentation = try b.scalar(void),
        .outgoing = try c.schema(t.Reply),
        .input = try c.schema(t.Request),
        .close_conversation = try b.scalar(void),
    });
    try c.registry.classify(d.effect, .interaction);
    return d;
}

fn turnFunction(comptime clarify_first: bool, c: agent.Context, session: Id, rows: []const Id, closed: boundary.library.raise.Family, cleanup: Id, observed: agent.observation.Definition, proposal: proposals.Definition, resolve: Id, execute: Id) !Id {
    const b = c.builder;
    const memory = try c.schema(t.Memory);
    const request = try c.schema(t.Request);
    const pair = try live.pairSchema(c);
    const turn = try b.declare(&.{ memory, request }, pair, rows, &.{});
    const body = try b.declare(&.{}, pair, rows, &.{});
    const previous = try b.reference(b.parameter(turn, 0));
    const task = try b.reference(b.parameter(turn, 1));
    const cap = try b.reference(b.parameter(session, 0));
    const occurrence = try code.field(b, try b.scalar(u64), previous, 0);
    const next = try b.variable(memory);
    const next_memory = try code.product(b, memory, &.{
        try code.add(b, occurrence, try b.constant(u64, 1)),
        try code.field(b, try c.schema(?t.Receipt), previous, 1),
    });
    // An ordinary owned counter prevents repeated task data from recreating an
    // earlier pending request. Overflow fails rather than reusing an occurrence.
    const work = try readAndExplore(clarify_first, c, body, observed, proposal, resolve, execute, closed, cap, try b.reference(next), task, occurrence);
    try b.define(body, try b.bind(next, try b.pure(next_memory), work));
    const exit = try boundary.library.cleanup.exitInfo(b, try b.scalar(void));
    const finalizer = try b.declare(&.{exit}, try b.scalar(void), &.{cleanup}, &.{});
    try b.define(finalizer, try code.perform(b, cleanup, try code.field(b, try b.scalar(u64), task, 5)));
    const body_type = try code.computation(b, &.{}, pair, rows, &.{ memory, request, closed.capability });
    const finalizer_type = try code.computation(b, &.{exit}, try b.scalar(void), &.{cleanup}, &.{request});
    try b.define(turn, try b.term(.{ .protect = .{
        .body = try b.lambda(body, body_type),
        .cleanup = try b.lambda(finalizer, finalizer_type),
    } }));
    return turn;
}

fn readAndExplore(comptime clarify_first: bool, c: agent.Context, owner: Id, observed: agent.observation.Definition, proposal: proposals.Definition, resolve: Id, execute: Id, closed: boundary.library.raise.Family, cap: Id, memory: Id, task: Id, occurrence: Id) !Id {
    const b = c.builder;
    const evidence = try b.variable(observed.evidence);
    const read = try b.variable(observed.data);
    const proof = try b.variable(observed.proof);
    const discarded = try b.variable(observed.data);
    const base = try b.variable(try c.schema(t.Observation));
    const failed = try b.variable(try c.schema(t.Reason));
    const frozen = try code.product(b, try c.schema(t.Context), &.{
        task, try b.reference(base), occurrence,
    });
    const classified = try b.variable(proposal.decision.types.classification);
    const resolution = try b.variable(proposal.decision.types.resolution);
    const continued = try resolutions(c, execute, closed, cap, memory, frozen, try b.reference(resolution));
    const explored = if (clarify_first)
        try b.bind(resolution, try code.call(b, resolve, &.{frozen}), continued)
    else blk: {
        const asked = try b.bind(resolution, try code.call(b, resolve, &.{ frozen, try b.reference(classified) }), continued);
        break :blk try b.bind(classified, try code.call(b, proposal.explore, &.{frozen}), asked);
    };
    const matched = try b.term(.{ .match_sum = .{
        .value = try b.reference(read),
        .cases = &.{
            .{ .variable = base, .body = explored },
            .{ .variable = failed, .body = try live.outcome(c, memory, 4, try b.reference(failed)) },
        },
    } });
    // Consume even failed-read evidence before entering any hypothetical future.
    const consumed = try b.bind(discarded, try agent.observation.consumeEvidence(c, observed, owner, try b.reference(proof)), matched);
    const unpack = try b.term(.{ .unpack_product = .{
        .value = try b.reference(evidence),
        .variables = &.{ read, proof },
        .body = consumed,
    } });
    return b.bind(evidence, try agent.observation.readEvidence(c, observed, owner, try code.field(b, try c.schema(t.Path), task, 0)), unpack);
}

fn resolutions(c: agent.Context, execute: Id, closed: boundary.library.raise.Family, capability: Id, memory: Id, frozen: Id, resolution: Id) !Id {
    const b = c.builder;
    const common = try b.variable(try c.schema(t.Group));
    const selected = try b.variable(try c.schema(t.Group));
    const unresolved = try b.variable(try c.schema(t.NonAction));
    const aborted = try b.variable(try b.scalar(void));
    const close = try b.variable(try b.scalar(void));
    const closing = try b.term(.{ .perform = .{
        .effect = closed.effect,
        .capability = capability,
        .payload = memory,
    } });
    const never = try b.bind(try b.variable(try b.scalar(void)), closing, try code.fail(b));
    return b.term(.{ .match_sum = .{ .value = resolution, .cases = &.{
        .{ .variable = common, .body = try code.call(b, execute, &.{
            memory, frozen, try b.reference(common), try b.constant(bool, false),
        }) },
        .{ .variable = selected, .body = try code.call(b, execute, &.{
            memory, frozen, try b.reference(selected), try b.constant(bool, true),
        }) },
        .{ .variable = unresolved, .body = try live.outcome(c, memory, 2, try b.reference(unresolved)) },
        .{ .variable = aborted, .body = try live.outcome(c, memory, 9, try b.constant(void, {})) },
        .{ .variable = close, .body = never },
    } } });
}

fn finishSession(c: agent.Context, session: Id, family: boundary.library.raise.Family, external_rows: []const Id, rows: []const Id, cleanup: Id) !source.Module {
    const b = c.builder;
    const memory = try c.schema(t.Memory);
    const request = try c.schema(t.Request);
    const unit = try b.scalar(void);
    const catching = try boundary.library.raise.catching(b, family, memory, &.{
        memory,                      request,                   try c.schema(t.Reply), try c.schema(t.Context),
        try c.schema(t.Resolution),  try c.schema(t.NonAction), try c.schema(t.Group), try c.schema(t.Receipt),
        try c.schema(t.Observation), try b.scalar(u64),         try b.scalar(bool),    unit,
    }, .{ .effects = external_rows }, &.{});
    const outer_rows = try code.row(b, external_rows, &.{cleanup});
    const entry = try b.declare(&.{request}, memory, outer_rows, &.{});
    const body = try b.declare(&.{}, memory, external_rows, &.{});
    const session_type = try code.computation(b, &.{ family.capability, request }, memory, rows, &.{});
    const handled = try b.term(.{ .handle = .{
        .handler = catching.handler,
        .body = try b.lambda(session, session_type),
        .arguments = &.{try b.reference(b.parameter(entry, 0))},
    } });
    const answer = try b.variable(catching.answer);
    const closed = try b.variable(memory);
    const finished = try b.variable(memory);
    try b.define(body, try b.bind(answer, handled, try b.term(.{ .match_sum = .{
        .value = try b.reference(answer),
        .cases = &.{
            .{ .variable = closed, .body = try b.pure(try b.reference(closed)) },
            .{ .variable = finished, .body = try b.pure(try b.reference(finished)) },
        },
    } })));
    const exit = try boundary.library.cleanup.exitInfo(b, unit);
    const finalizer = try b.declare(&.{exit}, unit, &.{cleanup}, &.{});
    try b.define(finalizer, try code.perform(b, cleanup, try b.constant(void, {})));
    const body_type = try code.computation(b, &.{}, memory, external_rows, &.{request});
    const cleanup_type = try code.computation(b, &.{exit}, unit, &.{cleanup}, &.{});
    try b.define(entry, try b.term(.{ .protect = .{
        .body = try b.lambda(body, body_type),
        .cleanup = try b.lambda(finalizer, cleanup_type),
    } }));
    return b.module(entry, unit);
}

test "complete terminology conversation compiles through protected Agent" {
    var compiled = try agent.compile(std.testing.allocator, System);
    defer compiled.deinit();
    try std.testing.expect(compiled.program.blocks.len > 0);
}
