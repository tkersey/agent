//! Structural equality for portable values, emitted as ordinary Boundary code.
//! The native implementation runs only while authoring a source module.
const std = @import("std");
const boundary = @import("boundary");
const source = boundary.computation;
const p = boundary.data_v2.program;
const Id = source.Id;

pub const Error = source.Error || error{UnsupportedEqualitySchema};

/// Declare a shared pure function `(schema, schema) -> bool`. `failure` is a
/// literal source value of the enclosing module's failure schema. Boundary
/// requires explicit fault edges even where a length/tag guard proves the
/// relevant arithmetic/projection cannot fail for an admitted value.
pub fn define(b: *source.Builder, schema: Id, failure: Id) Error!Id {
    var visited = std.AutoHashMapUnmanaged(Id, void){};
    defer visited.deinit(b.allocator());
    try portable(b, schema, &visited);
    return defineChecked(b, schema, try b.failureLiteral(failure));
}

/// Return a CALL TERM, not a value expression. Bind its boolean result before
/// using it in a conditional or another value expression.
pub fn compare(b: *source.Builder, schema: Id, left: Id, right: Id, failure: Id) Error!Id {
    if (left >= b.values.items.len or right >= b.values.items.len) return error.InvalidReference;
    const left_schema = b.values.items[@intCast(left)].schema;
    const right_schema = b.values.items[@intCast(right)].schema;
    if (left_schema != schema or right_schema != schema) return error.TypeMismatch;
    return call(b, try define(b, schema, failure), &.{ left, right });
}

fn portable(
    b: *source.Builder,
    schema: Id,
    visited: *std.AutoHashMapUnmanaged(Id, void),
) Error!void {
    if (schema >= b.schemas.items.len) return error.InvalidReference;
    const entry = try visited.getOrPut(b.allocator(), schema);
    if (entry.found_existing) return;
    switch (b.schemas.items[@intCast(schema)]) {
        .internal => return error.UnsupportedEqualitySchema,
        .product, .sum => |children| for (children) |child| try portable(b, child, visited),
        .seq => |element| try portable(b, element, visited),
        .vector => |vector| try portable(b, vector.element, visited),
        .array => |array| try portable(b, array.element, visited),
        else => {},
    }
}

fn defineChecked(b: *source.Builder, schema: Id, failure: Id) Error!Id {
    const cached = try b.specialization(Id, "agent.value-equality/v1", .{ schema, failure });
    if (cached.cached) |function| return function;
    // Publish the declaration before recursively constructing its body. This
    // gives mutually recursive portable schemas a finite function graph.
    const function = try b.declare(&.{ schema, schema }, try b.scalar(bool), &.{}, &.{});
    _ = try cached.finish(b, function);
    const left = try b.reference(b.parameter(function, 0));
    const right = try b.reference(b.parameter(function, 1));
    const shape = b.schemas.items[@intCast(schema)];
    const body = switch (shape) {
        .unit => try truth(b, true),
        .boolean, .i8, .i16, .i32, .i64, .u8, .u16, .u32, .u64 => try b.pure(try equal(
            b,
            left,
            right,
        )),
        .enumeration => try b.pure(try equal(
            b,
            try b.primitive(try b.scalar(u32), .enum_tag, &.{left}, 0),
            try b.primitive(try b.scalar(u32), .enum_tag, &.{right}, 0),
        )),
        .bytes, .text, .bounded_bytes, .bounded_text => try b.pure(try equal(
            b,
            try b.primitive(try b.scalar(i8), .blob_compare, &.{ left, right }, 0),
            try b.constant(i8, 0),
        )),
        .product => |fields| try product(b, fields, left, right, failure),
        .sum => |variants| try sum(b, variants, left, right, failure),
        .seq => |element| try sequence(b, schema, element, left, right, failure),
        .vector => |vector| try sequence(b, schema, vector.element, left, right, failure),
        .array => |array| try sequence(b, schema, array.element, left, right, failure),
        .internal => return error.UnsupportedEqualitySchema,
    };
    try b.define(function, body);
    return function;
}

