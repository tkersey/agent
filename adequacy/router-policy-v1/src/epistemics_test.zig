const std = @import("std");
const boundary = @import("boundary");
const app = @import("router_policy_definition");

const Machine = app.Machine;

fn nextRequest(state: Machine.State) !Machine.Request {
    var fuel: u64 = 8_000_000;
    return switch (try Machine.step(state, &fuel)) {
        .request => |request| request,
        .failed => return error.MachineFailed,
        .yielded => return error.MachineYielded,
        .done => return error.MachineCompleted,
    };
}

fn resumeRequest(state: *Machine.State, request: Machine.Request, value: anytype) !void {
    const prepared = try Machine.prepareResume(state.*, request);
    defer Machine.deinitPreparedResume(prepared);
    try Machine.@"resume"(prepared, value);
}

fn decisionView(request: Machine.Request) !app.DecisionView {
    return switch (request.value) {
        .s0 => |turn| turn.context,
        else => error.ExpectedDecision,
    };
}

fn drive(state: *Machine.State, action: app.Action, result: anytype) !app.DecisionView {
    const decision = try nextRequest(state.*);
    const view = try decisionView(decision);
    try resumeRequest(state, decision, action);
    const effect = try nextRequest(state.*);
    try resumeRequest(state, effect, result);
    return view;
}

fn goal() !app.Goal {
    return .{
        .task = try app.GoalText.fromSlice("upgrade the controlled router fixture"),
        .repository = try boundary.Text(128).fromSlice("router-policy-v1"),
    };
}

fn digest(byte: u8) !app.DigestHex {
    var bytes: [64]u8 = undefined;
    @memset(&bytes, byte);
    return app.DigestHex.fromSlice(&bytes);
}

fn snapshot(slot: app.DocumentSlot, marker: u8) !app.DocumentSnapshot {
    return .{
        .slot = slot,
        .slot_code = app.slotCode(slot),
        .path = try app.Path.fromSlice(app.slotPath(slot)),
        .sha256 = try digest(marker),
        .contents = try app.FileText.fromSlice(&.{marker}),
    };
}

fn readAction(slot: app.DocumentSlot) !app.Action {
    return .{ .read_file = .{
        .slot = slot,
        .path = try app.Path.fromSlice(app.slotPath(slot)),
    } };
}

fn testResult(passed: bool) !app.TestResult {
    return .{
        .exit_code = if (passed) 0 else 1,
        .passed = passed,
        .output = try app.TestOutput.fromSlice(if (passed) "pass" else "fail"),
        .truncated = false,
    };
}

fn testAction() app.Action {
    return .{ .run_tests = .{ .suite = .default } };
}

fn replaceAction(slot: app.DocumentSlot, marker: u8) !app.Action {
    return .{ .replace_file = .{
        .slot = slot,
        .path = try app.Path.fromSlice(app.slotPath(slot)),
        .expected_sha256 = try digest(marker),
        .replacement = try app.FileText.fromSlice(&.{marker + 1}),
        .rationale = try app.SummaryText.fromSlice("bounded fixture replacement"),
    } };
}

fn applied(slot: app.DocumentSlot, marker: u8) !app.ReplaceOutcome {
    return .{ .applied = .{
        .slot = slot,
        .slot_code = app.slotCode(slot),
        .path = try app.Path.fromSlice(app.slotPath(slot)),
        .old_sha256 = try digest(marker),
        .new_sha256 = try digest(marker + 1),
        .already_applied = false,
        .current = try snapshot(slot, marker + 1),
    } };
}

fn changedFiles() !app.ChangedFiles {
    var paths = app.ChangedFiles.empty();
    inline for (.{
        app.DocumentSlot.methods_source,
        app.DocumentSlot.errors_source,
        app.DocumentSlot.router_source,
        app.DocumentSlot.index_source,
    }) |slot| try paths.push(try app.Path.fromSlice(app.slotPath(slot)));
    return paths;
}

