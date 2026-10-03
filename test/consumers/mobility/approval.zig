//! Three placements retain live evidence, exact human approval and its private
//! grant. The environmental fixture performs one real conditional file replace.
const std = @import("std");
const agent = @import("agent");
const boundary = @import("boundary");
const source = boundary.source;
const Id = source.Id;
const Text = agent.contracts.Text;
const mobility = agent.mobility;
pub const Request = struct { path: Text(256), base: Text(64), replacement: Text(32768), reason: Text(4096) };
pub const Proposal = struct { request: Request, principal: u64 };
pub const Conflict = struct { path: Text(256), expected: Text(64), actual: Text(64) };
pub const Receipt = struct { path: Text(256), base: Text(64), current: Text(64), unchanged: bool };
pub const Delivery = union(enum) { applied: Receipt, conflict: Conflict, failed: Text(64), uncertain: Text(64) };
pub const Read = union(enum) { current: Proposal, conflict: Conflict, failed: Text(64) };
pub const Result = union(enum) { delivery: Delivery, declined: Text(128), invalid, denied };
pub const Task = struct { marker: u64, proposal: Proposal, read: mobility.EnsureInput, human: mobility.EnsureInput, commit: mobility.EnsureInput };
pub const Report = struct { marker: u64, result: Result };
pub const Challenge = struct { occurrence: mobility.Identifier, proposal: Proposal };
pub const Decision = union(enum) { approve, reject: Text(128), amend: Proposal };
pub const Answer = struct { challenge: Challenge, principal: u64, decision: Decision };
pub const HumanInput = struct { channel: agent.contracts.Utf8, purpose: agent.contracts.Utf8, presentation: void, outgoing: Challenge };
pub const HumanReply = union(enum) { response: Answer };