fn product(b: *source.Builder, fields: []const Id, left: Id, right: Id, failure: Id) Error!Id {
    var next = try truth(b, true);
    var index = fields.len;
    while (index != 0) {
        index -= 1;
        const schema = fields[index];
        const comparison = try call(b, try defineChecked(b, schema, failure), &.{
            try b.primitive(schema, .field, &.{left}, index),
            try b.primitive(schema, .field, &.{right}, index),
        });
        next = try andThen(b, comparison, next);
    }
    return next;
}

fn sum(b: *source.Builder, variants: []const Id, left: Id, right: Id, failure: Id) Error!Id {
    const Case = std.meta.Child(@FieldType(@FieldType(source.ast.Term, "match_sum"), "cases"));
    const cases = try b.allocator().alloc(Case, variants.len);
    for (cases, variants, 0..) |*case, schema, index| {
        const variable = try b.variable(schema);
        const right_payload = try fallible(
            b,
            schema,
            .variant_payload,
            &.{right},
            index,
            .invalid_variant,
            failure,
        );
        case.* = .{
            .variable = variable,
            .body = try call(b, try defineChecked(b, schema, failure), &.{
                try b.reference(variable), right_payload,
            }),
        };
    }
    return b.term(.{ .conditional = .{
        .condition = try equal(
            b,
            try b.primitive(try b.scalar(u64), .variant_tag, &.{left}, 0),
            try b.primitive(try b.scalar(u64), .variant_tag, &.{right}, 0),
        ),
        .when_true = try b.term(.{ .match_sum = .{ .value = left, .cases = cases } }),
        .when_false = try truth(b, false),
    } });
}

fn sequence(
    b: *source.Builder,
    schema: Id,
    element: Id,
    left: Id,
    right: Id,
    failure: Id,
) Error!Id {
    const integer = try b.scalar(u64);
    const boolean = try b.scalar(bool);
    const unit = try b.scalar(void);
    const optional = try b.schema(.{ .sum = &.{ unit, element } });
    const loop = try b.declare(&.{ schema, schema, integer, integer }, boolean, &.{}, &.{});
    const l = try b.reference(b.parameter(loop, 0));
    const r = try b.reference(b.parameter(loop, 1));
    const index = try b.reference(b.parameter(loop, 2));
    const length = try b.reference(b.parameter(loop, 3));
    const l_none = try b.variable(unit);
    const l_some = try b.variable(element);
    const r_none = try b.variable(unit);
    const r_some = try b.variable(element);
    const increment = try fallible(
        b,
        integer,
        .integer_add,
        &.{ index, try b.constant(u64, 1) },
        0,
        .arithmetic_overflow,
        failure,
    );
    const recurse = try call(b, loop, &.{ l, r, increment, length });
    const element_equal = try call(b, try defineChecked(b, element, failure), &.{
        try b.reference(l_some), try b.reference(r_some),
    });
    const right_match = try b.term(.{ .match_sum = .{
        .value = try b.primitive(optional, .sequence_get, &.{ r, index }, 0),
        .cases = &.{
            .{ .variable = r_none, .body = try truth(b, false) },
            .{ .variable = r_some, .body = try andThen(b, element_equal, recurse) },
        },
    } });
    const left_match = try b.term(.{ .match_sum = .{
        .value = try b.primitive(optional, .sequence_get, &.{ l, index }, 0),
        .cases = &.{
            .{ .variable = l_none, .body = try truth(b, false) },
            .{ .variable = l_some, .body = right_match },
        },
    } });
    try b.define(loop, try b.term(.{ .conditional = .{
        .condition = try equal(b, index, length),
        .when_true = try truth(b, true),
        .when_false = left_match,
    } }));
    const left_length = try b.primitive(integer, .sequence_length, &.{left}, 0);
    const right_length = try b.primitive(integer, .sequence_length, &.{right}, 0);
    return b.term(.{ .conditional = .{
        .condition = try equal(b, left_length, right_length),
        .when_true = try call(b, loop, &.{ left, right, try b.constant(u64, 0), left_length }),
        .when_false = try truth(b, false),
    } });
}

fn andThen(b: *source.Builder, condition: Id, next: Id) Error!Id {
    const variable = try b.variable(try b.scalar(bool));
    return b.bind(variable, condition, try b.term(.{ .conditional = .{
        .condition = try b.reference(variable),
        .when_true = next,
        .when_false = try truth(b, false),
    } }));
}

