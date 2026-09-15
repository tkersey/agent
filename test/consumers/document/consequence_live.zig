//! Live revalidation and exact-operation approval, outside every multi delimiter.
const agent = @import("agent");
const source = @import("boundary").computation;
const Id = source.Id;
const emit = @import("source.zig");
const t = @import("consequence_types.zig");

pub const Definition = struct { function: Id, effects: []const Id };

pub fn define(c: agent.Context, observation: agent.observation.Definition) !Definition {
    const b = c.builder;
    const action = try c.schema(t.Action);
    const memory = try c.schema(t.Memory);
    const pair = try pairSchema(c);
    const selected = try b.variable(action);
    const approval = try approvalContract(c, observation, selected);
    const rows = try emit.row(b, &.{observation.live_effect}, approval.effects);
    const f = try b.declare(&.{ memory, try c.schema(t.Context), try c.schema(t.Group), try b.scalar(bool) }, pair, rows, &.{});
    const known = try emit.field(b, try c.schema(t.Known), try b.reference(b.parameter(f, 2)), 1);
    const candidate = try emit.field(b, action, known, 1);
    const receipt = try receiptValue(c, try b.reference(b.parameter(f, 2)), try b.reference(b.parameter(f, 3)));
    const operation = try emit.field(b, try c.schema(@FieldType(t.Action, "operation")), try b.reference(selected), 0);
    const no_change = try emit.equal(b, try b.primitive(try b.scalar(u32), .enum_tag, &.{operation}, 0), try b.constant(u32, 0));
    const continuation = try revalidate(c, observation, approval, f, selected, receipt, no_change);
    try b.define(f, try b.bind(selected, try b.pure(candidate), continuation));
    return .{ .function = f, .effects = rows };
}

fn approvalContract(c: agent.Context, observed: agent.observation.Definition, selected: Id) !agent.approval.Definition {
    const b = c.builder;
    const action = try c.schema(t.Action);
    const integer = try b.scalar(u64);
    const boolean = try b.scalar(bool);
    const commit = try c.external("document.terminology.replace.v1", action, try c.schema(t.Operation), .commit);
    const authority = try b.declare(&.{ action, integer }, boolean, &.{}, &.{});
    const offered = try b.reference(b.parameter(authority, 0));
    const proposal = try emit.field(b, try c.schema(t.Proposal), offered, 1);
    const principal = try emit.field(b, integer, proposal, 4);
    try b.define(authority, try b.term(.{ .conditional = .{
        .condition = try emit.equal(b, try b.reference(b.parameter(authority, 1)), try b.constant(u64, 7)),
        .when_true = try b.pure(try emit.equal(b, principal, try b.constant(u64, 7))),
        .when_false = try b.pure(try b.constant(bool, false)),
    } }));
    const policy = try b.declare(&.{action}, boolean, &.{}, &.{});
    // A different amendment is a new editing attempt. An identical amendment
    // still traverses the existing fresh-challenge path; no old grant is reused.
    try b.define(policy, try agent.value_equality.compare(b, action, try b.reference(b.parameter(policy, 0)), try b.reference(selected), try b.constant(void, {})));
    const project = try b.declare(&.{action}, observed.data, &.{}, &.{});
    const proposed = try emit.field(b, try c.schema(t.Proposal), try b.reference(b.parameter(project, 0)), 1);
    const base = try emit.field(b, try c.schema(t.Observation), proposed, 1);
    try b.define(project, try b.pure(try b.primitive(observed.data, .variant, &.{base}, 0)));
    return agent.approval.define(c, .{
        .name = "document.terminology.change",
        .proposal = action,
        .occurrence = integer,
        .principal = integer,
        .reason = try c.schema(t.Reason),
        .commit_effect = commit,
        .authority = authority,
        .revalidate = policy,
        .failure = try b.constant(void, {}),
        .channel = "document-owner",
        .evidence = .{ .proof = observed.proof, .consume = observed.consume, .project = project },
    });
}

