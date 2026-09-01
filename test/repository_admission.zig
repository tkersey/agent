const boundary = @import("boundary");
const std = @import("std");

const ImageBytes = @embedFile("repository-system.bpi1");
const InitialArgs = @embedFile("repository-system-initial.bin");
const ProgramTransitionDigest = ImageBytes[32..64].*;

const repository = struct {
    pub const Path = boundary.Text(256);
    pub const Digest = boundary.Text(64);
    pub const FileText = boundary.Text(4 * 1024);
    pub const EvidenceText = boundary.Text(2 * 1024);
    pub const Summary = boundary.Text(1024);
    pub const ListResult = struct { listing: EvidenceText };
    pub const ReadResult = struct {
        role: u8,
        path: Path,
        sha256: Digest,
        contents: FileText,
    };
    pub const TestResult = struct {
        passed: bool,
        output: EvidenceText,
    };
    pub const ReplaceResult = struct {
        applied: bool,
        path: Path,
        old_sha256: Digest,
        new_sha256: Digest,
        detail: Summary,
    };
    pub const Failure = enum {
        arithmetic_overflow,
        capacity_exceeded,
        invalid_index,
        invalid_utf8,
        malformed,
        invalid_variant,
        incomplete,
        response_error,
        unsupported,
        multiple_calls,
        refusal,
        unknown_action,
        transport,
        http,
        policy_denied,
    };
};

const Protocol = struct {
    pub const semantic_identity = "agent.model.openai.responses.v1";
    pub const ResponseBody = boundary.Bytes(32 * 1024);
    pub const TransportFailureKind = enum {
        unavailable,
        denied,
        interrupted,
        response_too_large,
    };
    pub const Response = union(enum) {
        response: struct {
            http_status: u16,
            body: ResponseBody,
        },
        transport_failure: struct {
            kind: TransportFailureKind,
        },
    };
};
const Storage = boundary.process_v1.CapacityStorage(.{
    .input = 1024 * 1024,
    .output = 1024 * 1024,
    .state = 256 * 1024,
    .value = 128 * 1024,
    .request = 128 * 1024,
    .environment = 256 * 1024,
    .scratch = 4 * 1024 * 1024,
});

const initial_digest = "8832f65e4bcf4a701dc76f310f3af34296bf8e95feb16ad70608041cb2e6dbb3";
const replacement_digest = "8bf50f62e3a4294ef359a6b9096d66e5597ce37824b3483ddad541ee21438453";

fn expectSha256(bytes: []const u8, expected: []const u8) !void {
    var digest: [32]u8 = undefined;
    std.crypto.hash.sha2.Sha256.hash(bytes, &digest, .{});
    const actual = std.fmt.bytesToHex(digest, .lower);
    try std.testing.expectEqualStrings(expected, &actual);
}

const Pending = struct {
    state: []u8,
    request: []u8,

    fn deinit(self: @This()) void {
        std.testing.allocator.free(self.state);
        std.testing.allocator.free(self.request);
    }

    fn effect(self: @This()) !boundary.process_v1.EffectRequest {
        return boundary.process_v1.effect.validateRequest(
            self.request,
            ProgramTransitionDigest,
        );
    }
};

fn advanceToRequest(
    instance: boundary.process_v1.Instance,
    effect_result: ?[]const u8,
) !Pending {
    const allocator = std.testing.allocator;
    const storage = try allocator.create(Storage);
    defer allocator.destroy(storage);
    storage.* = .{};
    const workspace = try allocator.create(boundary.image.ValidationWorkspace);
    defer allocator.destroy(workspace);
    workspace.* = .{};
    const state_work = try allocator.alloc(u8, 256 * 1024);
    defer allocator.free(state_work);
    var current = instance;
    var result = effect_result;
    for (0..8192) |_| {
        workspace.* = .{};
        const outcome = try storage.advance(ImageBytes, current, result, workspace);
        result = null;
        switch (outcome) {
            .progressed, .explicitly_yielded => |state| {
                if (state.len > state_work.len) return error.StateCapacity;
                @memcpy(state_work[0..state.len], state);
                current = .{ .process_state = state_work[0..state.len] };
            },
            .requested => |requested| return .{
                .state = try allocator.dupe(u8, requested.state),
                .request = try allocator.dupe(u8, requested.request),
            },
            .completed, .authored_failure, .needs_capacity => return error.UnexpectedOutcome,
        }
    }
    return error.DidNotConverge;
}

