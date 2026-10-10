//! Data-only Boundary construction and pure native World execution.
//! Callers own task admission, occurrence accounting, and durable publication.
const std = @import("std");
const data = @import("boundary_data");
const world = @import("world");
const contracts = @import("agent_contracts");
const json = @import("json.zig");
const values = @import("values.zig");

const wire = contracts.tool_construction;
pub const maximum_asset_bytes = wire.maximum_asset_bytes;
pub const maximum_value_bytes = wire.maximum_value_bytes;
pub const maximum_recipe_bytes = wire.maximum_recipe_bytes;
pub const Name = wire.Name;
pub const Component = wire.Component;
pub const Catalog = wire.Catalog;
pub const Endpoint = wire.Endpoint;
pub const Recipe = wire.Recipe;
pub const Interface = wire.Interface;
pub const Built = wire.Built;
pub const Limits = struct {
    working_bytes: usize = 16 * 1024 * 1024,
    transitions: u64 = 1_000_000,
    deadline_ms: u64 = 10_000,
};

fn same(left: []const u8, right: []const u8) bool {
    return std.mem.eql(u8, left, right);
}

/// The caller supplies an already task-admitted catalog, never model bytes.
pub fn validateCatalog(a: std.mem.Allocator, catalog: Catalog) !void {
    var total: usize = 0;
    if (catalog.items.len == 0 or catalog.items.len > 16) return error.InvalidCatalog;
    for (catalog.items, 0..) |item, i| {
        if (item.id.bytes.len == 0 or item.id.bytes.len > 64) return error.InvalidCatalog;
        for (catalog.items[0..i]) |prior| if (same(prior.id.bytes, item.id.bytes)) return error.InvalidCatalog;
        total = try std.math.add(usize, total, item.object.bytes.len);
        if (total > maximum_asset_bytes) return error.Capacity;
        var decoded = try data.component.decode(a, item.object.bytes);
        defer decoded.deinit();
        for (decoded.object.program.effects) |effect| if (effect.external) return error.ForbiddenEffect;
    }
}

fn instanceIndex(recipe: Recipe, key: []const u8) !usize {
    for (recipe.instances.items, 0..) |item, i| if (same(item.key.bytes, key)) return i;
    return error.MissingInstance;
}

fn acyclic(recipe: Recipe) !void {
    var edges: [16][16]bool = @splat(@splat(false));
    const n = recipe.instances.items.len;
    for (recipe.bindings.items) |binding| {
        const from = try instanceIndex(recipe, binding.required.instance.bytes);
        const to = try instanceIndex(recipe, binding.supplied.instance.bytes);
        edges[from][to] = true;
    }
    for (0..n) |via| for (0..n) |from| for (0..n) |to| {
        edges[from][to] = edges[from][to] or (edges[from][via] and edges[via][to]);
    };
    for (0..n) |i| if (edges[i][i]) return error.CyclicComposition;
}

/// No external effects, even unreachable ones, and only ordinary public values
/// may cross the generated invocation boundary. Boundary owns schema meaning.
pub fn interfaceOf(a: std.mem.Allocator, program: data.activation.Program) !Interface {
    for (program.effects) |effect| if (effect.external) return error.ForbiddenEffect;
    const entry = program.functions[@intCast(program.roots.entry)];
    if (entry.inputs.len != 1) return error.InvalidInterface;
    const input = entry.layout.slots[@intCast(entry.inputs[0])];
    const facts = try data.admission.schemas(a, program.schemas);
    defer a.free(facts.minimum);
    defer a.free(facts.exportable);
    for ([_]u64{ input, program.roots.result, program.roots.failure }) |id|
        if (!facts.exportable[@intCast(id)]) return error.ForbiddenInterface;
    const input_bytes = try data.schema.encodeOwned(a, program.schemas, input);
    errdefer a.free(input_bytes);
    const output_bytes = try data.schema.encodeOwned(a, program.schemas, program.roots.result);
    errdefer a.free(output_bytes);
    const failure_bytes = try data.schema.encodeOwned(a, program.schemas, program.roots.failure);
    errdefer a.free(failure_bytes);
    if (input_bytes.len > maximum_asset_bytes or output_bytes.len > maximum_asset_bytes or failure_bytes.len > maximum_asset_bytes) return error.Capacity;
    return .{ .input = .{ .bytes = input_bytes }, .output = .{ .bytes = output_bytes }, .failure = .{ .bytes = failure_bytes } };
}

