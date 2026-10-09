//! Pure preparation of the next request and a recoverable control receipt.
//! Selection is authored. No model, work tool, or mutable host policy runs here.
const std = @import("std");
const native = @import("agent_native");
const contracts = @import("agent_contracts");
const t = @import("application_types");
const P = t.P;
const work = @import("work.zig");
const A = native.adaptive_responses.Admission(P);
const Adapter = native.adaptive_responses.Adapter(P);
const Objects = contracts.Vector(contracts.Bytes(128 * 1024), 2);
const Product = struct { result: t.PreparationResult, objects: Objects };

fn equal(left: []const u8, right: []const u8) bool {
    return std.mem.eql(u8, left, right);
}
fn digest(bytes: []const u8) [32]u8 {
    var value: [32]u8 = undefined;
    std.crypto.hash.sha2.Sha256.hash(bytes, &value, .{});
    return value;
}
fn encodedEqual(a: std.mem.Allocator, comptime T: type, left: T, right: T) !bool {
    return equal(try contracts.encodeOwned(T, a, left), try contracts.encodeOwned(T, a, right));
}
fn profile(policy: P.AdaptivePolicy, id: []const u8) !A.Profile {
    for (policy.profiles.items) |entry| if (equal(id, entry.id.bytes)) return entry;
    return error.UnknownInferenceProfile;
}
fn verifyEvidence(ctx: native.registry.ProjectionContext, evidence: t.EvidenceList) !void {
    if (evidence.items.len == 0) return;
    const parsed = try native.json.parse(ctx.allocator, ctx.profile, .{ .bytes = 256 * 1024 });
    const reference = try native.values.fromJson(native.registry.ObjectReference, ctx.allocator, native.json.get(parsed.value, "snapshot") orelse return error.InvalidConfiguration);
    const bytes = try ctx.object(reference, native.repository.maximum_snapshot_bytes);
    defer ctx.allocator.free(bytes);
    var snapshot = try native.repository.Snapshot.openBorrowed(ctx.allocator, bytes);
    defer snapshot.deinit();
    for (evidence.items) |ref| {
        const item = try work.evidence(ctx, ref);
        const file = snapshot.get(item.path.bytes) orelse return error.InvalidEvidence;
        if (!equal(&item.snapshot, &snapshot.identity) or !equal(item.sha256.bytes, &std.fmt.bytesToHex(file.sha256, .lower)) or
            item.start > item.end or item.end > file.contents.bytes.len or item.end - item.start > 4096 or item.file_bytes != file.contents.bytes.len or
            !equal(item.content.bytes, file.contents.bytes[@intCast(item.start)..@intCast(item.end)])) return error.InvalidEvidence;
    }
}
pub fn instructions(a: std.mem.Allocator, policy: P.AdaptivePolicy, catalog: P.AdaptiveCatalog) !P.MessageText {
    // Metadata never includes the instruction bodies or resource filesystem paths.
    const Profile = struct { id: contracts.Text(64), model: contracts.Text(128), efforts: @FieldType(A.Profile, "efforts") };
    const Skill = struct { id: contracts.Text(64), version: contracts.Text(64), description: contracts.Text(256) };
    const profiles = try a.alloc(Profile, policy.profiles.items.len);
    for (profiles, policy.profiles.items) |*out, entry| out.* = .{ .id = entry.id, .model = entry.model, .efforts = entry.efforts };
    const skills = try a.alloc(Skill, catalog.skills.items.len);
    for (skills, catalog.skills.items) |*out, entry| out.* = .{ .id = entry.id, .version = entry.version, .description = entry.description };
    const Catalog = struct { profiles: contracts.Vector(Profile, 8), skills: contracts.Vector(Skill, 32) };
    const metadata = try native.json.canonical(a, try native.values.toJson(Catalog, a, .{ .profiles = .{ .items = profiles }, .skills = .{ .items = skills } }));
    const text = try std.fmt.allocPrint(a, "{s}\nApproved catalog:\n{s}", .{ @embedFile("instructions.txt"), metadata });
    if (text.len > P.MessageText.max_length.?) return error.Capacity;
    return .{ .bytes = text };
}