fn advanceOneState(
    instance: boundary.process_v1.Instance,
    effect_result: ?[]const u8,
) ![]u8 {
    const allocator = std.testing.allocator;
    const storage = try allocator.create(Storage);
    defer allocator.destroy(storage);
    storage.* = .{};
    const workspace = try allocator.create(boundary.image.ValidationWorkspace);
    defer allocator.destroy(workspace);
    workspace.* = .{};
    const outcome = try storage.advance(ImageBytes, instance, effect_result, workspace);
    return switch (outcome) {
        .progressed, .explicitly_yielded => |state| allocator.dupe(u8, state),
        else => error.ExpectedInternalState,
    };
}

fn advanceToFailure(state: []const u8, effect_result: []const u8) !repository.Failure {
    const allocator = std.testing.allocator;
    const storage = try allocator.create(Storage);
    defer allocator.destroy(storage);
    storage.* = .{};
    const workspace = try allocator.create(boundary.image.ValidationWorkspace);
    defer allocator.destroy(workspace);
    workspace.* = .{};
    const state_work = try allocator.alloc(u8, 256 * 1024);
    defer allocator.free(state_work);
    @memcpy(state_work[0..state.len], state);
    var current: boundary.process_v1.Instance = .{
        .process_state = state_work[0..state.len],
    };
    var result: ?[]const u8 = effect_result;
    for (0..8192) |_| {
        workspace.* = .{};
        const outcome = try storage.advance(ImageBytes, current, result, workspace);
        result = null;
        switch (outcome) {
            .progressed, .explicitly_yielded => |next| {
                if (next.len > state_work.len) return error.StateCapacity;
                @memcpy(state_work[0..next.len], next);
                current = .{ .process_state = state_work[0..next.len] };
            },
            .authored_failure => |failure| return boundary.schema.decodeExact(
                repository.Failure,
                failure,
            ),
            .requested => return error.ForbiddenExternalEffect,
            .completed => return error.ForbiddenCompletion,
            .needs_capacity => return error.UnexpectedCapacity,
        }
    }
    return error.DidNotConverge;
}

fn advanceToCompletion(state: []const u8, effect_result: []const u8) ![]u8 {
    const allocator = std.testing.allocator;
    const storage = try allocator.create(Storage);
    defer allocator.destroy(storage);
    storage.* = .{};
    const workspace = try allocator.create(boundary.image.ValidationWorkspace);
    defer allocator.destroy(workspace);
    workspace.* = .{};
    const state_work = try allocator.alloc(u8, 256 * 1024);
    defer allocator.free(state_work);
    @memcpy(state_work[0..state.len], state);
    var current: boundary.process_v1.Instance = .{
        .process_state = state_work[0..state.len],
    };
    var result: ?[]const u8 = effect_result;
    for (0..8192) |_| {
        workspace.* = .{};
        const outcome = try storage.advance(ImageBytes, current, result, workspace);
        result = null;
        switch (outcome) {
            .progressed, .explicitly_yielded => |next| {
                if (next.len > state_work.len) return error.StateCapacity;
                @memcpy(state_work[0..next.len], next);
                current = .{ .process_state = state_work[0..next.len] };
            },
            .completed => |completed| return allocator.dupe(u8, completed),
            .authored_failure => return error.UnexpectedFailure,
            .requested => return error.ForbiddenExternalEffect,
            .needs_capacity => return error.UnexpectedCapacity,
        }
    }
    return error.DidNotConverge;
}

