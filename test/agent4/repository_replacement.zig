const std = @import("std");
const testing = std.testing;
const agent = @import("agent");
const boundary = @import("boundary");
const world = @import("world");
const replacement = @import("repository_replace");
const t = replacement.types;
const protocol = boundary.data.invocation;
const Input = struct { memory: t.Memory, request: t.ReplaceRequest, principal: u64 };
const Challenge = struct { occurrence: u64, proposal: replacement.Proposal };
const Decision = union(enum) { approve: void, deny: replacement.Reason, amend: replacement.Proposal };
const Answer = struct { challenge: Challenge, principal: u64, decision: Decision };
const Reply = union(enum) { reply: Answer };
const Exchange = struct { channel: agent.contracts.Utf8, purpose: agent.contracts.Utf8, presentation: void, outgoing: Challenge };
const proposal: replacement.Proposal = .{ .request = .{
    .path = .{ .bytes = "src/range.mjs" },
    .expected_sha256 = .{ .bytes = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef" },
    .replacement = .{ .bytes = "corrected source" },
    .rationale = .{ .bytes = "fix the failing boundary case" },
}, .principal = 7 };

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

const Driver = struct {
    image: []u8,
    outcome: world.invocation.Outcome,
    fn init(failing: bool) !Driver {
        var memory = std.mem.zeroes(t.Memory);
        memory.failing_test_observed = failing;
        memory.source_document = .{ .role = .source, .role_code = 1, .path = proposal.request.path, .sha256 = proposal.request.expected_sha256, .contents = .{ .bytes = "original source" } };
        return initMemory(memory);
    }
    fn initMemory(memory: t.Memory) !Driver {
        const a = testing.allocator;
        var compiled = try agent.compile(a, agent.system(.{ .InitialArgs = Input, .Result = t.ReplaceOutcome, .Failure = t.Failure, .application = Application }));
        defer compiled.deinit();
        const image = try a.alloc(u8, try boundary.data.program_image.encodedLength(compiled.program));
        errdefer a.free(image);
        _ = try compiled.encode(a, image);
        const args = try agent.contracts.encodeOwned(Input, a, .{ .memory = memory, .request = proposal.request, .principal = proposal.principal });
        defer a.free(args);
        return .{ .image = image, .outcome = try world.invocation.invoke(a, .{ .image = image, .instance = .{ .initial_args = args } }) };
    }
    fn deinit(self: *Driver) void {
        self.outcome.deinit();
        testing.allocator.free(self.image);
    }
    fn requested(self: *Driver, comptime T: type, identity: []const u8) !agent.contracts.Decoded(T) {
        try testing.expect(self.outcome.record == .requested);
        var request = try protocol.decode(protocol.Request, testing.allocator, self.outcome.record.requested.request);
        defer request.deinit();
        try testing.expectEqualStrings(identity, request.value.binding.semantic_identity);
        return agent.contracts.decodeOwned(T, testing.allocator, request.value.binding.payload);
    }
    fn reply(self: *Driver, comptime T: type, value: T) !void {
        const a = testing.allocator;
        try testing.expect(self.outcome.record == .requested);
        var request = try protocol.decode(protocol.Request, a, self.outcome.record.requested.request);
        defer request.deinit();
        const bytes = try agent.contracts.encodeOwned(T, a, value);
        defer a.free(bytes);
        const reply_bytes = try protocol.encodeOwned(protocol.Result, a, .{ .request_identity = request.value.request_identity, .value = bytes });
        defer a.free(reply_bytes);
        const next = try world.invocation.invoke(a, .{ .image = self.image, .instance = .{ .state = self.outcome.record.requested.state.? }, .control = .{ .reply = reply_bytes } });
        self.outcome.deinit();
        self.outcome = next;
    }
    fn beginApproval(self: *Driver) !agent.contracts.Decoded(Exchange) {
        var read = try self.requested(replacement.Proposal, "repository.repair.current.v1");
        defer read.deinit();
        try testing.expectEqualDeep(proposal, read.value);
        try self.reply(replacement.Read, .{ .current = proposal });
        var issued = try self.requested(replacement.Proposal, "agent.approval.issue.v1.repository.repair.replace");
        defer issued.deinit();
        try testing.expectEqualDeep(proposal, issued.value);
        try self.reply(u64, 17);
        return self.requested(Exchange, "agent.interaction.exchange.v1.repository.repair.replace");
    }
    fn result(self: *Driver) !agent.contracts.Decoded(t.ReplaceOutcome) {
        try testing.expect(self.outcome.record == .completed);
        return agent.contracts.decodeOwned(t.ReplaceOutcome, testing.allocator, self.outcome.record.completed);
    }
};

test "repository replacement requires a failing baseline before any external operation" {
    var d = try Driver.init(false);
    defer d.deinit();
    var result = try d.result();
    defer result.deinit();
    try testing.expect(result.value == .denied);
}

test "repository replacement rejects missing or stale retained source before I/O" {
    for (0..3) |mode| {
        var memory = std.mem.zeroes(t.Memory);
        memory.failing_test_observed = true;
        if (mode != 0) memory.source_document = .{
            .role = .source,
            .role_code = 1,
            .path = if (mode == 1) .{ .bytes = "other.mjs" } else proposal.request.path,
            .sha256 = if (mode == 2) .{ .bytes = "stale" } else proposal.request.expected_sha256,
            .contents = .{ .bytes = "original source" },
        };
        var d = try Driver.initMemory(memory);
        defer d.deinit();
        var result = try d.result();
        defer result.deinit();
        try testing.expect(result.value == .denied);
    }
}

test "repository replacement consumes live evidence and exact approval across fresh restores" {
    var d = try Driver.init(true);
    defer d.deinit();
    var exchange = try d.beginApproval();
    defer exchange.deinit();
    try d.reply(Reply, .{ .reply = .{ .challenge = exchange.value.outgoing, .principal = 7, .decision = .{ .approve = {} } } });
    var commit = try d.requested(replacement.Proposal, "repository.repair.replace.v1");
    defer commit.deinit();
    try testing.expectEqualDeep(proposal, commit.value);
    const applied: t.ReplaceApplied = .{ .path = proposal.request.path, .old_sha256 = proposal.request.expected_sha256, .new_sha256 = .{ .bytes = "new" }, .already_applied = false };
    try d.reply(replacement.Delivery, .{ .success = applied });
    var result = try d.result();
    defer result.deinit();
    try testing.expectEqualDeep(t.ReplaceOutcome{ .applied = applied }, result.value);
}

test "changed or substituted read evidence cannot reach approval or commit" {
    var d = try Driver.init(true);
    defer d.deinit();
    const conflict: t.ReplaceConflict = .{ .path = proposal.request.path, .expected_sha256 = proposal.request.expected_sha256, .actual_sha256 = .{ .bytes = "other" } };
    try d.reply(replacement.Read, .{ .conflict = conflict });
    var result = try d.result();
    defer result.deinit();
    try testing.expectEqualDeep(t.ReplaceOutcome{ .conflict = conflict }, result.value);
    var substituted = try Driver.init(true);
    defer substituted.deinit();
    var other = proposal;
    other.request.replacement = .{ .bytes = "substituted" };
    try substituted.reply(replacement.Read, .{ .current = other });
    var rejected = try substituted.result();
    defer rejected.deinit();
    try testing.expect(rejected.value == .denied);
}

test "denial wrong principal and proposal amendment cannot commit" {
    for (0..3) |mode| {
        var d = try Driver.init(true);
        defer d.deinit();
        var exchange = try d.beginApproval();
        defer exchange.deinit();
        var other = proposal;
        other.request.replacement = .{ .bytes = "changed after read" };
        const decision: Decision = switch (mode) {
            0 => .{ .deny = .{ .bytes = "no" } },
            1 => .{ .approve = {} },
            else => .{ .amend = other },
        };
        try d.reply(Reply, .{ .reply = .{ .challenge = exchange.value.outgoing, .principal = if (mode == 1) 8 else 7, .decision = decision } });
        var result = try d.result();
        defer result.deinit();
        try testing.expect(result.value == .denied);
    }
}

test "uncertain replacement remains an explicit terminal failure" {
    var d = try Driver.init(true);
    defer d.deinit();
    var exchange = try d.beginApproval();
    defer exchange.deinit();
    try d.reply(Reply, .{ .reply = .{ .challenge = exchange.value.outgoing, .principal = 7, .decision = .{ .approve = {} } } });
    try d.reply(replacement.Delivery, .{ .uncertain = .{ .bytes = "connection lost after submission" } });
    try testing.expect(d.outcome.record == .failed);
    var failure = try agent.contracts.decodeOwned(t.Failure, testing.allocator, d.outcome.record.failed.value);
    defer failure.deinit();
    try testing.expectEqual(t.Failure.uncertain_delivery, failure.value);
}

test "stale approval challenge fails without issuing replacement" {
    var d = try Driver.init(true);
    defer d.deinit();
    var exchange = try d.beginApproval();
    defer exchange.deinit();
    var stale = exchange.value.outgoing;
    stale.occurrence -= 1;
    try d.reply(Reply, .{ .reply = .{
        .challenge = stale,
        .principal = 7,
        .decision = .{ .approve = {} },
    } });
    try testing.expect(d.outcome.record == .failed);
    var failure = try agent.contracts.decodeOwned(t.Failure, testing.allocator, d.outcome.record.failed.value);
    defer failure.deinit();
    try testing.expectEqual(t.Failure.invalid_variant, failure.value);
}

test "unavailable live source fails before approval or replacement" {
    var d = try Driver.init(true);
    defer d.deinit();
    try d.reply(replacement.Read, .{ .unavailable = .{ .bytes = "source missing" } });
    try testing.expect(d.outcome.record == .failed);
    var failure = try agent.contracts.decodeOwned(t.Failure, testing.allocator, d.outcome.record.failed.value);
    defer failure.deinit();
    try testing.expectEqual(t.Failure.authored_abort, failure.value);
}

test "conditional delivery preserves conflict and failure outcomes" {
    for (0..2) |mode| {
        var d = try Driver.init(true);
        defer d.deinit();
        var exchange = try d.beginApproval();
        defer exchange.deinit();
        try d.reply(Reply, .{ .reply = .{
            .challenge = exchange.value.outgoing,
            .principal = 7,
            .decision = .{ .approve = {} },
        } });
        const conflict: t.ReplaceConflict = .{
            .path = proposal.request.path,
            .expected_sha256 = proposal.request.expected_sha256,
            .actual_sha256 = .{ .bytes = "changed during approval" },
        };
        const reason: replacement.Reason = .{ .bytes = "write refused" };
        try d.reply(replacement.Delivery, if (mode == 0)
            .{ .conflict = conflict }
        else
            .{ .failure = reason });
        var result = try d.result();
        defer result.deinit();
        try testing.expectEqualDeep(if (mode == 0)
            t.ReplaceOutcome{ .conflict = conflict }
        else
            t.ReplaceOutcome{ .denied = .{ .reason = reason } }, result.value);
    }
}
