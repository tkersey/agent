//! Internal first-order components with checked Agent helper bindings.
//! Objects remain BMO1; no source reconstruction or runtime evaluator is added.
const std = @import("std");
const boundary = @import("boundary");
const source = boundary.computation;
const data = boundary.data;
const admission = @import("admission.zig");
const Context = @import("authoring.zig").Context;
const Id = source.Id;

pub const FunctionBinding = struct { symbol: []const u8, function: Id };
pub const Specification = struct {
    instance: []const u8,
    object: []const u8,
    entry: []const u8,
    parameters: []const Id,
    result: Id,
    effects: []const admission.CompiledEffect = &.{},
    functions: []const FunctionBinding = &.{},
    residual: []const Id = &.{},
    regions: []const Id = &.{},
    borrows: data.borrow_contract.Summary = .{ .function = 0 },
};

fn effectBinding(items: []const admission.CompiledEffect, name: []const u8) !Id {
    var found: ?Id = null;
    for (items) |item| if (std.mem.eql(u8, item.symbol, name)) {
        if (found != null) return error.InvalidParticipant;
        found = item.effect;
    };
    return found orelse error.InvalidParticipant;
}
fn functionBinding(items: []const FunctionBinding, name: []const u8) !Id {
    var found: ?Id = null;
    for (items) |item| if (std.mem.eql(u8, item.symbol, name)) {
        if (found != null) return error.InvalidParticipant;
        found = item.function;
    };
    return found orelse error.InvalidParticipant;
}

/// All bindings are copied into the same owner used by Agent's final compiler.
/// Structural schemas and borrow assumptions are independently checked at link.
pub fn declare(c: Context, spec: Specification) !Id {
    if (spec.instance.len == 0 or !std.unicode.utf8ValidateSlice(spec.instance) or
        std.mem.eql(u8, spec.instance, "agent")) return error.InvalidParticipant;
    var decoded = try data.component.decode(c.builder.allocator(), spec.object);
    defer decoded.deinit();
    const object = decoded.object;
    if (object.imports.len != spec.effects.len + spec.functions.len)
        return error.InvalidParticipant;
    try bindings(c, spec, object);
    var exported = false;
    for (object.exports) |symbol| if (std.mem.eql(u8, symbol.name, spec.entry)) {
        if (symbol.reference.kind != .function) return error.InvalidParticipant;
        exported = true;
    };
    if (!exported) return error.InvalidParticipant;
    // One instance is installed once. Multiple exports can be added by a future
    // checked operation; silently accepting inconsistent bindings is forbidden.
    for (c.registry.compiled_imports.items) |prior| {
        if (std.mem.eql(u8, prior.instance, spec.instance)) return error.InvalidParticipant;
    }
    const stored = c.registry.arena.allocator();
    var item: admission.CompiledImport = .{
        .function = 0,
        .instance = try stored.dupe(u8, spec.instance),
        .entry = try stored.dupe(u8, spec.entry),
        .object = try stored.dupe(u8, spec.object),
        .effects = try source.own([]const admission.CompiledEffect, stored, spec.effects),
        .functions = try source.own([]const FunctionBinding, stored, spec.functions),
        .participant = true,
        .borrows = try source.own(data.borrow_contract.Summary, stored, spec.borrows),
    };
    // Reserve publication capacity before adding the source declaration.
    try c.registry.compiled_imports.ensureUnusedCapacity(stored, 1);
    item.function = try c.builder.declare(spec.parameters, spec.result, spec.residual, spec.regions);
    item.borrows.function = item.function;
    c.registry.compiled_imports.appendAssumeCapacity(item);
    return item.function;
}

fn bindings(c: Context, spec: Specification, object: data.component.Object) !void {
    for (object.imports) |symbol| switch (symbol.reference.kind) {
        .function => {
            const local = try functionBinding(spec.functions, symbol.name);
            if (local >= c.builder.functions.items.len) return error.InvalidParticipant;
            for (c.registry.private_functions.items) |private| {
                if (private == local) return error.PrivateFunctionBypass;
            }
        },
        .effect => {
            const local = try effectBinding(spec.effects, symbol.name);
            if (local >= c.builder.effects.items.len) return error.InvalidParticipant;
            const actual = c.builder.effects.items[@intCast(local)];
            const expected = object.program.effects[@intCast(symbol.reference.id)];
            if (actual.external != expected.external or
                !std.mem.eql(u8, actual.identity, expected.identity))
                return error.InvalidParticipant;
            const role = c.registry.roleOf(local) orelse return error.EffectRoleMismatch;
            if (!expected.external and role != .internal) return error.EffectRoleMismatch;
        },
        else => return error.InvalidParticipant,
    };
    // Authority inspection is repeated by final admission against its live bindings.
    const temporary: admission.CompiledImport = .{
        .function = 0,
        .instance = spec.instance,
        .entry = spec.entry,
        .object = spec.object,
        .effects = spec.effects,
        .functions = spec.functions,
        .participant = true,
    };
    try inspect(object, temporary, c.registry, null);
}

fn roleOf(object: data.component.Object, item: admission.CompiledImport, registry: *const admission.Registry, effect: Id) !admission.Role {
    for (object.imports) |symbol| {
        if (symbol.reference.kind == .effect and symbol.reference.id == effect) {
            const local = try effectBinding(item.effects, symbol.name);
            return registry.roleOf(local) orelse error.EffectRoleMismatch;
        }
    }
    if (object.program.effects[@intCast(effect)].external) return error.InvalidParticipant;
    return .internal;
}

/// Inspect every object definition, including code hidden behind local handlers.
/// Direct protected emissions/handlers are forbidden; only checked source helper
/// imports can implement them. Assessment also checks every bound helper body.
pub fn inspect(object: data.component.Object, item: admission.CompiledImport, registry: *const admission.Registry, allowed: ?[]const Id) !void {
    for (object.program.effects, 0..) |_, id| {
        const role = try roleOf(object, item, registry, id);
        if (allowed) |effects| {
            if (role == .approval or role == .commit or role == .write)
                return error.SpeculativeEffect;
            if (role != .internal) {
                var admitted = false;
                for (object.imports) |symbol| {
                    if (symbol.reference.kind != .effect or symbol.reference.id != id) continue;
                    const local = try effectBinding(item.effects, symbol.name);
                    admitted = std.mem.indexOfScalar(Id, effects, local) != null;
                }
                if (!admitted) return error.SpeculativeEffect;
            }
        }
    }
    for (object.program.blocks) |block| {
        if (block.terminator != .perform) continue;
        const role = try roleOf(object, item, registry, block.terminator.perform.effect);
        if (role != .internal and role != .read and role != .simulation)
            return error.ProtectedEffectBypass;
    }
    for (object.program.handlers) |handler| for (handler.clauses) |clause| {
        if (try roleOf(object, item, registry, clause.effect) != .internal)
            return error.ProtectedHandler;
    };
    for (object.program.schemas) |schema| {
        if (schema != .internal) continue;
        switch (schema.internal) {
            .abstract_resource, .suspension_package => if (allowed != null)
                return error.SpeculativeCapture,
            .resumption => |r| {
                if (r.use == .multi) return error.InvalidParticipant;
                if (allowed != null and r.obligations) return error.SpeculativeCapture;
            },
            .computation => |c| if (c.use == .multi) return error.InvalidParticipant,
            else => {},
        }
    }
}
