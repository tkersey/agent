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
};
