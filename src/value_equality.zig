//! Structural equality for portable values, emitted through typed Boundary code.
const std = @import("std");
const boundary = @import("boundary");
const source = boundary.source;
const a = boundary.authoring;
const Id = source.Id;
pub const Error = source.Error || error{UnsupportedEqualitySchema};
pub const TypedError = a.Error || error{UnsupportedEqualitySchema};

/// Construct a pure comparison, retaining named schemas and recursive sharing.
pub fn create(c: *a.Context, schema: *const a.Schema, failure: *const a.FailureLiteral) TypedError!*const a.Function {
    const b = a.interop.builder(c);
    const id = try a.interop.schemaId(c, schema);
    _ = try a.interop.failureLiteralId(c, failure);
    var visited = std.AutoHashMapUnmanaged(Id, void){};
    defer visited.deinit(b.allocator());
    try portable(b, id, &visited);
    return declare(c, schema, failure);
}

// Transitional source-ID adapter over the same typed construction.
pub fn define(b: *source.Builder, schema: Id, failure: Id) Error!Id {
    return adapted(b, schema, failure) catch |err| {
        if (err == error.UnsupportedEqualitySchema) return error.UnsupportedEqualitySchema;
        return a.sourceError(@errorCast(err));
    };
}
fn adapted(b: *source.Builder, schema: Id, failure: Id) TypedError!Id {
    var visited = std.AutoHashMapUnmanaged(Id, void){};
    defer visited.deinit(b.allocator());
    try portable(b, schema, &visited);
    const literal = try b.failureLiteral(failure);
    const cached = try b.specialization(Id, "agent.value-equality/source-adapter/v2", .{ schema, literal });
    if (cached.cached) |function| return function;
    const c = try a.Context.init(b);
    const contract = try a.interop.schema(c, schema);
    const fault = try a.interop.literalFailure(c, failure, try a.interop.schema(c, b.values.items[@intCast(failure)].schema));
    return cached.finish(b, try a.interop.functionId(c, try declare(c, contract, fault)));
}
pub fn compare(b: *source.Builder, schema: Id, left: Id, right: Id, failure: Id) Error!Id {
    if (left >= b.values.items.len or right >= b.values.items.len) return error.InvalidReference;
    if (b.values.items[@intCast(left)].schema != schema or b.values.items[@intCast(right)].schema != schema) return error.TypeMismatch;
    return b.term(.{ .call = .{ .function = try define(b, schema, failure), .arguments = &.{ left, right } } });
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

fn declare(c: *a.Context, schema: *const a.Schema, failure: *const a.FailureLiteral) TypedError!*const a.Function {
    const b = a.interop.builder(c);
    const id = try a.interop.schemaId(c, schema);
    const cached = try b.specialization(Id, "agent.value-equality/typed-v1", .{ @intFromPtr(c), @intFromPtr(schema), try a.interop.failureLiteralId(c, failure) });
    if (cached.cached) |function| return a.interop.declaredFunction(c, function);
    const function = try c.function("portable equality", &.{ .{ .name = "left", .schema = schema }, .{ .name = "right", .schema = schema } }, try c.scalar(bool), &.{});
    // Register before descending into recursive portable schemas.
    _ = try cached.finish(b, try a.interop.functionId(c, function));
    const body = try c.body(function);
    const left = try body.parameter("left");
    const right = try body.parameter("right");
    const result = switch (b.schemas.items[@intCast(id)]) {
        .unit => try body.constant(bool, true),
        .boolean, .i8, .i16, .i32, .i64, .u8, .u16, .u32, .u64 => try body.equal(left, right),
        .enumeration => try body.equal(try body.enumTag(left), try body.enumTag(right)),
        .bytes, .text, .bounded_bytes, .bounded_text => try body.equal(try body.blobCompare(left, right), try body.constant(i8, 0)),
        .product => try product(c, body, schema, left, right, failure),
        .sum => try sum(c, body, schema, left, right, failure),
        .seq, .vector, .array => try sequence(c, body, schema, left, right, failure),
        .internal => return error.UnsupportedEqualitySchema,
    };
    try c.define(function, try body.ret(result));
    return function;
}
const Guard = struct {
    parent: *a.Body,
    condition: *const a.Value,
    yes: *a.Body,
    no: *a.Body,
    fn finish(g: @This(), value: *const a.Value) TypedError!*const a.Value {
        return g.parent.conditional(g.condition, try g.yes.ret(value), try g.no.ret(try g.no.constant(bool, false)));
    }
};
fn product(c: *a.Context, body: *a.Body, schema: *const a.Schema, left: *const a.Value, right: *const a.Value, failure: *const a.FailureLiteral) TypedError!*const a.Value {
    const allocator = a.interop.builder(c).allocator();
    var guards: std.ArrayList(Guard) = .empty;
    defer guards.deinit(allocator);
    var work = body;
    for (schema.fields()) |field| {
        const compared = try work.call(try declare(c, field.schema, failure), &.{ .{ .name = "left", .value = try work.field(left, field.name) }, .{ .name = "right", .value = try work.field(right, field.name) } });
        const yes = try work.branch();
        try guards.append(allocator, .{ .parent = work, .condition = compared, .yes = yes, .no = try work.branch() });
        work = yes;
    }
    var result = try work.constant(bool, true);
    var remaining = guards.items.len;
    while (remaining != 0) {
        remaining -= 1;
        result = try guards.items[remaining].finish(result);
    }
    return result;
}
fn sum(c: *a.Context, body: *a.Body, schema: *const a.Schema, left: *const a.Value, right: *const a.Value, failure: *const a.FailureLiteral) TypedError!*const a.Value {
    const same = try body.equal(try body.variantTag(left), try body.variantTag(right));
    const matching = try body.branch();
    const different = try body.branch();
    const cases = try a.interop.builder(c).allocator().alloc(*const a.FinishedCase, schema.fields().len);
    for (schema.fields(), cases) |field, *finished| {
        const selected = try matching.caseOf(left, field.name);
        const work = selected.body();
        const payload = try work.variantPayload(right, field.name, failure);
        const equal = try work.call(try declare(c, field.schema, failure), &.{ .{ .name = "left", .value = selected.payload() }, .{ .name = "right", .value = payload } });
        finished.* = try selected.ret(equal);
    }
    return body.conditional(same, try matching.ret(try matching.match(left, cases)), try different.ret(try different.constant(bool, false)));
}
fn sequence(c: *a.Context, body: *a.Body, schema: *const a.Schema, left: *const a.Value, right: *const a.Value, failure: *const a.FailureLiteral) TypedError!*const a.Value {
    const integer = try c.scalar(u64);
    const boolean = try c.scalar(bool);
    const loop_fn = try c.function("compare sequence elements", &.{ .{ .name = "left", .schema = schema }, .{ .name = "right", .schema = schema }, .{ .name = "index", .schema = integer }, .{ .name = "length", .schema = integer } }, boolean, &.{});
    const loop = try c.body(loop_fn);
    const l = try loop.parameter("left");
    const r = try loop.parameter("right");
    const index = try loop.parameter("index");
    const length = try loop.parameter("length");
    const ended = try loop.branch();
    const active = try loop.branch();
    const lv = try active.sequenceGet(l, index);
    const l_none = try active.caseOf(lv, "none");
    const l_some = try active.caseOf(lv, "some");
    const rv = try l_some.body().sequenceGet(r, index);
    const r_none = try l_some.body().caseOf(rv, "none");
    const r_some = try l_some.body().caseOf(rv, "some");
    const working = r_some.body();
    const equal = try working.call(try declare(c, schema.resultSchema() orelse return error.InvalidSchema, failure), &.{ .{ .name = "left", .value = l_some.payload() }, .{ .name = "right", .value = r_some.payload() } });
    const yes = try working.branch();
    const no = try working.branch();
    const next = try yes.call(loop_fn, &.{ .{ .name = "left", .value = l }, .{ .name = "right", .value = r }, .{ .name = "index", .value = try yes.checkedAdd(index, try yes.constant(u64, 1), failure) }, .{ .name = "length", .value = length } });
    const compared = try working.conditional(equal, try yes.ret(next), try no.ret(try no.constant(bool, false)));
    const right_match = try l_some.body().match(rv, &.{ try r_none.ret(try r_none.body().constant(bool, false)), try r_some.ret(compared) });
    const left_match = try active.match(lv, &.{ try l_none.ret(try l_none.body().constant(bool, false)), try l_some.ret(right_match) });
    try c.define(loop_fn, try loop.ret(try loop.conditional(try loop.equal(index, length), try ended.ret(try ended.constant(bool, true)), try active.ret(left_match))));
    const left_length = try body.sequenceLength(left);
    const right_length = try body.sequenceLength(right);
    const same = try body.branch();
    const different = try body.branch();
    const compared_all = try same.call(loop_fn, &.{ .{ .name = "left", .value = left }, .{ .name = "right", .value = right }, .{ .name = "index", .value = try same.constant(u64, 0) }, .{ .name = "length", .value = left_length } });
    return body.conditional(try body.equal(left_length, right_length), try same.ret(compared_all), try different.ret(try different.constant(bool, false)));
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

test "typed comparisons preserve named records and share equal failure literals" {
    var b = source.Builder.init(std.testing.allocator);
    defer b.deinit();
    const c = try a.Context.init(&b);
    const unit = try c.scalar(void);
    const choice = try c.alternatives(&.{ .{ .name = "empty", .schema = unit }, .{ .name = "count", .schema = try c.scalar(u64) } });
    const schema = try c.record(&.{ .{ .name = "label", .schema = try a.interop.schema(c, try b.schema(.{ .bounded_text = 16 })) }, .{ .name = "choice", .schema = choice } });
    const function = try create(c, schema, try c.literalFailure(void, {}));
    const declarations = b.functions.items.len;
    try std.testing.expect(function == try create(c, schema, try c.literalFailure(void, {})));
    try std.testing.expectEqual(declarations, b.functions.items.len);
    const foreign = try a.Context.init(&b);
    try std.testing.expectError(error.ForeignHandle, create(foreign, schema, try foreign.literalFailure(void, {})));
    var compiled = try c.compile(std.testing.allocator, function, unit);
    defer compiled.deinit();
}
