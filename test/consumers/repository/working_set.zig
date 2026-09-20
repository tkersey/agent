//! Application-owned repository working-set policy. Every transition below is
//! authored Boundary data; host adapters do not fold memory or approve completion.
const std = @import("std");
const agent = @import("agent");
const boundary = @import("boundary");
pub const types = @import("types.zig");
const t = types;
const Id = boundary.computation.Id;

pub const initial: t.Memory = .{
    .listing = null,
    .package_document = null,
    .source_document = null,
    .test_document = null,
    .latest_search = null,
    .latest_test = null,
    .replacement = null,
    .failing_test_observed = false,
    .mutation_applied = false,
    .passing_test_observed = false,
    .applied_source = null,
};

pub const Functions = struct { observe: Id, project: Id, final_allowed: Id };

pub fn define(c: agent.Context) !Functions {
    const e: Emit = .{ .c = c };
    const b = c.builder;
    const observe = try b.declare(&.{ try c.schema(t.Memory), try c.schema(t.Observation) }, try c.schema(t.Memory), &.{}, &.{});
    const memory = try e.param(observe, 0);
    const Case = std.meta.Child(@FieldType(@FieldType(boundary.computation.ast.Term, "match_sum"), "cases"));
    var cases: [5]Case = undefined;
    inline for (std.meta.fields(t.Observation), 0..) |field, index| {
        const payload = try b.variable(try c.schema(field.type));
        const value = try b.reference(payload);
        const body = switch (index) {
            0 => try b.pure(try e.memory(memory, .{ .listing = try e.some(?t.CompactListing, value) })),
            1 => try observeRead(e, memory, value),
            2 => try b.pure(try e.memory(memory, .{ .latest_search = try e.some(?t.CompactSearch, value) })),
            3 => try b.pure(try observeTest(e, memory, value)),
            4 => try observeReplacement(e, memory, value),
            else => unreachable,
        };
        cases[index] = .{ .variable = payload, .body = body };
    }
    try b.define(observe, try b.term(.{ .match_sum = .{ .value = try e.param(observe, 1), .cases = &cases } }));

    const project = try b.declare(&.{try c.schema(t.Memory)}, try c.schema(t.DecisionView), &.{}, &.{});
    const m = try e.param(project, 0);
    var fields: [8]Id = undefined;
    inline for (std.meta.fields(t.Memory)[0..7], 0..) |field, i| fields[i] = try e.field(field.type, m, i);
    fields[7] = try e.product(t.DecisionEvidence, &.{ try e.field(bool, m, 7), try e.field(bool, m, 8), try e.field(bool, m, 9) });
    try b.define(project, try b.pure(try e.product(t.DecisionView, &fields)));

    const allowed = try b.declare(&.{ try c.schema(t.Memory), try c.schema(t.FinalResult) }, try c.schema(bool), &.{}, &.{});
    const fm = try e.param(allowed, 0);
    const result = try e.param(allowed, 1);
    const evidence = try e.both(try e.field(bool, fm, 7), try e.field(bool, fm, 8));
    const passing = try e.both(try e.field(bool, fm, 9), try e.field(bool, result, 2));
    try b.define(allowed, try b.pure(try e.both(evidence, passing)));
    return .{ .observe = observe, .project = project, .final_allowed = allowed };
}

fn observeRead(e: Emit, memory: Id, read: Id) !Id {
    const code = try e.field(u8, read, 1);
    var body = try e.c.builder.term(.{ .fail = try e.c.literal(t.Failure, .invalid_variant) });
    inline for (.{ t.DocumentRole.@"test", t.DocumentRole.source, t.DocumentRole.package }) |role| {
        const index = @intFromEnum(role);
        const normalized = try e.product(t.ReadResult, &.{
            try e.c.literal(t.DocumentRole, role), code,                             try e.field(t.Path, read, 2),
            try e.field(t.DigestHex, read, 3),     try e.field(t.FileText, read, 4),
        });
        const present = try e.some(?t.ReadResult, normalized);
        const updated = switch (role) {
            .package => try e.memory(memory, .{ .package_document = present }),
            .source => try e.memory(memory, .{ .source_document = present }),
            .@"test" => try e.memory(memory, .{ .test_document = present }),
        };
        body = try e.c.builder.term(.{ .conditional = .{
            .condition = try e.binary(.equal, code, try e.c.literal(u8, index)),
            .when_true = try e.c.builder.pure(updated),
            .when_false = body,
        } });
    }
    return body;
}

fn observeTest(e: Emit, memory: Id, result: Id) !Id {
    const passed = try e.field(bool, result, 1);
    const mutation = try e.field(bool, memory, 8);
    const failing = try e.both(try e.not(passed), try e.not(mutation));
    const compact = try e.product(t.CompactTestResult, &.{
        try e.field(i32, result, 0), passed, try e.field(bool, result, 4), try e.field(bool, result, 5),
    });
    return e.memory(memory, .{
        .latest_test = try e.some(?t.CompactTestResult, compact),
        .failing_test_observed = try e.either(try e.field(bool, memory, 7), failing),
        .passing_test_observed = try e.select(bool, mutation, passed, try e.field(bool, memory, 9)),
    });
}

fn observeReplacement(e: Emit, memory: Id, outcome: Id) !Id {
    const tag = try e.c.builder.primitive(try e.c.schema(u64), .variant_tag, &.{outcome}, 0);
    const applied = try e.binary(.equal, tag, try e.c.literal(u64, 0));
    const conflict = try e.binary(.equal, tag, try e.c.literal(u64, 2));
    const clears = try e.either(applied, conflict);
    const updated = try e.memory(memory, .{
        .source_document = try e.select(?t.ReadResult, clears, try e.c.literal(?t.ReadResult, null), try e.field(?t.ReadResult, memory, 2)),
        .latest_search = try e.select(?t.CompactSearch, clears, try e.c.literal(?t.CompactSearch, null), try e.field(?t.CompactSearch, memory, 4)),
        .replacement = try e.some(t.ReplacementSummary, outcome),
        .mutation_applied = try e.either(try e.field(bool, memory, 8), applied),
        .passing_test_observed = try e.select(bool, clears, try e.c.literal(bool, false), try e.field(bool, memory, 9)),
    });
    const b = e.c.builder;
    const success = try b.variable(try e.c.schema(t.ReplaceApplied));
    const denied = try b.variable(try e.c.schema(t.ReplaceDenied));
    const changed = try b.variable(try e.c.schema(t.ReplaceConflict));
    const source = try e.product(t.SourceVersion, &.{
        try e.field(t.Path, try b.reference(success), 0),
        try e.field(t.DigestHex, try b.reference(success), 2),
    });
    return b.term(.{ .match_sum = .{ .value = outcome, .cases = &.{
        .{ .variable = success, .body = try b.pure(try e.memory(updated, .{
            .applied_source = try e.some(?t.SourceVersion, source),
        })) },
        .{ .variable = denied, .body = try b.pure(updated) },
        .{ .variable = changed, .body = try b.pure(try e.memory(updated, .{
            .applied_source = try e.c.literal(?t.SourceVersion, null),
        })) },
    } } });
}

const Emit = @import("source.zig").Emit;
