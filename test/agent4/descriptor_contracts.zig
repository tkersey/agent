const std = @import("std");
const agent = @import("agent");

const Text = agent.contracts.Text(17);
const Question = agent.model_invocation.Question(Text, "answer", "Return the text answer.", .{
    .model_id_bytes = 32,
    .temperature_bytes = 8,
    .maximum_messages = 2,
    .message_bytes = 128,
    .maximum_output_items = 2,
    .call_id_bytes = 32,
    .arguments_json_bytes = 256,
    .result_text_bytes = 128,
    .provider_response_bytes = 4096,
});

test "model declaration keeps UTF8 byte bounds distinct from JSON character bounds" {
    const declaration = Question.allDeclarations().items[0];
    const json = declaration.input_schema_json.bytes;
    try std.testing.expect(std.mem.indexOf(u8, json, "UTF-8 encoding must not exceed 17 bytes") != null);
    try std.testing.expect(std.mem.indexOf(u8, json, "maxLength is an additional character-count bound.") != null);
    try std.testing.expect(std.mem.indexOf(u8, json, "\"maxLength\":17") != null);
    try std.testing.expectEqual(1, declaration.argument_codec.items.len);
    try std.testing.expectEqualStrings("value", declaration.argument_codec.items[0].name.bytes);
    try std.testing.expectEqual(17, declaration.argument_codec.items[0].maximum_bytes);
    const encoded = try agent.contracts.encodeOwned(Text, std.testing.allocator, .{ .bytes = "éééééééé" });
    defer std.testing.allocator.free(encoded);
    // Nine characters satisfy maxLength=17 but exceed the portable 17-byte bound.
    try std.testing.expectError(error.InvalidValue, agent.contracts.encodeOwned(Text, std.testing.allocator, .{ .bytes = "ééééééééé" }));
}
