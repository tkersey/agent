const std = @import("std");
const agent = @import("agent");
const boundary = @import("boundary");
const source = boundary.source;
const m = agent.mobility;
const Application = struct {
    pub fn emit(c: agent.Context) !source.Module {
        const b = c.builder;
        const effects = try m.define(c);
        const entry = try b.declare(&.{try c.schema(m.EnsureInput)}, try c.schema(m.PlacementResult), &.{ effects.resolve, effects.relocate }, &.{});
        try b.define(entry, try m.ensure(c, try b.reference(b.parameter(entry, 0)), try b.constant(void, {})));
        return b.module(entry, try b.scalar(void));
    }
};
const System = agent.system(.{ .InitialArgs = m.EnsureInput, .Result = m.PlacementResult, .Failure = void, .application = Application });
const Loop = struct {
    pub fn emit(c: agent.Context) !source.Module {
        const b = c.builder;
        const unit = try b.scalar(void);
        const effect = try c.external("agent.mobility.fixture.repeat.v1", unit, unit, .read);
        const entry = try b.declare(&.{unit}, unit, &.{effect}, &.{});
        const reply = try b.variable(unit);
        const next = try b.term(.{ .call = .{ .function = entry, .arguments = &.{try b.constant(void, {})} } });
        try b.define(entry, try b.bind(reply, try b.term(.{ .perform = .{ .effect = effect, .payload = try b.constant(void, {}) } }), next));
        return b.module(entry, unit);
    }
};
const LoopSystem = agent.system(.{ .InitialArgs = void, .Result = void, .Failure = void, .application = Loop });

test "ensure preserves caller failure type and cannot hide mobility in speculation" {
    var b = source.Builder.init(std.testing.allocator);
    defer b.deinit();
    var registry = agent.admission.Registry.init(std.testing.allocator);
    defer registry.deinit();
    const ctx = agent.Context{ .builder = &b, .registry = &registry };
    const effects = try m.define(ctx);
    const entry = try b.declare(&.{try ctx.schema(m.EnsureInput)}, try ctx.schema(m.PlacementResult), &.{ effects.resolve, effects.relocate }, &.{});
    try b.define(entry, try m.ensure(ctx, try b.reference(b.parameter(entry, 0)), try b.constant(u32, 17)));
    const module = b.module(entry, try b.scalar(u32));
    try agent.admission.verify(std.testing.allocator, module, &registry);
    var compiled = try source.lower(std.testing.allocator, module);
    defer compiled.deinit();
    try registry.speculate(entry, &.{ effects.resolve, effects.relocate });
    try std.testing.expectError(error.SpeculativeEffect, agent.admission.verify(std.testing.allocator, module, &registry));
}
pub fn main(init: std.process.Init) !void {
    var args = init.minimal.args.iterate();
    _ = args.next();
    const mode = args.next() orelse return error.ExpectedMode;
    if (std.mem.eql(u8, mode, "loop-image") or std.mem.eql(u8, mode, "loop-identity")) {
        var compiled = try agent.compile(init.gpa, LoopSystem);
        defer compiled.deinit();
        if (std.mem.eql(u8, mode, "loop-identity")) return write(init, &(try boundary.data.program_image.identity(init.gpa, compiled.program)));
        const bytes = try init.gpa.alloc(u8, try boundary.data.program_image.encodedLength(compiled.program));
        defer init.gpa.free(bytes);
        _ = try compiled.encode(init.gpa, bytes);
        return write(init, bytes);
    }
    if (std.mem.eql(u8, mode, "image")) {
        var compiled = try agent.compile(init.gpa, System);
        defer compiled.deinit();
        const bytes = try init.gpa.alloc(u8, try boundary.data.program_image.encodedLength(compiled.program));
        defer init.gpa.free(bytes);
        _ = try compiled.encode(init.gpa, bytes);
        return write(init, bytes);
    }
    inline for (.{ .{ "input", m.EnsureInput }, .{ "result", m.PlacementResult } }) |item| {
        if (std.mem.eql(u8, mode, item[0])) {
            var b = source.Builder.init(init.gpa);
            defer b.deinit();
            const id = try agent.contracts.schema(item[1], &b);
            const bytes = try boundary.data.schema.encodeOwned(init.gpa, b.schemas.items, id);
            defer init.gpa.free(bytes);
            return write(init, bytes);
        }
    }
    return error.InvalidMode;
}
fn write(init: std.process.Init, bytes: []const u8) !void {
    var buffer: [4096]u8 = undefined;
    var output = std.Io.File.stdout().writer(init.io, &buffer);
    try output.interface.writeAll(bytes);
    try output.interface.flush();
}
