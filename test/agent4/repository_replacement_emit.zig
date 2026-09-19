//! Standalone gate image for actual filesystem/portable-kernel qualification.
const std = @import("std");
const agent = @import("agent");
const boundary = @import("boundary");
const replacement = @import("repository_app").replacement;
const t = replacement.types;
const Input = struct { memory: t.Memory, request: t.ReplaceRequest, principal: u64 };
const System = agent.system(.{
    .InitialArgs = Input,
    .Result = t.ReplaceOutcome,
    .Failure = t.Failure,
    .application = Application,
});

const Application = struct {
    pub fn emit(c: agent.Context) !boundary.computation.Module {
        const b = c.builder;
        const operation = try replacement.define(c);
        const entry = try b.declare(&.{try c.schema(Input)}, try c.schema(t.ReplaceOutcome), operation.effects, &.{});
        const input = try b.reference(b.parameter(entry, 0));
        try b.define(entry, try b.term(.{ .call = .{ .function = operation.function, .arguments = &.{
            try b.primitive(try c.schema(t.Memory), .field, &.{input}, 0),
            try b.primitive(try c.schema(t.ReplaceRequest), .field, &.{input}, 1),
            try b.primitive(try c.schema(u64), .field, &.{input}, 2),
        } } }));
        return b.module(entry, try c.schema(t.Failure));
    }
};

pub fn main(init: std.process.Init) !void {
    var args = init.minimal.args.iterate();
    _ = args.next();
    const mode = args.next() orelse "image";
    if (args.next() != null) return error.InvalidArgument;
    const app = @import("repository_app");
    if (std.mem.eql(u8, mode, "task-schema")) return writeSchema(init, app.Task);
    if (std.mem.eql(u8, mode, "final-schema")) return writeSchema(init, app.t.FinalResult);
    if (std.mem.eql(u8, mode, "application")) return writeImage(init, app.System);
    if (std.mem.eql(u8, mode, "input-schema")) return writeSchema(init, Input);
    if (std.mem.eql(u8, mode, "result-schema")) return writeSchema(init, t.ReplaceOutcome);
    if (std.mem.eql(u8, mode, "failure-schema")) return writeSchema(init, t.Failure);
    if (!std.mem.eql(u8, mode, "image")) return error.InvalidArgument;
    return writeImage(init, System);
}

fn writeImage(init: std.process.Init, comptime App: type) !void {
    var compiled = try agent.compile(init.gpa, App);
    defer compiled.deinit();
    const bytes = try init.gpa.alloc(u8, try boundary.data.program_image.encodedLength(compiled.program));
    defer init.gpa.free(bytes);
    return writeBytes(init, try compiled.encode(init.gpa, bytes));
}

fn writeSchema(init: std.process.Init, comptime T: type) !void {
    var builder = boundary.computation.Builder.init(init.gpa);
    defer builder.deinit();
    const root = try agent.contracts.schema(T, &builder);
    const bytes = try boundary.data.schema.encodeOwned(init.gpa, builder.schemas.items, root);
    defer init.gpa.free(bytes);
    return writeBytes(init, bytes);
}

fn writeBytes(init: std.process.Init, bytes: []const u8) !void {
    var buffer: [4096]u8 = undefined;
    var output = std.Io.File.stdout().writer(init.io, &buffer);
    try output.interface.writeAll(bytes);
    try output.interface.flush();
}
