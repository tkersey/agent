const std = @import("std");
const agent = @import("agent");
const boundary = @import("boundary");
const source = boundary.source;
const data = boundary.data;
const a = std.testing.allocator;

fn object(hidden: bool) ![]u8 {
    return objectWith(hidden, false);
}
fn objectWith(hidden: bool, multi: bool) ![]u8 {
    return objectProfile(hidden, multi, false);
}
fn objectProfile(hidden: bool, multi: bool, internal: bool) ![]u8 {
    var b = source.Builder.init(a);
    defer b.deinit();
    const unit = try b.scalar(void);
    const integer = try b.scalar(u64);
    const read = try b.effect(.{ .identity = "fixture/compiled-read", .payload = integer, .result = integer, .control_use = if (multi) .multi else .linear, .external = !internal });
    if (multi) _ = try b.schema(.{ .internal = .{ .resumption = .{
        .effect = read,
        .input = integer,
        .answer = integer,
        .handled = &.{read},
        .mode = .deep,
        .use = .multi,
    } } });
    if (hidden) _ = try b.effect(.{ .identity = "fixture/hidden", .payload = unit, .result = unit });
    const main = try b.declare(&.{integer}, integer, &.{read}, &.{});
    const value = try b.reference(b.parameter(main, 0));
    try b.define(main, if (internal) try b.pure(value) else try b.term(.{ .perform = .{ .effect = read, .payload = value } }));
    var compiled = try source.component.compile(a, b.module(main, unit), .{
        .imports = &.{.{ .name = "read", .reference = .{ .kind = .effect, .id = read } }},
        .exports = &.{.{ .name = "inspect", .reference = .{ .kind = .function, .id = main } }},
    });
    defer compiled.deinit();
    const bytes = try a.alloc(u8, try data.component.encodedLength(compiled.object));
    errdefer a.free(bytes);
    _ = try compiled.encode(a, bytes);
    return bytes;
}

const Tool = struct {
    var bytes: []u8 = &.{};
    var role: agent.admission.Role = .read;
    var rename = false;
    var internal = false;
    var internal_role: agent.admission.Role = .internal;
    pub fn declare(c: agent.Context) !agent.tools.Descriptor {
        const integer = try c.schema(u64);
        const read = if (internal) blk: {
            const effect = try c.builder.effect(.{ .identity = "fixture/compiled-read", .payload = integer, .result = integer, .external = false });
            try c.registry.classify(effect, internal_role);
            break :blk effect;
        } else try c.external(if (rename) "fixture/other" else "fixture/compiled-read", integer, integer, role);
        return agent.tools.declareCompiled(c, .{ .instance = "read-tool", .object = bytes, .entry = "inspect", .identity = "fixture/local-inspect", .payload = integer, .result = integer, .effects = &.{.{ .symbol = "read", .effect = read }}, .model_offered = true, .name = "inspect", .description = "Inspect a number using the compiled tool" });
    }
};
const Application = struct {
    var mutate = false;
    var speculate = false;
    pub fn emit(c: agent.Context) !source.Module {
        const tool = try c.catalogs.tool("inspect");
        const b = c.builder;
        const function = tool.implementation.local;
        const main = try b.declare(&.{tool.payload}, tool.result, b.functions.items[@intCast(function)].effects, &.{});
        try b.define(main, try agent.tools.perform(c, tool, try b.reference(b.parameter(main, 0))));
        if (speculate) try c.registry.speculate(function, b.functions.items[@intCast(function)].effects);
        if (mutate) @memset(Tool.bytes, 0xff);
        return b.module(main, try b.scalar(void));
    }
};
const System = agent.system(.{ .InitialArgs = u64, .Result = u64, .Failure = void, .tools = .{Tool}, .application = Application });

