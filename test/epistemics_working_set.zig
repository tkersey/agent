const std = @import("std");
const boundary = @import("boundary");
const actuality = @import("repository_repair_actuality");

const Machine = actuality.Machine;
const Cycle = struct {
    view: actuality.DecisionView,
    state_bytes: usize,
};

test "repository working set resource shapes remain inspectable" {
    try std.testing.expect(@sizeOf(Machine.FrameType) <= 640 * 1024);
    try std.testing.expect(@sizeOf(actuality.Memory) <= 128 * 1024);
    try std.testing.expect(@sizeOf(actuality.DecisionView) <= 128 * 1024);
    try std.testing.expect(@sizeOf(actuality.TestResult) <= 9 * 1024);
    try std.testing.expect(@sizeOf(actuality.CompactTestResult) <= 16);
}

noinline fn resumeRequest(state: *Machine.State, request: Machine.Request, value: anytype) !void {
    const prepared = try Machine.prepareResume(state.*, request);
    defer Machine.deinitPreparedResume(prepared);
    try Machine.@"resume"(prepared, value);
}

noinline fn nextRequest(state: Machine.State) !Machine.Request {
    var fuel: u64 = 200_000;
    return switch (try Machine.step(state, &fuel)) {
        .request => |request| request,
        .failed => |failure| {
            std.debug.print("machine failed before request: {any}\n", .{failure});
            return error.MachineFailedBeforeRequest;
        },
        .yielded => {
            std.debug.print("machine yielded before request with {d} fuel left\n", .{fuel});
            return error.MachineYieldedBeforeRequest;
        },
        .done => return error.MachineCompletedBeforeRequest,
    };
}

noinline fn canonicalStateBytes(state: Machine.State) !usize {
    const canonical = try Machine.encodeState(std.testing.allocator, state);
    defer std.testing.allocator.free(canonical);
    return canonical.len;
}

noinline fn driveEffect(
    state: *Machine.State,
    action: actuality.Action,
    result: anytype,
) !Cycle {
    const decision = try nextRequest(state.*);
    const view = switch (decision.value) {
        .s0 => |turn| turn.context,
        else => return error.ExpectedDecisionSite,
    };
    resumeRequest(state, decision, action) catch |err| {
        std.debug.print("decision resume error: {s}\n", .{@errorName(err)});
        return err;
    };
    const effect = nextRequest(state.*) catch |err| {
        std.debug.print("effect request error: {s}\n", .{@errorName(err)});
        return err;
    };
    resumeRequest(state, effect, result) catch |err| {
        std.debug.print("effect resume error: {s}\n", .{@errorName(err)});
        return err;
    };

    return .{
        .view = view,
        .state_bytes = canonicalStateBytes(state.*) catch return error.StateEncodeFailed,
    };
}

fn digest() !actuality.DigestHex {
    return actuality.DigestHex.fromSlice(
        "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
    );
}

fn listing() !actuality.ListResult {
    var entries = boundary.Vector(actuality.CompactTreeEntry, 32).empty();
    try entries.push(.{
        .path = try actuality.Path.fromSlice("src/range.mjs"),
        .kind = .file,
    });
    try entries.push(.{
        .path = try actuality.Path.fromSlice("test/range.mjs"),
        .kind = .file,
    });
    return .{ .entries = entries, .truncated = false };
}

fn readResult(role: actuality.DocumentRole) !actuality.ReadResult {
    const path = switch (role) {
        .package => "package.json",
        .source => "src/range.mjs",
        .@"test" => "test/range.mjs",
    };
    return .{
        .role = role,
        .role_code = @intFromEnum(role),
        .path = try actuality.Path.fromSlice(path),
        .sha256 = try digest(),
        .contents = try actuality.FileText.fromSlice("0123456789abcdef"),
    };
}

fn searchResult() !actuality.SearchResult {
    var hits = boundary.Vector(actuality.SearchHit, 8).empty();
    try hits.push(.{
        .path = try actuality.Path.fromSlice("src/range.mjs"),
        .line = 7,
        .excerpt = try actuality.ExcerptText.fromSlice("0123456789abcdef"),
    });
    return .{ .hits = hits, .truncated = false };
}

fn testResult(passed: bool) !actuality.TestResult {
    return .{
        .exit_code = if (passed) 0 else 1,
        .passed = passed,
        .stdout = try actuality.ProcessText.fromSlice("0123456789abcdef"),
        .stderr = try actuality.ProcessText.fromSlice("fedcba9876543210"),
        .stdout_truncated = false,
        .stderr_truncated = false,
    };
}

fn replacement() !actuality.ReplaceOutcome {
    return .{ .applied = .{
        .path = try actuality.Path.fromSlice("src/range.mjs"),
        .old_sha256 = try digest(),
        .new_sha256 = try actuality.DigestHex.fromSlice(
            "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789",
        ),
        .already_applied = false,
    } };
}

fn actionForRead(role: actuality.DocumentRole) !actuality.Action {
    const path = switch (role) {
        .package => "package.json",
        .source => "src/range.mjs",
        .@"test" => "test/range.mjs",
    };
    return .{ .read_file = .{
        .role = role,
        .path = try actuality.Path.fromSlice(path),
    } };
}

