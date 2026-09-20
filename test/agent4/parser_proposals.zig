//! Actual checked model interpretation of parser construction proposals.
const std = @import("std");
const agent = @import("agent");
const boundary = @import("boundary");
const proposals = agent.parser_synthesis.proposals;
const P = proposals.Profile;
const Input = struct { request: P.Request, offered: [5]bool };
const Model = agent.model(.{ .name = "parser-fixture", .model = "synthetic-only", .protocol = struct {
    pub const semantic_identity = agent.model_invocation.protocol_identity;
} });
const Application = struct {
    pub fn emit(c: agent.Context) !boundary.computation.Module {
        const b = c.builder;
        const responder = try proposals.define(c, try b.constant(void, {}));
        const entry = try b.declare(&.{try c.schema(Input)}, try c.schema(P.Interpretation), b.functions.items[@intCast(responder)].effects, &.{});
        const input = try b.reference(b.parameter(entry, 0));
        try b.define(entry, try b.term(.{ .call = .{ .function = responder, .arguments = &.{
            try b.primitive(try c.schema(P.Request), .field, &.{input}, 0),
            try b.primitive(try c.schema([5]bool), .field, &.{input}, 1),
        } } }));
        return b.module(entry, try b.scalar(void));
    }
};
const System = agent.system(.{ .InitialArgs = Input, .Result = P.Interpretation, .Failure = void, .application = Application });
const fragment = "export const escapedByte = byte => byte === 110 ? 10 : byte;";
fn response(allocator: std.mem.Allocator, mode: []const u8) ![]u8 {
    const fragment_value: proposals.SourceProposal = .{
        .source = .{ .bytes = fragment },
        .explanation = .{ .bytes = "Escape transition only; incomplete parser." },
    };
    var action: proposals.Proposal = .{ .fragment = fragment_value };
    var name: []const u8 = "fragment";
    var ordinal: u32 = 0;
    var arguments: []const u8 = try std.json.Stringify.valueAlloc(allocator, .{ .source = fragment, .explanation = "Escape transition only; incomplete parser." }, .{});
    if (std.mem.eql(u8, mode, "unknown")) name = "approve_and_write";
    if (std.mem.eql(u8, mode, "unoffered")) {
        name = "complete_candidate";
        ordinal = 1;
        action = .{ .complete_candidate = fragment_value };
    }
    if (std.mem.eql(u8, mode, "experiment")) {
        name = "experiment";
        ordinal = 2;
        action = .{ .experiment = .{ .input_hex = .{ .bytes = "5c6e0a" }, .first_chunk_bytes = 1, .chunk_bytes = 2, .finalize = true, .reason = .{ .bytes = "Check escaped LF versus record termination." } } };
        allocator.free(arguments);
        arguments = try std.json.Stringify.valueAlloc(allocator, .{
            .input_hex = "5c6e0a",
            .first_chunk_bytes = 1,
            .chunk_bytes = 2,
            .finalize = true,
            .reason = "Check escaped LF versus record termination.",
        }, .{});
    }
    if (std.mem.eql(u8, mode, "unresolved")) {
        name = "unresolved";
        ordinal = 4;
        action = .{ .unresolved = .{ .reason = .{ .bytes = "Insufficient current evidence." } } };
        allocator.free(arguments);
        arguments = try std.json.Stringify.valueAlloc(allocator, .{ .reason = "Insufficient current evidence." }, .{});
    }
    if (std.mem.eql(u8, mode, "constraint")) {
        name = "constraint";
        ordinal = 3;
        action = .{ .constraint = .{ .kind = .reference, .question = .{ .bytes = "Does the escaped LF terminate a record?" } } };
        allocator.free(arguments);
        arguments = try std.json.Stringify.valueAlloc(allocator, .{ .kind = "reference", .question = "Does the escaped LF terminate a record?" }, .{});
    }
    defer allocator.free(arguments);
    return agent.contracts.encodeOwned(P.Result, allocator, .{ .output = .{
        .items = .{ .items = &.{.{ .function_call = .{
            .call_id = .{ .bytes = "same-provider-id" },
            .name = .{ .bytes = name },
            .arguments_json = .{ .bytes = arguments },
            .tool_ordinal_claim = ordinal,
            .decoded_action = .{ .decoded = action },
        } }} },
        .normalized_output_digest = [_]u8{0} ** 32,
    } });
}
fn output(init: std.process.Init, bytes: []const u8) !void {
    var buffer: [4096]u8 = undefined;
    var writer = std.Io.File.stdout().writer(init.io, &buffer);
    try writer.interface.writeAll(bytes);
    try writer.interface.flush();
}
pub fn main(init: std.process.Init) !void {
    var args = init.minimal.args.iterate();
    _ = args.next();
    const mode = args.next() orelse return error.ExpectedMode;
    if (args.next() != null) return error.UnexpectedArgument;
    if (std.mem.eql(u8, mode, "program")) {
        var compiled = try agent.compile(init.gpa, System);
        defer compiled.deinit();
        const bytes = try init.gpa.alloc(u8, try boundary.data.program_image.encodedLength(compiled.program));
        defer init.gpa.free(bytes);
        _ = try compiled.encode(init.gpa, bytes);
        return output(init, bytes);
    }
    if (std.mem.eql(u8, mode, "input")) {
        const request = try P.templateValue(Model, .{ .items = &.{
            .{ .role = .system, .content = .{ .bytes = proposals.instructions } },
            .{ .role = .user, .content = .{ .bytes = "Supply only the requested escape transition before a full parser exists." } },
        } }, .{ .minimum_calls = 1, .maximum_calls = 1, .parallel_calls = false });
        const bytes = try agent.contracts.encodeOwned(Input, init.gpa, .{
            .request = request,
            .offered = .{ true, false, true, true, true },
        });
        defer init.gpa.free(bytes);
        return output(init, bytes);
    }
    if (std.mem.eql(u8, mode, "result-schema")) {
        var b = boundary.computation.Builder.init(init.gpa);
        defer b.deinit();
        const schema = try agent.contracts.schema(P.Interpretation, &b);
        const bytes = try boundary.data.schema.encodeOwned(init.gpa, b.schemas.items, schema);
        defer init.gpa.free(bytes);
        return output(init, bytes);
    }
    const bytes = try response(init.gpa, mode);
    defer init.gpa.free(bytes);
    return output(init, bytes);
}
