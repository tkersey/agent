//! Existing conversation composition owns task epochs across repeated inputs.
const agent = @import("agent");
const boundary = @import("boundary");
const main = @import("main.zig");
const t = @import("types.zig");
const s = @import("source.zig");
pub const System = agent.system(.{ .InitialArgs = t.Task, .Result = u64, .Failure = void, .application = Application });

const Application = struct {
    pub fn emit(c: agent.Context) !boundary.computation.Module {
        const e = s.E{ .c = c };
        const b = c.builder;
        const task = try main.defineTask(c);
        const integer = try e.schema(u64);
        const unit = try e.schema(void);
        const exchange = try agent.interaction.define(b, .{
            .name = "inquiry.repair.next-task",
            .channel = try b.schema(.text),
            .purpose = try b.schema(.text),
            .presentation = unit,
            .outgoing = try e.schema(t.Result),
            .input = try e.schema(t.Task),
            .close_conversation = unit,
        });
        try c.registry.classify(exchange.effect, .interaction);
        const effects = try e.row(b.functions.items[task].effects, &.{exchange.effect});
        const pair = try b.schema(.{ .product = &.{ integer, try e.schema(t.Result) } });
        const turn = try b.declare(&.{ integer, try e.schema(t.Task) }, pair, effects, &.{});
        const result = try b.variable(try e.schema(t.Result));
        const next = try e.arithmetic(.integer_add, try e.p(turn, 0), try e.value(u64, 1));
        try b.define(turn, try b.bind(result, try e.call(task, &.{ try e.p(turn, 1), next }), try b.pure(try b.primitive(pair, .product, &.{ next, try e.ref(result) }, 0))));
        const finish = try b.declare(&.{ integer, unit }, integer, &.{}, &.{});
        try b.define(finish, try b.pure(try e.p(finish, 0)));
        const loop = try agent.conversation.define(b, .{
            .memory = integer,
            .input = try e.schema(t.Task),
            .reply = try e.schema(t.Result),
            .result = integer,
            .exchange = exchange,
            .turn = turn,
            .finish = finish,
            .channel = try e.value(agent.contracts.Utf8, .{ .bytes = "repository-owner" }),
            .purpose = try e.value(agent.contracts.Utf8, .{ .bytes = "next-task" }),
            .presentation = try e.value(void, {}),
            .residual = .{ .effects = effects },
        });
        const entry = try b.declare(&.{try e.schema(t.Task)}, integer, effects, &.{});
        try b.define(entry, try agent.conversation.run(b, loop, try e.value(u64, 0), try e.p(entry, 0)));
        return b.module(entry, unit);
    }
};
