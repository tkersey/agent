const std = @import("std");
const agent = @import("agent");
const boundary = @import("boundary");
const world = @import("world");
const policy = @import("repository");
const t = policy.types;
const testing = std.testing;
const Kind = enum { observe, project, final_allowed };
const ObserveInput = struct { memory: t.Memory, observation: t.Observation };
const FinalInput = struct { memory: t.Memory, result: t.FinalResult };

fn Harness(comptime kind: Kind) type {
    const Input = switch (kind) {
        .observe => ObserveInput,
        .project => t.Memory,
        .final_allowed => FinalInput,
    };
    const Result = switch (kind) {
        .observe => t.Memory,
        .project => t.DecisionView,
        .final_allowed => bool,
    };
    const Application = struct {
        pub fn emit(c: agent.Context) !boundary.computation.Module {
            const b = c.builder;
            const functions = try policy.define(c);
            const entry = try b.declare(&.{try c.schema(Input)}, try c.schema(Result), &.{}, &.{});
            const input = try b.reference(b.parameter(entry, 0));
            const memory = if (kind == .project) input else try b.primitive(try c.schema(t.Memory), .field, &.{input}, 0);
            const arguments: []const u64 = switch (kind) {
                .project => &.{memory},
                .observe => &.{ memory, try b.primitive(try c.schema(t.Observation), .field, &.{input}, 1) },
                .final_allowed => &.{ memory, try b.primitive(try c.schema(t.FinalResult), .field, &.{input}, 1) },
            };
            try b.define(entry, try b.term(.{ .call = .{ .function = @field(functions, @tagName(kind)), .arguments = arguments } }));
            return b.module(entry, try c.schema(t.Failure));
        }
    };
    return struct {
        image: []u8,
        const Self = @This();
        fn init() !Self {
            var compiled = try agent.compile(testing.allocator, agent.system(.{ .InitialArgs = Input, .Result = Result, .Failure = t.Failure, .application = Application }));
            defer compiled.deinit();
            const image = try testing.allocator.alloc(u8, try boundary.data.program_image.encodedLength(compiled.program));
            errdefer testing.allocator.free(image);
            _ = try compiled.encode(testing.allocator, image);
            return .{ .image = image };
        }
        fn deinit(self: Self) void {
            testing.allocator.free(self.image);
        }
        fn invoke(self: Self, input: Input) !world.invocation.Outcome {
            const bytes = try agent.contracts.encodeOwned(Input, testing.allocator, input);
            defer testing.allocator.free(bytes);
            return world.invocation.invoke(testing.allocator, .{ .image = self.image, .instance = .{ .initial_args = bytes } });
        }
        fn run(self: Self, input: Input) !agent.contracts.Decoded(Result) {
            var outcome = try self.invoke(input);
            defer outcome.deinit();
            try testing.expect(outcome.record == .completed);
            return agent.contracts.decodeOwned(Result, testing.allocator, outcome.record.completed);
        }
    };
}

const old_digest = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
const new_digest = "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789";

fn read(role: t.DocumentRole, code: u8) t.ReadResult {
    const path = switch (role) {
        .package => "package.json",
        .source => "src/range.mjs",
        .@"test" => "test/range.mjs",
    };
    return .{ .role = role, .role_code = code, .path = .{ .bytes = path }, .sha256 = .{ .bytes = old_digest }, .contents = .{ .bytes = "0123456789abcdef" } };
}
fn testResult(passed: bool) t.TestResult {
    return .{ .exit_code = if (passed) 0 else 1, .passed = passed, .stdout = .{ .bytes = "0123456789abcdef" }, .stderr = .{ .bytes = "fedcba9876543210" }, .stdout_truncated = false, .stderr_truncated = false };
}
fn applied() t.ReplaceOutcome {
    return .{ .applied = .{ .path = .{ .bytes = "src/range.mjs" }, .old_sha256 = .{ .bytes = old_digest }, .new_sha256 = .{ .bytes = new_digest }, .already_applied = false } };
}
const final_result: t.FinalResult = .{ .summary = .{ .bytes = "repaired" }, .changed_files = .{ .items = &.{.{ .bytes = "src/range.mjs" }} }, .tests_passed = true, .final_source_sha256 = .{ .bytes = new_digest } };

test "staged repository memory normalizes role codes and rejects invalid roles" {
    const h = try Harness(.observe).init();
    defer h.deinit();
    var mismatched = read(.package, 0);
    mismatched.role = .source;
    var normalized = try h.run(.{ .memory = policy.initial, .observation = .{ .read_file = mismatched } });
    defer normalized.deinit();
    try testing.expectEqual(t.DocumentRole.package, normalized.value.package_document.?.role);
    try testing.expect(normalized.value.source_document == null);
    var rejected = try h.invoke(.{ .memory = policy.initial, .observation = .{ .read_file = read(.package, 3) } });
    defer rejected.deinit();
    try testing.expect(rejected.record == .failed);
    var failure = try agent.contracts.decodeOwned(t.Failure, testing.allocator, rejected.record.failed.value);
    defer failure.deinit();
    try testing.expectEqual(t.Failure.invalid_variant, failure.value);
}