test "compiled internal requirements retain nominal and role bindings" {
    Tool.bytes = try objectProfile(false, false, true);
    defer a.free(Tool.bytes);
    try std.testing.expectError(error.InvalidCompiledTool, agent.compile(a, System));
    Tool.internal = true;
    defer Tool.internal = false;
    var compiled = try agent.compile(a, System);
    defer compiled.deinit();
    try std.testing.expect(!compiled.program.effects[0].external);
    Tool.internal_role = .read;
    defer Tool.internal_role = .internal;
    try std.testing.expectError(error.InvalidCompiledTool, agent.compile(a, System));
    Tool.internal_role = .internal;
    Application.speculate = true;
    defer Application.speculate = false;
    try std.testing.expectError(error.UnprovenComputationOrigin, agent.compile(a, System));
}

test "compiled local tool links owned object bytes through normal Agent compilation" {
    Tool.bytes = try object(false);
    defer a.free(Tool.bytes);
    Application.mutate = true;
    defer Application.mutate = false;
    var compiled = try agent.compile(a, System);
    defer compiled.deinit();
    try std.testing.expectEqual(1, compiled.program.effects.len);
    try std.testing.expectEqualStrings("fixture/compiled-read", compiled.program.effects[0].identity);
    const encoded = try a.alloc(u8, try data.program_image.encodedLength(compiled.program));
    defer a.free(encoded);
    _ = try compiled.encode(a, encoded);
    var admitted = try data.program_image.decode(a, encoded);
    defer admitted.deinit();
    try std.testing.expectEqual(2, admitted.program.functions.len);
}

test "compiled imports cannot hide external operations rename meanings or grant authority" {
    Tool.bytes = try object(true);
    try std.testing.expectError(error.InvalidCompiledTool, agent.compile(a, System));
    a.free(Tool.bytes);
    Tool.bytes = try object(false);
    defer a.free(Tool.bytes);
    Tool.rename = true;
    defer Tool.rename = false;
    try std.testing.expectError(error.InvalidCompiledTool, agent.compile(a, System));
    Tool.rename = false;
    Tool.role = .commit;
    defer Tool.role = .read;
    try std.testing.expectError(error.InvalidCompiledTool, agent.compile(a, System));
}

test "an opaque read-tool row is not permission to enter protected speculation" {
    Tool.bytes = try object(false);
    defer a.free(Tool.bytes);
    Application.speculate = true;
    defer Application.speculate = false;
    try std.testing.expectError(error.UnprovenComputationOrigin, agent.compile(a, System));
}

test "text inspection compiles into a source-independent owned component" {
    const bytes = try agent.tools.textInspection.emit(a);
    defer a.free(bytes);
    var decoded = try data.component.decode(a, bytes);
    defer decoded.deinit();
    try std.testing.expectEqual(2, decoded.object.imports.len);
    try std.testing.expectEqualStrings("inspect", decoded.object.exports[0].name);
}

test "compiled read-tool admission rejects latent multi-shot control" {
    Tool.bytes = try objectWith(false, true);
    defer a.free(Tool.bytes);
    try std.testing.expectError(error.InvalidCompiledTool, agent.compile(a, System));
}

test "an external compiled requirement cannot bind an internal declaration" {
    Tool.bytes = try object(false);
    defer a.free(Tool.bytes);
    Tool.internal = true;
    defer Tool.internal = false;
    try std.testing.expectError(error.InvalidCompiledTool, agent.compile(a, System));
}

fn allocationFailure(allocator: std.mem.Allocator) !void {
    var compiled = try agent.compile(allocator, System);
    defer compiled.deinit();
    const bytes = try allocator.alloc(u8, try data.program_image.encodedLength(compiled.program));
    defer allocator.free(bytes);
    _ = try compiled.encode(allocator, bytes);
}
test "compiled tool construction releases all partial object and link owners" {
    Tool.bytes = try object(false);
    defer a.free(Tool.bytes);
    try std.testing.checkAllAllocationFailures(a, allocationFailure, .{});
}