const Application = struct {
    pub fn emit(c: agent.Context) !source.Module {
        const b = c.builder;
        const unit = try b.scalar(void);
        const boolean = try b.scalar(bool);
        const proposal_schema = try c.schema(Proposal);
        const entry = try b.declare(&.{try c.schema(Task)}, try c.schema(Report), &.{}, &.{});
        const task = try b.reference(b.parameter(entry, 0));
        const selected = try field(c, task, Proposal, 1);
        const marker = try field(c, task, u64, 0);
        const live = try c.external("agent.mobility.fixture.target-read.v1", proposal_schema, try c.schema(Read), .read);
        const recheck = try c.external("agent.mobility.fixture.target-check.v1", proposal_schema, boolean, .read);
        const commit = try c.external("agent.mobility.fixture.replace.v1", proposal_schema, try c.schema(Delivery), .commit);
        const observed = try agent.observation.define(c, "mobility.target", live);
        const authority = try b.declare(&.{ proposal_schema, try b.scalar(u64) }, boolean, &.{}, &.{});
        try b.define(authority, try b.pure(try b.primitive(boolean, .equal, &.{ try field(c, try b.reference(b.parameter(authority, 0)), u64, 1), try b.reference(b.parameter(authority, 1)) }, 0)));
        const revalidate = try b.declare(&.{proposal_schema}, boolean, &.{recheck}, &.{});
        try b.define(revalidate, try b.term(.{ .perform = .{ .effect = recheck, .payload = try b.reference(b.parameter(revalidate, 0)) } }));
        const project = try b.declare(&.{proposal_schema}, try c.schema(Read), &.{}, &.{});
        try b.define(project, try b.pure(try b.primitive(try c.schema(Read), .variant, &.{try b.reference(b.parameter(project, 0))}, 0)));
        const m = try mobility.define(c);
        const placement = try b.declare(&.{proposal_schema}, boolean, &.{ m.resolve, m.relocate }, &.{});
        const placed = try b.variable(try c.schema(mobility.PlacementResult));
        const ready = try b.variable(try c.schema(mobility.Placement));
        const refused = try b.variable(try c.schema(mobility.Reason));
        try b.define(placement, try b.bind(placed, try mobility.ensure(c, try field(c, task, mobility.EnsureInput, 4), try b.constant(void, {})), try b.term(.{ .match_sum = .{ .value = try b.reference(placed), .cases = &.{
            .{ .variable = ready, .body = try b.pure(try b.constant(bool, true)) },
            .{ .variable = refused, .body = try b.pure(try b.constant(bool, false)) },
        } } })));
        const gate = try agent.approval.define(c, .{
            .name = "mobility.replace",
            .proposal = proposal_schema,
            .occurrence = try c.schema(mobility.Identifier),
            .principal = try b.scalar(u64),
            .reason = try c.schema(Text(128)),
            .commit_effect = commit,
            .authority = authority,
            .revalidate = revalidate,
            .failure = try b.constant(void, {}),
            .channel = "human-A",
            .placement = placement,
            .evidence = .{ .proof = observed.proof, .consume = observed.consume, .project = project },
        });
        const all = try (source.Row{ .effects = gate.effects }).unionWith(b.allocator(), .{ .effects = &.{ live, m.resolve, m.relocate } });
        b.functions.items[@intCast(entry)].effects = all.effects;
        const proof = try b.variable(observed.proof);
        const data = try b.variable(observed.data);
        const evidence = try b.variable(observed.evidence);
        const after_read = try b.variable(try c.schema(mobility.PlacementResult));
        const at_data = try b.variable(try c.schema(mobility.Placement));
        const no_data = try b.variable(try c.schema(mobility.Reason));
        const after_human = try b.variable(try c.schema(mobility.PlacementResult));
        const at_human = try b.variable(try c.schema(mobility.Placement));
        const no_human = try b.variable(try c.schema(mobility.Reason));
        const answer = try b.variable(gate.result);
        const report = try b.pure(try b.primitive(try c.schema(Report), .product, &.{ marker, try b.reference(answer) }, 0));
        const denied = try b.pure(try b.primitive(gate.result, .variant, &.{try b.constant(void, {})}, 3));
        const discarded = try b.variable(observed.data);
        const discard = try b.bind(discarded, try agent.observation.consumeEvidence(c, observed, entry, try b.reference(proof)), denied);
        const approved = try agent.approval.approveWithEvidence(c, gate, entry, selected, try b.reference(proof));
        const home = try b.bind(after_human, try mobility.ensure(c, try field(c, task, mobility.EnsureInput, 3), try b.constant(void, {})), try b.term(.{ .match_sum = .{ .value = try b.reference(after_human), .cases = &.{
            .{ .variable = at_human, .body = approved }, .{ .variable = no_human, .body = discard },
        } } }));
        const read = try b.bind(evidence, try agent.observation.readEvidence(c, observed, entry, selected), try b.term(.{ .unpack_product = .{
            .value = try b.reference(evidence),
            .variables = &.{ data, proof },
            .body = home,
        } }));
        const work = try b.bind(after_read, try mobility.ensure(c, try field(c, task, mobility.EnsureInput, 2), try b.constant(void, {})), try b.term(.{ .match_sum = .{ .value = try b.reference(after_read), .cases = &.{
            .{ .variable = at_data, .body = read }, .{ .variable = no_data, .body = denied },
        } } }));
        try b.define(entry, try b.bind(answer, work, report));
        return b.module(entry, unit);
    }
};
fn field(c: agent.Context, value: Id, comptime T: type, index: Id) !Id {
    return c.builder.primitive(try c.schema(T), .field, &.{value}, index);
}
pub const System = agent.system(.{ .InitialArgs = Task, .Result = Report, .Failure = void, .application = Application });
pub fn main(init: std.process.Init) !void {
    var args = init.minimal.args.iterate();
    _ = args.next();
    const mode = args.next() orelse return error.ExpectedMode;
    inline for (.{ .{ "task", Task }, .{ "report", Report }, .{ "proposal", Proposal }, .{ "read", Read }, .{ "delivery", Delivery }, .{ "human", HumanInput }, .{ "human-reply", HumanReply }, .{ "identifier", mobility.Identifier }, .{ "integer", u64 }, .{ "boolean", bool } }) |item| {
        if (std.mem.eql(u8, mode, item[0])) {
            var b = source.Builder.init(init.gpa);
            defer b.deinit();
            const schema = try agent.contracts.schema(item[1], &b);
            const bytes = try boundary.data.schema.encodeOwned(init.gpa, b.schemas.items, schema);
            defer init.gpa.free(bytes);
            return write(init, bytes);
        }
    }
    var compiled = try agent.compile(init.gpa, System);
    defer compiled.deinit();
    if (std.mem.eql(u8, mode, "identity")) return write(init, &(try boundary.data.program_image.identity(init.gpa, compiled.program)));
    if (!std.mem.eql(u8, mode, "image")) return error.InvalidMode;
    const bytes = try init.gpa.alloc(u8, try boundary.data.program_image.encodedLength(compiled.program));
    defer init.gpa.free(bytes);
    _ = try compiled.encode(init.gpa, bytes);
    try write(init, bytes);
}
fn write(init: std.process.Init, bytes: []const u8) !void {
    var buffer: [4096]u8 = undefined;
    var output = std.Io.File.stdout().writer(init.io, &buffer);
    try output.interface.writeAll(bytes);
    try output.interface.flush();
}
