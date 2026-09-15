//! Deterministic presentation of retained, checked consequence classes.
const agent = @import("agent");
const source = @import("boundary").computation;
const Id = source.Id;
const emit = @import("source.zig");
const t = @import("consequence_types.zig");

pub fn define(c: agent.Context, d: agent.clarification.Definition) !Id {
    const b = c.builder;
    const unit = try b.scalar(void);
    const text = try b.schema(.text);
    const exchange = try agent.interaction.define(b, .{
        .name = "document.terminology.choice",
        .channel = text,
        .purpose = text,
        .presentation = unit,
        .outgoing = try c.schema(t.Question),
        .input = d.types.input,
        .abort_turn = unit,
        .close_conversation = unit,
    });
    try c.registry.classify(exchange.effect, .interaction);
    return agent.clarification.resolver(b, d, .{
        .context = try c.schema(t.Context),
        .present = try presenter(c),
        .exchange = exchange,
        .channel = try emit.text(c, "document-user"),
        .purpose = try emit.text(c, "consequence-clarification"),
        .presentation = try b.constant(void, {}),
    });
}

fn presenter(c: agent.Context) !Id {
    const b = c.builder;
    const f = try b.declare(&.{ try c.schema(t.Context), try c.schema(t.Choice) }, try c.schema(t.Question), &.{}, &.{});
    const choice = try b.reference(b.parameter(f, 1));
    const reason = try emit.field(b, try b.scalar(u8), choice, 0);
    const options = try b.variable(try c.schema([]const t.Option));
    const prompt_type = @FieldType(t.Question, "prompt");
    const prompt = try b.primitive(try c.schema(prompt_type), .select, &.{
        try emit.equal(b, reason, try b.constant(u8, 1)),
        try c.literal(prompt_type, .{
            .bytes = "Please choose the intended scope; policy requires a choice even if the edits agree.",
        }),
        try c.literal(prompt_type, .{
            .bytes = "Limit the replacement to the active section, or apply it throughout the document? " ++
                "Each option includes the exact edit and whether archived text changes.",
        }),
    }, 0);
    const question = try emit.product(b, try c.schema(t.Question), &.{
        try b.reference(b.parameter(f, 0)), reason, prompt, try b.reference(options),
    });
    try b.define(f, try b.bind(options, try emit.call(b, try optionLoop(c), &.{
        try emit.field(b, try c.schema([]const t.Group), choice, 1),
        try b.constant(u64, 0),
        try b.primitive(try c.schema([]const t.Option), .sequence, &.{}, 0),
    }), try b.pure(question)));
    return f;
}

fn optionLoop(c: agent.Context) !Id {
    const b = c.builder;
    const groups = try c.schema([]const t.Group);
    const options = try c.schema([]const t.Option);
    const integer = try b.scalar(u64);
    const f = try b.declare(&.{ groups, integer, options }, options, &.{}, &.{});
    const input = try b.reference(b.parameter(f, 0));
    const index = try b.reference(b.parameter(f, 1));
    const found = try b.reference(b.parameter(f, 2));
    const optional = try b.schema(.{ .sum = &.{ try b.scalar(void), try c.schema(t.Group) } });
    const absent = try b.variable(try b.scalar(void));
    const present = try b.variable(try c.schema(t.Group));
    const added = try option(c, try b.reference(present));
    const next = try emit.call(b, f, &.{
        input, try emit.add(b, index, try b.constant(u64, 1)),
        try b.primitive(options, .sequence_concat, &.{
            found, try b.primitive(options, .sequence, &.{added}, 0),
        }, 0),
    });
    try b.define(f, try b.term(.{ .match_sum = .{
        .value = try b.primitive(optional, .sequence_get, &.{ input, index }, 0),
        .cases = &.{
            .{ .variable = absent, .body = try b.pure(found) },
            .{ .variable = present, .body = next },
        },
    } }));
    return f;
}

fn option(c: agent.Context, group: Id) !Id {
    const b = c.builder;
    const id = try emit.field(b, try b.scalar(u64), group, 0);
    const known = try emit.field(b, try c.schema(t.Known), group, 1);
    const consequences = try emit.field(b, try c.schema(t.Consequences), known, 0);
    const changed = try emit.field(b, try b.scalar(bool), consequences, 0);
    const meaning_type = @FieldType(t.Option, "meaning");
    const whole_meaning = try b.primitive(try c.schema(meaning_type), .select, &.{
        changed,
        try c.literal(meaning_type, .{
            .bytes = "Whole document: this checked replacement changes archived text too.",
        }),
        try c.literal(meaning_type, .{
            .bytes = "Whole document: this checked replacement leaves archived text unchanged.",
        }),
    }, 0);
    const meaning = try b.primitive(try c.schema(meaning_type), .select, &.{
        try emit.equal(b, id, try b.constant(u64, 1)),
        try c.literal(meaning_type, .{
            .bytes = "Active section only: this checked replacement leaves archived text unchanged.",
        }),
        whole_meaning,
    }, 0);
    return emit.product(b, try c.schema(t.Option), &.{
        id,                                                  try emit.field(b, try c.schema([]const u64), group, 2),
        try emit.field(b, try c.schema(t.Action), known, 1), changed,
        meaning,
    });
}