fn equal(b: *source.Builder, left: Id, right: Id) source.Error!Id {
    return b.primitive(try b.scalar(bool), .equal, &.{ left, right }, 0);
}

fn truth(b: *source.Builder, value: bool) source.Error!Id {
    return b.pure(try b.constant(bool, value));
}

fn call(b: *source.Builder, function: Id, arguments: []const Id) source.Error!Id {
    return b.term(.{ .call = .{ .function = function, .arguments = arguments } });
}

fn fallible(
    b: *source.Builder,
    schema: Id,
    opcode: p.Opcode,
    operands: []const Id,
    immediate: Id,
    kind: p.Fault,
    failure: Id,
) source.Error!Id {
    return b.value(.{ .schema = schema, .expression = .{ .primitive = .{
        .opcode = opcode,
        .operands = operands,
        .immediate = immediate,
        .failures = &.{.{ .kind = kind, .value = failure }},
    } } });
}

test "all portable schema families lower to checked pure comparisons" {
    var b = source.Builder.init(std.testing.allocator);
    defer b.deinit();
    const unit = try b.scalar(void);
    const failure = try b.constant(void, {});
    const integer = try b.scalar(i64);
    const tree = try b.reserveSchema();
    const children = try b.schema(.{ .product = &.{ integer, tree, tree } });
    try b.defineSchema(tree, .{ .sum = &.{ unit, children } });
    const fields = [_]Id{
        unit,
        try b.scalar(bool),
        try b.scalar(i8),
        try b.scalar(i16),
        try b.scalar(i32),
        integer,
        try b.scalar(u8),
        try b.scalar(u16),
        try b.scalar(u32),
        try b.scalar(u64),
        try b.schema(.{ .enumeration = &.{ 1, 19, 4000000000 } }),
        try b.schema(.bytes),
        try b.schema(.text),
        try b.schema(.{ .bounded_bytes = 16 }),
        try b.schema(.{ .bounded_text = 16 }),
        try b.schema(.{ .seq = tree }),
        try b.schema(.{ .vector = .{ .element = integer, .maximum = 32 } }),
        try b.schema(.{ .array = .{ .element = integer, .length = 64 } }),
        tree,
    };
    const whole = try b.schema(.{ .product = &fields });
    const function = try define(&b, whole, failure);
    try std.testing.expectEqual(function, try define(&b, whole, try b.constant(void, {})));
    try std.testing.expectEqual(@as(usize, 0), b.functions.items[@intCast(function)].effects.len);
    var compiled = try boundary.program.compile(std.testing.allocator, b.module(function, unit));
    defer compiled.deinit();
    try std.testing.expectEqual(@as(usize, 0), compiled.program.effects.len);
}

test "internal values reject at any recursive schema depth before declarations" {
    var b = source.Builder.init(std.testing.allocator);
    defer b.deinit();
    const failure = try b.constant(void, {});
    const unit = try b.scalar(void);
    const region = b.region();
    const cell = try b.schema(.{ .internal = .{ .cell = .{ .element = unit, .region = region } } });
    const recursive = try b.reserveSchema();
    const nested = try b.schema(.{ .product = &.{ recursive, cell } });
    try b.defineSchema(recursive, .{ .sum = &.{ unit, nested } });
    const before = b.functions.items.len;
    try std.testing.expectError(error.UnsupportedEqualitySchema, define(&b, recursive, failure));
    try std.testing.expectEqual(before, b.functions.items.len);
}

test "compare validates values and returns an ordinary source call" {
    var b = source.Builder.init(std.testing.allocator);
    defer b.deinit();
    const failure = try b.constant(void, {});
    const integer = try b.scalar(u64);
    const left = try b.constant(u64, 13);
    const right = try b.constant(u64, 17);
    const term = try compare(&b, integer, left, right, failure);
    try std.testing.expect(b.terms.items[@intCast(term)] == .call);
    try std.testing.expectError(
        error.TypeMismatch,
        compare(&b, integer, left, try b.constant(bool, true), failure),
    );
    try std.testing.expectError(
        error.InvalidReference,
        compare(&b, integer, left, b.values.items.len, failure),
    );
}