fn revalidate(c: agent.Context, observed: agent.observation.Definition, approval: agent.approval.Definition, owner: Id, selected: Id, receipt: Id, no_change: Id) !Id {
    const b = c.builder;
    const memory = try b.reference(b.parameter(owner, 0));
    const frozen = try b.reference(b.parameter(owner, 1));
    const task = try emit.field(b, try c.schema(t.Request), frozen, 0);
    const base = try emit.field(b, try c.schema(t.Observation), frozen, 1);
    const evidence = try b.variable(observed.evidence);
    const read = try b.variable(observed.data);
    const proof = try b.variable(observed.proof);
    const actual = try b.variable(try c.schema(t.Observation));
    const failed = try b.variable(try c.schema(t.Reason));
    const same = try b.variable(try b.scalar(bool));
    const discarded = try b.variable(observed.data);
    const discard = try agent.observation.consumeEvidence(c, observed, owner, try b.reference(proof));
    const conflict = try b.bind(discarded, discard, try outcome(c, memory, 3, try b.reference(actual)));
    const failure = try b.bind(discarded, discard, try outcome(c, memory, 4, try b.reference(failed)));
    const approve = try finishApproval(c, approval, owner, selected, proof, receipt, memory);
    const unchanged = try b.bind(discarded, discard, try successful(c, receipt, 1));
    const permitted = try b.term(.{ .conditional = .{
        .condition = no_change,
        .when_true = unchanged,
        .when_false = approve,
    } });
    const matching = try b.bind(same, try agent.value_equality.compare(b, try c.schema(t.Observation), base, try b.reference(actual), try b.constant(void, {})), try b.term(.{ .conditional = .{
        .condition = try b.reference(same),
        .when_true = permitted,
        .when_false = conflict,
    } }));
    const checked = try b.term(.{ .match_sum = .{
        .value = try b.reference(read),
        .cases = &.{
            .{ .variable = actual, .body = matching },
            .{ .variable = failed, .body = failure },
        },
    } });
    const unpack = try b.term(.{ .unpack_product = .{
        .value = try b.reference(evidence),
        .variables = &.{ read, proof },
        .body = checked,
    } });
    return b.bind(evidence, try agent.observation.readEvidence(c, observed, owner, try emit.field(b, try c.schema(t.Path), task, 0)), unpack);
}

fn finishApproval(c: agent.Context, approval: agent.approval.Definition, owner: Id, selected: Id, proof: Id, receipt: Id, memory: Id) !Id {
    const b = c.builder;
    const answer = try b.variable(approval.result);
    const operation = try b.variable(try c.schema(t.Operation));
    const declined = try b.variable(try c.schema(t.Reason));
    const invalid = try b.variable(try b.scalar(void));
    const denied = try b.variable(try b.scalar(void));
    const success = try b.variable(try c.schema(t.Observation));
    const conflict = try b.variable(try c.schema(t.Observation));
    const failed = try b.variable(try c.schema(t.Reason));
    const uncertain = try b.variable(try c.schema(t.Reason));
    const result = try b.term(.{ .match_sum = .{
        .value = try b.reference(operation),
        .cases = &.{
            .{ .variable = success, .body = try successful(c, receipt, 0) },
            .{ .variable = conflict, .body = try outcome(c, memory, 3, try b.reference(conflict)) },
            .{ .variable = failed, .body = try outcome(c, memory, 4, try b.reference(failed)) },
            .{ .variable = uncertain, .body = try outcome(c, memory, 5, try b.reference(uncertain)) },
        },
    } });
    const matched = try b.term(.{ .match_sum = .{
        .value = try b.reference(answer),
        .cases = &.{
            .{ .variable = operation, .body = result },
            .{ .variable = declined, .body = try outcome(c, memory, 6, try b.reference(declined)) },
            .{ .variable = invalid, .body = try outcome(c, memory, 7, try b.constant(void, {})) },
            .{ .variable = denied, .body = try outcome(c, memory, 8, try b.constant(void, {})) },
        },
    } });
    const approve = try agent.approval.approveWithEvidence(c, approval, owner, try b.reference(selected), try b.reference(proof));
    return b.bind(answer, approve, matched);
}

pub fn pairSchema(c: agent.Context) !Id {
    return c.builder.schema(.{ .product = &.{ try c.schema(t.Memory), try c.schema(t.Reply) } });
}

pub fn outcome(c: agent.Context, memory: Id, tag: u64, value: Id) !Id {
    const b = c.builder;
    const reply = try b.primitive(try c.schema(t.Reply), .variant, &.{value}, tag);
    return b.pure(try emit.product(b, try pairSchema(c), &.{ memory, reply }));
}

fn successful(c: agent.Context, receipt: Id, tag: u64) !Id {
    const memory = try c.builder.primitive(try c.schema(t.Memory), .variant, &.{receipt}, 1);
    return outcome(c, memory, tag, receipt);
}

fn receiptValue(c: agent.Context, group: Id, by_choice: Id) !Id {
    const b = c.builder;
    const members = try emit.field(b, try c.schema([]const u64), group, 2);
    const id = try emit.field(b, try b.scalar(u64), group, 0);
    const length = try b.primitive(try b.scalar(u64), .sequence_length, &.{members}, 0);
    const both = try emit.equal(b, length, try b.constant(u64, 2));
    var supported: [2]Id = undefined;
    for (&supported, 1..) |*value, member| value.* = try b.primitive(try b.scalar(bool), .select, &.{ both, try b.constant(bool, true), try emit.equal(b, id, try b.constant(u64, member)) }, 0);
    return emit.product(b, try c.schema(t.Receipt), &.{
        by_choice, try b.primitive(try c.schema([2]bool), .sequence, &supported, 0),
    });
}
