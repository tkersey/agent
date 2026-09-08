const std = @import("std");
const boundary = @import("boundary");
const contracts = @import("agent_contracts");
const model = @import("model.zig");
const invocation = @import("model_invocation.zig");

const limits: invocation.Limits = .{
    .model_id_bytes = 32,
    .temperature_bytes = 64,
    .maximum_messages = 4,
    .message_bytes = 256,
    .maximum_output_items = 8,
    .call_id_bytes = 64,
    .arguments_json_bytes = 1024,
    .result_text_bytes = 256,
    .provider_response_bytes = 4096,
};
const FixtureModel = model.model(.{
    .name = "fixture",
    .model = "fixture-model",
    .protocol = struct {
        pub const semantic_identity = invocation.protocol_identity;
    },
    .parameters = .{
        .max_output_tokens = @as(u32, 256),
        .temperature = "0.125",
        .reasoning = .{ .effort = .low, .summary = .concise },
    },
});
const FixtureAnswer = union(enum(u32)) {
    choose: struct {
        text: contracts.Text(16),
        signed: i64,
        unsigned: u64,
        enabled: bool,
        mode: enum(u32) { low = 9, high = 3 },
    } = 7,
    decline: enum(u32) { no = 3, later = 9 } = 31,
};
const Fixture = invocation.Profile(FixtureAnswer, .{
    .{ .name = "choose", .description = "Propose a typed answer." },
    .{ .name = "decline", .description = "Decline the question." },
}, limits);

test "model declarations preserve logical tags and derive strict schemas/codecs" {
    const declarations = Fixture.allDeclarations().items;
    try std.testing.expectEqual(2, declarations.len);
    try std.testing.expectEqual(7, declarations[0].action_tag);
    try std.testing.expectEqual(1, declarations[1].action_ordinal);
    try std.testing.expectEqual(31, declarations[1].action_tag);
    const fields = declarations[0].argument_codec.items;
    try std.testing.expectEqual(5, fields.len);
    try std.testing.expectEqualSlices(u32, &.{ 9, 3 }, fields[4].enum_tags.items);
    try std.testing.expect(std.mem.indexOf(u8, declarations[0].input_schema_json.bytes, "18446744073709551615") != null);
    try std.testing.expect(std.mem.indexOf(u8, declarations[0].input_schema_json.bytes, "\"additionalProperties\":false") != null);
}

test "one self-contained request round trips without losing exact model parameters" {
    var arena = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena.deinit();
    const allocator = arena.allocator();
    const request = try Fixture.invocationValue(allocator, FixtureModel, .{
        .items = &.{.{ .role = .user, .content = .{ .bytes = "Decide." } }},
    }, .{ true, false }, .{ .minimum_calls = 1, .maximum_calls = 1, .parallel_calls = false });
    const bytes = try contracts.encodeOwned(Fixture.Request, allocator, request);
    var restored = try contracts.decodeOwned(Fixture.Request, allocator, bytes);
    defer restored.deinit();
    try std.testing.expectEqualStrings("0.125", restored.value.parameters.temperature.?.bytes);
    try std.testing.expectEqualStrings("fixture-model", restored.value.model.bytes);
    try std.testing.expectEqual(1, restored.value.tools.items.len);
    try std.testing.expectEqualStrings("choose", restored.value.tools.items[0].name.bytes);
    try std.testing.expectEqualStrings("Decide.", restored.value.messages.items[0].content.bytes);
}

test "normalized Answer uses sum ordinal while enum payload keeps explicit tags" {
    const result: Fixture.Result = .{ .output = .{
        .items = .{ .items = &.{.{ .function_call = .{
            .call_id = .{ .bytes = "call" },
            .name = .{ .bytes = "decline" },
            .arguments_json = .{ .bytes = "{\"value\":\"later\"}" },
            .tool_ordinal_claim = 1,
            .decoded_action = .{ .decoded = .{ .decline = .later } },
        } }} },
        .normalized_output_digest = [_]u8{0} ** 32,
    } };
    const bytes = try contracts.encodeOwned(Fixture.Result, std.testing.allocator, result);
    defer std.testing.allocator.free(bytes);
    try std.testing.expectEqualSlices(u8, &.{ 0, 1, 0 }, bytes[0..3]);
    var restored = try contracts.decodeOwned(Fixture.Result, std.testing.allocator, bytes);
    defer restored.deinit();
    const call = restored.value.output.items.items[0].function_call;
    try std.testing.expectEqual(.later, call.decoded_action.decoded.decline);
    try std.testing.expectEqual(1, call.tool_ordinal_claim);
}

