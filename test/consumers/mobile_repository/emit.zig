const std = @import("std");
const m = @import("model.zig");
const V = *const a.Value;
const agent = @import("agent");
const boundary = @import("boundary");
const a = boundary.authoring;
const t = @import("types.zig");
const mobility = agent.mobility;
pub const Emit = struct {
    agent_context: agent.Context,
    c: *a.Context,

    pub fn schema(e: Emit, comptime T: type) anyerror!*const a.Schema {
        switch (@typeInfo(T)) {
            .@"struct" => |info| {
                if (@hasDecl(T, "agent_value_kind")) return a.interop.schema(e.c, try e.agent_context.schema(T));
                var fields: [info.field_names.len]a.Field = undefined;
                inline for (info.field_names, info.field_types, 0..) |name, F, i| fields[i] = .{ .name = name, .schema = try e.schema(F) };
                return e.c.record(&fields);
            },
            .@"union" => |info| {
                var fields: [info.field_names.len]a.Field = undefined;
                inline for (info.field_names, info.field_types, 0..) |name, F, i| fields[i] = .{ .name = name, .schema = try e.schema(F) };
                return e.c.alternatives(&fields);
            },
            .pointer => |info| if (info.size == .slice and info.child != u8) {
                return e.c.sequence(try e.schema(info.child));
            } else return a.interop.schema(e.c, try e.agent_context.schema(T)),
            else => return a.interop.schema(e.c, try e.agent_context.schema(T)),
        }
    }
    pub fn external(e: Emit, name: []const u8, comptime Input: type, comptime Output: type, role: agent.admission.Role) !*const a.Operation {
        const op = try e.c.external(name, try e.schema(Input), try e.schema(Output));
        try e.agent_context.registry.classify(try a.interop.operationId(e.c, op), role);
        return op;
    }
    pub fn literal(e: Emit, body: *a.Body, comptime T: type, value: T) !*const a.Value {
        return a.interop.adoptValue(body, try e.agent_context.literal(T, value), try e.schema(T));
    }
    pub fn sequence(e: Emit, body: *a.Body, schema_: *const a.Schema, values: []const *const a.Value) !*const a.Value {
        const b = e.agent_context.builder;
        const ids = try b.allocator().alloc(boundary.source.Id, values.len);
        for (values, ids) |value, *id| id.* = try a.interop.valueId(body, value);
        return a.interop.adoptValue(body, try b.primitive(try a.interop.schemaId(e.c, schema_), .sequence, ids, 0), schema_);
    }
    // A later destination cannot reset the allowance supplied by an earlier
    // ensure. The template contributes requirements/policy and attempt bounds.
    pub fn place(e: Emit, body: *a.Body, template: *const a.Value, moves: *const a.Value) !*const a.Value {
        const budget = try body.field(template, "budget");
        const input = try body.product(try e.schema(mobility.EnsureInput), &.{
            .{ .name = "placement", .value = try body.field(template, "placement") },
            .{ .name = "placement_intent_id", .value = try body.field(template, "placement_intent_id") },
            .{ .name = "export_policy_ref", .value = try body.field(template, "export_policy_ref") },
            .{ .name = "budget", .value = try body.product(try e.schema(mobility.Budget), &.{
                .{ .name = "moves", .value = moves },
                .{ .name = "attempts", .value = try body.field(budget, "attempts") },
            }) },
        });
        return a.interop.term(body, try mobility.ensure(e.agent_context, try a.interop.valueId(body, input), try e.agent_context.literal(t.Failure, .placement_failed)), try e.schema(mobility.PlacementResult));
    }

    // Logical working text has one derived account; provider replay has its own bound.
    const maximumTextBytes: u64 = 512 * 1024;
    fn capacityFailure(e: Emit) !*const a.FailureLiteral {
        return a.interop.literalFailure(e.c, try e.agent_context.literal(t.Failure, .capacity_exceeded), try e.schema(t.Failure));
    }

    pub fn addTextBytes(e: Emit, b: *a.Body, left: V, right: V) !V {
        return b.checkedAdd(left, right, try e.capacityFailure());
    }

    pub fn textBytes(e: Emit, b: *a.Body, comptime T: type, value: V) anyerror!V {
        const raw = e.agent_context.builder;
        return a.interop.term(b, try raw.term(.{ .call = .{ .function = try e.measureText(T), .arguments = &.{try a.interop.valueId(b, value)} } }), try e.c.scalar(u64));
    }

    fn measureText(e: Emit, comptime T: type) anyerror!boundary.source.Id {
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
                    const size = try e.textBytes(more, T.Child, some.payload());
                    const rest = try more.call(scan, &.{ .{ .name = "value", .value = list }, .{ .name = "index", .value = try e.addTextBytes(more, index, try more.constant(u64, 1)) } });
                    try e.c.define(scan, try loop.ret(try loop.match(item, &.{ try some.ret(try e.addTextBytes(more, size, rest)), try none.ret(try none.body().constant(u64, 0)) })));
                    total = try b.call(scan, &.{ .{ .name = "value", .value = value }, .{ .name = "index", .value = try b.constant(u64, 0) } });
                },
                else => @compileError("unaccounted retained value kind"),
            }
        } else switch (@typeInfo(T)) {
            .@"struct" => |info| inline for (info.field_names, info.field_types) |name, Field| {
                if (comptime T == m.State and std.mem.eql(u8, name, "replay")) continue;
                total = try e.addTextBytes(b, total, try e.textBytes(b, Field, try b.field(value, name)));
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

    pub fn workingText(e: Emit, b: *a.Body, task: V, evidence: V, state: V) !V {
        const context = try e.addTextBytes(b, try b.blobLength(try b.field(task, "goal")), try e.textBytes(b, t.Evidence, evidence));
        return e.addTextBytes(b, context, try e.textBytes(b, m.State, state));
    }

    /// The returned value is the only one passed on to a retained consumer.
    pub fn admitText(e: Emit, b: *a.Body, comptime T: type, value: V, used: V) !V {
        const yes = try b.branch();
        const no = try b.branch();
        return b.conditional(try b.less(used, try b.constant(u64, maximumTextBytes + 1)), try yes.ret(value), try no.fail(try e.schema(T), try e.literal(no, t.Failure, .capacity_exceeded)));
    }

    pub fn admitWorkingState(e: Emit, b: *a.Body, task: V, evidence: V, value: V) !V {
        return e.admitText(b, m.State, value, try e.workingText(b, task, evidence, value));
    }
};
