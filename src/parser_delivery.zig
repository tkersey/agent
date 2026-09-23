//! Exact parser proposals use the existing live-evidence and approval owners.
const agent_contracts = @import("agent_contracts");
const parser = @import("parser_synthesis.zig");
const source = @import("boundary").computation;
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
fn field(c: Context, comptime T: type, value: Id, index: Id) !Id {
    return c.builder.primitive(try c.schema(T), .field, &.{value}, index);
}
fn result(c: Context, tag: Id, value: Id) !Id {
    return c.builder.pure(try c.builder.primitive(try c.schema(Result), .variant, &.{value}, tag));
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
    const selected = try b.reference(b.parameter(function, 0));
    const gate = try approvalGate(c, observed, commit, selected);
    const effects = try (source.Row{ .effects = gate.effects }).unionWith(b.allocator(), .{ .effects = &.{live} });
    b.functions.items[@intCast(function)].effects = effects.effects;
    try b.define(function, try readAndApprove(c, observed, gate, function, selected));
    return cache.finish(b, .{ .function = function, .effects = effects.effects });
}
fn approvalGate(c: Context, observed: observation.Definition, commit: Id, selected: Id) !approval.Definition {
    const b = c.builder;
    const p = try c.schema(Proposal);
    const boolean = try b.scalar(bool);
    const integer = try b.scalar(u64);
    const authority = try b.declare(&.{ p, integer }, boolean, &.{}, &.{});
    const principal = try b.reference(b.parameter(authority, 1));
    const matches = try b.primitive(boolean, .equal, &.{ principal, try field(c, u64, try b.reference(b.parameter(authority, 0)), 1) }, 0);
    const nonzero = try b.primitive(boolean, .less, &.{ try b.constant(u64, 0), principal }, 0);
    try b.define(authority, try b.term(.{ .conditional = .{ .condition = nonzero, .when_true = try b.pure(matches), .when_false = try b.pure(try b.constant(bool, false)) } }));
    const policy = try b.declare(&.{p}, boolean, &.{}, &.{});
    try b.define(policy, try @import("value_equality.zig").compare(b, p, try b.reference(b.parameter(policy, 0)), selected, try b.constant(void, {})));
    const project = try b.declare(&.{p}, observed.data, &.{}, &.{});
    try b.define(project, try b.pure(try b.primitive(observed.data, .variant, &.{try b.reference(b.parameter(project, 0))}, 0)));
    return approval.define(c, .{ .name = "parser.replace", .proposal = p, .occurrence = integer, .principal = integer, .reason = try c.schema(agent_contracts.Text(512)), .commit_effect = commit, .authority = authority, .revalidate = policy, .failure = try b.constant(void, {}), .channel = "fixture-owner", .evidence = .{ .proof = observed.proof, .consume = observed.consume, .project = project } });
}
fn readAndApprove(c: Context, d: observation.Definition, gate: approval.Definition, owner: Id, selected: Id) !Id {
    const b = c.builder;
    const evidence = try b.variable(d.evidence);
    const data = try b.variable(d.data);
    const proof = try b.variable(d.proof);
    const actual = try b.variable(try c.schema(Proposal));
    const conflict = try b.variable(try c.schema(Conflict));
    const failed = try b.variable(try c.schema(agent_contracts.Text(64)));
    const discarded = try b.variable(d.data);
    const consume = try observation.consumeEvidence(c, d, owner, try b.reference(proof));
    const artifact = try b.bind(discarded, consume, try result(c, 4, selected));
    const approved = try b.variable(gate.result);
    const handled = try approvalResult(c, gate, try b.reference(approved));
    const approve = try b.bind(approved, try approval.approveWithEvidence(c, gate, owner, selected, try b.reference(proof)), handled);
    const choose = try b.term(.{ .conditional = .{ .condition = try b.reference(b.parameter(owner, 1)), .when_true = approve, .when_false = artifact } });
    const equal = try b.variable(try b.scalar(bool));
    const invalid = try b.bind(discarded, consume, try result(c, 2, try b.constant(void, {})));
    const checked = try b.bind(equal, try @import("value_equality.zig").compare(b, try c.schema(Proposal), selected, try b.reference(actual), try b.constant(void, {})), try b.term(.{ .conditional = .{ .condition = try b.reference(equal), .when_true = choose, .when_false = invalid } }));
    const dispatch = try b.term(.{ .match_sum = .{ .value = try b.reference(data), .cases = &.{
        .{ .variable = actual, .body = checked },
        .{ .variable = conflict, .body = try b.bind(discarded, consume, try result(c, 5, try b.reference(conflict))) },
        .{ .variable = failed, .body = try b.bind(discarded, consume, try result(c, 6, try b.reference(failed))) },
    } } });
    const unpack = try b.term(.{ .unpack_product = .{ .value = try b.reference(evidence), .variables = &.{ data, proof }, .body = dispatch } });
    return b.bind(evidence, try observation.readEvidence(c, d, owner, selected), unpack);
}
fn approvalResult(c: Context, gate: approval.Definition, value: Id) !Id {
    const b = c.builder;
    var cases: [4]struct { variable: Id, body: Id } = undefined;
    const types = [_]Id{ try c.schema(Delivery), try c.schema(agent_contracts.Text(512)), try b.scalar(void), try b.scalar(void) };
    for (types, 0..) |schema, index| {
        const v = try b.variable(schema);
        cases[index] = .{ .variable = v, .body = try result(c, index, try b.reference(v)) };
    }
    _ = gate;
    return b.term(.{ .match_sum = .{ .value = value, .cases = &.{
        .{ .variable = cases[0].variable, .body = cases[0].body }, .{ .variable = cases[1].variable, .body = cases[1].body },
        .{ .variable = cases[2].variable, .body = cases[2].body }, .{ .variable = cases[3].variable, .body = cases[3].body },
    } } });
}
pub fn run(c: Context, d: Definition, owner: Id, proposal: Id, apply: Id) !Id {
    const call = try c.builder.term(.{ .call = .{ .function = d.function, .arguments = &.{ proposal, apply } } });
    try c.registry.allowPrivateCall(owner, call, d.function);
    return call;
}
