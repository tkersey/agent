//! Exact checked candidate -> current read proof -> approval -> conditional write.
const agent = @import("agent");
const t = @import("types.zig");
const s = @import("source.zig");
const Pop = @import("plans.zig").Pop;
const Id = s.Id;
const E = s.E;
pub const Definition = struct { function: Id, effects: []const Id };

pub fn define(e: E) !Definition {
    const b = e.b();
    const read = try e.c.external("inquiry.repair.read.v1", try e.schema(t.Proposal), try e.schema(t.Read), .read);
    const observed = try agent.observation.define(e.c, "inquiry.repair.current", read);
    const proposal = try b.variable(try e.schema(t.Proposal));
    const approval = try approvalDefinition(e, observed, proposal);
    const effects = try e.row(&.{observed.live_effect}, approval.effects);
    const execute = try b.declare(&.{ try e.schema(t.Task), try e.schema(t.Candidate) }, try e.schema(t.Result), effects, &.{});
    try b.define(execute, try revalidate(e, observed, approval, execute, proposal));
    const f = try b.declare(&.{ try e.schema(t.Task), try e.schema(t.InquiryOutcome) }, try e.schema(t.Result), effects, &.{});
    const candidate = try b.variable(try e.schema(?t.Candidate));
    const selected = try b.variable(try e.schema(t.Candidate));
    const absent = try b.variable(try e.schema(void));
    const unresolved = try result(e, 1, try e.value(t.Reason, .{ .bytes = "Inquiry produced no independently checked repair." }));
    const branch = try b.term(.{ .match_sum = .{ .value = try e.ref(candidate), .cases = &.{
        .{ .variable = absent, .body = unresolved },
        .{ .variable = selected, .body = try e.call(execute, &.{ try e.p(f, 0), try e.ref(selected) }) },
    } } });
    const inquiry = try e.p(f, 1);
    const continued = try b.bind(candidate, try e.call(try selectCandidate(e), &.{try e.field([]const t.Found, inquiry, 1)}), branch);
    const status = try e.field(u8, inquiry, 0);
    const stopped = try e.cond(try e.eq(status, try e.value(u8, 2)), try result(e, 8, try e.value(void, {})), unresolved);
    const unavailable = try e.cond(try e.eq(status, try e.value(u8, 5)), try result(e, 5, try e.value(t.Hash, .{ .bytes = "Experiment environment unavailable." })), stopped);
    try b.define(f, try e.cond(try e.eq(status, try e.value(u8, 0)), continued, unavailable));
    return .{ .function = f, .effects = effects };
}

fn selectCandidate(e: E) !Id {
    const b = e.b();
    const f = try b.declare(&.{try e.schema([]const t.Found)}, try e.schema(?t.Candidate), &.{}, &.{});
    const pop = try Pop.init(e, []const t.Found, t.Found);
    const candidate = try b.variable(try e.schema(t.Candidate));
    const ignored = try b.variable(try e.schema(t.Reason));
    const body = try b.term(.{ .match_sum = .{
        .value = try e.field(t.Finding, try e.ref(pop.head), 1),
        .cases = &.{ .{ .variable = candidate, .body = try b.pure(try e.variant(?t.Candidate, try e.ref(candidate), 1)) }, .{ .variable = ignored, .body = try e.call(f, &.{try e.ref(pop.rest)}) } },
    } });
    try b.define(f, try pop.match(e, try e.p(f, 0), try b.pure(try e.value(?t.Candidate, null)), body));
    return f;
}

fn approvalDefinition(e: E, observed: agent.observation.Definition, selected: Id) !agent.approval.Definition {
    const b = e.b();
    const proposal = try e.schema(t.Proposal);
    const integer = try e.schema(u64);
    const boolean = try e.schema(bool);
    const write = try e.c.external("inquiry.repair.replace.v1", proposal, try e.schema(t.Delivery), .commit);
    const authority = try b.declare(&.{ proposal, integer }, boolean, &.{}, &.{});
    const principal = try e.p(authority, 1);
    try b.define(authority, try e.cond(try e.less(try e.value(u64, 0), principal), try b.pure(try e.eq(principal, try e.field(u64, try e.p(authority, 0), 3))), try b.pure(try e.value(bool, false))));
    const policy = try b.declare(&.{proposal}, boolean, &.{}, &.{});
    try b.define(policy, try agent.value_equality.compare(b, proposal, try e.p(policy, 0), try e.ref(selected), try e.value(void, {})));
    const project = try b.declare(&.{proposal}, observed.data, &.{}, &.{});
    try b.define(project, try b.pure(try e.variant(t.Read, try e.p(project, 0), 0)));
    return agent.approval.define(e.c, .{
        .name = "inquiry.repair.change",
        .proposal = proposal,
        .occurrence = integer,
        .principal = integer,
        .reason = try e.schema(t.Hash),
        .commit_effect = write,
        .authority = authority,
        .revalidate = policy,
        .failure = try e.value(void, {}),
        .channel = "repository-owner",
        .evidence = .{ .proof = observed.proof, .consume = observed.consume, .project = project },
    });
}

