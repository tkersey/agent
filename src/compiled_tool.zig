//! Checked closed read-tool objects; Agent owns their final bindings and bytes.
const std = @import("std");
const boundary = @import("boundary");
const data = boundary.data;
const source = boundary.computation;
const admission = @import("admission.zig");
const Context = @import("authoring.zig").Context;
const Descriptor = @import("tools.zig").Descriptor;
const Id = source.Id;
const wrapper_key = "agent";

pub const Specification = struct {
    instance: []const u8,
    object: []const u8,
    entry: []const u8,
    identity: []const u8,
    payload: Id,
    result: Id,
    effects: []const admission.CompiledEffect,
    role: admission.Role = .read,
    model_offered: bool = false,
    name: []const u8 = "",
    description: []const u8 = "",
};

fn binding(effects: []const admission.CompiledEffect, name: []const u8) !Id {
    var found: ?Id = null;
    for (effects) |item| if (std.mem.eql(u8, name, item.symbol)) {
        if (found != null) return error.InvalidCompiledTool;
        found = item.effect;
    };
    return found orelse error.InvalidCompiledTool;
}
fn exported(object: data.component.Object, name: []const u8) !Id {
    for (object.exports) |symbol| if (std.mem.eql(u8, symbol.name, name)) {
        if (symbol.reference.kind != .function) return error.InvalidCompiledTool;
        return symbol.reference.id;
    };
    return error.InvalidCompiledTool;
}
fn descriptor(spec: Specification, function: Id) Descriptor {
    return .{ .identity = spec.identity, .payload = spec.payload, .result = spec.result, .implementation = .{ .local = function }, .role = spec.role, .model_offered = spec.model_offered, .name = spec.name, .description = spec.description };
}

/// Admit actual code, not an alleged purity summary. This import profile has
/// portable input/output, no function imports, no multi-shot control, and only
/// explicitly bound read/simulation I/O and nominal internal effects. Opaque
/// imports cannot enter speculation; closed Boundary admission follows at linking.
pub fn declare(c: Context, spec: Specification) !Descriptor {
    if (spec.instance.len == 0 or !std.unicode.utf8ValidateSlice(spec.instance) or
        std.mem.eql(u8, spec.instance, wrapper_key) or
        (spec.role != .read and spec.role != .simulation)) return error.InvalidCompiledTool;
    var decoded = try data.component.decode(c.builder.allocator(), spec.object);
    defer decoded.deinit();
    const object = decoded.object;
    if (object.imports.len != spec.effects.len) return error.InvalidCompiledTool;
    for (object.imports) |symbol| {
        if (symbol.reference.kind != .effect) return error.InvalidCompiledTool;
        const provided = try binding(spec.effects, symbol.name);
        if (provided >= c.builder.effects.items.len) return error.InvalidCompiledTool;
        const expected = object.program.effects[@intCast(symbol.reference.id)];
        const actual = c.builder.effects.items[@intCast(provided)];
        const role: admission.Role = if (expected.external) spec.role else .internal;
        if (expected.external != actual.external or c.registry.roleOf(provided) != role or
            !std.mem.eql(u8, expected.identity, actual.identity))
            return error.InvalidCompiledTool;
    }
    for (object.program.effects, 0..) |effect, id| {
        if (std.mem.eql(u8, effect.identity, "agent.model.invoke.v3")) return error.InvalidCompiledTool;
        if (!effect.external) continue;
        var imported = false;
        for (object.imports) |symbol| if (symbol.reference.kind == .effect and symbol.reference.id == id) {
            imported = true;
        };
        if (!imported) return error.InvalidCompiledTool;
    }
    for (object.program.schemas) |schema| {
        if (schema == .internal and schema.internal == .resumption and schema.internal.resumption.use == .multi)
            return error.InvalidCompiledTool;
    }
    const function = object.program.functions[@intCast(try exported(object, spec.entry))];
    if (function.inputs.len != 1 or function.regions.len != 0) return error.InvalidCompiledTool;
    const a = c.builder.allocator();
    const object_facts = try data.admission.schemas(a, object.program.schemas);
    const local_facts = try data.admission.schemas(a, c.builder.schemas.items);
    if (spec.payload >= local_facts.exportable.len or spec.result >= local_facts.exportable.len or
        !local_facts.exportable[@intCast(spec.payload)] or !local_facts.exportable[@intCast(spec.result)] or
        !object_facts.exportable[@intCast(function.layout.slots[@intCast(function.inputs[0])])] or
        !object_facts.exportable[@intCast(function.result)]) return error.InvalidCompiledTool;
    var effects: std.ArrayList(Id) = .empty;
    for (function.effects) |effect| {
        var provided: ?Id = null;
        for (object.imports) |symbol| if (symbol.reference.kind == .effect and symbol.reference.id == effect) {
            provided = try binding(spec.effects, symbol.name);
        };
        const id = provided orelse return error.InvalidCompiledTool;
        if (std.mem.indexOfScalar(Id, effects.items, id) == null) try effects.append(a, id);
    }
    std.mem.sort(Id, effects.items, {}, std.sort.asc(Id));
    for (c.registry.compiled_imports.items) |prior| {
        if (!std.mem.eql(u8, prior.instance, spec.instance)) continue;
        if (!std.mem.eql(u8, prior.object, spec.object) or prior.effects.len != spec.effects.len) return error.InvalidCompiledTool;
        for (prior.effects) |effect| if (try binding(spec.effects, effect.symbol) != effect.effect) return error.InvalidCompiledTool;
        if (std.mem.eql(u8, prior.entry, spec.entry)) {
            const declared = c.builder.functions.items[@intCast(prior.function)];
            if (declared.result != spec.result or c.builder.variables.items[@intCast(declared.parameters[0])] != spec.payload)
                return error.InvalidCompiledTool;
            return descriptor(spec, prior.function);
        }
    }
    const declared = try c.builder.declare(&.{spec.payload}, spec.result, effects.items, &.{});
    const stored = c.registry.arena.allocator();
    try c.registry.compiled_imports.append(stored, .{ .function = declared, .instance = try stored.dupe(u8, spec.instance), .entry = try stored.dupe(u8, spec.entry), .object = try stored.dupe(u8, spec.object), .effects = try source.own([]const admission.CompiledEffect, stored, spec.effects) });
    return descriptor(spec, declared);
}