test "staged repository evidence follows failure mutation pass and revokes later failure" {
    const h = try Harness(.observe).init();
    defer h.deinit();
    const allowed = try Harness(.final_allowed).init();
    defer allowed.deinit();
    var owner = try h.run(.{ .memory = policy.initial, .observation = .{ .run_tests = testResult(true) } });
    defer owner.deinit();
    try testing.expect(!owner.value.passing_test_observed);
    const observations = [_]t.Observation{ .{ .run_tests = testResult(false) }, .{ .replace_file = applied() }, .{ .run_tests = testResult(true) }, .{ .run_tests = testResult(false) } };
    for (observations, 0..) |observation, i| {
        const next = try h.run(.{ .memory = owner.value, .observation = observation });
        owner.deinit();
        owner = next;
        try testing.expect(owner.value.failing_test_observed);
        try testing.expectEqual(i >= 1, owner.value.mutation_applied);
        try testing.expectEqual(i >= 1, owner.value.applied_source != null);
        if (owner.value.applied_source) |source| {
            try testing.expectEqualStrings("src/range.mjs", source.path.bytes);
            try testing.expectEqualStrings(new_digest, source.sha256.bytes);
        }
        try testing.expectEqual(i == 2, owner.value.passing_test_observed);
        var result = try allowed.run(.{ .memory = owner.value, .result = final_result });
        defer result.deinit();
        try testing.expectEqual(i == 2, result.value);
    }
    try testing.expect(!owner.value.latest_test.?.stdout_truncated);
}

test "staged denial preserves evidence and conflict invalidates source search and passing" {
    const h = try Harness(.observe).init();
    defer h.deinit();
    var memory = policy.initial;
    memory.source_document = read(.source, 1);
    memory.latest_search = .{ .hits = .{ .items = &.{} }, .truncated = false };
    memory.failing_test_observed = true;
    memory.mutation_applied = true;
    memory.passing_test_observed = true;
    memory.replacement = applied();
    memory.applied_source = .{
        .path = .{ .bytes = "src/range.mjs" },
        .sha256 = .{ .bytes = new_digest },
    };
    var denied = try h.run(.{ .memory = memory, .observation = .{ .replace_file = .{ .denied = .{ .reason = .{ .bytes = "denied" } } } } });
    defer denied.deinit();
    try testing.expect(denied.value.passing_test_observed and denied.value.mutation_applied);
    try testing.expect(denied.value.source_document != null and denied.value.latest_search != null);
    try testing.expect(denied.value.replacement.? == .denied);
    try testing.expectEqualStrings(new_digest, denied.value.applied_source.?.sha256.bytes);
    var conflicted = try h.run(.{ .memory = denied.value, .observation = .{ .replace_file = .{ .conflict = .{ .path = .{ .bytes = "src/range.mjs" }, .expected_sha256 = .{ .bytes = old_digest }, .actual_sha256 = .{ .bytes = new_digest } } } } });
    defer conflicted.deinit();
    try testing.expect(conflicted.value.mutation_applied and conflicted.value.failing_test_observed);
    try testing.expect(!conflicted.value.passing_test_observed);
    try testing.expect(conflicted.value.source_document == null and conflicted.value.latest_search == null);
    try testing.expect(conflicted.value.applied_source == null);
}

test "staged final guard requires all four independent evidence flags" {
    const h = try Harness(.final_allowed).init();
    defer h.deinit();
    for (0..16) |bits| {
        var memory = policy.initial;
        memory.failing_test_observed = bits & 1 != 0;
        memory.mutation_applied = bits & 2 != 0;
        memory.passing_test_observed = bits & 4 != 0;
        var result = final_result;
        result.tests_passed = bits & 8 != 0;
        var allowed = try h.run(.{ .memory = memory, .result = result });
        defer allowed.deinit();
        try testing.expectEqual(bits == 15, allowed.value);
    }
}

