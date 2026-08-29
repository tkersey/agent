const agent = @import("agent");
const boundary = @import("boundary");
const std = @import("std");

const Observe = boundary.effect.site(0, "fixture.open.observe.v1", u32, u32);
const Action = union(enum) {
    observe: u32,
    fail: Failure,
};
const Observation = union(enum) {
    observed: u32,
};
const Failure = enum {
    denied,
    arithmetic_overflow,
    invalid_variant,
    invalid_index,
    capacity_exceeded,
};

const Open = agent.process.define(.{
    .name = "open-process",
    .version = "1.0.0",
    .instructions = "Continue until typed application semantics stop you.",
    .Goal = u32,
    .Action = Action,
    .Observation = Observation,
    .Result = void,
    .Failure = Failure,
    .actions = .{
        agent.action.effect(.observe, .observed, Observe, .{
            .name = "observe",
            .description = "Observe one value.",
        }),
        agent.action.fail(.fail, .{
            .name = "fail",
            .description = "Stop with an authored failure.",
        }),
    },
    .decision = .{
        .interface = "fixture.open.decide.v1",
        .maximum_request_bytes = 32 * 1024,
        .maximum_result_bytes = 4096,
    },
});
const Strategy = agent.strategy.react(.{});
const Epistemics = agent.epistemics.verbatim(.{
    .maximum_observations = 4,
    .overflow = .drop_oldest,
    .final = agent.final_policy.none,
});
const Compiled = agent.process.compile(Open, Strategy, Epistemics);

test "agent.process admits no Budget and no final action" {
    try std.testing.expectEqual(agent.DefinitionKind.process, Open.kind);
    try std.testing.expect(!@hasDecl(Open, "budget"));
    try std.testing.expectEqual(@as(usize, 2), Open.action_count);
    try std.testing.expect(@hasDecl(Compiled, "Program"));
    try std.testing.expect(!@hasDecl(Compiled, "Machine"));
    try std.testing.expect(Compiled.Program.image().bytes.len > 0);
    try std.testing.expect(@hasField(Compiled.DecisionSite.Payload, "contract_bytes"));
    try std.testing.expectEqual(
        Compiled.DecisionContractBytes.len,
        @sizeOf(@FieldType(Compiled.DecisionSite.Payload, "contract_bytes")),
    );
}

test "agent.process decision request carries its complete contract" {
    const Image = Compiled.Program.image();
    const Storage = boundary.process_v1.CapacityStorage(.{
        .input = 64 * 1024,
        .output = 64 * 1024,
        .state = 64 * 1024,
        .value = 64 * 1024,
        .request = 64 * 1024,
        .environment = 64 * 1024,
        .scratch = 512 * 1024,
    });
    var storage: Storage = .{};
    var state_bytes: [64 * 1024]u8 = undefined;
    var state_length: usize = 0;
    var initial_args: [4]u8 = undefined;
    std.mem.writeInt(u32, &initial_args, 7, .little);
    var initial = true;
    for (0..16) |_| {
        var workspace: boundary.image.ValidationWorkspace = .{};
        const outcome = try storage.advance(
            &Image.bytes,
            if (initial)
                .{ .initial_args = &initial_args }
            else
                .{ .process_state = state_bytes[0..state_length] },
            null,
            &workspace,
        );
        initial = false;
        switch (outcome) {
            .progressed, .explicitly_yielded => |state| {
                @memcpy(state_bytes[0..state.len], state);
                state_length = state.len;
            },
            .requested => |requested| {
                const request = try boundary.process_v1.effect.validateRequest(
                    requested.request,
                    Image.program_transition_digest,
                );
                const envelope = try boundary.schema.decodeExact(
                    Compiled.DecisionSite.Payload,
                    request.payload,
                );
                try std.testing.expectEqualSlices(
                    u8,
                    &Compiled.DecisionContract.canonical_digest,
                    &envelope.contract_digest,
                );
                try std.testing.expectEqualSlices(
                    u8,
                    &Compiled.DecisionContractBytes,
                    &envelope.contract_bytes,
                );
                return;
            },
            else => return error.UnexpectedProcessOutcome,
        }
    }
    return error.DecisionRequestNotReached;
}

test "agent.process continues across caller-selected decisions without a budget" {
    const Image = Compiled.Program.image();
    const Storage = boundary.process_v1.CapacityStorage(.{
        .input = 64 * 1024,
        .output = 64 * 1024,
        .state = 64 * 1024,
        .value = 64 * 1024,
        .request = 64 * 1024,
        .environment = 64 * 1024,
        .scratch = 512 * 1024,
    });
    var storage: Storage = .{};
    var process_state: [64 * 1024]u8 = undefined;
    var process_state_length: usize = 0;
    var initial_args: [4]u8 = undefined;
    std.mem.writeInt(u32, &initial_args, 11, .little);
    var effect_result: [4096]u8 = undefined;
    var effect_result_length: usize = 0;
    var initial = true;
    var decisions: usize = 0;

    for (0..512) |_| {
        var workspace: boundary.image.ValidationWorkspace = .{};
        const outcome = try storage.advance(
            &Image.bytes,
            if (initial)
                .{ .initial_args = &initial_args }
            else
                .{ .process_state = process_state[0..process_state_length] },
            if (effect_result_length == 0)
                null
            else
                effect_result[0..effect_result_length],
            &workspace,
        );
        initial = false;
        effect_result_length = 0;
        switch (outcome) {
            .progressed, .explicitly_yielded => |state| {
                @memcpy(process_state[0..state.len], state);
                process_state_length = state.len;
            },
            .requested => |requested| {
                @memcpy(process_state[0..requested.state.len], requested.state);
                process_state_length = requested.state.len;
                const request = try boundary.process_v1.effect.validateRequest(
                    requested.request,
                    Image.program_transition_digest,
                );
                var resume_bytes: [64]u8 = undefined;
                const resume_length = if (std.mem.eql(
                    u8,
                    request.effect_semantic_identity,
                    Compiled.DecisionSite.semantic_identity,
                )) decision: {
                    decisions += 1;
                    break :decision try boundary.schema.encode(
                        Action,
                        .{ .observe = @intCast(decisions) },
                        &resume_bytes,
                    );
                } else if (std.mem.eql(
                    u8,
                    request.effect_semantic_identity,
                    Observe.semantic_identity,
                )) try boundary.schema.encode(u32, @intCast(decisions), &resume_bytes) else return error.UnexpectedEffect;
                const encoded = try boundary.process_v1.effect.encodeResult(.{
                    .request_identity_digest = request.request_identity_digest,
                    .resume_schema_digest = request.resume_schema_digest,
                    .@"resume" = resume_bytes[0..resume_length],
                }, &effect_result);
                effect_result_length = encoded.len;
                if (decisions == 32 and std.mem.eql(
                    u8,
                    request.effect_semantic_identity,
                    Compiled.DecisionSite.semantic_identity,
                )) return;
            },
            .needs_capacity => return error.InsufficientTestCapacity,
            .completed, .authored_failure => return error.UnexpectedTerminalOutcome,
        }
    }
    return error.DecisionCountNotReached;
}