pub fn declaration() native.Declaration {
    return .{ .identity = t.prepare_identity, .resource_role = "context", .kind = .leaf, .payload_schema = struct {
        fn schema(a: std.mem.Allocator) ![]u8 {
            return native.values.schemaBytes(t.Preparation, a);
        }
    }.schema, .resume_schema = struct {
        fn schema(a: std.mem.Allocator) ![]u8 {
            return native.values.schemaBytes(t.PreparationResult, a);
        }
    }.schema, .capture = .{ .prepare = prepare, .acquire = acquire, .interpret = interpret } };
}

const Overlay = struct {
    parent: native.registry.ProjectionContext,
    seed: ?[]const u8,
    fn read(owner: *anyopaque, a: std.mem.Allocator, ref: native.registry.ObjectReference, limit: usize) ![]u8 {
        const self: *Overlay = @ptrCast(@alignCast(owner));
        if (self.seed) |bytes| if (bytes.len == ref.bytes and bytes.len <= limit and equal(&digest(bytes), &ref.digest)) return a.dupe(u8, bytes);
        return self.parent.object(ref, limit);
    }
};

fn receiptText(a: std.mem.Allocator, receipt: t.ControlReceipt, control: t.controls.State) !P.ResultText {
    var value = try native.values.toJson(t.ControlReceipt, a, receipt);
    // Model-facing revision arguments are exact JSON integers, independent of
    // the machine protocol's decimal-string u64 mapping.
    inline for (.{ "previous_revision", "next_revision", "context_epoch", "eviction_generation" }) |name| try native.json.put(a, &value, name, try native.json.number(a, @field(receipt, name)));
    try native.json.put(a, &value, "takes_effect", native.json.string("next inference; no provider request has been executed by this control"));
    try native.json.put(a, &value, "skills", try native.values.toJson(@FieldType(t.controls.State, "skills"), a, control.skills));
    return .{ .bytes = try native.json.canonicalBounded(a, value, P.ResultText.max_length.?) };
}

fn controlSource(ctx: native.registry.ProjectionContext, state: t.State, subject: t.ControlSubject, policy: P.AdaptivePolicy) !contracts.Decoded(P.AdaptiveContext) {
    const ref = state.replay orelse return error.InvalidContext;
    var prior = try Adapter.Context.open(ctx, ref, policy.audience.bytes);
    errdefer prior.deinit();
    if (!try encodedEqual(ctx.allocator, t.model.AdaptiveSelection, state.control.selection, prior.value.selection) or
        state.control.epoch != prior.value.plan.epoch or state.control.eviction_generation != prior.value.plan.eviction_generation or
        !try encodedEqual(ctx.allocator, @FieldType(t.controls.State, "skills"), state.control.skills, prior.value.plan.skills)) return error.InvalidContext;
    const prepared_bytes = try ctx.object(.{ .digest = prior.value.source_request.digest, .bytes = prior.value.source_request.bytes }, 2 * 1024 * 1024);
    var prepared = try contracts.decodeOwned(Adapter.Prepared, ctx.allocator, prepared_bytes);
    defer prepared.deinit();
    const capture = try ctx.object(.{ .digest = prior.value.source_capture.digest, .bytes = prior.value.source_capture.bytes }, 4 * 1024 * 1024);
    var raw = try contracts.decodeOwned(native.responses.Raw, ctx.allocator, capture);
    defer raw.deinit();
    const response = (try native.json.parse(ctx.allocator, raw.value.body.bytes, .{ .bytes = P.representation.provider_response_bytes })).value;
    const output = native.json.get(response, "output") orelse return error.InvalidCapture;
    const normalized = try native.responses.Adapter(P).normalize(ctx.allocator, prepared.value.request.invocation, output);
    if (normalized != .output) return error.InvalidCapture;
    var found = false;
    for (normalized.output.items.items) |item| if (item == .function_call and equal(item.function_call.call_id.bytes, subject.call_id.bytes)) {
        const call = item.function_call;
        if (found or call.tool_ordinal_claim >= P.declaration_count or !prepared.value.request.offered[call.tool_ordinal_claim] or call.decoded_action != .decoded) return error.InvalidCapture;
        const action = call.decoded_action.decoded;
        const reason = switch (action) {
            .inference_set => |value| value.reason,
            .skill_set => |value| value.reason,
            else => return error.InvalidCapture,
        };
        if (!equal(reason.bytes, subject.reason.bytes)) return error.InvalidCapture;
        const expected = switch (action) {
            .inference_set => |command| command.expected_revision,
            .skill_set => |command| command.expected_revision,
            else => return error.InvalidCapture,
        };
        if (subject.proposal.disposition != .rejected and expected != state.control.selection.control_revision) return error.InvalidCapture;
        if (subject.proposal.disposition == .proposed and action == .inference_set and
            (!equal(subject.proposal.state.selection.profile_id.bytes, action.inference_set.profile_id.bytes) or subject.proposal.state.selection.effective_effort != action.inference_set.effort)) return error.InvalidCapture;
        found = true;
    };
    if (!found) return error.InvalidCapture;
    return prior;
}

