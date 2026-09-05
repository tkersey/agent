const boundary = @import("boundary");
const std = @import("std");

const ImageBytes = @embedFile("repository-system.bpi1");
const InitialArgs = @embedFile("repository-system-initial.bin");
const ProgramTransitionDigest = ImageBytes[32..64].*;

const agent = @import("agent");
const RepositorySystem = @import("repository_system").RepositoryRepairEconomySource(
    agent,
    boundary,
);
const repository = RepositorySystem;
// The image is already embedded above. Derive its protocol from the same source
// and profile factory without re-running the complete program compiler.
const ProductionModelProtocol = agent.protocol.modelInvokeV2.Profile(
    RepositorySystem.Source,
    RepositorySystem.Source.epistemics.PromptType(RepositorySystem.Source),
);
const ModelProtocol = struct {
    pub const semantic_identity = "agent.model.invoke.v2";
    pub const ArgumentsJson = ProductionModelProtocol.ArgumentsJsonType;
    pub const CallId = ProductionModelProtocol.CallIdType;
    pub const ToolName = ProductionModelProtocol.ToolNameType;
    pub const OutputItems = ProductionModelProtocol.OutputItemsType;
    pub const ModelResult = ProductionModelProtocol.ModelResultType;
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
    const digest = sha256(bytes);
    const actual = std.fmt.bytesToHex(digest, .lower);
    try std.testing.expectEqualStrings(expected, &actual);
}

fn sha256(bytes: []const u8) [32]u8 {
    var digest: [32]u8 = undefined;
    std.crypto.hash.sha2.Sha256.hash(bytes, &digest, .{});
    return digest;
}

