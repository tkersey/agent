//! One logical account for retained working text. Derived views and wire copies
//! remain subject to World's separate limits; only the designated replay field
//! has the independent provider-replay allowance.
const std = @import("std");
const boundary = @import("boundary");
const a = boundary.authoring;
const t = @import("types.zig");
const m = @import("model.zig");
const Emit = @import("emit.zig").Emit;
const V = *const a.Value;
pub const maximum: u64 = 512 * 1024;

fn failure(e: Emit) !*const a.FailureLiteral {
    return a.interop.literalFailure(e.c, try e.agent_context.literal(t.Failure, .capacity_exceeded), try e.schema(t.Failure));
}

pub fn add(e: Emit, b: *a.Body, left: V, right: V) !V {
    return b.checkedAdd(left, right, try failure(e));
}

pub fn textBytes(e: Emit, b: *a.Body, comptime T: type, value: V) anyerror!V {
    const raw = e.agent_context.builder;
    return a.interop.term(b, try raw.term(.{ .call = .{ .function = try measure(e, T), .arguments = &.{try a.interop.valueId(b, value)} } }), try e.c.scalar(u64));
}

fn measure(e: Emit, comptime T: type) anyerror!boundary.source.Id {
    const raw = e.agent_context.builder;
    const cached = try raw.specialization(boundary.source.Id, "mobile.repository.working-text", .{@typeName(T)});
    if (cached.cached) |id| return id;
    const f = try e.c.function("measure retained text", &.{.{ .name = "value", .schema = try e.schema(T) }}, try e.c.scalar(u64), &.{});
    const b = try e.c.body(f);
    const value = try b.parameter("value");
    var total = try b.constant(u64, 0);
    if (comptime @typeInfo(T) == .@"struct" and @hasDecl(T, "agent_value_kind")) {
        switch (T.agent_value_kind) {
            .text, .bytes => total = try b.blobLength(value),
            .vector => {
                const scan = try e.c.function("sum retained vector text", &.{ .{ .name = "value", .schema = try e.schema(T) }, .{ .name = "index", .schema = try e.c.scalar(u64) } }, try e.c.scalar(u64), &.{});
                const loop = try e.c.body(scan);
                const list = try loop.parameter("value");
                const index = try loop.parameter("index");
                const item = try loop.sequenceGet(list, index);
                const some = try loop.caseOf(item, "some");
                const none = try loop.caseOf(item, "none");
                const more = some.body();
                const size = try textBytes(e, more, T.Child, some.payload());
                const rest = try more.call(scan, &.{ .{ .name = "value", .value = list }, .{ .name = "index", .value = try add(e, more, index, try more.constant(u64, 1)) } });
                try e.c.define(scan, try loop.ret(try loop.match(item, &.{ try some.ret(try add(e, more, size, rest)), try none.ret(try none.body().constant(u64, 0)) })));
                total = try b.call(scan, &.{ .{ .name = "value", .value = value }, .{ .name = "index", .value = try b.constant(u64, 0) } });
            },
            else => @compileError("unaccounted retained value kind"),
        }
    } else switch (@typeInfo(T)) {
        .@"struct" => |info| inline for (info.field_names, info.field_types) |name, Field| {
            if (comptime T == m.State and std.mem.eql(u8, name, "replay")) continue;
            total = try add(e, b, total, try textBytes(e, b, Field, try b.field(value, name)));
        },
        .array => |info| {
            if (info.child != u8) @compileError("unaccounted retained array");
            total = try b.constant(u64, info.len);
        },
        .void, .bool, .int, .@"enum" => {},
        else => @compileError("unaccounted retained text shape"),
    }
    try e.c.define(f, try b.ret(total));
    return cached.finish(raw, try a.interop.functionId(e.c, f));
}

pub fn working(e: Emit, b: *a.Body, task: V, evidence: V, state: V) !V {
    const context = try add(e, b, try b.blobLength(try b.field(task, "goal")), try textBytes(e, b, t.Evidence, evidence));
    return add(e, b, context, try textBytes(e, b, m.State, state));
}

/// The returned value is the only one passed on to a retained consumer.
pub fn admit(e: Emit, b: *a.Body, comptime T: type, value: V, used: V) !V {
    const yes = try b.branch();
    const no = try b.branch();
    return b.conditional(try b.less(used, try b.constant(u64, maximum + 1)), try yes.ret(value), try no.fail(try e.schema(T), try e.literal(no, t.Failure, .capacity_exceeded)));
}

pub fn admitState(e: Emit, b: *a.Body, task: V, evidence: V, value: V) !V {
    return admit(e, b, m.State, value, try working(e, b, task, evidence, value));
}
