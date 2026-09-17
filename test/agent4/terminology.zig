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

fn compile() !boundary.computation.Compiled {
    var b = boundary.computation.Builder.init(a);
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
    const exact = "Active policy:\n" ++ "x" ** (512 - 15 - 9) ++ "Archive:\n";
    try std.testing.expectEqual(@as(usize, 512), exact.len);
    try check(compiled.program, exact, "x", "y", 1, "Active policy:\n" ++ "y" ** (512 - 15 - 9) ++ "Archive:\n", false);
    try check(compiled.program, exact, "x", "yy", 1, null, false);
}

test "every operative document field participates in the decisive key" {
    var b = boundary.computation.Builder.init(a);
    defer b.deinit();
    const d = try agent.clarification.define(&b, .{
        .identity = "test.document.projection",
        .candidate = try agent.contracts.schema(t.Consequences, &b),
        .key = try agent.contracts.schema(t.Action, &b),
        .domain = .{ .finite = &.{ 1, 2 } },
        .failure = try b.constant(void, {}),
    });
    var compiled = try boundary.program.compile(a, b.module(d.classify, try b.scalar(void)));
    defer compiled.deinit();
    const base = t.Action{
        .operation = .replace,
        .proposal = .{
            .path = .{ .bytes = "document.txt" },
            .base = .{ .content = .{ .bytes = "base" }, .digest = .{ .bytes = "digest" } },
            .replacement = .{ .bytes = "replacement" },
            .provenance = 1,
            .required_principal = 7,
            .reason = .{ .bytes = "operative reason" },
        },
        .task = t.default_request,
        .policy_id = 1,
    };
    var mutations = [_]t.Action{base} ** 15;
    mutations[0].operation = .no_change;
    mutations[1].proposal.path.bytes = "another.txt";
    mutations[2].proposal.base.content.bytes = "different content with the same alleged digest";
    mutations[3].proposal.base.digest.bytes = "different digest";
    mutations[4].proposal.replacement.bytes = "different replacement";
    mutations[5].proposal.provenance = 2;
    mutations[6].proposal.required_principal = 8;
    mutations[7].proposal.reason.bytes = "different operative reason";
    mutations[8].task.path.bytes = "another.txt";
    mutations[9].task.old_term.bytes = "another term";
    mutations[10].task.replacement_term.bytes = "another replacement";
    mutations[11].task.require_scope = true;
    mutations[12].task.allow_archive = false;
    mutations[13].task.attempt = 2;
    mutations[14].policy_id = 2;
    for (mutations) |changed| {
        const initial = struct { evaluations: []const t.Evaluation, mandatory: bool }{
            .evaluations = &.{
                .{ .id = 1, .assessed = .{ .known = .{
                    .consequences = .{ .changes_archive = false },
                    .action = base,
                } } },
                .{ .id = 2, .assessed = .{ .known = .{
                    .consequences = .{ .changes_archive = false },
                    .action = changed,
                } } },
            },
            .mandatory = false,
        };
        const args = try agent.contracts.encodeOwned(@TypeOf(initial), a, initial);
        defer a.free(args);
        const invocation_image_1 = try a.alloc(u8, try boundary.data.program_image.encodedLength(compiled.program));
        defer a.free(invocation_image_1);
        _ = try boundary.data.program_image.encode(a, compiled.program, invocation_image_1);
        var result = try world.invocation.invoke(a, .{
            .image = invocation_image_1,
            .instance = .{ .initial_args = args },
        });
        defer result.deinit();
        try std.testing.expect(result.record == .completed);
        var classified = try agent.contracts.decodeOwned(t.Classification, a, result.record.completed);
        defer classified.deinit();
        try std.testing.expect(classified.value == .choice);
        try std.testing.expectEqual(@as(usize, 2), classified.value.choice.groups.len);
    }
}