const Pending = struct {
    state: []u8,
    request: []u8,

    fn deinit(self: @This()) void {
        std.heap.page_allocator.free(self.state);
        std.heap.page_allocator.free(self.request);
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
    const allocator = std.heap.page_allocator;
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
    const allocator = std.heap.page_allocator;
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
    const allocator = std.heap.page_allocator;
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
    const allocator = std.heap.page_allocator;
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
    name: []const u8,
    arguments_json: []const u8,
    resume_output: []u8,
    result_output: []u8,
) ![]const u8 {
    const decoded = try decodeFixtureAction(name, arguments_json);
    var items = ModelProtocol.OutputItems.empty();
    try items.push(.{ .function_call = .{
        .call_id = try ModelProtocol.CallId.fromSlice("fixture-call"),
        .name = try ModelProtocol.ToolName.fromSlice(name),
        .arguments_json = try ModelProtocol.ArgumentsJson.fromSlice(arguments_json),
        .tool_ordinal_claim = decoded.ordinal,
        .decoded_action = .{ .decoded = decoded.action },
    } });
    const items_len = try boundary.schema.encode(
        ModelProtocol.OutputItems,
        items,
        resume_output,
    );
    const normalized_output_digest = sha256(resume_output[0..items_len]);
    return encodeResume(
        ModelProtocol.ModelResult,
        request,
        .{ .output = .{
            .items = items,
            .normalized_output_digest = normalized_output_digest,
        } },
        resume_output,
        result_output,
    );
}

fn decodeFixtureAction(
    name: []const u8,
    arguments_json: []const u8,
) !struct { ordinal: u32, action: repository.Action } {
    if (std.mem.eql(u8, name, "list_repository")) {
        return .{ .ordinal = 0, .action = .{ .list_repository = .{} } };
    }
    if (std.mem.eql(u8, name, "run_tests")) {
        return .{ .ordinal = 3, .action = .{ .run_tests = .{} } };
    }
    if (std.mem.eql(u8, name, "read_file")) {
        return .{ .ordinal = 1, .action = .{ .read_file = .{ .role = 1 } } };
    }
    if (std.mem.eql(u8, name, "replace_file")) {
        return .{ .ordinal = 4, .action = .{ .replace_file = .{
            .path = try repository.Path.fromSlice("src/range.mjs"),
            .expected_sha256 = try repository.Digest.fromSlice(
                if (std.mem.indexOf(u8, arguments_json, initial_digest) != null)
                    initial_digest
                else
                    "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
            ),
            .replacement = try repository.FileText.fromSlice("fixed"),
            .rationale = try repository.Summary.fromSlice(
                if (std.mem.indexOf(u8, arguments_json, "stale") != null)
                    "stale"
                else
                    "repair",
            ),
        } } };
    }
    if (std.mem.eql(u8, name, "finish")) {
        const digest = if (std.mem.indexOf(u8, arguments_json, replacement_digest) != null)
            replacement_digest
        else if (std.mem.indexOf(u8, arguments_json, "aaaaaaaa") != null)
            "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
        else
            "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
        return .{ .ordinal = 5, .action = .{ .finish = .{
            .summary = try repository.Summary.fromSlice(
                if (std.mem.indexOf(u8, arguments_json, "Corrected normalizeRange") != null)
                    "Corrected normalizeRange and verified the complete suite."
                else
                    "done",
            ),
            .changed_path = try repository.Path.fromSlice(
                if (std.mem.indexOf(u8, arguments_json, "test/range.test.mjs") != null)
                    "test/range.test.mjs"
                else
                    "src/range.mjs",
            ),
            .final_source_sha256 = try repository.Digest.fromSlice(digest),
        } } };
    }
    return error.UnsupportedFixtureAction;
}

fn expectPolicyFailure(label: []const u8, state: []const u8, result: []const u8) ![32]u8 {
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
    return sha256(failure_bytes[0..failure_len]);
}

const PolicyCheck = struct {
    label: []const u8,
    state: []const u8,
    result: []const u8,
    failure: ?anyerror = null,
    failure_digest: [32]u8 = [_]u8{0} ** 32,
};

fn runPolicyCheck(check: *PolicyCheck) void {
    check.failure_digest = expectPolicyFailure(
        check.label,
        check.state,
        check.result,
    ) catch |err| {
        check.failure = err;
        return;
    };
}

fn joinPolicyCheck(thread: std.Thread, check: *const PolicyCheck) !void {
    thread.join();
    if (check.failure) |err| return err;
}

fn expectIdentity(pending: Pending, expected: []const u8) !boundary.process_v1.EffectRequest {
    const request = try pending.effect();
    try std.testing.expectEqualStrings(expected, request.effect_semantic_identity);
    return request;
}

const NativeProof = struct {
    pending_model_state: [32]u8,
    pending_model_request: [32]u8,
    parser_state: [32]u8,
    pending_repository_state: [32]u8,
    pending_repository_request: [32]u8,
    policy_failure: [32]u8,
    completion: [32]u8,
};

fn proveNativeAdmission() !NativeProof {
    var resume_bytes: [128 * 1024]u8 = undefined;
    var result_bytes: [256 * 1024]u8 = undefined;

    const model0 = try advanceToRequest(.{
        .initial_args = InitialArgs,
    }, null);
    defer model0.deinit();
    const model0_request = try expectIdentity(
        model0,
        ModelProtocol.semantic_identity,
    );
    const list_result = try encodeModel(
        model0_request,
        "list_repository",
        "{}",
        &resume_bytes,
        &result_bytes,
    );
    const parser_state = try advanceOneState(
        .{ .process_state = model0.state },
        list_result,
    );
    defer std.heap.page_allocator.free(parser_state);
    const list = try advanceToRequest(.{ .process_state = parser_state }, null);
    defer list.deinit();
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
        ModelProtocol.semantic_identity,
    );
    const read_action = try encodeModel(
        model1_request,
        "read_file",
        "{\"role\":1}",
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
        ModelProtocol.semantic_identity,
    );
    const test_action = try encodeModel(
        model2_request,
        "run_tests",
        "{}",
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
        ModelProtocol.semantic_identity,
    );

    const stale_replace = try encodeModel(
        pre_replace_request,
        "replace_file",
        "{\"path\":\"src/range.mjs\"," ++
            "\"expected_sha256\":\"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb\"," ++
            "\"replacement\":\"fixed\",\"rationale\":\"stale\"}",
        &resume_bytes,
        &result_bytes,
    );
    const stale_result = try std.heap.page_allocator.dupe(u8, stale_replace);
    defer std.heap.page_allocator.free(stale_result);
    var stale_check: PolicyCheck = .{
        .label = "stale digest",
        .state = pre_replace.state,
        .result = stale_result,
    };
    const stale_thread = try std.Thread.spawn(.{}, runPolicyCheck, .{&stale_check});
    errdefer stale_thread.join();

    const valid_replace = try encodeModel(
        pre_replace_request,
        "replace_file",
        "{\"path\":\"src/range.mjs\"," ++
            "\"expected_sha256\":\"8832f65e4bcf4a701dc76f310f3af34296bf8e95feb16ad70608041cb2e6dbb3\"," ++
            "\"replacement\":\"fixed\",\"rationale\":\"repair\"}",
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
        ModelProtocol.semantic_identity,
    );
    const retest_action = try encodeModel(
        model3_request,
        "run_tests",
        "{}",
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
        ModelProtocol.semantic_identity,
    );

    const wrong_final_path = try encodeModel(
        finish_request,
        "finish",
        "{\"summary\":\"done\",\"changed_path\":\"test/range.test.mjs\"," ++
            "\"final_source_sha256\":\"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\"}",
        &resume_bytes,
        &result_bytes,
    );
    const wrong_path_result = try std.heap.page_allocator.dupe(u8, wrong_final_path);
    defer std.heap.page_allocator.free(wrong_path_result);
    var wrong_path_check: PolicyCheck = .{
        .label = "wrong final path",
        .state = ready_to_finish.state,
        .result = wrong_path_result,
    };
    const wrong_path_thread = try std.Thread.spawn(.{}, runPolicyCheck, .{&wrong_path_check});
    errdefer wrong_path_thread.join();

    const wrong_final_digest = try encodeModel(
        finish_request,
        "finish",
        "{\"summary\":\"done\",\"changed_path\":\"src/range.mjs\"," ++
            "\"final_source_sha256\":\"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb\"}",
        &resume_bytes,
        &result_bytes,
    );
    const wrong_digest_result = try std.heap.page_allocator.dupe(u8, wrong_final_digest);
    defer std.heap.page_allocator.free(wrong_digest_result);
    var wrong_digest_check: PolicyCheck = .{
        .label = "wrong final digest",
        .state = ready_to_finish.state,
        .result = wrong_digest_result,
    };
    const wrong_digest_thread = try std.Thread.spawn(.{}, runPolicyCheck, .{&wrong_digest_check});
    errdefer wrong_digest_thread.join();

    const valid_final = try encodeModel(
        finish_request,
        "finish",
        "{\"summary\":\"Corrected normalizeRange and verified the complete suite.\"," ++
            "\"changed_path\":\"src/range.mjs\"," ++
            "\"final_source_sha256\":\"8bf50f62e3a4294ef359a6b9096d66e5597ce37824b3483ddad541ee21438453\"}",
        &resume_bytes,
        &result_bytes,
    );
    const completed = try advanceToCompletion(ready_to_finish.state, valid_final);
    defer std.heap.page_allocator.free(completed);
    var completion_digest: [32]u8 = undefined;
    std.crypto.hash.sha2.Sha256.hash(completed, &completion_digest, .{});
    try expectSha256(
        completed,
        "36c4354afea674adb139253064d7d14563ab3296804ff7cbefbba508a93f1032",
    );
    try joinPolicyCheck(stale_thread, &stale_check);
    try joinPolicyCheck(wrong_path_thread, &wrong_path_check);
    try joinPolicyCheck(wrong_digest_thread, &wrong_digest_check);
    return .{
        .pending_model_state = sha256(model0.state),
        .pending_model_request = sha256(model0.request),
        .parser_state = sha256(parser_state),
        .pending_repository_state = sha256(list.state),
        .pending_repository_request = sha256(list.request),
        .policy_failure = stale_check.failure_digest,
        .completion = completion_digest,
    };
}

