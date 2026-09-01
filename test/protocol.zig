const agent = @import("agent");
const boundary = @import("boundary");
const std = @import("std");

const Protocol = agent.protocol.openaiResponsesV1.Contract(1024, 2048);
const Site = Protocol.Site(7);

test "OpenAI Responses v1 preserves raw response bytes" {
    try std.testing.expectEqualStrings(
        "agent.model.openai.responses.v1",
        Site.semantic_identity,
    );
    try std.testing.expectEqual(@as(u32, 7), Site.site_id);
    try std.testing.expect(Site.Payload == Protocol.Request);
    try std.testing.expect(Site.Resume == Protocol.Response);

    const body = try Protocol.ResponseBody.fromSlice(&.{ 0xff, 0x00 });
    const value = Protocol.Response{ .response = .{
        .http_status = 200,
        .body = body,
    } };
    const maximum = comptime boundary.schema.maximumEncodedSize(
        Protocol.Response,
    );
    var encoded: [maximum]u8 = undefined;
    const length = try boundary.schema.encode(
        Protocol.Response,
        value,
        &encoded,
    );
    const decoded = try boundary.schema.decodeExact(
        Protocol.Response,
        encoded[0..length],
    );
    try std.testing.expectEqualSlices(
        u8,
        &.{ 0xff, 0x00 },
        try decoded.response.body.slice(),
    );
}

test "OpenAI Responses v1 carries explicit transport failures" {
    const value = Protocol.Response{ .transport_failure = .{
        .kind = .response_too_large,
    } };
    try std.testing.expectEqual(
        agent.protocol.openaiResponsesV1.TransportFailureKind.response_too_large,
        value.transport_failure.kind,
    );
}
