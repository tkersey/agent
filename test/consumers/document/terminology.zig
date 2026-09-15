//! Pure authored literal editing for the controlled terminology example.
//! UTF-8, case-sensitive, non-overlapping replacement over original bytes.
//! Exactly one Active policy marker must precede exactly one Archive marker.
//! Markers cannot be edited or introduced. Invalid/overflow returns Invalid.
const std = @import("std");
const agent = @import("agent");
const boundary = @import("boundary");
const source = boundary.computation;
const Id = source.Id;
pub const Content = agent.contracts.Text(512);
pub const Change = struct { replacement: Content, archive_changed: bool };
pub const Edit = union(enum) { known: Change, invalid };
pub const active_marker = "Active policy:\n";
pub const archive_marker = "Archive:\n";
pub const active_scope: u64 = 1;
pub const whole_scope: u64 = 2;

/// (frozen content, nonempty old term, replacement term, scope ID) -> Edit.
/// Each byte scan is bounded by Content's explicit 512-byte application limit.
pub fn define(c: agent.Context) !Id {
    const b = c.builder;
    const cached = try b.specialization(Id, "document.terminology/v1", .{});
    if (cached.cached) |found| return found;
    const h = try Helpers.init(c);
    const matches = try matchBytes(h);
    const find = try findBytes(h, matches);
    const layout = try layoutFunction(h, find);
    const replace = try replaceFunction(h, find);
    const finish = try finishFunction(h, layout);
    const f = try b.declare(&.{ h.text, h.text, h.text, h.integer }, h.edit, &.{}, &.{});
    const content = try h.param(f, 0);
    const old = try h.param(f, 1);
    const replacement = try h.param(f, 2);
    const scope = try h.param(f, 3);
    const shape = try b.variable(h.maybe_layout);
    const invalid = try b.variable(h.unit);
    const valid = try b.variable(h.layout);
    const edited = try b.variable(h.maybe_text);
    const bounds = try b.reference(valid);
    const begin = try b.primitive(h.integer, .select, &.{
        try h.equal(scope, try h.n(active_scope)),
        try h.add(try h.field(h.integer, bounds, 0), try h.n(active_marker.len)),
        try h.n(0),
    }, 0);
    const end = try b.primitive(h.integer, .select, &.{
        try h.equal(scope, try h.n(active_scope)),
        try h.field(h.integer, bounds, 1),
        try h.length(content),
    }, 0);
    const rewrite = try call(b, replace, &.{
        content, old, replacement, end, bounds, begin, try h.slice(content, try h.n(0), begin),
    });
    const finished = try b.bind(edited, rewrite, try call(b, finish, &.{
        content, bounds, try b.reference(edited),
    }));
    const matched = try b.term(.{ .match_sum = .{ .value = try b.reference(shape), .cases = &.{
        .{ .variable = invalid, .body = try h.invalid(h.edit) },
        .{ .variable = valid, .body = finished },
    } } });
    const prepared = try b.bind(shape, try call(b, layout, &.{content}), matched);
    const scoped = try h.conditional(try h.equal(scope, try h.n(active_scope)), prepared, try h.conditional(try h.equal(scope, try h.n(whole_scope)), prepared, try h.invalid(h.edit)));
    try b.define(f, try h.conditional(try h.equal(try h.length(old), try h.n(0)), try h.invalid(h.edit), scoped));
    return cached.finish(b, f);
}

fn matchBytes(h: Helpers) !Id {
    const b = h.b;
    const f = try b.declare(&.{ h.text, h.text, h.integer, h.integer }, h.boolean, &.{}, &.{});
    const content = try h.param(f, 0);
    const needle = try h.param(f, 1);
    const start = try h.param(f, 2);
    const offset = try h.param(f, 3);
    const same = try h.equal(try h.byte(content, try h.add(start, offset)), try h.byte(needle, offset));
    const next = try call(b, f, &.{ content, needle, start, try h.add(offset, try h.n(1)) });
    const checked = try h.conditional(same, next, try b.pure(try b.constant(bool, false)));
    try b.define(f, try h.conditional(try h.equal(offset, try h.length(needle)), try b.pure(try b.constant(bool, true)), checked));
    return f;
}