test "repository admission rejects stale mutation and false completion from current State" {
    _ = try proveNativeAdmission();
}

pub fn main(init: std.process.Init) !void {
    const proof = try proveNativeAdmission();
    var image_digest: [32]u8 = undefined;
    std.crypto.hash.sha2.Sha256.hash(ImageBytes, &image_digest, .{});
    const image_sha256 = std.fmt.bytesToHex(image_digest, .lower);
    const pending_model_state = std.fmt.bytesToHex(proof.pending_model_state, .lower);
    const pending_model_request = std.fmt.bytesToHex(proof.pending_model_request, .lower);
    const parser_state = std.fmt.bytesToHex(proof.parser_state, .lower);
    const pending_repository_state = std.fmt.bytesToHex(proof.pending_repository_state, .lower);
    const pending_repository_request = std.fmt.bytesToHex(proof.pending_repository_request, .lower);
    const policy_failure = std.fmt.bytesToHex(proof.policy_failure, .lower);
    const completion_sha256 = std.fmt.bytesToHex(proof.completion, .lower);
    var buffer: [4096]u8 = undefined;
    var stdout = std.Io.File.stdout().writer(init.io, &buffer);
    try stdout.interface.print(
        "{{\"format\":\"agent-system-native-admission-proof/v1\",\"result\":\"passed\",\"imageSha256\":\"{s}\",\"parity\":{{\"pendingModelStateSha256\":\"{s}\",\"pendingModelRequestSha256\":\"{s}\",\"parserStateSha256\":\"{s}\",\"pendingRepositoryStateSha256\":\"{s}\",\"pendingRepositoryRequestSha256\":\"{s}\",\"policyFailureSha256\":\"{s}\",\"completionSha256\":\"{s}\"}},\"negativeResults\":[{{\"name\":\"stale-digest-replacement\",\"failure\":\"policy_denied\"}},{{\"name\":\"wrong-final-path\",\"failure\":\"policy_denied\"}},{{\"name\":\"wrong-final-digest\",\"failure\":\"policy_denied\"}}],\"nativeProcessImageSemantics\":true}}\n",
        .{
            &image_sha256,
            &pending_model_state,
            &pending_model_request,
            &parser_state,
            &pending_repository_state,
            &pending_repository_request,
            &policy_failure,
            &completion_sha256,
        },
    );
    try stdout.interface.flush();
}