pub fn build(output: std.mem.Allocator, scratch: std.mem.Allocator, catalog: Catalog, proposal: []const u8) !Built {
    var parsed = try json.parse(scratch, proposal, .{ .bytes = maximum_recipe_bytes, .depth = 6, .tokens = 2048, .members = 64 });
    defer parsed.deinit();
    var arena = std.heap.ArenaAllocator.init(scratch);
    defer arena.deinit();
    const a = arena.allocator();
    const recipe = try values.fromJson(Recipe, a, parsed.value);
    if (recipe.instances.items.len == 0) return error.InvalidRecipe;
    try acyclic(recipe);
    const instances = try a.alloc(data.linker.Instance, recipe.instances.items.len);
    for (recipe.instances.items, instances) |item, *instance| {
        var object: ?[]const u8 = null;
        for (catalog.items) |candidate| if (same(candidate.id.bytes, item.component_id.bytes)) {
            object = candidate.object.bytes;
            break;
        };
        instance.* = .{ .key = item.key.bytes, .object = object orelse return error.UnknownComponent };
    }
    const bindings = try a.alloc(data.linker.Binding, recipe.bindings.items.len);
    for (recipe.bindings.items, bindings) |item, *binding| binding.* = .{
        .required = .{ .instance = item.required.instance.bytes, .symbol = item.required.symbol.bytes },
        .supplied = .{ .instance = item.supplied.instance.bytes, .symbol = item.supplied.symbol.bytes },
    };
    var linked = try data.linker.linkWithCompilation(scratch, instances, bindings, .{ .instance = recipe.entry.instance.bytes, .symbol = recipe.entry.symbol.bytes }, .{ .max_image_bytes = maximum_asset_bytes });
    defer linked.deinit();
    const interface = try interfaceOf(a, linked.program);
    const length = try data.program_image.encodedLength(linked.program);
    if (length > maximum_asset_bytes) return error.Capacity;
    const bytes = try a.alloc(u8, length);
    _ = try linked.encode(a, bytes);
    const image_copy = try output.dupe(u8, bytes);
    errdefer output.free(image_copy);
    const input_copy = try output.dupe(u8, interface.input.bytes);
    errdefer output.free(input_copy);
    const output_copy = try output.dupe(u8, interface.output.bytes);
    errdefer output.free(output_copy);
    const failure_copy = try output.dupe(u8, interface.failure.bytes);
    return .{ .image = .{ .bytes = image_copy }, .interface = .{
        .input = .{ .bytes = input_copy },
        .output = .{ .bytes = output_copy },
        .failure = .{ .bytes = failure_copy },
    } };
}

/// A fresh pure Session is entirely owned by this occurrence. Its public
/// deinitializer releases interrupted work; no resident or checkpoint escapes.
/// Fuel is reserved cumulatively across quanta, including explicit yields.
pub fn run(output: std.mem.Allocator, parent: std.mem.Allocator, io: std.Io, cancellation: ?*const std.atomic.Value(bool), built: Built, input_schema: []const u8, input: []const u8, limits: Limits) ![]u8 {
    if (built.image.bytes.len > maximum_asset_bytes or input.len > maximum_value_bytes or limits.working_bytes == 0 or limits.working_bytes > 16 * 1024 * 1024 or limits.transitions == 0 or limits.transitions > 1_000_000 or limits.deadline_ms == 0 or limits.deadline_ms > 10_000) return error.Capacity;
    const start = std.Io.Clock.awake.now(io).toMilliseconds();
    var budget: world.AllocationBudget = .{ .parent = parent, .limit = limits.working_bytes };
    const a = budget.allocator();
    var prepared = try world.Prepared.init(a, built.image.bytes);
    defer prepared.deinit();
    var session = try world.Session.start(a, &prepared, input);
    defer session.deinit();
    var arena = std.heap.ArenaAllocator.init(a);
    defer arena.deinit();
    const actual = try interfaceOf(arena.allocator(), session.program);
    if (!same(actual.input.bytes, input_schema) or !same(actual.input.bytes, built.interface.input.bytes) or !same(actual.output.bytes, built.interface.output.bytes) or !same(actual.failure.bytes, built.interface.failure.bytes)) return error.IncompatibleInterface;
    var remaining = limits.transitions;
    while (remaining != 0) {
        if (cancellation) |flag| if (flag.load(.acquire)) return error.Canceled;
        if (std.Io.Clock.awake.now(io).toMilliseconds() - start >= limits.deadline_ms) return error.Timeout;
        const quantum = @min(remaining, 256);
        remaining -= quantum;
        switch (try session.run(quantum)) {
            .progressed => {},
            .yielded => try session.resumeYield(),
            .requested => return error.ForbiddenEffect,
            .failed => return error.ProgramFailed,
            .cancelled => return error.Canceled,
            .completed => |value| {
                const bytes = try session.bytes(&value);
                if (bytes.len > maximum_value_bytes) return error.Capacity;
                return output.dupe(u8, bytes);
            },
        }
    }
    return error.FuelExhausted;
}