fn findBytes(h: Helpers, matches: Id) !Id {
    const b = h.b;
    const f = try b.declare(&.{ h.text, h.text, h.integer }, h.maybe_integer, &.{}, &.{});
    const content = try h.param(f, 0);
    const needle = try h.param(f, 1);
    const start = try h.param(f, 2);
    const matched = try b.variable(h.boolean);
    const next = try call(b, f, &.{ content, needle, try h.add(start, try h.n(1)) });
    const found = try h.variant(h.maybe_integer, start, 1);
    const compared = try b.bind(matched, try call(b, matches, &.{ content, needle, start, try h.n(0) }), try h.conditional(try b.reference(matched), found, next));
    try b.define(f, try h.conditional(
        try h.less(try h.length(content), try h.add(start, try h.length(needle))),
        try h.none(h.maybe_integer),
        compared,
    ));
    return f;
}

fn layoutFunction(h: Helpers, find: Id) !Id {
    const b = h.b;
    const f = try b.declare(&.{h.text}, h.maybe_layout, &.{}, &.{});
    const content = try h.param(f, 0);
    const first_a = try b.variable(h.maybe_integer);
    const first_z = try b.variable(h.maybe_integer);
    const extra_a = try b.variable(h.maybe_integer);
    const extra_z = try b.variable(h.maybe_integer);
    const a_pos = try h.payload(h.integer, try b.reference(first_a), 1);
    const z_pos = try h.payload(h.integer, try b.reference(first_z), 1);
    const marker_a = try h.literal(active_marker);
    const marker_z = try h.literal(archive_marker);
    var next = try h.variant(h.maybe_layout, try b.primitive(h.layout, .product, &.{ a_pos, z_pos }, 0), 1);
    next = try h.conditional(try h.less(z_pos, try h.add(a_pos, try h.n(active_marker.len))), try h.none(h.maybe_layout), next);
    next = try h.conditional(try h.tagIs(try b.reference(extra_z), 0), next, try h.none(h.maybe_layout));
    next = try b.bind(extra_z, try call(b, find, &.{
        content, marker_z, try h.add(z_pos, try h.n(1)),
    }), next);
    next = try h.conditional(try h.tagIs(try b.reference(extra_a), 0), next, try h.none(h.maybe_layout));
    next = try b.bind(extra_a, try call(b, find, &.{
        content, marker_a, try h.add(a_pos, try h.n(1)),
    }), next);
    next = try h.conditional(try h.tagIs(try b.reference(first_z), 1), next, try h.none(h.maybe_layout));
    next = try b.bind(first_z, try call(b, find, &.{ content, marker_z, try h.n(0) }), next);
    next = try h.conditional(try h.tagIs(try b.reference(first_a), 1), next, try h.none(h.maybe_layout));
    try b.define(f, try b.bind(first_a, try call(b, find, &.{ content, marker_a, try h.n(0) }), next));
    return f;
}

