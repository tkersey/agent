const std = @import("std");
const bnd = @import("boundary");
const agent = @import("agent");
const admission = agent.admission;
const callable = agent.callable;
const Id = bnd.computation.Id;
const B = bnd.computation.Builder;

pub const Representation = enum { interned, static_code, unsafe_reuse, unsafe_code };

pub fn build(b: *B, registry: *admission.Registry, representation: Representation, count: usize) !bnd.computation.Module {
    const unit = try b.scalar(void);
    const signature: bnd.data_v2.program.ComputationType = .{ .parameters = &.{}, .result = unit };
    const safe = try b.declare(&.{}, unit, &.{}, &.{});
    try b.define(safe, try b.pure(try b.constant(void, {})));
    const safe_code: callable.Definition = if (representation == .interned) .{
        .function = safe,
        .schema = try b.schema(.{ .internal = .{ .computation = signature } }),
    } else try callable.define(b, safe, signature);

    // This local effect is legal outside speculation, but not admitted inside.
    const u = try b.effect(.{ .identity = "probe/outside-only", .payload = unit, .result = unit, .external = false });
    const cap = try b.schema(.{ .internal = .{ .capability = u } });
    const token = try b.schema(.{ .internal = .{ .resumption = .{ .effect = u, .input = unit, .answer = unit, .handled = &.{u}, .mode = .deep, .use = .linear } } });
    const returns = try b.declare(&.{unit}, unit, &.{}, &.{});
    try b.define(returns, try b.pure(try b.reference(b.parameter(returns, 0))));
    const clause = try b.declare(&.{ unit, token }, unit, &.{}, &.{});
    try b.define(clause, try b.term(.{ .resume_value = .{ .resumption = try b.reference(b.parameter(clause, 1)), .argument = try b.constant(void, {}) } }));
    const local = try b.handler(.{ .mode = .deep, .input = unit, .answer = unit, .return_function = returns, .clauses = &.{.{ .effect = u, .function = clause, .resumption = token }} });
    const local_body = try b.declare(&.{cap}, unit, &.{u}, &.{});
    try b.define(local_body, try b.term(.{ .perform = .{ .effect = u, .capability = try b.reference(b.parameter(local_body, 0)), .payload = try b.constant(void, {}) } }));
    const local_type = try b.schema(.{ .internal = .{ .computation = .{ .parameters = &.{cap}, .result = unit, .effects = &.{u} } } });
    const outside = try b.declare(&.{}, unit, &.{}, &.{});
    try b.define(outside, try b.term(.{ .handle = .{ .handler = local, .body = try b.lambda(local_body, local_type) } }));
    const outside_code: callable.Definition = switch (representation) {
        .interned, .unsafe_reuse => .{ .function = outside, .schema = safe_code.schema },
        .static_code, .unsafe_code => try callable.define(b, outside, signature),
    };
    const supplied = switch (representation) {
        .unsafe_reuse, .unsafe_code => outside_code,
        else => safe_code,
    };
    const callback = supplied.schema;

    // One reusable higher-order helper receives the safe callback as a VALUE.
    const choice = try bnd.library.choice.family(b, "probe/choice");
    try registry.classify(choice.effect, .internal);
    const all = try bnd.library.choice.all(b, choice, unit, &.{ unit, callback, choice.capability }, .{ .effects = &.{} });
    const body = try b.declare(&.{ choice.capability, callback }, unit, &.{choice.effect}, &.{});
    const decision = try b.variable(try b.scalar(bool));
    try b.define(body, try b.bind(decision, try b.term(.{ .perform = .{ .effect = choice.effect, .capability = try b.reference(b.parameter(body, 0)), .payload = try b.constant(void, {}) } }), try b.term(.{ .apply = .{ .computation = try b.reference(b.parameter(body, 1)), .arguments = &.{} } })));
    const body_type = try b.schema(.{ .internal = .{ .computation = .{ .parameters = &.{ choice.capability, callback }, .result = unit, .effects = &.{choice.effect} } } });
    const root = try b.declare(&.{}, unit, &.{}, &.{});
    // The unrelated callback runs only AFTER all speculative work returns.
    var tail = try b.term(.{ .apply = .{ .computation = try callable.value(b, outside_code), .arguments = &.{} } });
    for (0..count) |_| {
        const result = try b.variable(all.answer);
        const evaluate = try b.term(.{ .handle = .{
            .handler = all.handler,
            .body = try b.lambda(body, body_type),
            .arguments = &.{try callable.value(b, supplied)},
        } });
        tail = try b.bind(result, evaluate, tail);
    }
    try b.define(root, tail);
    return b.module(root, unit);
}

