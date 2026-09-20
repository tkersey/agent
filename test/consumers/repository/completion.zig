//! Completion names only the files actually changed by this execution.
const std = @import("std");
const agent = @import("agent");
const boundary = @import("boundary");
const E = @import("source.zig").Emit;
const t = @import("types.zig");
const Id = boundary.computation.Id;
pub const Changes = @FieldType(t.FinalResult, "changed_files");
const Pair = struct { head: t.Path, rest: Changes };
pub const Functions = struct { capacity: Id, update: Id, allowed: Id };

pub fn define(e: E) !Functions {
    const b = e.c.builder;
    const contains = try containsFunction(e);
    const subset = try subsetFunction(e, contains);
    const capacity = try b.declare(&.{ try e.c.schema(Changes), try e.c.schema(t.Path) }, try e.c.schema(bool), &.{}, &.{});
    const found = try b.variable(try e.c.schema(bool));
    const length = try b.primitive(try e.c.schema(u64), .sequence_length, &.{try e.param(capacity, 0)}, 0);
    try b.define(capacity, try b.bind(found, try e.call(contains, &.{ try e.param(capacity, 0), try e.param(capacity, 1) }), try b.pure(try e.either(try b.reference(found), try e.binary(.less, length, try e.c.literal(u64, 4))))));
    return .{ .capacity = capacity, .update = try updateFunction(e, contains), .allowed = try allowedFunction(e, subset) };
}

fn containsFunction(e: E) !Id {
    const b = e.c.builder;
    const f = try b.declare(&.{ try e.c.schema(Changes), try e.c.schema(t.Path) }, try e.c.schema(bool), &.{}, &.{});
    const no = try b.variable(try e.c.schema(void));
    const yes = try b.variable(try e.c.schema(Pair));
    const equal = try b.variable(try e.c.schema(bool));
    const next = try e.call(f, &.{ try e.field(Changes, try b.reference(yes), 1), try e.param(f, 1) });
    const checked = try b.bind(equal, try compare(e, t.Path, try e.field(t.Path, try b.reference(yes), 0), try e.param(f, 1)), try b.term(.{ .conditional = .{ .condition = try b.reference(equal), .when_true = try b.pure(try e.c.literal(bool, true)), .when_false = next } }));
    try b.define(f, try pop(e, try e.param(f, 0), no, yes, try b.pure(try e.c.literal(bool, false)), checked));
    return f;
}

fn subsetFunction(e: E, contains: Id) !Id {
    const b = e.c.builder;
    const f = try b.declare(&.{ try e.c.schema(Changes), try e.c.schema(Changes) }, try e.c.schema(bool), &.{}, &.{});
    const no = try b.variable(try e.c.schema(void));
    const yes = try b.variable(try e.c.schema(Pair));
    const found = try b.variable(try e.c.schema(bool));
    const next = try e.call(f, &.{ try e.field(Changes, try b.reference(yes), 1), try e.param(f, 1) });
    const checked = try b.bind(found, try e.call(contains, &.{ try e.param(f, 1), try e.field(t.Path, try b.reference(yes), 0) }), try b.term(.{ .conditional = .{ .condition = try b.reference(found), .when_true = next, .when_false = try b.pure(try e.c.literal(bool, false)) } }));
    try b.define(f, try pop(e, try e.param(f, 0), no, yes, try b.pure(try e.c.literal(bool, true)), checked));
    return f;
}

fn updateFunction(e: E, contains: Id) !Id {
    const b = e.c.builder;
    const f = try b.declare(&.{ try e.c.schema(Changes), try e.c.schema(t.ReplaceOutcome) }, try e.c.schema(Changes), &.{}, &.{});
    const applied = try b.variable(try e.c.schema(t.ReplaceApplied));
    const denied = try b.variable(try e.c.schema(t.ReplaceDenied));
    const conflict = try b.variable(try e.c.schema(t.ReplaceConflict));
    const found = try b.variable(try e.c.schema(bool));
    const changes = try e.param(f, 0);
    const path = try e.field(t.Path, try b.reference(applied), 0);
    const appended = try b.value(.{ .schema = try e.c.schema(Changes), .expression = .{ .primitive = .{
        .opcode = .sequence_append,
        .operands = &.{ changes, path },
        .failures = &.{.{ .kind = .capacity_exceeded, .value = try b.failureLiteral(try e.c.literal(t.Failure, .capacity_exceeded)) }},
    } } });
    const changed = try b.bind(found, try e.call(contains, &.{ changes, path }), try b.term(.{ .conditional = .{
        .condition = try b.reference(found),
        .when_true = try b.pure(changes),
        .when_false = try b.pure(appended),
    } }));
    try b.define(f, try b.term(.{ .match_sum = .{ .value = try e.param(f, 1), .cases = &.{
        .{ .variable = applied, .body = changed },
        .{ .variable = denied, .body = try b.pure(changes) },
        .{ .variable = conflict, .body = try b.pure(changes) },
    } } }));
    return f;
}

fn allowedFunction(e: E, subset: Id) !Id {
    const b = e.c.builder;
    const f = try b.declare(&.{ try e.c.schema(t.Memory), try e.c.schema(Changes), try e.c.schema(t.FinalResult) }, try e.c.schema(bool), &.{}, &.{});
    const no = try b.variable(try e.c.schema(void));
    const applied = try b.variable(try e.c.schema(t.SourceVersion));
    const reject = try b.pure(try e.c.literal(bool, false));
    const paths = try e.field(Changes, try e.param(f, 2), 1);
    const matching = try b.variable(try e.c.schema(bool));
    const digest = try b.variable(try e.c.schema(bool));
    const actual_length = try b.primitive(try e.c.schema(u64), .sequence_length, &.{try e.param(f, 1)}, 0);
    const claimed_length = try b.primitive(try e.c.schema(u64), .sequence_length, &.{paths}, 0);
    const valid = try e.both(try b.reference(matching), try e.both(try b.reference(digest), try e.binary(.equal, actual_length, claimed_length)));
    const claimed_digest = try e.field(t.DigestHex, try e.param(f, 2), 3);
    const applied_digest = try e.field(t.DigestHex, try b.reference(applied), 1);
    const same_digest = try compare(e, t.DigestHex, claimed_digest, applied_digest);
    const checked_digest = try b.bind(digest, same_digest, try b.pure(valid));
    const matching_paths = try e.call(subset, &.{ try e.param(f, 1), paths });
    const checked = try b.bind(matching, matching_paths, checked_digest);
    const source = try e.field(?t.SourceVersion, try e.param(f, 0), 10);
    try b.define(f, try b.term(.{ .match_sum = .{ .value = source, .cases = &.{
        .{ .variable = no, .body = reject }, .{ .variable = applied, .body = checked },
    } } }));
    return f;
}

fn compare(e: E, comptime T: type, a: Id, b: Id) !Id {
    return agent.value_equality.compare(e.c.builder, try e.c.schema(T), a, b, try e.c.literal(t.Failure, .invalid_variant));
}
fn pop(e: E, value: Id, no: Id, yes: Id, empty: Id, more: Id) !Id {
    const b = e.c.builder;
    return b.term(.{ .match_sum = .{ .value = try b.primitive(try e.c.schema(?Pair), .sequence_pop, &.{value}, 0), .cases = &.{
        .{ .variable = no, .body = empty }, .{ .variable = yes, .body = more },
    } } });
}
