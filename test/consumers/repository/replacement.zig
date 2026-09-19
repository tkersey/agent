//! Fresh read evidence and exact-proposal approval own conditional replacement.
const agent = @import("agent");
const boundary = @import("boundary");
pub const types = @import("types.zig");
const t = types;
const E = @import("source.zig").Emit;
const Id = boundary.computation.Id;
pub const Reason = agent.contracts.Text(256);
pub const Proposal = struct { request: t.ReplaceRequest, principal: u64 };
// The adapter returns current only after matching the real file to the query's
// path and expected digest. The program binds its echo to the exact proposal.
pub const Read = union(enum) { current: Proposal, conflict: t.ReplaceConflict, unavailable: Reason };
pub const Delivery = agent.tools.CommitResult(t.ReplaceApplied, t.ReplaceConflict, Reason, Reason);
pub const Definition = struct { function: Id, effects: []const Id };

pub fn define(c: agent.Context) !Definition {
    const b = c.builder;
    const e: E = .{ .c = c };
    const proposal_schema = try c.schema(Proposal);
    const read = try c.external("repository.repair.current.v1", proposal_schema, try c.schema(Read), .read);
    const observed = try agent.observation.define(c, "repository.repair.current", read);
    const commit = try c.external("repository.repair.replace.v1", proposal_schema, try c.schema(Delivery), .commit);
    const selected = try b.variable(proposal_schema);
    const authority = try b.declare(&.{ proposal_schema, try c.schema(u64) }, try c.schema(bool), &.{}, &.{});
    const principal = try e.param(authority, 1);
    try b.define(authority, try b.pure(try e.both(
        try e.binary(.less, try c.literal(u64, 0), principal),
        try e.binary(.equal, principal, try e.field(u64, try e.param(authority, 0), 1)),
    )));
    const revalidate = try b.declare(&.{proposal_schema}, try c.schema(bool), &.{}, &.{});
    try b.define(revalidate, try agent.value_equality.compare(b, proposal_schema, try e.param(revalidate, 0), try b.reference(selected), try c.literal(t.Failure, .invalid_variant)));
    const project = try b.declare(&.{proposal_schema}, observed.data, &.{}, &.{});
    try b.define(project, try b.pure(try b.primitive(observed.data, .variant, &.{try e.param(project, 0)}, 0)));
    const approval = try agent.approval.define(c, .{
        .name = "repository.repair.replace",
        .proposal = proposal_schema,
        .occurrence = try c.schema(u64),
        .principal = try c.schema(u64),
        .reason = try c.schema(Reason),
        .commit_effect = commit,
        .authority = authority,
        .revalidate = revalidate,
        .failure = try c.literal(t.Failure, .invalid_variant),
        .channel = "repository-owner",
        .evidence = .{ .proof = observed.proof, .consume = observed.consume, .project = project },
    });
    const effects = (try (boundary.computation.Row{ .effects = approval.effects }).unionWith(b.allocator(), .{ .effects = &.{read} })).effects;
    const f = try b.declare(&.{ try c.schema(t.Memory), try c.schema(t.ReplaceRequest), try c.schema(u64) }, try c.schema(t.ReplaceOutcome), effects, &.{});
    const evidence = try b.variable(observed.evidence);
    const data = try b.variable(observed.data);
    const proof = try b.variable(observed.proof);
    const current = try b.variable(proposal_schema);
    const conflict = try b.variable(try c.schema(t.ReplaceConflict));
    const unavailable = try b.variable(try c.schema(Reason));
    const approved = try b.variable(approval.result);
    const delivery = try b.variable(try c.schema(Delivery));
    const reason = try b.variable(try c.schema(Reason));
    const invalid = try b.variable(try c.schema(void));
    const denied = try b.variable(try c.schema(void));
    const applied = try b.variable(try c.schema(t.ReplaceApplied));
    const changed = try b.variable(try c.schema(t.ReplaceConflict));
    const failed = try b.variable(try c.schema(Reason));
    const uncertain = try b.variable(try c.schema(Reason));
    const delivered = try b.term(.{ .match_sum = .{ .value = try b.reference(delivery), .cases = &.{
        .{ .variable = applied, .body = try outcome(e, 0, try b.reference(applied)) },
        .{ .variable = changed, .body = try outcome(e, 2, try b.reference(changed)) },
        .{ .variable = failed, .body = try denial(e, try b.reference(failed)) },
        .{ .variable = uncertain, .body = try b.term(.{ .fail = try c.literal(t.Failure, .uncertain_delivery) }) },
    } } });
    const approval_result = try b.term(.{ .match_sum = .{ .value = try b.reference(approved), .cases = &.{
        .{ .variable = delivery, .body = delivered },
        .{ .variable = reason, .body = try denial(e, try b.reference(reason)) },
        .{ .variable = invalid, .body = try b.term(.{ .fail = try c.literal(t.Failure, .invalid_variant) }) },
        .{ .variable = denied, .body = try denial(e, try c.literal(Reason, .{ .bytes = "Approval authority or exact-proposal policy denied." })) },
    } } });
    const approve = try b.bind(approved, try agent.approval.approveWithEvidence(c, approval, f, try b.reference(selected), try b.reference(proof)), approval_result);
    const discarded = try b.variable(observed.data);
    const consume = try b.term(.{ .call = .{ .function = observed.consume, .arguments = &.{try b.reference(proof)} } });
    try c.registry.allowPrivateCall(f, consume, observed.consume);
    const branches = try b.term(.{ .match_sum = .{ .value = try b.reference(data), .cases = &.{
        .{ .variable = current, .body = approve },
        .{ .variable = conflict, .body = try b.bind(discarded, consume, try outcome(e, 2, try b.reference(conflict))) },
        .{ .variable = unavailable, .body = try b.bind(discarded, consume, try b.term(.{ .fail = try c.literal(t.Failure, .authored_abort) })) },
    } } });
    const unpack = try b.term(.{ .unpack_product = .{ .value = try b.reference(evidence), .variables = &.{ data, proof }, .body = branches } });
    const acquire = try b.bind(evidence, try agent.observation.readEvidence(c, observed, f, try b.reference(selected)), unpack);
    const proposal = try e.product(Proposal, &.{ try e.param(f, 1), try e.param(f, 2) });
    const source = try b.variable(try c.schema(t.ReadResult));
    const missing = try b.variable(try c.schema(void));
    const same_path = try b.variable(try c.schema(bool));
    const same_digest = try b.variable(try c.schema(bool));
    const request = try e.param(f, 1);
    const stale = try denial(e, try c.literal(Reason, .{ .bytes = "Replacement must match the latest-read source path and digest." }));
    const checked = try b.term(.{ .conditional = .{
        .condition = try e.both(try b.reference(same_path), try b.reference(same_digest)),
        .when_true = try b.bind(selected, try b.pure(proposal), acquire),
        .when_false = stale,
    } });
    const digest_check = try b.bind(same_digest, try agent.value_equality.compare(b, try c.schema(t.DigestHex), try e.field(t.DigestHex, request, 1), try e.field(t.DigestHex, try b.reference(source), 3), try c.literal(t.Failure, .invalid_variant)), checked);
    const path_check = try b.bind(same_path, try agent.value_equality.compare(b, try c.schema(t.Path), try e.field(t.Path, request, 0), try e.field(t.Path, try b.reference(source), 2), try c.literal(t.Failure, .invalid_variant)), digest_check);
    const retained_source = try b.term(.{ .match_sum = .{
        .value = try e.field(?t.ReadResult, try e.param(f, 0), 2),
        .cases = &.{ .{ .variable = missing, .body = stale }, .{ .variable = source, .body = path_check } },
    } });
    const gate = try b.term(.{ .conditional = .{
        .condition = try e.field(bool, try e.param(f, 0), 7),
        .when_true = retained_source,
        .when_false = try denial(e, try c.literal(Reason, .{ .bytes = "A failing baseline test is required before replacement." })),
    } });
    try b.define(f, gate);
    return .{ .function = f, .effects = effects };
}

fn outcome(e: E, tag: u64, value: Id) !Id {
    return e.c.builder.pure(try e.c.builder.primitive(try e.c.schema(t.ReplaceOutcome), .variant, &.{value}, tag));
}
fn denial(e: E, reason: Id) !Id {
    return outcome(e, 1, try e.product(t.ReplaceDenied, &.{reason}));
}