test "original interned source is conservatively rejected despite valid Boundary compilation" {
    const a = std.testing.allocator;
    var b = B.init(a);
    defer b.deinit();
    var registry = admission.Registry.init(a);
    defer registry.deinit();
    const module = try build(&b, &registry, .interned, 1);
    var compiled = try bnd.program.compile(a, module);
    defer compiled.deinit();
    try std.testing.expectError(error.SpeculativeEffect, admission.verify(a, module, &registry));
}

test "public static-code callable preserves safe higher-order composition" {
    const a = std.testing.allocator;
    var b = B.init(a);
    defer b.deinit();
    var registry = admission.Registry.init(a);
    defer registry.deinit();
    const module = try build(&b, &registry, .static_code, 1);
    var compiled = try bnd.program.compile(a, module);
    defer compiled.deinit();
    try admission.verify(a, module, &registry);
}

test "static-code source comparison records image cost" {
    const a = std.testing.allocator;
    var b1 = B.init(a);
    defer b1.deinit();
    var r1 = admission.Registry.init(a);
    defer r1.deinit();
    var b2 = B.init(a);
    defer b2.deinit();
    var r2 = admission.Registry.init(a);
    defer r2.deinit();
    var c1 = try bnd.program.compile(a, try build(&b1, &r1, .interned, 1));
    defer c1.deinit();
    var c2 = try bnd.program.compile(a, try build(&b2, &r2, .static_code, 1));
    defer c2.deinit();
    const image = bnd.data_v2.image;
    const len1 = try image.encodedLength(c1.program);
    const len2 = try image.encodedLength(c2.program);
    const bytes1 = try a.alloc(u8, len1);
    defer a.free(bytes1);
    const bytes2 = try a.alloc(u8, len2);
    defer a.free(bytes2);
    _ = try c1.encode(a, bytes1);
    _ = try c2.encode(a, bytes2);
    std.debug.print("shape-interned image={d}; nominal separation image={d}; byte_equal={}\n", .{ len1, len2, std.mem.eql(u8, bytes1, bytes2) });
    try std.testing.expectEqual(len1 + 8, len2);
}

test "static-code identity does not assert effect safety or bless schema reuse" {
    for ([_]Representation{ .unsafe_reuse, .unsafe_code }) |representation| {
        const a = std.testing.allocator;
        var b = B.init(a);
        defer b.deinit();
        var registry = admission.Registry.init(a);
        defer registry.deinit();
        const module = try build(&b, &registry, representation, 1);
        var compiled = try bnd.program.compile(a, module);
        defer compiled.deinit();
        try std.testing.expectError(error.SpeculativeEffect, admission.verify(a, module, &registry));
    }
}

test "1 8 and 64 callable installations share schema and executable body" {
    for ([_]usize{ 1, 8, 64 }) |count| {
        var b = B.init(std.testing.allocator);
        defer b.deinit();
        const unit = try b.scalar(void);
        const function = try b.declare(&.{}, unit, &.{}, &.{});
        try b.define(function, try b.pure(try b.constant(void, {})));
        const signature: bnd.data_v2.program.ComputationType = .{
            .parameters = &.{},
            .result = unit,
        };
        const declaration = try callable.define(&b, function, signature);
        const schemas = b.schemas.items.len;
        const functions = b.functions.items.len;
        for (0..count) |_| {
            const again = try callable.define(&b, function, signature);
            try std.testing.expectEqual(declaration, again);
            _ = try callable.value(&b, again);
        }
        try std.testing.expectEqual(schemas, b.schemas.items.len);
        try std.testing.expectEqual(functions, b.functions.items.len);
    }
}