fn replaceFunction(h: Helpers, find: Id) !Id {
    const b = h.b;
    const f = try b.declare(&.{
        h.text, h.text, h.text, h.integer, h.layout, h.integer, h.text,
    }, h.maybe_text, &.{}, &.{});
    const content = try h.param(f, 0);
    const old = try h.param(f, 1);
    const replacement = try h.param(f, 2);
    const end = try h.param(f, 3);
    const layout = try h.param(f, 4);
    const cursor = try h.param(f, 5);
    const output = try h.param(f, 6);
    const found = try b.variable(h.maybe_integer);
    const at = try h.payload(h.integer, try b.reference(found), 1);
    const after = try h.add(at, try h.length(old));
    const prefix = try h.slice(content, cursor, at);
    const done = try appendResult(h, output, try h.slice(content, cursor, try h.length(content)));
    const size = try h.add(try h.add(try h.length(output), try h.length(prefix)), try h.length(replacement));
    var next = try call(b, f, &.{ content, old, replacement, end, layout, after, try h.concat(try h.concat(output, prefix), replacement) });
    next = try h.conditional(try h.less(try h.n(Content.max_length.?), size), try h.none(h.maybe_text), next);
    const starts = [_]Id{
        try h.field(h.integer, layout, 0), try h.field(h.integer, layout, 1),
    };
    for (starts, [_]u64{ active_marker.len, archive_marker.len }) |start, length| {
        const outside = try h.conditional(try h.less(start, after), try h.conditional(try h.less(at, try h.add(start, try h.n(length))), try h.none(h.maybe_text), next), next);
        next = outside;
    }
    next = try h.conditional(try h.less(end, after), done, next);
    next = try h.conditional(try h.tagIs(try b.reference(found), 1), next, done);
    try b.define(f, try b.bind(found, try call(b, find, &.{ content, old, cursor }), next));
    return f;
}

fn appendResult(h: Helpers, output: Id, suffix: Id) !Id {
    const size = try h.add(try h.length(output), try h.length(suffix));
    return h.conditional(try h.less(try h.n(Content.max_length.?), size), try h.none(h.maybe_text), try h.variant(h.maybe_text, try h.concat(output, suffix), 1));
}

fn finishFunction(h: Helpers, layout: Id) !Id {
    const b = h.b;
    const f = try b.declare(&.{ h.text, h.layout, h.maybe_text }, h.edit, &.{}, &.{});
    const base = try h.param(f, 0);
    const old_layout = try h.param(f, 1);
    const edited = try h.param(f, 2);
    const output = try h.payload(h.text, edited, 1);
    const shape = try b.variable(h.maybe_layout);
    const new_layout = try h.payload(h.layout, try b.reference(shape), 1);
    const before = try h.slice(base, try h.add(try h.field(h.integer, old_layout, 1), try h.n(archive_marker.len)), try h.length(base));
    const after = try h.slice(output, try h.add(try h.field(h.integer, new_layout, 1), try h.n(archive_marker.len)), try h.length(output));
    const order = try b.primitive(try b.scalar(i8), .blob_compare, &.{ before, after }, 0);
    const changed = try b.primitive(h.boolean, .select, &.{
        try h.equal(order, try b.constant(i8, 0)),
        try b.constant(bool, false),
        try b.constant(bool, true),
    }, 0);
    const change = try b.primitive(try h.c.schema(Change), .product, &.{ output, changed }, 0);
    const ready = try h.variant(h.edit, change, 0);
    const checked = try b.bind(shape, try call(b, layout, &.{output}), try h.conditional(try h.tagIs(try b.reference(shape), 1), ready, try h.invalid(h.edit)));
    try b.define(f, try h.conditional(try h.tagIs(edited, 1), checked, try h.invalid(h.edit)));
    return f;
}