test "model effect is ordinary and a typed question requires no executable tool" {
    const Question = invocation.Question(i64, "answer", "Answer the integer question.", limits);
    var builder = boundary.computation.Builder.init(std.testing.allocator);
    defer builder.deinit();
    const first = try Question.declare(&builder);
    try std.testing.expectEqual(first, try Question.declare(&builder));
    try std.testing.expectEqualStrings(invocation.semantic_identity, builder.effects.items[@intCast(first)].identity);
    const request = try contracts.schema(Question.Request, &builder);
    const result = try contracts.schema(Question.Result, &builder);
    try std.testing.expectEqual(request, builder.effects.items[@intCast(first)].payload);
    try std.testing.expectEqual(result, builder.effects.items[@intCast(first)].result);
    try std.testing.expect(builder.effects.items[@intCast(first)].external);
    const facts = try boundary.data_v2.admission.schemas(std.testing.allocator, builder.schemas.items);
    defer std.testing.allocator.free(facts.minimum);
    defer std.testing.allocator.free(facts.exportable);
    try std.testing.expectEqualStrings("answer", Question.allDeclarations().items[0].name.bytes);
}

test "single answer admission compiles as ordinary Boundary functions" {
    var builder = boundary.computation.Builder.init(std.testing.allocator);
    defer builder.deinit();
    const entry = try Fixture.interpreter(&builder);
    try std.testing.expectEqual(entry, try Fixture.interpreter(&builder));
    var compiled = try boundary.program.compile(std.testing.allocator, builder.module(entry, try builder.scalar(void)));
    defer compiled.deinit();
    try std.testing.expect(compiled.program.functions.len > 1);
    const all = try Fixture.interpretAll(&builder);
    var compiled_all = try boundary.program.compile(std.testing.allocator, builder.module(all, try builder.scalar(void)));
    defer compiled_all.deinit();
}

fn Many() type {
    @setEvalBranchQuota(100_000);
    const Payload = struct { value: u32 };
    const Declaration = struct { name: []const u8, description: []const u8 };
    var names: [64][:0]const u8 = undefined;
    var tags: [64]u32 = undefined;
    var types: [64]type = undefined;
    var declarations: [64]Declaration = undefined;
    for (0..64) |i| {
        const name = std.fmt.comptimePrint("tool_{d}", .{i});
        names[i] = name;
        tags[i] = i;
        types[i] = Payload;
        declarations[i] = .{ .name = name, .description = "A typed candidate." };
    }
    const Tag = @Enum(u32, .exhaustive, &names, &tags);
    const Answer = @Union(.auto, Tag, &names, &types, &@splat(.{}));
    return invocation.Profile(Answer, declarations, limits);
}

test "model declarations and offered sets preserve indexes 31 32 and 63" {
    const P = Many();
    var offered = [_]bool{false} ** 64;
    offered[31] = true;
    offered[32] = true;
    offered[63] = true;
    const declarations = try P.declarationsValue(std.testing.allocator, offered);
    defer std.testing.allocator.free(declarations.items);
    try std.testing.expectEqual(3, declarations.items.len);
    try std.testing.expectEqual(31, declarations.items[0].action_ordinal);
    try std.testing.expectEqual(32, declarations.items[1].action_ordinal);
    try std.testing.expectEqual(63, declarations.items[2].action_ordinal);
    try std.testing.expectEqualStrings("tool_63", declarations.items[2].name.bytes);
    var builder = boundary.computation.Builder.init(std.testing.allocator);
    defer builder.deinit();
    inline for (0..64) |index| _ = try P.declarationValue(&builder, index);
    const encoded_schema = try contracts.encodeOwned(P.ToolSchema, std.testing.allocator, declarations.items[0].input_schema_json);
    defer std.testing.allocator.free(encoded_schema);
    const schema = try contracts.schema(P.ToolSchema, &builder);
    var copies: usize = 0;
    for (builder.constants.items) |constant| {
        if (constant.schema == schema and std.mem.eql(u8, constant.bytes, encoded_schema))
            copies += 1;
    }
    try std.testing.expectEqual(1, copies);
}
