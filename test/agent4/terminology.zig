const std = @import("std");
const agent = @import("agent");
const boundary = @import("boundary");
const world = @import("world");
const t = @import("document").types;
const terminology = t.terminology;
const a = std.testing.allocator;
const Input = struct {
    content: terminology.Content,
    old: terminology.Content,
    replacement: terminology.Content,
    scope: u64,
};

fn compile() !boundary.source.Compiled {
    var b = boundary.source.Builder.init(a);
    defer b.deinit();
    var registry = agent.admission.Registry.init(b.allocator());
    defer registry.deinit();
    const c: agent.Context = .{ .builder = &b, .registry = &registry };
    const f = try terminology.define(c);
    const module = b.module(f, try b.scalar(void));
    try agent.admission.verify(a, module, &registry);
    return boundary.program.compile(a, module);
}

fn check(program: boundary.data.activation.Program, content: []const u8, old: []const u8, replacement: []const u8, scope: u64, expected: ?[]const u8, archive_changed: bool) !void {
    const args = try agent.contracts.encodeOwned(Input, a, .{
        .content = .{ .bytes = content },
        .old = .{ .bytes = old },
        .replacement = .{ .bytes = replacement },
        .scope = scope,
    });
    defer a.free(args);
    const invocation_image_0 = try a.alloc(u8, try boundary.data.program_image.encodedLength(program));
    defer a.free(invocation_image_0);
    _ = try boundary.data.program_image.encode(a, program, invocation_image_0);
    var outcome = try world.invocation.invoke(a, .{
        .image = invocation_image_0,
        .instance = .{ .initial_args = args },
    });
    defer outcome.deinit();
    try std.testing.expect(outcome.record == .completed);
    var result = try agent.contracts.decodeOwned(terminology.Edit, a, outcome.record.completed);
    defer result.deinit();
    if (expected) |bytes| {
        try std.testing.expect(result.value == .known);
        try std.testing.expectEqualStrings(bytes, result.value.known.replacement.bytes);
        try std.testing.expectEqual(archive_changed, result.value.known.archive_changed);
    } else try std.testing.expect(result.value == .invalid);
}

test "authored editing preserves exact active/whole bytes and derives archive changes" {
    var compiled = try compile();
    defer compiled.deinit();
    const before = "Active policy:\nA customer may request a refund.\n\n" ++
        "Archive:\nA customer filed a request in 2021.\n";
    try check(compiled.program, before, "customer", "client", 1, "Active policy:\nA client may request a refund.\n\n" ++
        "Archive:\nA customer filed a request in 2021.\n", false);
    try check(compiled.program, before, "customer", "client", 2, "Active policy:\nA client may request a refund.\n\n" ++
        "Archive:\nA client filed a request in 2021.\n", true);
    const convergent = "Active policy:\nA customer may request a refund.\n\n" ++
        "Archive:\nNo prior requests.\n";
    for ([_]u64{ 1, 2 }) |scope| try check(compiled.program, convergent, "customer", "client", scope, "Active policy:\nA client may request a refund.\n\nArchive:\nNo prior requests.\n", false);
    try check(compiled.program, "préface\nActive policy:\ncafé café\nArchive:\ncafé\n", "café", "thé", 1, "préface\nActive policy:\nthé thé\nArchive:\ncafé\n", false);
    try check(compiled.program, "préface\nActive policy:\ncafé café\nArchive:\ncafé\n", "café", "thé", 2, "préface\nActive policy:\nthé thé\nArchive:\nthé\n", true);
    try check(compiled.program, "Active policy:\naaaa\nArchive:\nnone\n", "aa", "aaa", 1, "Active policy:\naaaaaa\nArchive:\nnone\n", false);
    try check(compiled.program, before, "customer", "customer", 2, before, false);
    try check(compiled.program, before, "CUSTOMER", "client", 2, before, false);
}

test "grammar, marker mutation, empty term, foreign scope, and overflow are explicit invalid" {
    var compiled = try compile();
    defer compiled.deinit();
    const invalid = [_][]const u8{
        "",                                                  "Archive:\nx\nActive policy:\nx",              "Active policy:\nx",
        "Active policy:\nx\nActive policy:\nx\nArchive:\nx", "Active policy:\nx\nArchive:\nx\nArchive:\nx",
    };
    for (invalid) |text| try check(compiled.program, text, "x", "y", 1, null, false);
    const valid = "Active policy:\nx\nArchive:\nx\n";
    try check(compiled.program, valid, "", "y", 1, null, false);
    try check(compiled.program, valid, "x", "y", 0, null, false);
    try check(compiled.program, valid, "policy", "rule", 2, null, false);
    try check(compiled.program, valid, "Archive", "History", 2, null, false);
    try check(compiled.program, valid, "x", "Archive:\n", 1, null, false);
    const exact = "Active policy:\n" ++ @as([512 - 15 - 9]u8, @splat('x')) ++ "Archive:\n";
    try std.testing.expectEqual(@as(usize, 512), exact.len);
    try check(compiled.program, exact, "x", "y", 1, "Active policy:\n" ++ @as([512 - 15 - 9]u8, @splat('y')) ++ "Archive:\n", false);
    try check(compiled.program, exact, "x", "yy", 1, null, false);
}