fn encodeResume(
    comptime T: type,
    request: boundary.process_v1.EffectRequest,
    value: T,
    resume_output: []u8,
    result_output: []u8,
) ![]const u8 {
    const resume_len = try boundary.schema.encode(T, value, resume_output);
    return boundary.process_v1.effect.encodeResult(.{
        .request_identity_digest = request.request_identity_digest,
        .resume_schema_digest = request.resume_schema_digest,
        .@"resume" = resume_output[0..resume_len],
    }, result_output);
}

fn encodeModel(
    request: boundary.process_v1.EffectRequest,
    provider_json: []const u8,
    resume_output: []u8,
    result_output: []u8,
) ![]const u8 {
    return encodeResume(
        Protocol.Response,
        request,
        .{ .response = .{
            .http_status = 200,
            .body = try Protocol.ResponseBody.fromSlice(provider_json),
        } },
        resume_output,
        result_output,
    );
}

fn providerJson(name: []const u8, arguments_json: []const u8) ![]u8 {
    var output: std.Io.Writer.Allocating = .init(std.testing.allocator);
    errdefer output.deinit();
    try output.writer.writeAll(
        "{\"status\":\"completed\",\"error\":null,\"output\":[{" ++
            "\"type\":\"function_call\",\"status\":\"completed\",\"name\":",
    );
    try std.json.Stringify.value(name, .{}, &output.writer);
    try output.writer.writeAll(",\"arguments\":");
    try std.json.Stringify.value(arguments_json, .{}, &output.writer);
    try output.writer.writeAll("}]}");
    return output.toOwnedSlice();
}

fn expectPolicyFailure(label: []const u8, state: []const u8, result: []const u8) !void {
    const actual = try advanceToFailure(state, result);
    if (actual != repository.Failure.policy_denied) {
        std.debug.print("{s}: expected policy_denied, observed {s}\n", .{
            label,
            @tagName(actual),
        });
    }
    try std.testing.expectEqual(repository.Failure.policy_denied, actual);
    var failure_bytes: [boundary.schema.maximumEncodedSize(repository.Failure)]u8 = undefined;
    const failure_len = try boundary.schema.encode(
        repository.Failure,
        actual,
        &failure_bytes,
    );
    try expectSha256(
        failure_bytes[0..failure_len],
        "01b4f6bd5d6a06a7b74a8565ceb4f845afe0ae96a0ac05cf5e86066bf7b538ec",
    );
}

fn expectIdentity(pending: Pending, expected: []const u8) !boundary.process_v1.EffectRequest {
    const request = try pending.effect();
    try std.testing.expectEqualStrings(expected, request.effect_semantic_identity);
    return request;
}