const Helpers = struct {
    c: agent.Context,
    b: *source.Builder,
    unit: Id,
    boolean: Id,
    integer: Id,
    text: Id,
    edit: Id,
    layout: Id,
    maybe_layout: Id,
    maybe_integer: Id,
    maybe_text: Id,

    fn init(c: agent.Context) !Helpers {
        const b = c.builder;
        const unit = try b.scalar(void);
        const integer = try b.scalar(u64);
        const text = try c.schema(Content);
        const layout = try b.schema(.{ .product = &.{ integer, integer } });
        return .{
            .c = c,
            .b = b,
            .unit = unit,
            .integer = integer,
            .text = text,
            .layout = layout,
            .boolean = try b.scalar(bool),
            .edit = try c.schema(Edit),
            .maybe_layout = try b.schema(.{ .sum = &.{ unit, layout } }),
            .maybe_integer = try b.schema(.{ .sum = &.{ unit, integer } }),
            .maybe_text = try b.schema(.{ .sum = &.{ unit, text } }),
        };
    }
    fn param(h: Helpers, f: Id, i: usize) !Id {
        return h.b.reference(h.b.parameter(f, i));
    }
    fn n(h: Helpers, value: u64) !Id {
        return h.b.constant(u64, value);
    }
    fn literal(h: Helpers, bytes: []const u8) !Id {
        return h.c.literal(Content, .{ .bytes = bytes });
    }
    fn field(h: Helpers, schema: Id, value: Id, i: u64) !Id {
        return h.b.primitive(schema, .field, &.{value}, i);
    }
    fn length(h: Helpers, value: Id) !Id {
        return h.b.primitive(h.integer, .blob_length, &.{value}, 0);
    }
    fn equal(h: Helpers, left: Id, right: Id) !Id {
        return h.b.primitive(h.boolean, .equal, &.{ left, right }, 0);
    }
    fn less(h: Helpers, left: Id, right: Id) !Id {
        return h.b.primitive(h.boolean, .less, &.{ left, right }, 0);
    }
    fn add(h: Helpers, left: Id, right: Id) !Id {
        return h.fallible(h.integer, .integer_add, &.{ left, right }, 0, &.{.arithmetic_overflow});
    }
    fn slice(h: Helpers, value: Id, start: Id, end: Id) !Id {
        return h.fallible(h.text, .blob_slice, &.{ value, start, end }, 0, &.{ .capacity_exceeded, .invalid_utf8 });
    }
    fn concat(h: Helpers, left: Id, right: Id) !Id {
        return h.fallible(h.text, .blob_concat, &.{ left, right }, 0, &.{.capacity_exceeded});
    }
    fn byte(h: Helpers, value: Id, index: Id) !Id {
        const byte_type = try h.b.scalar(u8);
        const optional = try h.b.schema(.{ .sum = &.{ h.unit, byte_type } });
        return h.payload(byte_type, try h.b.primitive(optional, .blob_byte, &.{ value, index }, 0), 1);
    }
    fn payload(h: Helpers, schema: Id, value: Id, tag: u64) !Id {
        return h.fallible(schema, .variant_payload, &.{value}, tag, &.{.invalid_variant});
    }
    fn tagIs(h: Helpers, value: Id, tag: u64) !Id {
        return h.equal(try h.b.primitive(h.integer, .variant_tag, &.{value}, 0), try h.n(tag));
    }
    fn conditional(h: Helpers, condition: Id, yes: Id, no: Id) !Id {
        return h.b.term(.{ .conditional = .{
            .condition = condition,
            .when_true = yes,
            .when_false = no,
        } });
    }
    fn variant(h: Helpers, schema: Id, value: Id, tag: u64) !Id {
        return h.b.pure(try h.b.primitive(schema, .variant, &.{value}, tag));
    }
    fn none(h: Helpers, schema: Id) !Id {
        return h.variant(schema, try h.b.constant(void, {}), 0);
    }
    fn invalid(h: Helpers, schema: Id) !Id {
        return h.variant(schema, try h.b.constant(void, {}), 1);
    }
    fn fallible(h: Helpers, schema: Id, opcode: boundary.data_v2.program.Opcode, operands: []const Id, immediate: Id, faults: []const boundary.data_v2.program.Fault) !Id {
        const Failure = boundary.data_v2.program.InstructionFailure;
        const failures = try h.b.allocator().alloc(Failure, faults.len);
        const failure = try h.b.failureLiteral(try h.b.constant(void, {}));
        for (failures, faults) |*edge, kind| edge.* = .{ .kind = kind, .value = failure };
        return h.b.value(.{ .schema = schema, .expression = .{ .primitive = .{
            .opcode = opcode,
            .operands = operands,
            .immediate = immediate,
            .failures = failures,
        } } });
    }
};

fn call(b: *source.Builder, function: Id, arguments: []const Id) !Id {
    return b.term(.{ .call = .{ .function = function, .arguments = arguments } });
}