fn evaluate(ctx: native.registry.ProjectionContext, input: t.Preparation) !Product {
    const a = ctx.allocator;
    const policy = try A.policy(a, ctx.profile);
    var catalog = try A.catalog(ctx, policy);
    defer catalog.deinit();
    var control = input.state.control;
    var receipt: ?t.ControlReceipt = null;
    var text: ?P.ResultText = null;
    const pending = input.state.results;
    const resolved = try a.alloc(P.ToolResult, pending.items.len);
    for (resolved, pending.items) |*out, item| {
        const content: []const u8 = switch (item.output) {
            .inline_text => |value| value.bytes,
            .work => |ref| blk: {
                var record = try work.open(ctx, ref);
                defer record.deinit();
                if (!equal(record.value.call_id.bytes, item.call_id.bytes)) return error.InvalidWorkArtifact;
                break :blk try a.dupe(u8, record.value.model_text.bytes);
            },
            .control => |ref| blk: {
                const bytes = try ctx.object(.{ .digest = ref.digest, .bytes = ref.bytes }, 128 * 1024);
                var record = try contracts.decodeOwned(t.ReceiptArtifact, a, bytes);
                defer record.deinit();
                if (!equal(&record.value.receipt.task, &ctx.task) or !equal(record.value.receipt.call_id.bytes, item.call_id.bytes)) return error.InvalidContext;
                break :blk try a.dupe(u8, record.value.model_text.bytes);
            },
        };
        out.* = .{ .call_id = item.call_id, .output = .{ .bytes = content } };
    }
    var results: @FieldType(P.AdaptiveRequest, "results") = .{ .items = resolved };
    if (input.control) |subject| {
        var prior = try controlSource(ctx, input.state, subject, policy);
        defer prior.deinit();
        if (input.state.receipts.items.len == 16) return error.Capacity;
        if (subject.proposal.disposition == .proposed) {
            if (subject.proposal.rejection != .none) return error.InvalidContext;
            if (subject.proposal.state.selection.control_revision != try std.math.add(u64, control.selection.control_revision, 1)) return error.InvalidContext;
            control = subject.proposal.state;
        } else if (!try encodedEqual(a, t.controls.State, control, subject.proposal.state)) return error.InvalidContext;
        receipt = .{
            .task = ctx.task,
            .source = prior.value.source_capture,
            .call_id = subject.call_id,
            .previous_revision = input.state.control.selection.control_revision,
            .next_revision = control.selection.control_revision,
            .disposition = switch (subject.proposal.disposition) {
                .proposed => .admitted,
                .unchanged => .unchanged,
                .rejected => .rejected,
            },
            .rejection = subject.proposal.rejection,
            .previous_profile = input.state.control.selection.profile_id,
            .next_profile = control.selection.profile_id,
            .previous_model = (try profile(policy, input.state.control.selection.profile_id.bytes)).model,
            .next_model = (try profile(policy, control.selection.profile_id.bytes)).model,
            .previous_effort = input.state.control.selection.effective_effort,
            .next_effort = control.selection.effective_effort,
            .context_epoch = control.epoch,
            .eviction_generation = control.eviction_generation,
        };
        text = try receiptText(a, receipt.?, control);
        const items = try a.alloc(P.ToolResult, 1);
        items[0] = .{ .call_id = subject.call_id, .output = text.? };
        results = .{ .items = items };
    }
    const selected = try profile(policy, control.selection.profile_id.bytes);
    var materialized = policy.core_tools;
    var offered = policy.core_tools;
    for (control.skills.items) |loaded| for (catalog.value.skills.items) |skill| if (equal(loaded.skill_id.bytes, skill.id.bytes)) {
        for (skill.tools, 0..) |enabled, ordinal| {
            materialized[ordinal] = materialized[ordinal] or enabled;
            offered[ordinal] = offered[ordinal] or (enabled and loaded.active);
        }
    };
    for (&offered, input.offered, policy.permitted_tools) |*allowed, requested, permitted| allowed.* = allowed.* and requested and permitted;
    var declarations: std.ArrayList(P.ToolDeclaration) = .empty;
    for (materialized, P.allDeclarations().items) |defined, item| if (defined) try declarations.append(a, item);
    var request: P.AdaptiveRequest = .{
        .policy = digest(ctx.profile),
        .selection = control.selection,
        .materialized = materialized,
        .offered = offered,
        .results = results,
        .plan = .{ .epoch = control.epoch, .reason = control.epoch_reason, .watermark = if (input.state.replay) |ref| ref.watermark else 0, .eviction_generation = control.eviction_generation, .prior = input.state.replay, .handoff = input.state.handoff, .catalog = policy.catalog, .skills = control.skills },
        .invocation = .{
            .protocol = .{ .bytes = t.model.protocol_identity },
            .model = selected.model,
            .parameters = .{ .max_output_tokens = selected.max_output_tokens, .temperature = null, .reasoning = .{ .effort = control.top_effort, .summary = null } },
            .messages = input.state.messages,
            .tools = .{ .items = declarations.items },
            .selection = .{ .minimum_calls = 1, .maximum_calls = 1, .parallel_calls = false },
            .response_policy = .{ .store = false, .stream = false, .background = false, .truncation = .disabled },
            .normalization_limits = P.normalizationLimits(),
            .maximum_provider_response_bytes = selected.response_bytes,
        },
    };
    var seed: ?[]const u8 = null;
    if (input.state.replay) |prior| if (control.epoch != prior.epoch and (input.control != null or input.state.handoff == null)) {
        try verifyEvidence(ctx, input.state.evidence);
        // Keep exact acquired facts; refuse capacity rather than summarize away
        // evidence, a follow-up, an outcome, or an allowance.
        const Handoff = struct { original_task: t.Summary, followups: t.Followups, evidence: contracts.Vector(t.Evidence, 8), work_outcomes: contracts.Vector(t.WorkOutcome, 12), prior_controls: t.Receipts, current_control: ?t.ControlReceipt, pending_model_hypothesis: contracts.Text(256), control: t.controls.State, remaining_model_calls: u16, remaining_work_calls: u16, pending_questions: contracts.Vector(t.Question, 1), completion_criteria: contracts.Text(256) };
        const evidence = try a.alloc(t.Evidence, input.state.evidence.items.len);
        for (evidence, input.state.evidence.items) |*out, ref| out.* = try work.evidence(ctx, ref);
        const outcomes = try a.alloc(t.WorkOutcome, input.state.outcomes.items.len);
        // Decoded work objects live in the bounded projection allocator until
        // this capture evaluation ends; they are never stored in World state.
        var opened: std.ArrayList(contracts.Decoded(t.WorkArtifact)) = .empty;
        defer {
            for (opened.items) |*item| item.deinit();
            opened.deinit(a);
        }
        for (outcomes, input.state.outcomes.items) |*out, item| switch (item) {
            .answer => |answer| out.* = .{ .ask = answer },
            .artifact => |ref| {
                try opened.append(a, try work.open(ctx, ref));
                out.* = opened.items[opened.items.len - 1].value.outcome;
            },
        };
        const facts = try native.json.canonicalBounded(a, try native.values.toJson(Handoff, a, .{
            .original_task = input.state.task,
            .followups = input.state.followups,
            .evidence = .{ .items = evidence },
            .work_outcomes = .{ .items = outcomes },
            .prior_controls = input.state.receipts,
            .current_control = receipt,
            .pending_model_hypothesis = if (input.control) |subject| subject.reason else input.state.pending_model_intent,
            .control = control,
            .remaining_model_calls = policy.model_attempts -| input.state.model_calls,
            .remaining_work_calls = 12 -| input.state.work_calls,
            .pending_questions = .{ .items = &.{} },
            .completion_criteria = .{ .bytes = "Answer the original task and consumed follow-ups using acquired evidence, distinguishing observations from hypotheses and unrun checks." },
        }), P.MessageText.max_length.?);
        seed = try contracts.encodeOwned(P.AdaptiveSeed, a, .{
            .schema = .{ .bytes = P.adaptive_seed_identity },
            .policy = request.policy,
            .task = ctx.task,
            .tenant = .{ .bytes = ctx.tenant },
            .audience = policy.audience,
            .selection = control.selection,
            .epoch = control.epoch,
            .watermark = prior.watermark,
            .eviction_generation = control.eviction_generation,
            .source = prior,
            .messages = .{ .items = &.{ .{ .role = .developer, .content = try instructions(a, policy, catalog.value) }, .{ .role = .user, .content = .{ .bytes = input.state.task.bytes } }, .{ .role = .developer, .content = .{ .bytes = facts } } } },
        });
        request.plan.handoff = .{ .digest = digest(seed.?), .bytes = seed.?.len };
    };
    var overlay: Overlay = .{ .parent = ctx, .seed = seed };
    var prepared_context = ctx;
    prepared_context.objects = .{ .owner = &overlay, .read = Overlay.read };
    // Decide the actual next request, including handoff and body capacity,
    // before publishing its receipt. This performs no external inference.
    _ = try Adapter.prepare(prepared_context, try contracts.encodeOwned(P.AdaptiveRequest, a, request));
    var objects: std.ArrayList(contracts.Bytes(128 * 1024)) = .empty;
    if (seed) |bytes| try objects.append(a, .{ .bytes = bytes });
    var receipt_ref: ?t.ReceiptReference = null;
    var next_results = pending;
    if (receipt) |value| {
        const bytes = try contracts.encodeOwned(t.ReceiptArtifact, a, .{ .receipt = value, .model_text = text.? });
        try objects.append(a, .{ .bytes = bytes });
        const ref = work.reference(bytes);
        receipt_ref = .{ .object = ref, .previous_revision = value.previous_revision, .next_revision = value.next_revision, .disposition = value.disposition, .rejection = value.rejection, .next_profile = value.next_profile, .next_effort = value.next_effort, .context_epoch = value.context_epoch, .eviction_generation = value.eviction_generation };
        const items = try a.alloc(t.PendingResult, 1);
        items[0] = .{ .call_id = value.call_id, .output = .{ .control = ref } };
        next_results = .{ .items = items };
    }
    return .{ .result = .{ .ready = .{ .request = request, .receipt = receipt_ref, .results = next_results } }, .objects = .{ .items = objects.items } };
}