const Trace = struct {
    pub fn emit(c: agent.Context) !boundary.computation.Module {
        const b = c.builder;
        const functions = try policy.define(c);
        const memory = try c.schema(t.Memory);
        const integer = try c.schema(u64);
        const effect = try c.external("repository.working-set.observe.v1", try c.schema(t.DecisionView), try c.schema(t.Observation), .read);
        const loop = try b.declare(&.{ memory, integer }, memory, &.{effect}, &.{});
        const current = try b.reference(b.parameter(loop, 0));
        const remaining = try b.reference(b.parameter(loop, 1));
        const view = try b.variable(try c.schema(t.DecisionView));
        const observation = try b.variable(try c.schema(t.Observation));
        const updated = try b.variable(memory);
        const decrement = try b.value(.{ .schema = integer, .expression = .{ .primitive = .{
            .opcode = .integer_sub,
            .operands = &.{ remaining, try c.literal(u64, 1) },
            .failures = &.{.{ .kind = .arithmetic_overflow, .value = try b.failureLiteral(try c.literal(t.Failure, .arithmetic_overflow)) }},
        } } });
        const next = try b.term(.{ .call = .{ .function = loop, .arguments = &.{ try b.reference(updated), decrement } } });
        const folded = try b.bind(updated, try b.term(.{ .call = .{ .function = functions.observe, .arguments = &.{ current, try b.reference(observation) } } }), next);
        const observed = try b.bind(observation, try b.term(.{ .perform = .{ .effect = effect, .payload = try b.reference(view) } }), folded);
        const projected = try b.bind(view, try b.term(.{ .call = .{ .function = functions.project, .arguments = &.{current} } }), observed);
        try b.define(loop, try b.term(.{ .conditional = .{
            .condition = try b.primitive(try c.schema(bool), .equal, &.{ remaining, try c.literal(u64, 0) }, 0),
            .when_true = try b.term(.{ .fail = try c.literal(t.Failure, .budget_exhausted) }),
            .when_false = projected,
        } }));
        const entry = try b.declare(&.{try c.schema(void)}, memory, &.{effect}, &.{});
        try b.define(entry, try b.term(.{ .call = .{ .function = loop, .arguments = &.{ try c.literal(t.Memory, policy.initial), try c.literal(u64, 32) } } }));
        return b.module(entry, try c.schema(t.Failure));
    }
};

fn traceObservation(index: usize) t.Observation {
    const step = if (index < 11) index else (index - 11) % 6;
    return switch (step) {
        0 => .{ .list_repository = .{ .entries = .{ .items = &.{ .{ .path = .{ .bytes = "src/range.mjs" }, .kind = .file }, .{ .path = .{ .bytes = "test/range.mjs" }, .kind = .file } } }, .truncated = false } },
        1 => .{ .read_file = read(.package, 0) },
        2, 8 => .{ .read_file = read(.source, 1) },
        3 => .{ .read_file = read(.@"test", 2) },
        4, 9 => .{ .search_text = .{ .hits = .{ .items = &.{.{ .path = .{ .bytes = "src/range.mjs" }, .line = 7, .excerpt = .{ .bytes = "0123456789abcdef" } }} }, .truncated = false } },
        5, 10 => .{ .run_tests = testResult(true) },
        6 => .{ .run_tests = testResult(false) },
        7 => .{ .replace_file = applied() },
        else => unreachable,
    };
}

test "repository working set survives 32 portable observations with bounded history" {
    const a = testing.allocator;
    const protocol = boundary.data.invocation;
    var compiled = try agent.compile(a, agent.system(.{ .InitialArgs = void, .Result = t.Memory, .Failure = t.Failure, .application = Trace }));
    defer compiled.deinit();
    const image = try a.alloc(u8, try boundary.data.program_image.encodedLength(compiled.program));
    defer a.free(image);
    _ = try compiled.encode(a, image);
    var outcome = try world.invocation.invoke(a, .{ .image = image, .instance = .{ .initial_args = &.{} } });
    defer outcome.deinit();
    var saturated: usize = 0;
    for (0..32) |index| {
        try testing.expect(outcome.record == .requested);
        const pending = outcome.record.requested;
        try testing.expect(pending.state.?.len <= 384 * 1024);
        if (index == 11) saturated = pending.state.?.len;
        if (index >= 11) try testing.expect(pending.state.?.len <= saturated + 4096);
        var request = try protocol.decode(protocol.Request, a, pending.request);
        defer request.deinit();
        var view = try agent.contracts.decodeOwned(t.DecisionView, a, request.value.binding.payload);
        defer view.deinit();
        if (index == 7) try testing.expect(view.value.evidence.failing_test_observed and !view.value.evidence.passing_test_observed);
        if (index == 8) {
            try testing.expect(view.value.evidence.mutation_applied and !view.value.evidence.passing_test_observed);
            try testing.expect(view.value.source_document == null and view.value.latest_search == null);
        }
        if (index >= 11) {
            try testing.expect(view.value.evidence.failing_test_observed and view.value.evidence.mutation_applied and view.value.evidence.passing_test_observed);
            try testing.expect(view.value.source_document != null and view.value.latest_search != null);
        }
        const observation = try agent.contracts.encodeOwned(t.Observation, a, traceObservation(index));
        defer a.free(observation);
        const reply = try protocol.encodeOwned(protocol.Result, a, .{ .request_identity = request.value.request_identity, .value = observation });
        defer a.free(reply);
        const next = try world.invocation.invoke(a, .{ .image = image, .instance = .{ .state = pending.state.? }, .control = .{ .reply = reply } });
        outcome.deinit();
        outcome = next;
    }
    try testing.expect(outcome.record == .failed);
    var failure = try agent.contracts.decodeOwned(t.Failure, a, outcome.record.failed.value);
    defer failure.deinit();
    try testing.expectEqual(t.Failure.budget_exhausted, failure.value);
}
