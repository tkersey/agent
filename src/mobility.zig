//! Explicit placement effects. Native functions only construct Boundary terms;
//! custody, authority and transport remain environmental.
const std = @import("std");
const c = @import("agent_contracts");
const Context = @import("authoring.zig").Context;
const Id = @import("boundary").source.Id;

pub const resolve_identity = "agent.mobility.resolve.v1";
pub const relocate_identity = "agent.mobility.relocate.v1";
pub const Identifier = c.Text(128);
pub const Digest = [32]u8;
pub const Requirement = struct {
    operation_identity: c.Text(256),
    payload_schema_digest: Digest,
    result_schema_digest: Digest,
    semantic_role: Identifier,
    subject_ref: Identifier,
    subject_version: ?Digest,
    scope_ref: Identifier,
    trust_domain: ?Identifier,
    audience_ref: ?Identifier,
};
pub const Requirements = c.Vector(Requirement, 16);
pub const Constraints = struct {
    allowed_trust_domains: c.Vector(Identifier, 16),
    required_host_id: ?Identifier,
    affinity_host_id: ?Identifier,
    maximum_state_bytes: u64,
};
pub const Observation = struct {
    host_id: Identifier,
    requirements_digest: Digest,
    binding_digest: Digest,
    policy_revision: Identifier,
    runtime_profile: Digest,
};
pub const Candidate = struct {
    observation: Observation,
    trust_domain: Identifier,
    transfer_microseconds: ?u64,
    startup_microseconds: ?u64,
    capability_microseconds: ?u64,
    cost_revision: Identifier,
};
// Variant order is part of the v1 contract. Unknown custody is deliberately
// absent: only a durable environmental decision may resume this call.
pub const Reason = union(enum) {
    unavailable: void,
    policy_denied: void,
    export_denied: void,
    binding_mismatch: void,
    runtime_mismatch: void,
    capacity: void,
    unsettled_occurrence: void,
    pinned_resource: void,
    cleanup_unsupported: void,
    budget_exhausted: void,
    withdrawn: void,
    expired_offer: void,
    already_here: void,
    invalid_state: void,
    busy: void,
    unsupported: void,
};
pub const ResolveInput = struct { requirements: Requirements, constraints: Constraints };
pub const Resolution = union(enum) {
    Here: Observation,
    Candidates: c.Vector(Candidate, 32),
    Unavailable: Reason,
};
pub const RelocateInput = struct {
    destination_host_id: Identifier,
    requirements: Requirements,
    placement_intent_id: Identifier,
    export_policy_ref: Identifier,
    remaining_move_budget: u32,
};
pub const Arrival = struct {
    destination_host_id: Identifier,
    custody_epoch: u64,
    transfer_id: Identifier,
    accepted_receipt_digest: Digest,
    observation: Observation,
};
pub const RefusalEvidence = union(enum) { LocalUnsent: Reason, DestinationReceipt: Digest };
pub const Refusal = struct {
    reason: Reason,
    destination_host_id: Identifier,
    evidence: RefusalEvidence,
};
pub const RelocationReply = union(enum) { Arrived: Arrival, Refused: Refusal };

pub const Definition = struct { resolve: Id, relocate: Id };

pub fn define(context: Context) !Definition {
    const instance = try context.builder.specialization(Definition, "agent.mobility/v1", .{});
    if (instance.cached) |present| return present;
    return instance.finish(context.builder, .{
        .resolve = try context.external(resolve_identity, try context.schema(ResolveInput), try context.schema(Resolution), .mobility),
        .relocate = try context.external(relocate_identity, try context.schema(RelocateInput), try context.schema(RelocationReply), .mobility),
    });
}

pub fn resolve(context: Context, owner: Id, input: Id) !Id {
    return perform(context, owner, (try define(context)).resolve, input);
}

pub fn relocate(context: Context, owner: Id, input: Id) !Id {
    return perform(context, owner, (try define(context)).relocate, input);
}

fn perform(context: Context, owner: Id, effect: Id, input: Id) !Id {
    const b = context.builder;
    if (input >= b.values.items.len) return error.InvalidReference;
    if (b.values.items[@intCast(input)].schema != b.effects.items[@intCast(effect)].payload)
        return error.TypeMismatch;
    const term = try b.term(.{ .perform = .{ .effect = effect, .payload = input } });
    try context.registry.protectSite(owner, term, effect);
    return term;
}

test "mobility contracts have stable bounded products and exactly two relocation outcomes" {
    const source = @import("boundary").source;
    const admission = @import("admission.zig");
    var b = source.Builder.init(std.testing.allocator);
    defer b.deinit();
    var r = admission.Registry.init(std.testing.allocator);
    defer r.deinit();
    const ctx = Context{ .builder = &b, .registry = &r };
    const def = try define(ctx);
    try std.testing.expectEqual(def, try define(ctx));
    try std.testing.expectEqual(admission.Role.mobility, r.roleOf(def.relocate).?);
    const reply = b.schemas.items[@intCast(b.effects.items[@intCast(def.relocate)].result)];
    try std.testing.expectEqual(@as(usize, 2), reply.sum.len);
    const reason = b.schemas.items[@intCast(try ctx.schema(Reason))];
    try std.testing.expectEqual(@as(usize, 16), reason.sum.len);
}