fn prepare(ctx: native.registry.ProjectionContext, bytes: []const u8) ![]u8 {
    var input = try contracts.decodeOwned(t.Preparation, ctx.allocator, bytes);
    defer input.deinit();
    const product = evaluate(ctx, input.value) catch |err| switch (err) {
        error.Capacity => Product{ .result = .{ .rejected = .capacity }, .objects = .{ .items = &.{} } },
        error.UnknownSkill, error.InvalidSkill => Product{ .result = .{ .rejected = .unknown_skill }, .objects = .{ .items = &.{} } },
        error.UnknownInferenceProfile => Product{ .result = .{ .rejected = .unknown_profile }, .objects = .{ .items = &.{} } },
        error.UnsupportedEffort => Product{ .result = .{ .rejected = .unsupported_effort }, .objects = .{ .items = &.{} } },
        else => return err,
    };
    return contracts.encodeOwned(Product, ctx.allocator, product);
}
fn acquire(ctx: native.Context, bytes: []const u8) !native.registry.Acquisition {
    ctx.checkCancellation() catch |err| return .{ .definitely_not_sent = err };
    return .{ .captured = try ctx.allocator.dupe(u8, bytes) };
}
fn interpret(ctx: native.registry.ProjectionContext, request: []const u8, prepared: []const u8, captured: []const u8) !native.registry.Projection {
    if (!equal(prepared, captured) or !equal(try prepare(ctx, request), prepared)) return error.InvalidCapture;
    var product = try contracts.decodeOwned(Product, ctx.allocator, prepared);
    defer product.deinit();
    const objects = try ctx.allocator.alloc([]const u8, product.value.objects.items.len);
    for (objects, product.value.objects.items) |*out, object| out.* = try ctx.allocator.dupe(u8, object.bytes);
    return .{ .reply = try contracts.encodeOwned(t.PreparationResult, ctx.allocator, product.value.result), .objects = objects };
}