noinline fn runOne(state: *Machine.State, index: usize) !Cycle {
    return switch (index) {
        0 => driveEffect(state, .{ .list_repository = {} }, try listing()),
        1 => driveEffect(state, try actionForRead(.package), try readResult(.package)),
        2 => driveEffect(state, try actionForRead(.source), try readResult(.source)),
        3 => driveEffect(state, try actionForRead(.@"test"), try readResult(.@"test")),
        4 => driveEffect(state, .{ .search_text = .{
            .query = try actuality.QueryText.fromSlice("range"),
            .path_prefix = try actuality.Path.fromSlice("src"),
        } }, try searchResult()),
        5 => driveEffect(state, .{ .run_tests = .{ .suite = .default } }, try testResult(true)),
        6 => driveEffect(state, .{ .run_tests = .{ .suite = .default } }, try testResult(false)),
        7 => driveEffect(state, .{ .replace_file = .{
            .path = try actuality.Path.fromSlice("src/range.mjs"),
            .expected_sha256 = try digest(),
            .replacement = try actuality.FileText.fromSlice("0123456789abcdef"),
            .rationale = try actuality.SummaryText.fromSlice("0123456789abcdef"),
        } }, try replacement()),
        8 => driveEffect(state, try actionForRead(.source), try readResult(.source)),
        9 => driveEffect(state, .{ .search_text = .{
            .query = try actuality.QueryText.fromSlice("range"),
            .path_prefix = try actuality.Path.fromSlice("src"),
        } }, try searchResult()),
        10 => driveEffect(state, .{ .run_tests = .{ .suite = .default } }, try testResult(true)),
        else => switch ((index - 11) % 6) {
            0 => driveEffect(state, .{ .list_repository = {} }, try listing()),
            1 => driveEffect(state, try actionForRead(.package), try readResult(.package)),
            2 => driveEffect(state, try actionForRead(.source), try readResult(.source)),
            3 => driveEffect(state, try actionForRead(.@"test"), try readResult(.@"test")),
            4 => driveEffect(state, .{ .search_text = .{
                .query = try actuality.QueryText.fromSlice("range"),
                .path_prefix = try actuality.Path.fromSlice("src"),
            } }, try searchResult()),
            5 => driveEffect(state, .{ .run_tests = .{ .suite = .default } }, try testResult(true)),
            else => unreachable,
        },
    };
}

test "repository working set folds roles, clears stale data, and saturates for 32 effects" {
    const goal = actuality.Goal{
        .task = try actuality.GoalText.fromSlice("repair fixture"),
        .repository = try boundary.Text(128).fromSlice("fixture"),
    };
    var state = try Machine.initialState(std.testing.allocator, goal);
    defer Machine.deinitState(state);

    var saturation_bytes: usize = 0;
    var post_saturation_peak: usize = 0;
    for (0..32) |index| {
        const cycle = runOne(&state, index) catch |err| {
            std.debug.print("working-set trace failed at effect {d}: {s}\n", .{
                index,
                @errorName(err),
            });
            return err;
        };
        try std.testing.expect(cycle.state_bytes <= 384 * 1024);

        if (index == 6) {
            try std.testing.expect(!cycle.view.evidence.passing_test_observed);
        } else if (index == 8) {
            try std.testing.expect(cycle.view.evidence.failing_test_observed);
            try std.testing.expect(cycle.view.evidence.mutation_applied);
            try std.testing.expect(!cycle.view.evidence.passing_test_observed);
            try std.testing.expect(cycle.view.source_document == null);
            try std.testing.expect(cycle.view.latest_search == null);
        } else if (index == 11) {
            try std.testing.expect(cycle.view.evidence.failing_test_observed);
            try std.testing.expect(cycle.view.evidence.mutation_applied);
            try std.testing.expect(cycle.view.evidence.passing_test_observed);
            try std.testing.expect(cycle.view.source_document != null);
            try std.testing.expect(cycle.view.latest_search != null);
        }

        if (index == 10) saturation_bytes = cycle.state_bytes;
        if (index >= 10) post_saturation_peak = @max(post_saturation_peak, cycle.state_bytes);
    }

    try std.testing.expect(post_saturation_peak <= saturation_bytes + 4096);
    var fuel: u64 = 200_000;
    switch (try Machine.step(state, &fuel)) {
        .failed => |failure| switch (failure) {
            .authored => |authored| try std.testing.expectEqual(
                actuality.Failure.budget_exhausted,
                authored,
            ),
            else => return error.ExpectedAuthoredBudgetFailure,
        },
        else => return error.ExpectedBudgetTermination,
    }
}

test "repository working set admits final result only after failing mutation passing evidence" {
    const goal = actuality.Goal{
        .task = try actuality.GoalText.fromSlice("repair fixture"),
        .repository = try boundary.Text(128).fromSlice("fixture"),
    };
    var state = try Machine.initialState(std.testing.allocator, goal);
    defer Machine.deinitState(state);

    for (0..11) |index| _ = try runOne(&state, index);

    var changed_files = boundary.Vector(actuality.Path, 4).empty();
    try changed_files.push(try actuality.Path.fromSlice("src/range.mjs"));
    const result = actuality.FinalResult{
        .summary = try actuality.SummaryText.fromSlice("repaired fixture"),
        .changed_files = changed_files,
        .tests_passed = true,
        .final_source_sha256 = try digest(),
    };
    const decision = try nextRequest(state);
    try resumeRequest(&state, decision, actuality.Action{ .final = result });
    var fuel: u64 = 200_000;
    const done = switch (try Machine.step(state, &fuel)) {
        .done => |owned| owned,
        else => return error.ExpectedFinalResult,
    };
    defer done.deinit();
    try std.testing.expectEqual(true, done.value().tests_passed);
    try std.testing.expectEqual(@as(u32, 1), done.value().changed_files.len());
}
