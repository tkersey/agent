//! Agent admission traverses cleanup retained by a composed exchange owner.
const std = @import("std");
const agent = @import("agent");
const boundary = @import("boundary");
const source = boundary.computation;
const generator = boundary.library.generator;
const Id = source.Id;
fn Application(comptime duplicate: bool, comptime assessment: bool, comptime write: bool) type {
    return struct {
        pub fn emit(c: agent.Context) !source.Module {
            const b = c.builder;
            const integer = try b.scalar(u64);
            const unit = try b.scalar(void);
            const release = try c.external("composed/cleanup", integer, unit, if (write) .write else .read);
            const g = try generator.defineExchange(b, "composed/participant", integer, integer, integer, &.{integer}, &.{}, &.{}, .{ .effects = &.{release} });
            const joined = try generator.compose(b, "composed/pipeline", g, g);
            try c.registry.classify(g.effect, .internal);
            try c.registry.classify(joined.generator.effect, .internal);
            const body = try b.declare(&.{ g.capability, integer }, integer, &.{ release, g.effect }, &.{});
            const run = try b.declare(&.{}, integer, &.{g.effect}, &.{});
            const offer = try b.term(.{ .perform = .{ .effect = g.effect, .capability = try b.reference(b.parameter(body, 0)), .payload = try b.reference(b.parameter(body, 1)) } });
            const input = try b.variable(integer);
            // One offer obtains a live owner; resuming it offers the actual new input.
            try b.define(run, try b.bind(input, offer, try b.term(.{ .perform = .{ .effect = g.effect, .capability = try b.reference(b.parameter(body, 0)), .payload = try b.reference(input) } })));
            const exit = try boundary.library.cleanup.exitInfo(b, unit);
            const cleanup = try b.declare(&.{exit}, unit, &.{release}, &.{});
            const site = try b.term(.{ .perform = .{ .effect = release, .payload = try b.reference(b.parameter(body, 1)) } });
            if (write) try c.registry.protectSite(cleanup, site, release);
            try b.define(cleanup, site);
            const rt = try b.schema(.{ .internal = .{ .computation = .{ .parameters = &.{}, .result = integer, .effects = &.{g.effect}, .capture_bound = &.{ g.capability, integer } } } });
            const ct = try b.schema(.{ .internal = .{ .computation = .{ .parameters = &.{exit}, .result = unit, .effects = &.{release}, .capture_bound = &.{integer} } } });
            try b.define(body, try b.term(.{ .protect = .{ .body = try b.lambda(run, rt), .cleanup = try b.lambda(cleanup, ct) } }));
            const signature = try b.schema(.{ .internal = .{ .computation = .{ .parameters = &.{ g.capability, integer }, .result = integer, .effects = &.{ release, g.effect } } } });
            const entry = try b.declare(&.{unit}, unit, &.{release}, &.{});
            const owners = [_]Id{ try b.variable(g.package), try b.variable(g.package) };
            const answer = try b.variable(joined.generator.answer);
            const owner = try b.variable(joined.generator.package);
            var done = try b.bind(try b.variable(unit), try generator.close(b, joined.generator, try b.reference(owner)), try b.pure(try b.constant(void, {})));
            if (duplicate) done = try b.bind(try b.variable(unit), try generator.close(b, joined.generator, try b.reference(owner)), done);
            var work = try b.bind(answer, try b.term(.{ .call = .{ .function = joined.start, .arguments = &.{ try b.reference(owners[0]), try b.reference(owners[1]), try b.constant(u64, 7) } } }), try unpack(b, joined.generator, try b.reference(answer), owner, done));
            var i: usize = owners.len;
            while (i > 0) {
                i -= 1;
                const result = try b.variable(g.answer);
                work = try b.bind(result, try generator.begin(b, g, try b.lambda(body, signature), try b.constant(u64, i + 1)), try unpack(b, g, try b.reference(result), owners[i], work));
            }
            try b.define(entry, work);
            if (assessment) try c.registry.speculate(entry, &.{release});
            return b.module(entry, unit);
        }
    };
}
fn unpack(b: *source.Builder, g: generator.Generator, answer: Id, owner: Id, next: Id) !Id {
    const row = try b.variable(g.yielded);
    return b.term(.{ .match_sum = .{ .value = answer, .cases = &.{
        .{ .variable = try b.variable(g.result), .body = try b.term(.{ .fail = try b.constant(void, {}) }) },
        .{ .variable = row, .body = try b.term(.{ .unpack_product = .{ .value = try b.reference(row), .variables = &.{ try b.variable(g.element), owner }, .body = next } }) },
    } } });
}
fn compile(comptime duplicate: bool, comptime assessment: bool, comptime write: bool) !void {
    const System = agent.system(.{ .InitialArgs = void, .Result = void, .Failure = void, .application = Application(duplicate, assessment, write) });
    var result = try agent.compile(std.testing.allocator, System);
    defer result.deinit();
}
test "normal Agent entry admits composed owners and their read cleanup" {
    try compile(false, false, false);
    try compile(false, true, false);
}
test "composed ownership cannot be consumed twice" {
    try std.testing.expectError(error.UnavailableSlot, compile(true, false, false));
}
test "assessment cannot launder write authority through retained cleanup" {
    try compile(false, false, true);
    try std.testing.expectError(error.SpeculativeEffect, compile(false, true, true));
}
pub fn main(init: std.process.Init) !void {
    const System = agent.system(.{ .InitialArgs = void, .Result = void, .Failure = void, .application = Application(false, false, false) });
    var result = try agent.compile(init.gpa, System);
    defer result.deinit();
    const bytes = try init.gpa.alloc(u8, try boundary.data.program_image.encodedLength(result.program));
    defer init.gpa.free(bytes);
    _ = try result.encode(init.gpa, bytes);
    var buffer: [4096]u8 = undefined;
    var writer = std.Io.File.stdout().writer(init.io, &buffer);
    try writer.interface.writeAll(bytes);
    try writer.interface.flush();
}