pub fn link(allocator: std.mem.Allocator, module: source.Module, registry: *const admission.Registry, options: source.CompileOptions) !source.Compiled {
    errdefer |err| if (options.diagnostic) |diagnostic| {
        diagnostic.code = err;
    };
    var scratch = std.heap.ArenaAllocator.init(allocator);
    defer scratch.deinit();
    const a = scratch.allocator();
    var imports: std.ArrayList(data.component.Symbol) = .empty;
    var borrows: std.ArrayList(data.borrow_contract.Summary) = .empty;
    var exports: std.ArrayList(data.component.Symbol) = .empty;
    var instances: std.ArrayList(data.linker.Instance) = .empty;
    var bindings: std.ArrayList(data.linker.Binding) = .empty;
    var effects: std.ArrayList(Id) = .empty;
    try exports.append(a, .{ .name = "main", .reference = .{ .kind = .function, .id = module.entry } });
    for (registry.compiled_imports.items, 0..) |item, index| {
        const name = try std.fmt.allocPrint(a, "import-{d}", .{index});
        try imports.append(a, .{ .name = name, .reference = .{ .kind = .function, .id = item.function } });
        // The value-only tool boundary requires this guarantee. The linker
        // derives it from the bound implementation; an effect role is no proof.
        try borrows.append(a, if (item.participant) item.borrows else .{ .function = item.function });
        try bindings.append(a, .{ .required = .{ .instance = wrapper_key, .symbol = name }, .supplied = .{ .instance = item.instance, .symbol = item.entry } });
        var existing = false;
        for (instances.items) |instance| if (std.mem.eql(u8, instance.key, item.instance)) {
            existing = true;
        };
        if (existing) continue;
        try instances.append(a, .{ .key = item.instance, .object = item.object });
        for (item.functions, 0..) |function, function_index| {
            const symbol = try std.fmt.allocPrint(a, "helper-{d}-{d}", .{ index, function_index });
            try exports.append(a, .{ .name = symbol, .reference = .{ .kind = .function, .id = function.function } });
            try bindings.append(a, .{
                .required = .{ .instance = item.instance, .symbol = function.symbol },
                .supplied = .{ .instance = wrapper_key, .symbol = symbol },
            });
        }
        for (item.effects) |effect| {
            const symbol = try std.fmt.allocPrint(a, "effect-{d}", .{effect.effect});
            if (std.mem.indexOfScalar(Id, effects.items, effect.effect) == null) {
                try effects.append(a, effect.effect);
                try exports.append(a, .{ .name = symbol, .reference = .{ .kind = .effect, .id = effect.effect } });
            }
            try bindings.append(a, .{ .required = .{ .instance = item.instance, .symbol = effect.symbol }, .supplied = .{ .instance = wrapper_key, .symbol = symbol } });
        }
    }
    var compiled = try source.component.compileObserved(a, module, .{
        .imports = imports.items,
        .exports = exports.items,
        .borrows = borrows.items,
    }, options);
    defer compiled.deinit();
    const bytes = try a.alloc(u8, try data.component.encodedLength(compiled.object));
    _ = try compiled.encode(a, bytes);
    try instances.append(a, .{ .key = wrapper_key, .object = bytes });
    if (options.diagnostic) |diagnostic| diagnostic.phase = .target_check;
    const linked = try data.linker.linkWithOptions(allocator, instances.items, bindings.items, .{ .instance = wrapper_key, .symbol = "main" }, options.coalescing);
    if (options.diagnostic) |diagnostic| diagnostic.phase = .complete;
    // Move both owners into the ordinary compile result. No source or emitter
    // survives, and no independently supplied analysis is trusted at runtime.
    return .{ .arena = linked.arena, .program = linked.program, .flow = linked.flow };
}