fn revalidate(e: E, observed: agent.observation.Definition, approval: agent.approval.Definition, f: Id, selected: Id) !Id {
    const b = e.b();
    const task = try e.p(f, 0);
    const subject = try e.field(t.Subject, task, 0);
    const candidate = try e.p(f, 1);
    const evidence = try b.variable(observed.evidence);
    const data = try b.variable(observed.data);
    const proof = try b.variable(observed.proof);
    const actual = try b.variable(try e.schema(t.Proposal));
    const failed = try b.variable(try e.schema(t.Hash));
    const same = try b.variable(try e.schema(bool));
    const unchanged = try b.variable(try e.schema(bool));
    const context_matches = try b.variable(try e.schema(bool));
    const discarded = try b.variable(observed.data);
    const consume = try agent.observation.consumeEvidence(e.c, observed, f, try e.ref(proof));
    const base = try e.field(t.Live, try e.ref(actual), 1);
    const conflict = try b.bind(discarded, consume, try result(e, 2, base));
    const failure = try b.bind(discarded, consume, try result(e, 5, try e.ref(failed)));
    const invalid_context = try b.bind(discarded, consume, try result(e, 4, try e.value(void, {})));
    const proposed = try e.product(t.Proposal, &.{ try e.field(agent.contracts.Text(32), subject, 0), base, candidate, try e.field(u64, task, 6), try e.field(u64, task, 7), try e.field(t.Hash, subject, 6) });
    const no_change = try b.bind(discarded, consume, try result(e, 7, try e.product(t.Receipt, &.{ base, proposed })));
    const approve = try b.bind(selected, try b.pure(proposed), try approveExact(e, approval, f, selected, proof));
    const artifact = try b.bind(discarded, consume, try result(e, 9, try e.product(t.Receipt, &.{ base, proposed })));
    const delivery = try e.cond(try e.eq(try e.field(u8, task, 9), try e.value(u8, 1)), artifact, approve);
    const choose = try b.bind(unchanged, try agent.value_equality.compare(b, try e.schema(t.Source), try e.field(t.Source, candidate, 0), try e.field(t.Source, base, 0), try e.value(void, {})), try e.cond(try e.ref(unchanged), no_change, delivery));
    const matching = try b.bind(same, try agent.value_equality.compare(b, try e.schema(t.Source), try e.field(t.Source, subject, 1), try e.field(t.Source, base, 0), try e.value(void, {})), try e.cond(try e.ref(same), choose, conflict));
    const scoped = try b.bind(context_matches, try agent.value_equality.compare(b, try e.schema(t.Proposal), proposed, try e.ref(actual), try e.value(void, {})), try e.cond(try e.ref(context_matches), matching, invalid_context));
    const branch = try b.term(.{ .match_sum = .{ .value = try e.ref(data), .cases = &.{
        .{ .variable = actual, .body = scoped }, .{ .variable = failed, .body = failure },
    } } });
    const unpack = try b.term(.{ .unpack_product = .{ .value = try e.ref(evidence), .variables = &.{ data, proof }, .body = branch } });
    const query = try e.product(t.Proposal, &.{ try e.field(agent.contracts.Text(32), subject, 0), try e.product(t.Live, &.{ try e.field(t.Source, subject, 1), try e.value(t.Hash, .{ .bytes = "" }) }), candidate, try e.field(u64, task, 6), try e.field(u64, task, 7), try e.field(t.Hash, subject, 6) });
    return b.bind(evidence, try agent.observation.readEvidence(e.c, observed, f, query), unpack);
}

fn approveExact(e: E, approval: agent.approval.Definition, owner: Id, selected: Id, proof: Id) !Id {
    const b = e.b();
    const approved = try b.variable(approval.result);
    const delivery = try b.variable(try e.schema(t.Delivery));
    const decline = try b.variable(try e.schema(t.Hash));
    const invalid = try b.variable(try e.schema(void));
    const denied = try b.variable(try e.schema(void));
    const success = try b.variable(try e.schema(t.Live));
    const conflict = try b.variable(try e.schema(t.Live));
    const failure = try b.variable(try e.schema(t.Hash));
    const uncertain = try b.variable(try e.schema(t.Hash));
    const delivered = try b.term(.{ .match_sum = .{ .value = try e.ref(delivery), .cases = &.{
        .{ .variable = success, .body = try result(e, 0, try e.product(t.Receipt, &.{ try e.ref(success), try e.ref(selected) })) },
        .{ .variable = conflict, .body = try result(e, 2, try e.ref(conflict)) },
        .{ .variable = failure, .body = try result(e, 5, try e.ref(failure)) },
        .{ .variable = uncertain, .body = try result(e, 6, try e.ref(uncertain)) },
    } } });
    const handled = try b.term(.{ .match_sum = .{ .value = try e.ref(approved), .cases = &.{
        .{ .variable = delivery, .body = delivered },                              .{ .variable = decline, .body = try result(e, 3, try e.ref(decline)) },
        .{ .variable = invalid, .body = try result(e, 4, try e.value(void, {})) }, .{ .variable = denied, .body = try result(e, 1, try e.value(t.Reason, .{ .bytes = "Approval authority or amended proposal denied; a new validated attempt is required." })) },
    } } });
    return b.bind(approved, try agent.approval.approveWithEvidence(e.c, approval, owner, try e.ref(selected), try e.ref(proof)), handled);
}

fn result(e: E, tag: u64, value: Id) !Id {
    return e.b().pure(try e.variant(t.Result, value, tag));
}