test "repository admission rejects stale mutation and false completion from current State" {
    var resume_bytes: [128 * 1024]u8 = undefined;
    var result_bytes: [256 * 1024]u8 = undefined;

    const model0 = try advanceToRequest(.{
        .initial_args = InitialArgs,
    }, null);
    defer model0.deinit();
    try expectSha256(
        model0.state,
        "470b36ca934e9aa213b365f3763121a04614a1f79f0ab35b4392e7f3bdaccedf",
    );
    try expectSha256(
        model0.request,
        "825168cfe4332afd5c34bf5ef4015d56c6a7c22c1319a9688075f316bbf66066",
    );
    const model0_request = try expectIdentity(
        model0,
        Protocol.semantic_identity,
    );
    const list_json = try providerJson("list_repository", "{}");
    defer std.testing.allocator.free(list_json);
    const list_result = try encodeModel(
        model0_request,
        list_json,
        &resume_bytes,
        &result_bytes,
    );
    const parser_state = try advanceOneState(
        .{ .process_state = model0.state },
        list_result,
    );
    defer std.testing.allocator.free(parser_state);
    try expectSha256(
        parser_state,
        "684c2abc8e7a402a7072d55bf80301737ac6b5bf59317a838c8ddb0f2e64f022",
    );
    const list = try advanceToRequest(.{ .process_state = parser_state }, null);
    defer list.deinit();
    try expectSha256(
        list.state,
        "f81cad473d9e40933f09beedd7e232abefa839baa04a3a042deaa23e8b770a16",
    );
    try expectSha256(
        list.request,
        "2f87063f80f4aa9e68984ab33c886337ed68a5ea8117724354480c9bccc3ef7f",
    );
    const list_request = try expectIdentity(list, "repo.list.v1");
    const listing_result = try encodeResume(
        repository.ListResult,
        list_request,
        .{ .listing = try repository.EvidenceText.fromSlice("src/range.mjs") },
        &resume_bytes,
        &result_bytes,
    );
    const model1 = try advanceToRequest(.{ .process_state = list.state }, listing_result);
    defer model1.deinit();
    const model1_request = try expectIdentity(
        model1,
        Protocol.semantic_identity,
    );
    const read_json = try providerJson("read_file", "{\"role\":1}");
    defer std.testing.allocator.free(read_json);
    const read_action = try encodeModel(
        model1_request,
        read_json,
        &resume_bytes,
        &result_bytes,
    );
    const read = try advanceToRequest(.{ .process_state = model1.state }, read_action);
    defer read.deinit();
    const read_request = try expectIdentity(read, "repo.read.v1");
    const read_result = try encodeResume(
        repository.ReadResult,
        read_request,
        .{
            .role = 1,
            .path = try repository.Path.fromSlice("src/range.mjs"),
            .sha256 = try repository.Digest.fromSlice(initial_digest),
            .contents = try repository.FileText.fromSlice("buggy source"),
        },
        &resume_bytes,
        &result_bytes,
    );
    const model2 = try advanceToRequest(.{ .process_state = read.state }, read_result);
    defer model2.deinit();
    const model2_request = try expectIdentity(
        model2,
        Protocol.semantic_identity,
    );
    const test_json = try providerJson("run_tests", "{}");
    defer std.testing.allocator.free(test_json);
    const test_action = try encodeModel(
        model2_request,
        test_json,
        &resume_bytes,
        &result_bytes,
    );
    const baseline_test = try advanceToRequest(.{ .process_state = model2.state }, test_action);
    defer baseline_test.deinit();
    const baseline_request = try expectIdentity(baseline_test, "repo.test.v1");
    const baseline_result = try encodeResume(
        repository.TestResult,
        baseline_request,
        .{ .passed = false, .output = try repository.EvidenceText.fromSlice("failed") },
        &resume_bytes,
        &result_bytes,
    );
    const pre_replace = try advanceToRequest(.{ .process_state = baseline_test.state }, baseline_result);
    defer pre_replace.deinit();
    const pre_replace_request = try expectIdentity(
        pre_replace,
        Protocol.semantic_identity,
    );

    const stale_json = try providerJson(
        "replace_file",
        "{\"path\":\"src/range.mjs\"," ++
            "\"expected_sha256\":\"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb\"," ++
            "\"replacement\":\"fixed\",\"rationale\":\"stale\"}",
    );
    defer std.testing.allocator.free(stale_json);
    const stale_replace = try encodeModel(
        pre_replace_request,
        stale_json,
        &resume_bytes,
        &result_bytes,
    );
    try expectPolicyFailure("stale digest", pre_replace.state, stale_replace);

    const valid_replace_json = try providerJson(
        "replace_file",
        "{\"path\":\"src/range.mjs\"," ++
            "\"expected_sha256\":\"8832f65e4bcf4a701dc76f310f3af34296bf8e95feb16ad70608041cb2e6dbb3\"," ++
            "\"replacement\":\"fixed\",\"rationale\":\"repair\"}",
    );
    defer std.testing.allocator.free(valid_replace_json);
    const valid_replace = try encodeModel(
        pre_replace_request,
        valid_replace_json,
        &resume_bytes,
        &result_bytes,
    );
    const replace = try advanceToRequest(.{ .process_state = pre_replace.state }, valid_replace);
    defer replace.deinit();
    const replace_request = try expectIdentity(replace, "repo.replace.approved.v1");
    const replace_result = try encodeResume(
        repository.ReplaceResult,
        replace_request,
        .{
            .applied = true,
            .path = try repository.Path.fromSlice("src/range.mjs"),
            .old_sha256 = try repository.Digest.fromSlice(initial_digest),
            .new_sha256 = try repository.Digest.fromSlice(replacement_digest),
            .detail = try repository.Summary.fromSlice("applied"),
        },
        &resume_bytes,
        &result_bytes,
    );
    const model3 = try advanceToRequest(.{ .process_state = replace.state }, replace_result);
    defer model3.deinit();
    const model3_request = try expectIdentity(
        model3,
        Protocol.semantic_identity,
    );
    const retest_json = try providerJson("run_tests", "{}");
    defer std.testing.allocator.free(retest_json);
    const retest_action = try encodeModel(
        model3_request,
        retest_json,
        &resume_bytes,
        &result_bytes,
    );
    const post_test = try advanceToRequest(.{ .process_state = model3.state }, retest_action);
    defer post_test.deinit();
    const post_test_request = try expectIdentity(post_test, "repo.test.v1");
    const pass_result = try encodeResume(
        repository.TestResult,
        post_test_request,
        .{ .passed = true, .output = try repository.EvidenceText.fromSlice("passed") },
        &resume_bytes,
        &result_bytes,
    );
    const ready_to_finish = try advanceToRequest(.{ .process_state = post_test.state }, pass_result);
    defer ready_to_finish.deinit();
    const finish_request = try expectIdentity(
        ready_to_finish,
        Protocol.semantic_identity,
    );

    const wrong_final_path_json = try providerJson(
        "finish",
        "{\"summary\":\"done\",\"changed_path\":\"test/range.test.mjs\"," ++
            "\"final_source_sha256\":\"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\"}",
    );
    defer std.testing.allocator.free(wrong_final_path_json);
    const wrong_final_path = try encodeModel(
        finish_request,
        wrong_final_path_json,
        &resume_bytes,
        &result_bytes,
    );
    try expectPolicyFailure("wrong final path", ready_to_finish.state, wrong_final_path);

    const wrong_final_digest_json = try providerJson(
        "finish",
        "{\"summary\":\"done\",\"changed_path\":\"src/range.mjs\"," ++
            "\"final_source_sha256\":\"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb\"}",
    );
    defer std.testing.allocator.free(wrong_final_digest_json);
    const wrong_final_digest = try encodeModel(
        finish_request,
        wrong_final_digest_json,
        &resume_bytes,
        &result_bytes,
    );
    try expectPolicyFailure("wrong final digest", ready_to_finish.state, wrong_final_digest);

    const valid_final_json = try providerJson(
        "finish",
        "{\"summary\":\"Corrected normalizeRange and verified the complete suite.\"," ++
            "\"changed_path\":\"src/range.mjs\"," ++
            "\"final_source_sha256\":\"8bf50f62e3a4294ef359a6b9096d66e5597ce37824b3483ddad541ee21438453\"}",
    );
    defer std.testing.allocator.free(valid_final_json);
    const valid_final = try encodeModel(
        finish_request,
        valid_final_json,
        &resume_bytes,
        &result_bytes,
    );
    const completed = try advanceToCompletion(ready_to_finish.state, valid_final);
    defer std.testing.allocator.free(completed);
    try expectSha256(
        completed,
        "36c4354afea674adb139253064d7d14563ab3296804ff7cbefbba508a93f1032",
    );
}
