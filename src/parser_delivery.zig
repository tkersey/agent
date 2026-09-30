//! Exact parser proposals use the existing live-evidence and approval owners.
const agent_contracts = @import("agent_contracts");
const parser = @import("parser_synthesis.zig");
const source = @import("boundary").source;
const typed = @import("boundary").authoring;
const equality = @import("value_equality.zig");
const Context = @import("authoring.zig").Context;
const observation = @import("observation.zig");
const approval = @import("approval.zig");
const Id = source.Id;
pub const Request = struct { path: agent_contracts.Text(256), base: parser.Digest, replacement: parser.Code, reason: agent_contracts.Text(4096) };
pub const Proposal = struct { request: Request, principal: u64, subject: parser.Subject, candidate_version: u64, assessment: parser.Assessment };
pub const Conflict = struct { path: agent_contracts.Text(256), expected: parser.Digest, actual: parser.Digest };
pub const Receipt = struct { path: agent_contracts.Text(256), base: parser.Digest, current: parser.Digest, unchanged: bool };
pub const Delivery = union(enum(u32)) { applied: Receipt = 0, conflict: Conflict = 1, failed: agent_contracts.Text(64) = 2, uncertain: agent_contracts.Text(64) = 3 };
pub const Read = union(enum(u32)) { current: Proposal = 0, conflict: Conflict = 1, failed: agent_contracts.Text(64) = 2 };
pub const Result = union(enum(u32)) { delivery: Delivery = 0, declined: agent_contracts.Text(512) = 1, invalid: void = 2, denied: void = 3, artifact: Proposal = 4, conflict: Conflict = 5, failed: agent_contracts.Text(64) = 6 };
pub const Definition = struct { function: Id, effects: []const Id };
fn schema(c: Context, t: *typed.Context, comptime T: type) !*const typed.Schema {
    return typed.interop.schema(t, try c.schema(T));
}
pub fn define(c: Context) !Definition {
    const b = c.builder;
    const cache = try b.specialization(Definition, "agent.parser.delivery/v1", .{});
    if (cache.cached) |value| return value;
    const live = try c.external("agent.parser.target-read.v1", try c.schema(Proposal), try c.schema(Read), .read);
    const observed = try observation.define(c, "parser.target", live);
    const commit = try c.external("agent.parser.replace.v1", try c.schema(Proposal), try c.schema(Delivery), .commit);
    const function = try b.declare(&.{ try c.schema(Proposal), try b.scalar(bool) }, try c.schema(Result), &.{}, &.{});
    try c.registry.privateFunction(function);
    const t = try typed.Context.init(b);
    const proposal = try schema(c, t, Proposal);
    const equal = try equality.create(t, proposal, try t.literalFailure(void, {}));
    const selected = try b.reference(b.parameter(function, 0));
    const gate = try approvalGate(c, t, observed, commit, selected, equal);
    const effects = try (source.Row{ .effects = gate.effects }).unionWith(b.allocator(), .{ .effects = &.{live} });
    b.functions.items[@intCast(function)].effects = effects.effects;
    try b.define(function, try readAndApprove(c, t, observed, gate, function, equal));
    return cache.finish(b, .{ .function = function, .effects = effects.effects });
}
fn approvalGate(c: Context, t: *typed.Context, observed: observation.Definition, commit: Id, selected: Id, equal: *const typed.Function) !approval.Definition {
    const b = c.builder;
    const p = try schema(c, t, Proposal);
    const boolean = try t.scalar(bool);
    const integer = try t.scalar(u64);
    const authority = try t.function("parser replacement authority", &.{ .{ .name = "proposal", .schema = p }, .{ .name = "principal", .schema = integer } }, boolean, &.{});
    const auth = try t.body(authority);
    const principal = try auth.parameter("principal");
    const yes = try auth.branch();
    const no = try auth.branch();
    const matches = try yes.equal(principal, try yes.field(try auth.parameter("proposal"), "1"));
    try t.define(authority, try auth.ret(try auth.conditional(try auth.less(try auth.constant(u64, 0), principal), try yes.ret(matches), try no.ret(try no.constant(bool, false)))));
    const policy = try t.function("retain exact parser proposal", &.{.{ .name = "proposal", .schema = p }}, boolean, &.{});
    const check = try t.body(policy);
    const retained = try typed.interop.adoptValue(check, selected, p);
    try t.define(policy, try check.ret(try check.call(equal, &.{ .{ .name = "left", .value = try check.parameter("proposal") }, .{ .name = "right", .value = retained } })));
    const project = try t.function("parser proposal evidence", &.{.{ .name = "proposal", .schema = p }}, try typed.interop.schema(t, observed.data), &.{});
    const projection = try t.body(project);
    try t.define(project, try projection.ret(try projection.variant(try typed.interop.schema(t, observed.data), "0", try projection.parameter("proposal"))));
    return approval.define(c, .{ .name = "parser.replace", .proposal = try c.schema(Proposal), .occurrence = try b.scalar(u64), .principal = try b.scalar(u64), .reason = try c.schema(agent_contracts.Text(512)), .commit_effect = commit, .authority = try typed.interop.functionId(t, authority), .revalidate = try typed.interop.functionId(t, policy), .failure = try b.constant(void, {}), .channel = "fixture-owner", .evidence = .{ .proof = observed.proof, .consume = observed.consume, .project = try typed.interop.functionId(t, project) } });
}
fn readAndApprove(c: Context, t: *typed.Context, d: observation.Definition, gate: approval.Definition, owner: Id, equal: *const typed.Function) !Id {
    const b = c.builder;
    const body = try typed.interop.scope(t);
    const selected = try typed.interop.adoptValue(body, try b.reference(b.parameter(owner, 0)), try schema(c, t, Proposal));
    const apply = try typed.interop.adoptValue(body, try b.reference(b.parameter(owner, 1)), try t.scalar(bool));
    // Protected operations retain their exact admission sites and owner identity.
    const read = try observation.readEvidence(c, d, owner, try typed.interop.valueId(body, selected));
    const evidence = try body.destructure(try typed.interop.term(body, read, try typed.interop.schema(t, d.evidence)));
    const data = try evidence.get("0");
    const proof = try evidence.get("1");
    const actual = try body.caseOf(data, "0");
    const work = actual.body();
    const same = try work.call(equal, &.{ .{ .name = "left", .value = selected }, .{ .name = "right", .value = actual.payload() } });
    const matching = try work.branch();
    const invalid = try work.branch();
    const approved = try matching.branch();
    const artifact = try matching.branch();
    const commit = try approval.approveWithEvidence(c, gate, owner, try typed.interop.valueId(approved, selected), try typed.interop.valueId(approved, proof));
    const delivered = try typed.interop.term(approved, commit, try typed.interop.schema(t, gate.result));
    const outcome = try schema(c, t, Result);
    var deliveries: [4]*const typed.FinishedCase = undefined;
    inline for (.{ "0", "1", "2", "3" }, 0..) |name, index| {
        const item = try approved.caseOf(delivered, name);
        deliveries[index] = try item.ret(try item.body().variant(outcome, name, item.payload()));
    }
    const decision = try matching.conditional(apply, try approved.ret(try approved.match(delivered, &deliveries)), try artifact.ret(try discardAndReturn(c, t, d, owner, artifact, proof, outcome, "4", selected)));
    const checked = try work.conditional(same, try matching.ret(decision), try invalid.ret(try discardAndReturn(c, t, d, owner, invalid, proof, outcome, "2", try invalid.constant(void, {}))));
    const conflict = try body.caseOf(data, "1");
    const failed = try body.caseOf(data, "2");
    const conflict_result = try discardAndReturn(c, t, d, owner, conflict.body(), proof, outcome, "5", conflict.payload());
    const failed_result = try discardAndReturn(c, t, d, owner, failed.body(), proof, outcome, "6", failed.payload());
    return typed.interop.computationId(t, try body.ret(try body.match(data, &.{
        try actual.ret(checked), try conflict.ret(conflict_result), try failed.ret(failed_result),
    })));
}
fn discardAndReturn(c: Context, t: *typed.Context, d: observation.Definition, owner: Id, body: *typed.Body, proof: *const typed.Value, outcome: *const typed.Schema, tag: []const u8, value: *const typed.Value) !*const typed.Value {
    const consume = try observation.consumeEvidence(c, d, owner, try typed.interop.valueId(body, proof));
    _ = try typed.interop.term(body, consume, try typed.interop.schema(t, d.data));
    return body.variant(outcome, tag, value);
}
pub fn run(c: Context, d: Definition, owner: Id, proposal: Id, apply: Id) !Id {
    const call = try c.builder.term(.{ .call = .{ .function = d.function, .arguments = &.{ proposal, apply } } });
    try c.registry.allowPrivateCall(owner, call, d.function);
    return call;
}