test "document reads upsert by slot and reject a mismatched compact code" {
    var state = try Machine.initialState(std.testing.allocator, try goal());
    defer Machine.deinitState(state);

    _ = try drive(&state, try readAction(.methods_source), try snapshot(.methods_source, 'a'));
    _ = try drive(&state, try readAction(.methods_source), try snapshot(.methods_source, 'b'));
    const decision = try nextRequest(state);
    const view = try decisionView(decision);
    try std.testing.expectEqual(@as(u32, 1), view.documents.len());
    const retained = (try view.documents.get(0)).?;
    try std.testing.expectEqual(app.DocumentSlot.methods_source, retained.slot);
    try std.testing.expectEqualSlices(u8, "b", try retained.contents.slice());

    var invalid_state = try Machine.initialState(std.testing.allocator, try goal());
    defer Machine.deinitState(invalid_state);
    var invalid = try snapshot(.methods_source, 'a');
    invalid.slot_code = app.slotCode(.router_source);
    const first = try nextRequest(invalid_state);
    try resumeRequest(&invalid_state, first, try readAction(.methods_source));
    const read = try nextRequest(invalid_state);
    try resumeRequest(&invalid_state, read, invalid);
    var fuel: u64 = 8_000_000;
    switch (try Machine.step(invalid_state, &fuel)) {
        .failed => |failure| switch (failure) {
            .authored => |authored| try std.testing.expectEqual(app.Failure.invalid_variant, authored),
            else => return error.ExpectedAuthoredFailure,
        },
        else => return error.ExpectedSlotCodeFailure,
    }
}

test "applied replacement and conflict update epochs and the document set" {
    var state = try Machine.initialState(std.testing.allocator, try goal());
    defer Machine.deinitState(state);

    _ = try drive(&state, try readAction(.methods_source), try snapshot(.methods_source, 'a'));
    _ = try drive(&state, testAction(), try testResult(false));
    _ = try drive(&state, try replaceAction(.methods_source, 'a'), try applied(.methods_source, 'a'));
    var decision = try nextRequest(state);
    var view = try decisionView(decision);
    try std.testing.expect(view.evidence.baseline_failure_observed);
    try std.testing.expectEqual(@as(u32, 1), view.evidence.mutation_count);
    try std.testing.expect(!view.evidence.latest_test_passed);
    try std.testing.expectEqual(@as(u32, 0), view.evidence.last_test_mutation_count);
    try std.testing.expectEqual(@as(u32, 1), view.mutations.len());

    try resumeRequest(&state, decision, try replaceAction(.methods_source, 'b'));
    const replacement = try nextRequest(state);
    try resumeRequest(&state, replacement, app.ReplaceOutcome{ .conflict = .{
        .slot = .methods_source,
        .slot_code = app.slotCode(.methods_source),
        .path = try app.Path.fromSlice(app.slotPath(.methods_source)),
        .expected_sha256 = try digest('b'),
        .actual_sha256 = try digest('c'),
    } });
    decision = try nextRequest(state);
    view = try decisionView(decision);
    try std.testing.expectEqual(@as(u32, 0), view.documents.len());
    try std.testing.expectEqual(@as(u32, 1), view.evidence.mutation_count);
    try std.testing.expect(!view.evidence.latest_test_passed);
}

test "final admission requires four mutations and a fresh passing fourth test" {
    var state = try Machine.initialState(std.testing.allocator, try goal());
    defer Machine.deinitState(state);

    _ = try drive(&state, testAction(), try testResult(false));
    const slots = .{
        app.DocumentSlot.methods_source,
        app.DocumentSlot.errors_source,
        app.DocumentSlot.router_source,
        app.DocumentSlot.index_source,
    };
    inline for (slots, 0..) |slot, index| {
        const marker: u8 = 'a' + @as(u8, @intCast(index * 2));
        _ = try drive(&state, try replaceAction(slot, marker), try applied(slot, marker));
        _ = try drive(&state, testAction(), try testResult(index == 3));
    }

    const decision = try nextRequest(state);
    const view = try decisionView(decision);
    try std.testing.expect(view.evidence.baseline_failure_observed);
    try std.testing.expect(view.evidence.latest_test_passed);
    try std.testing.expectEqual(@as(u32, 4), view.evidence.mutation_count);
    try std.testing.expectEqual(@as(u32, 4), view.evidence.last_test_mutation_count);
    try std.testing.expectEqual(@as(u32, 5), view.evidence.test_count);

    const result = app.FinalResult{
        .summary = try app.SummaryText.fromSlice("router policy complete"),
        .changed_files = try changedFiles(),
        .tests_passed = true,
        .mutation_count = 4,
    };
    try resumeRequest(&state, decision, app.Action{ .final = result });
    var fuel: u64 = 8_000_000;
    const done = switch (try Machine.step(state, &fuel)) {
        .done => |owned| owned,
        else => return error.ExpectedFinalResult,
    };
    defer done.deinit();
    try std.testing.expectEqual(@as(u32, 4), done.value().mutation_count);
    try std.testing.expect(done.value().tests_passed);
}
